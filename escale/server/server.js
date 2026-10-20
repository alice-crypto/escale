import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { AIError, createConversation, deleteConversation, getConversation, runAgentTurn } from "./agent.js";

const PORT = Number(process.env.PORT || 8787);
const FREE_ANALYSES = Number(process.env.FREE_ANALYSES || 3);
const MAX_MESSAGES_PER_CONVERSATION = 10;
const USAGE_FILE = new URL("./usage.json", import.meta.url);

// --- Compteur d'utilisation (fichier JSON pour le prototype) ---
let usage = {};
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
} catch {
  usage = {};
}
const saveUsage = () => fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));

function account(userId) {
  usage[userId] ??= { used: 0, paidCredits: 0 };
  return usage[userId];
}

function creditsLeft(acc) {
  return Math.max(0, FREE_ANALYSES - acc.used) + acc.paidCredits;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- API ---
const app = express();
app.use(cors());
app.use(express.json({ limit: "500kb" }));

app.get("/", (req, res) => res.send("Escale server OK"));
app.get("/confidentialite", (req, res) =>
  res.sendFile(fileURLToPath(new URL("./public/confidentialite.html", import.meta.url))),
);

app.get("/api/status", (req, res) => {
  const userId = String(req.query.userId || "");
  if (!UUID_RE.test(userId)) return res.status(400).json({ error: "userId invalide" });
  const acc = account(userId);
  res.json({ creditsLeft: creditsLeft(acc), freeAnalyses: FREE_ANALYSES });
});

app.post("/api/chat", async (req, res) => {
  const { userId, conversationId, message, page } = req.body ?? {};
  if (!UUID_RE.test(String(userId || ""))) return res.status(400).json({ error: "userId invalide" });
  if (!message && !page) return res.status(400).json({ error: "Message vide" });

  const acc = account(userId);
  let convId = conversationId;
  let conversation = convId ? getConversation(convId) : null;

  if (conversation && conversation.userId !== userId) {
    return res.status(403).json({ error: "Conversation inconnue" });
  }

  if (conversation && conversation.userTurns >= MAX_MESSAGES_PER_CONVERSATION) {
    return res.status(429).json({ error: "conversation_full" });
  }

  // Une nouvelle conversation (ou une nouvelle page analysée) consomme une analyse.
  let consumed = null;
  if (!conversation || page) {
    if (creditsLeft(acc) <= 0) return res.status(402).json({ error: "no_credits", creditsLeft: 0 });
    if (acc.used < FREE_ANALYSES) {
      acc.used += 1;
      consumed = "free";
    } else {
      acc.paidCredits -= 1;
      consumed = "paid";
    }
    saveUsage();
  }
  const isNewConversation = !conversation;
  if (!conversation) {
    convId = crypto.randomUUID();
    conversation = createConversation(convId);
    conversation.userId = userId;
  }

  // Réponse en flux : une ligne JSON par événement.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const emit = (event) => res.write(JSON.stringify(event) + "\n");
  emit({ type: "meta", conversationId: convId, creditsLeft: creditsLeft(acc) });

  try {
    await runAgentTurn(conversation, { message, page }, emit);
  } catch (err) {
    console.error(err);
    // Panne côté serveur : on rend l'analyse à l'utilisateur.
    if (consumed === "free") acc.used -= 1;
    if (consumed === "paid") acc.paidCredits += 1;
    if (consumed) saveUsage();
    if (isNewConversation) deleteConversation(convId);
    let text = "Une erreur est survenue. Réessaie dans un instant.";
    if (err instanceof AIError && [400, 401, 403].includes(err.status)) text = "Clé API Gemini invalide côté serveur.";
    else if (err instanceof AIError && err.status === 429) text = "Limite gratuite atteinte pour le moment, réessaie dans une minute.";
    emit({ type: "error", text });
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`Escale server prêt sur http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY manquante : copie .env.example en .env et ajoute ta clé.");
  }
});
