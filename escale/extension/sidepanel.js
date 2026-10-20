const ALL_SITES = { origins: ["<all_urls>"] };

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");

let userId = null;
let conversationId = null;
let busy = false;
let hasSiteAccess = false;

// ---------- Initialisation ----------
async function init() {
  const stored = await chrome.storage.local.get("userId");
  userId = stored.userId;
  if (!userId) {
    userId = crypto.randomUUID();
    await chrome.storage.local.set({ userId });
  }
  hasSiteAccess = await chrome.permissions.contains(ALL_SITES);
  await refreshCredits();
}

async function refreshCredits() {
  try {
    const res = await fetch(`${SERVER_URL}/api/status?userId=${userId}`);
    const data = await res.json();
    showCredits(data.creditsLeft);
  } catch {
    $("credits").textContent = "hors ligne";
  }
}

function showCredits(n) {
  $("credits").textContent = n === 1 ? "1 analyse" : `${n} analyses`;
  $("paywall").hidden = n > 0;
}

// ---------- Lecture de la page ouverte ----------
async function readCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) {
    throw new Error("Ouvre une page web (hôtel, vol, blog…) puis réessaie.");
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const meta = document.querySelector('meta[name="description"]')?.content || "";
      const text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n");
      return { url: location.href, title: document.title, text: (meta ? meta + "\n\n" : "") + text };
    },
  });
  return result.result;
}

// ---------- Envoi à l'agent ----------
async function send({ message, page }) {
  if (busy) return;
  setBusy(true);

  if (message) addMessage("user", message);
  if (page) addPageChip(page);
  const status = addStatus("✨ L'agent réfléchit…");

  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, conversationId, message, page }),
    });

    if (res.status === 402) {
      status.remove();
      showCredits(0);
      return;
    }
    if (res.status === 429) {
      status.remove();
      addMessage("error", "Cette conversation est pleine. Clique sur « ＋ Nouveau » pour en commencer une autre.");
      return;
    }
    if (!res.ok || !res.body) throw new Error(`Erreur serveur (${res.status})`);

    // Le serveur envoie une ligne JSON par événement.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) handleEvent(JSON.parse(line), status);
      }
    }
  } catch (err) {
    addMessage("error", err.message.includes("fetch") ? "Impossible de joindre le serveur Escale. Est-il lancé ?" : err.message);
  } finally {
    status.remove();
    setBusy(false);
  }
}

function handleEvent(event, status) {
  if (event.type === "meta") {
    conversationId = event.conversationId;
    showCredits(event.creditsLeft);
  } else if (event.type === "status") {
    status.textContent = event.text;
  } else if (event.type === "answer") {
    addMessage("agent", event.text);
  } else if (event.type === "error") {
    addMessage("error", event.text);
  }
}

// ---------- Interface ----------
function setBusy(value) {
  busy = value;
  $("analyze").disabled = value;
  $("send").disabled = value;
}

function addMessage(kind, text) {
  chat.querySelector(".welcome")?.remove();
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  if (kind === "agent") div.innerHTML = renderMarkdown(text);
  else div.textContent = text;
  chat.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "start" });
  return div;
}

function addPageChip(page) {
  chat.querySelector(".welcome")?.remove();
  const div = document.createElement("div");
  div.className = "page-chip";
  div.textContent = `📄 ${page.title || page.url}`;
  chat.appendChild(div);
}

function addStatus(text) {
  const p = document.createElement("p");
  p.className = "status";
  p.textContent = text;
  chat.appendChild(p);
  p.scrollIntoView({ behavior: "smooth" });
  return p;
}

// Markdown minimal et sûr : on échappe tout le HTML avant de formater.
function renderMarkdown(md) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  let html = "";
  let list = null;
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^#{1,3}\s+(.*)/))) {
      closeList();
      html += `<h3>${inline(m[1])}</h3>`;
    } else if ((m = line.match(/^#{4,6}\s+(.*)/))) {
      closeList();
      html += `<h4>${inline(m[1])}</h4>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "" || /^-{3,}$/.test(line.trim())) {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// ---------- Événements ----------
$("analyze").addEventListener("click", async () => {
  // La demande de permission doit être le tout premier appel du clic.
  if (!hasSiteAccess) {
    hasSiteAccess = await chrome.permissions.request(ALL_SITES);
    if (!hasSiteAccess) {
      addMessage("error", "Sans accès aux pages, Escale ne peut pas lire le site que tu regardes.");
      return;
    }
  }
  try {
    const page = await readCurrentPage();
    const message = input.value.trim();
    input.value = "";
    await send({ message, page });
  } catch (err) {
    addMessage("error", err.message);
  }
});

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  send({ message });
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

$("reset").addEventListener("click", () => {
  conversationId = null;
  chat.innerHTML = '<div class="welcome"><p><strong>Nouvelle conversation</strong></p><p>Analyse une page ou décris ton voyage idéal.</p></div>';
});

init();
