import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createConversation, deleteConversation, errorMessage, getConversation, runAgentTurn } from "./agent.js";
import * as store from "./store.js";
import * as notchpay from "./notchpay.js";
import { setupWhatsApp } from "./whatsapp.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_MESSAGES_PER_CONVERSATION = 10;
const PRICE_XAF = Number(process.env.PREMIUM_PRICE_XAF || 3300); // ≈ 5 €
const SITE_URL = (process.env.SITE_URL || "https://escale-site.onrender.com").replace(/\/$/, "");
// Mode d'essai local sans Notch Pay : le paiement est simulé (jamais en ligne).
const MOCK_PAYMENTS = process.env.NOTCHPAY_MOCK === "1" && !process.env.RENDER;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const REF_RE = /^[A-Za-z0-9._-]{4,80}$/;

// --- API ---
const app = express();
app.use(cors());
// On garde le corps brut : WhatsApp et Notch Pay signent leurs requêtes avec.
app.use(express.json({ limit: "3mb", verify: (req, res, buf) => (req.rawBody = buf) }));

// Les erreurs des routes asynchrones remontent ici au lieu de faire planter le serveur.
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Erreur du serveur, réessaie dans un instant." });
  });

app.get("/", (req, res) => res.send("Escale server OK"));
app.get("/confidentialite", (req, res) =>
  res.sendFile(fileURLToPath(new URL("./public/confidentialite.html", import.meta.url))),
);

const statusOf = (acc) => ({
  creditsLeft: store.creditsLeft(acc),
  freeAnalyses: store.FREE_ANALYSES,
  premium: store.isPremium(acc),
  premiumUntil: store.isPremium(acc) ? new Date(acc.premium_until).toISOString() : null,
  price: { amount: PRICE_XAF, currency: "XAF", label: `${PRICE_XAF.toLocaleString("fr-FR")} FCFA / an` },
});

app.get("/api/status", route(async (req, res) => {
  const userId = String(req.query.userId || "");
  if (!UUID_RE.test(userId)) return res.status(400).json({ error: "userId invalide" });
  res.json(statusOf(await store.getAccount(userId)));
}));

app.post("/api/chat", route(async (req, res) => {
  const { userId, conversationId, message, page } = req.body ?? {};
  if (!UUID_RE.test(String(userId || ""))) return res.status(400).json({ error: "userId invalide" });
  if (!message && !page) return res.status(400).json({ error: "Message vide" });

  const acc = await store.getAccount(userId);
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
    consumed = await store.consume(acc);
    if (consumed === "limit") return res.status(429).json({ error: "daily_limit", limit: store.DAILY_LIMIT });
    if (!consumed) return res.status(402).json({ error: "no_credits", ...statusOf(acc) });
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
  emit({ type: "meta", conversationId: convId, creditsLeft: store.creditsLeft(acc), premium: store.isPremium(acc) });

  try {
    await runAgentTurn(conversation, { message, page }, emit);
  } catch (err) {
    console.error(err);
    // Panne côté serveur : on rend l'analyse à l'utilisateur.
    await store.refund(acc, consumed).catch(console.error);
    if (isNewConversation) deleteConversation(convId);
    emit({ type: "error", text: errorMessage(err) });
  }
  res.end();
}));

// --- Paiement : Escale Premium, 1 an ---

app.post("/api/checkout", route(async (req, res) => {
  const { userId, email, phone, name } = req.body ?? {};
  if (!UUID_RE.test(String(userId || ""))) return res.status(400).json({ error: "userId invalide" });
  if (!EMAIL_RE.test(String(email || ""))) return res.status(400).json({ error: "Adresse e-mail invalide" });
  if (!notchpay.configured() && !MOCK_PAYMENTS) return res.status(503).json({ error: "Le paiement n'est pas encore ouvert." });

  const reference = "ESC-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  await store.createOrder({ reference, userId, email: String(email).trim(), amount: PRICE_XAF, currency: "XAF" });
  const callback = `${SITE_URL}/merci.html?ref=${reference}`;

  if (MOCK_PAYMENTS) return res.json({ url: callback + "&essai=1", reference });

  const { url, notchRef } = await notchpay.createPayment({
    reference, amount: PRICE_XAF, currency: "XAF", userId, callback,
    email: String(email).trim(),
    name: name ? String(name).slice(0, 80) : undefined,
    phone: phone ? String(phone).replace(/[^\d+]/g, "").slice(0, 20) : undefined,
    description: "Escale Premium – analyses illimitées pendant 1 an",
  });
  if (notchRef) await store.setNotchRef(reference, notchRef);
  res.json({ url, reference });
}));

