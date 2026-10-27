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

let left = null; // analyses gratuites restantes (null = Premium)

async function refreshCredits() {
  if (!userId) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/status?userId=${userId}`);
    showCredits(await res.json());
  } catch {
    $("credits").textContent = "hors ligne";
  }
}

function showCredits({ creditsLeft, premium, premiumUntil, price }) {
  left = premium ? null : creditsLeft;
  $("credits").textContent = premium ? "⭐ Premium" : creditsLeft === 1 ? "1 analyse" : `${creditsLeft} analyses`;
  $("credits").title = premium && premiumUntil
    ? `Premium actif jusqu'au ${new Date(premiumUntil).toLocaleDateString("fr-FR")}`
    : premium ? "Premium actif" : "Passer à Escale Premium";
  if (price) $("pw-price").textContent = price.label.replace(" / an", "");
  if (premium) openPaywall(false);
  else if (creditsLeft <= 0) openPaywall(true, true);
}

function openPaywall(open, forced = false) {
  $("paywall").hidden = !open;
  $("pw-close").hidden = forced;
  $("pw-title").innerHTML = forced ? "<strong>Tes analyses gratuites sont terminées.</strong>" : "<strong>Voyage sans compter, toute l'année.</strong>";
}

$("credits").addEventListener("click", () => {
  if (left !== null) openPaywall($("paywall").hidden, left <= 0);
});
$("pw-close").addEventListener("click", () => openPaywall(false));

async function postJson(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur serveur (${res.status})`);
  return data;
}

$("buy").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  $("buy-msg").textContent = "Ouverture du paiement sécurisé…";
  try {
    const { url } = await postJson("/api/checkout", { userId, email: $("buy-email").value.trim() });
    await chrome.tabs.create({ url }); // page de paiement Notch Pay dans un nouvel onglet
    $("buy-msg").textContent = "Termine le paiement dans l'onglet ouvert : Premium s'activera ici automatiquement.";
  } catch (err) {
    $("buy-msg").textContent = err.message.includes("fetch") ? "Impossible de joindre le serveur Escale." : err.message;
  } finally {
    button.disabled = false;
  }
});

$("restore").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    showCredits(await postJson("/api/restore", { userId, reference: $("restore-ref").value.trim() }));
    addMessage("agent", "⭐ Escale Premium est activé dans l'extension. Où partons-nous ?");
  } catch (err) {
    $("buy-msg").textContent = err.message;
  }
});

// Au retour du paiement, on remet le compteur à jour.
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshCredits());
window.addEventListener("focus", refreshCredits);

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
      showCredits(await res.json());
      return;
    }
    if (res.status === 429 && (await res.clone().json().catch(() => ({}))).error === "daily_limit") {
      status.remove();
      addMessage("error", "Tu as atteint la limite de 30 analyses pour aujourd'hui. On reprend demain !");
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
    if (!event.premium) showCredits({ creditsLeft: event.creditsLeft });
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
