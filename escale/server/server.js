import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createConversation, deleteConversation, errorMessage, getConversation, runAgentTurn } from "./agent.js";
import { FREE_ANALYSES, account, consumeCredit, creditsLeft, refundCredit } from "./usage.js";
import { setupWhatsApp } from "./whatsapp.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_MESSAGES_PER_CONVERSATION = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- API ---
const app = express();
app.use(cors());
// On garde le corps brut : WhatsApp signe ses requêtes avec.
app.use(express.json({ limit: "3mb", verify: (req, res, buf) => (req.rawBody = buf) }));

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
    consumed = consumeCredit(acc);
    if (!consumed) return res.status(402).json({ error: "no_credits", creditsLeft: 0 });
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
    refundCredit(acc, consumed);
    if (isNewConversation) deleteConversation(convId);
    emit({ type: "error", text: errorMessage(err) });
  }
  res.end();
});

setupWhatsApp(app);

app.listen(PORT, () => {
  console.log(`Escale server prêt sur http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY manquante : copie .env.example en .env et ajoute ta clé.");
  }
});