/** Demande l'état du paiement à Notch Pay et active le Premium s'il est réussi. */
async function settle(order) {
  if (order.status === "paid") return "paid";
  if (MOCK_PAYMENTS) {
    await store.activateOrder(order.reference);
    return "paid";
  }
  const tx = await notchpay.fetchPayment(order.notch_ref || order.reference);
  const amountOk = Number(tx.amount) >= order.amount && String(tx.currency || "XAF").toUpperCase() === order.currency;
  if (tx.status === "complete" && amountOk) {
    if (await store.activateOrder(order.reference)) console.log(`Paiement ${order.reference} : Premium activé`);
    return "paid";
  }
  if (["failed", "canceled", "cancelled", "expired"].includes(tx.status)) {
    await store.markOrder(order.reference, tx.status);
    return "failed";
  }
  return "pending";
}

app.get("/api/checkout/verify", route(async (req, res) => {
  const reference = String(req.query.reference || "");
  if (!REF_RE.test(reference)) return res.status(400).json({ error: "Référence invalide" });
  const order = await store.getOrder(reference);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const status = await settle(order);
  const acc = await store.getAccount(order.user_id);
  res.json({ status, reference: order.reference, premiumUntil: statusOf(acc).premiumUntil });
}));

// Notch Pay prévient le serveur dès qu'un paiement change d'état.
app.post("/notchpay/webhook", route(async (req, res) => {
  if (!notchpay.isValidWebhook(req.rawBody, req.get("x-notch-signature"))) {
    console.warn("Notch Pay : signature de webhook invalide (vérifie NOTCHPAY_HASH_KEY dans Render)");
    return res.sendStatus(401);
  }
  const data = req.body?.data ?? {};
  const refs = [data.merchant_reference, data.trxref, data.reference].filter((r) => r && REF_RE.test(String(r)));
  let order = null;
  for (const r of refs) if ((order = await store.getOrder(String(r)))) break;
  if (order) await settle(order); // on revérifie toujours auprès de Notch Pay
  res.sendStatus(200);
}));

// Activer le Premium sur un autre appareil (site ↔ extension) avec la référence du paiement.
app.post("/api/restore", route(async (req, res) => {
  const { userId, reference } = req.body ?? {};
  if (!UUID_RE.test(String(userId || ""))) return res.status(400).json({ error: "userId invalide" });
  const ref = String(reference || "").trim().toUpperCase();
  if (!REF_RE.test(ref)) return res.status(400).json({ error: "Référence invalide" });
  const order = await store.getOrder(ref);
  if (order && order.status !== "paid") await settle(order).catch(console.error);
  const r = await store.restoreOrder(ref, userId);
  const messages = {
    introuvable: "Aucun paiement réussi avec cette référence.",
    expire: "Cet abonnement est arrivé à son terme.",
    limite: "Cette référence a déjà servi sur 3 appareils.",
  };
  if (!r.ok) return res.status(400).json({ error: messages[r.reason] });
  res.json(statusOf(await store.getAccount(userId)));
}));

setupWhatsApp(app);

await store.init();
app.listen(PORT, () => {
  console.log(`Escale server prêt sur http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY manquante : copie .env.example en .env et ajoute ta clé.");
  }
  if (MOCK_PAYMENTS) console.warn("⚠️  Paiements simulés (NOTCHPAY_MOCK=1).");
  else if (!notchpay.configured()) console.log("ℹ️  Paiement fermé (NOTCHPAY_PUBLIC_KEY absente).");
});
