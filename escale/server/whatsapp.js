// Canal WhatsApp (API officielle WhatsApp Cloud de Meta).
// Variables : WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
import crypto from "node:crypto";
import { createConversation, deleteConversation, errorMessage, runAgentTurn } from "./agent.js";
import { consume, creditsLeft, getAccount, markWelcomed, refund, restoreOrder } from "./store.js";

const GRAPH_URL = process.env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com/v26.0";
const MAX_TURNS_PER_CONVERSATION = 10;
const CONVERSATION_IDLE_MS = 6 * 60 * 60 * 1000; // 6 h sans message → nouvelle conversation
const WHATSAPP_TEXT_LIMIT = 4000;
const RESET_WORDS = new Set(["nouveau", "/nouveau", "reset", "recommencer"]);

const CHANNEL_NOTE =
  "Canal : WhatsApp. Réponds court (moins de 1 200 caractères), sans tableau. " +
  "La personne ne peut pas t'envoyer de page web : si elle colle un lien, demande-lui de décrire l'offre.";

const WELCOME =
  "👋 Salut, je suis *Escale*, ton agent pour choisir où partir en vacances.\n\n" +
  "Dis-moi tes envies, par exemple :\n" +
  "_« 7 jours au soleil en décembre, 500 000 FCFA à deux depuis Douala »_\n\n" +
  "Je vérifie la météo réelle et les guides de voyage pour te conseiller.";

const SITE_URL = (process.env.SITE_URL || "https://escale-site.onrender.com").replace(/\/$/, "");
const RESTORE_ERRORS = {
  introuvable: "Je ne trouve pas de paiement réussi avec cette référence. Vérifie-la (elle commence par ESC-).",
  expire: "Cet abonnement est arrivé à son terme.",
  limite: "Cette référence a déjà été utilisée sur 3 appareils.",
};
const leftText = (acc) => {
  const n = creditsLeft(acc);
  return n === null ? "⭐ Premium actif." : `Il te reste ${n} analyse(s) gratuite(s).`;
};

// État en mémoire (prototype). En production : une base de données.
const chats = new Map(); // clé utilisateur → { conversationId, conversation, lastAt }
const queues = new Map(); // clé utilisateur → promesse (traite les messages d'une personne un par un)
const seenMessageIds = new Set();
const stats = { received: 0, badSignature: 0, handled: 0, lastSend: null };

