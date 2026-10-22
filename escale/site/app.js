const SERVER_URL = "https://escale-luv4.onrender.com";
const RESET_WORDS = ["nouveau", "/nouveau", "recommencer"];

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");

let conversationId = null;
let busy = false;

// Identifiant anonyme pour compter les analyses gratuites.
function getUserId() {
  let id = null;
  try {
    id = localStorage.getItem("escaleUserId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("escaleUserId", id);
    }
  } catch {
    id ??= crypto.randomUUID();
  }
  return id;
}
const userId = getUserId();

async function refreshCredits() {
  try {
    const res = await fetch(`${SERVER_URL}/api/status?userId=${userId}`);
    showCredits((await res.json()).creditsLeft);
  } catch {
    $("credits").textContent = "réveil du serveur…";
  }
}

function showCredits(n) {
  $("credits").textContent = n === 1 ? "1 analyse" : `${n} analyses`;
  $("paywall").hidden = n > 0;
}

async function send(message) {
  if (busy) return;
  chat.querySelector(".suggestions")?.remove();

  if (RESET_WORDS.includes(message.toLowerCase())) {
    conversationId = null;
    addMessage("agent", "🆕 Nouvelle conversation. Décris-moi ton prochain voyage !");
    return;
  }

  busy = true;
  $("send").disabled = true;
  addMessage("user", message);
  const status = addStatus("✨ L'agent réfléchit…");

  try {
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, conversationId, message }),
    });
    if (res.status === 402) return showCredits(0);
    if (res.status === 429) {
      conversationId = null;
      return addMessage("error", "Cette conversation est pleine. Renvoie ton message pour en commencer une nouvelle.");
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
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "meta") {
          conversationId = event.conversationId;
          showCredits(event.creditsLeft);
        } else if (event.type === "status") status.textContent = event.text;
        else if (event.type === "answer") addMessage("agent", event.text);
        else if (event.type === "error") addMessage("error", event.text);
      }
    }
  } catch {
    addMessage("error", "Le serveur ne répond pas. Réessaie dans une minute (il se réveille parfois).");
  } finally {
    status.remove();
    busy = false;
    $("send").disabled = false;
  }
}

function addMessage(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  if (kind === "agent") div.innerHTML = renderMarkdown(text);
  else div.textContent = text;
  chat.appendChild(div);
  // On montre le début de la réponse de l'agent, pas sa fin.
  chat.scrollTop = kind === "agent" ? div.offsetTop - chat.offsetTop - 8 : chat.scrollHeight;
}

function addStatus(text) {
  const p = document.createElement("p");
  p.className = "status";
  p.textContent = text;
  chat.appendChild(p);
  chat.scrollTop = chat.scrollHeight;
  return p;
}

// Markdown minimal et sûr : tout le HTML est échappé avant la mise en forme.
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
    if ((m = line.match(/^#{1,3}\s+(.*)/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^#{4,6}\s+(.*)/))) { closeList(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (!line.trim() || /^-{3,}$/.test(line.trim())) closeList();
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  send(message);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

// Questions suggérées et destinations : on remonte au chat puis on envoie.
document.addEventListener("click", (e) => {
  const q = e.target.closest("button[data-q]")?.dataset.q;
  if (!q) return;
  if (!chat.contains(e.target)) document.getElementById("essayer").scrollIntoView({ behavior: "smooth" });
  send(q);
});

refreshCredits();
