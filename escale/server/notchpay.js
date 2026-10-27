// Paiement par Notch Pay (MTN Mobile Money, Orange Money) — https://developer.notchpay.co
// Variables : NOTCHPAY_PUBLIC_KEY (clé publique, test_… en mode test), NOTCHPAY_HASH_KEY (clé de hachage des webhooks)
import crypto from "node:crypto";

const API = "https://api.notchpay.co";
const env = (n) => (process.env[n] || "").trim();

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: env("NOTCHPAY_PUBLIC_KEY"), "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notch Pay ${res.status} : ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

/** Crée le paiement : renvoie l'adresse de la page de paiement Notch Pay et sa référence. */
export async function createPayment({ reference, amount, currency, email, name, phone, callback, description, userId }) {
  const customer = { email };
  if (name) customer.name = name;
  if (phone) customer.phone = phone;
  const data = await call("POST", "/payments", {
    amount, currency, customer, description, reference, callback,
    metadata: { user_id: userId, produit: "escale-premium-1an" },
  });
  if (!data.authorization_url) throw new Error("Notch Pay n'a pas renvoyé de page de paiement");
  return { url: data.authorization_url, notchRef: data.transaction?.reference || null };
}

/** Demande à Notch Pay l'état réel d'un paiement (on ne fait jamais confiance au navigateur). */
export async function fetchPayment(reference) {
  const data = await call("GET", `/payments/${encodeURIComponent(reference)}`);
  return data.transaction || {};
}

/** Vérifie que le webhook vient bien de Notch Pay (HMAC SHA-256 du corps brut avec la clé de hachage). */
export function isValidWebhook(rawBody, signature) {
  const key = env("NOTCHPAY_HASH_KEY");
  if (!key || !rawBody || !signature) return false;
  const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  const given = String(signature).trim();
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const configured = () => Boolean(env("NOTCHPAY_PUBLIC_KEY"));