// trim + retrait des guillemets : évite les erreurs de copier-coller dans Render
const env = (name) => (process.env[name] || "").trim().replace(/^["']|["']$/g, "");

// Le numéro n'est jamais stocké en clair dans le compteur : on le hache.
const userKey = (phone) => "wa:" + crypto.createHash("sha256").update(phone).digest("hex").slice(0, 32);

function isValidSignature(req) {
  const secret = env("WHATSAPP_APP_SECRET");
  const header = req.get("x-hub-signature-256") || "";
  if (!secret || !req.rawBody || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function graphPost(body) {
  const res = await fetch(`${GRAPH_URL}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) {
    stats.lastSend = "ok";
  } else {
    const detail = await res.text().catch(() => "");
    stats.lastSend = `erreur ${res.status} : ${detail.slice(0, 300)}`;
    console.error("WhatsApp API", res.status, detail);
  }
}

async function sendText(to, text) {
  // WhatsApp limite la taille d'un message : on découpe proprement si besoin.
  let rest = text.trim();
  while (rest) {
    let cut = rest.length <= WHATSAPP_TEXT_LIMIT ? rest.length : rest.lastIndexOf("\n", WHATSAPP_TEXT_LIMIT);
    if (cut <= 0) cut = WHATSAPP_TEXT_LIMIT;
    await graphPost({ to, type: "text", text: { body: rest.slice(0, cut) } });
    rest = rest.slice(cut).trim();
  }
}

const showTyping = (messageId) =>
  graphPost({ status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() => {});

// Markdown → mise en forme WhatsApp (*gras*, _italique_, puces).
export function toWhatsApp(md) {
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*-{3,}\s*$/.test(line)) return "";
      const heading = line.match(/^\s*#{1,6}\s+(.*)/);
      if (heading) return `*${heading[1].replace(/\*\*/g, "")}*`;
      return line.replace(/^(\s*)[-*]\s+/, "$1• ");
    })
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function handleMessage(msg) {
  const from = msg.from;
  const key = userKey(from);
  const acc = await getAccount(key);

  if (msg.type !== "text") {
    await sendText(from, "Pour l'instant, je ne lis que les messages écrits 🙂 Décris-moi ton voyage idéal !");
    return;
  }
  const text = String(msg.text?.body || "").trim().slice(0, 2000);
  if (!text) return;

  let chat = chats.get(key);
  if (chat && (Date.now() - chat.lastAt > CONVERSATION_IDLE_MS || chat.conversation.userTurns >= MAX_TURNS_PER_CONVERSATION)) {
    deleteConversation(chat.conversationId);
    chats.delete(key);
    chat = null;
  }

  if (RESET_WORDS.has(text.toLowerCase())) {
    if (chat) deleteConversation(chat.conversationId);
    chats.delete(key);
    await sendText(from, `🆕 Nouvelle conversation. ${leftText(acc)} Décris-moi ton voyage !`);
    return;
  }

  // « restaurer ESC-… » : active ici un Premium acheté sur le site.
  const restore = text.match(/^restaurer\s+(\S+)/i);
  if (restore) {
    const r = await restoreOrder(restore[1].toUpperCase(), key);
    await sendText(from, r.ok ? "⭐ Escale Premium est activé sur ce numéro. Bon voyage !" : RESTORE_ERRORS[r.reason]);
    return;
  }

  // Tout premier message de cette personne : on se présente, sans consommer d'analyse.
  if (acc.used === 0 && !chat && !acc.welcomed) {
    await markWelcomed(acc);
    await sendText(from, WELCOME);
    if (text.length < 15) return; // un simple « bonjour » : on attend sa vraie demande
  }

  // Une nouvelle conversation consomme une analyse.
  let consumed = null;
  if (!chat) {
    consumed = await consume(acc);
    if (consumed === "limit") {
      await sendText(from, "Tu as atteint la limite de 30 analyses pour aujourd'hui 🙂 On reprend demain !");
      return;
    }
    if (!consumed) {
      await sendText(
        from,
        "Tes analyses gratuites sont terminées 🙏\n\n⭐ *Escale Premium* : analyses illimitées pendant 1 an pour 3 300 FCFA (5 €), " +
          `payable par MTN ou Orange Money sur ${SITE_URL}/#essayer\n\n` +
          "Après le paiement, écris ici : _restaurer_ suivi de ta référence (ESC-…).",
      );
      return;
    }
    const conversationId = crypto.randomUUID();
    chat = { conversationId, conversation: createConversation(conversationId), lastAt: Date.now() };
    chats.set(key, chat);
  }
  chat.lastAt = Date.now();

  await showTyping(msg.id);

  let answer = "";
  let error = "";
  try {
    await runAgentTurn(chat.conversation, { message: text, channelNote: CHANNEL_NOTE }, (event) => {
      if (event.type === "answer") answer = event.text;
      if (event.type === "error") error = event.text;
    });
  } catch (err) {
    console.error(err);
    await refund(acc, consumed);
    if (consumed) {
      deleteConversation(chat.conversationId);
      chats.delete(key);
    }
    await sendText(from, errorMessage(err));
    return;
  }

  let reply = error || toWhatsApp(answer);
  if (consumed && !error) {
    reply += `\n\n_${leftText(acc)} Écris « nouveau » pour parler d'un autre voyage._`;
  }
  await sendText(from, reply);
}

export function setupWhatsApp(app) {
  // Vérification de l'adresse par Meta (une seule fois, à la configuration).
  // Diagnostic : indique quels réglages sont présents (jamais leur valeur).
  app.get("/whatsapp/status", (req, res) => {
    res.json({
      WHATSAPP_TOKEN: Boolean(env("WHATSAPP_TOKEN")),
      WHATSAPP_PHONE_NUMBER_ID: Boolean(env("WHATSAPP_PHONE_NUMBER_ID")),
      WHATSAPP_APP_SECRET: Boolean(env("WHATSAPP_APP_SECRET")),
      WHATSAPP_VERIFY_TOKEN: Boolean(env("WHATSAPP_VERIFY_TOKEN")),
      webhooksRecus: stats.received,
      signaturesRefusees: stats.badSignature,
      messagesTraites: stats.handled,
      dernierEnvoi: stats.lastSend,
    });
  });

  app.get("/whatsapp", (req, res) => {
    console.log("WhatsApp : demande de vérification du webhook par Meta");
    const ok =
      req.query["hub.mode"] === "subscribe" &&
      env("WHATSAPP_VERIFY_TOKEN") &&
      req.query["hub.verify_token"] === env("WHATSAPP_VERIFY_TOKEN");
    if (ok) return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    res.sendStatus(403);
  });

  // Messages reçus.
  app.post("/whatsapp", (req, res) => {
    stats.received += 1;
    if (!isValidSignature(req)) {
      stats.badSignature += 1;
      console.warn("WhatsApp : signature invalide (vérifie WHATSAPP_APP_SECRET dans Render)");
      return res.sendStatus(401);
    }
    res.sendStatus(200); // on répond tout de suite à Meta, le traitement continue ensuite

    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (seenMessageIds.has(msg.id)) continue; // Meta peut renvoyer un message deux fois
          seenMessageIds.add(msg.id);
          if (seenMessageIds.size > 5000) seenMessageIds.delete(seenMessageIds.values().next().value);

          console.log(`WhatsApp : message reçu (type ${msg.type})`);
          stats.handled += 1;
          const key = userKey(msg.from);
          const previous = queues.get(key) ?? Promise.resolve();
          const next = previous
            .then(() => handleMessage(msg))
            .catch((err) => console.error("WhatsApp", err))
            .finally(() => {
              if (queues.get(key) === next) queues.delete(key);
            });
          queues.set(key, next);
        }
      }
    }
  });

  if (!env("WHATSAPP_TOKEN")) console.log("ℹ️  WhatsApp non configuré (WHATSAPP_TOKEN absent).");
}
