// Comptes et paiements.
// En ligne : base PostgreSQL (variable DATABASE_URL, par exemple Neon).
// En local sans DATABASE_URL : simple fichier JSON (pour développer uniquement).
import fs from "node:fs";
import pg from "pg";

export const FREE_ANALYSES = Number(process.env.FREE_ANALYSES || 3);
export const DAILY_LIMIT = Number(process.env.PREMIUM_DAILY_LIMIT || 30); // usage raisonnable des abonnés
export const PREMIUM_DAYS = 365;
const MAX_RESTORES = 3; // une référence de paiement peut activer 3 appareils (site, extension, téléphone)

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;

// ---------- Mode fichier (développement) ----------
const FILE = new URL("./donnees-dev.json", import.meta.url);
let mem = { accounts: {}, orders: {} };
try { mem = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* premier lancement */ }
const save = () => fs.writeFileSync(FILE, JSON.stringify(mem, null, 2));

export async function init() {
  if (!pool) {
    console.warn("⚠️  DATABASE_URL absente : données stockées dans un fichier local (développement seulement).");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      premium_until TIMESTAMPTZ,
      welcomed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      reference TEXT PRIMARY KEY,
      notch_ref TEXT,
      user_id TEXT NOT NULL,
      email TEXT,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ,
      restores INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS orders_notch_ref ON orders (notch_ref);`);
}

// ---------- Comptes ----------
export async function getAccount(userId) {
  if (!pool) {
    mem.accounts[userId] ??= { user_id: userId, used: 0, premium_until: null, welcomed: false };
    return { ...mem.accounts[userId], premium_until: mem.accounts[userId].premium_until ? new Date(mem.accounts[userId].premium_until) : null };
  }
  await pool.query("INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  const { rows } = await pool.query("SELECT * FROM accounts WHERE user_id = $1", [userId]);
  return rows[0];
}

export const isPremium = (acc) => Boolean(acc.premium_until && new Date(acc.premium_until) > new Date());

// Analyses du jour des abonnés (en mémoire : se remet à zéro chaque jour)
const today = new Map();
const dayKey = (userId) => `${userId}|${new Date().toISOString().slice(0, 10)}`;

/** Ce qu'il reste : un nombre, ou null si l'abonnement est actif (illimité dans la limite du jour). */
export function creditsLeft(acc) {
  if (isPremium(acc)) return null;
  return Math.max(0, FREE_ANALYSES - acc.used);
}

/** Consomme une analyse. Renvoie "free", "premium", "limit" (limite du jour atteinte) ou null (plus d'analyse gratuite). */
export async function consume(acc) {
  if (isPremium(acc)) {
    const k = dayKey(acc.user_id);
    const n = today.get(k) || 0;
    if (n >= DAILY_LIMIT) return "limit";
    today.set(k, n + 1);
    return "premium";
  }
  if (acc.used >= FREE_ANALYSES) return null;
  acc.used += 1;
  if (!pool) { mem.accounts[acc.user_id].used = acc.used; save(); }
  else await pool.query("UPDATE accounts SET used = used + 1 WHERE user_id = $1", [acc.user_id]);
  return "free";
}

/** Rend une analyse (panne côté serveur). */
export async function refund(acc, consumed) {
  if (consumed === "premium") {
    const k = dayKey(acc.user_id);
    today.set(k, Math.max(0, (today.get(k) || 1) - 1));
  } else if (consumed === "free") {
    acc.used = Math.max(0, acc.used - 1);
    if (!pool) { mem.accounts[acc.user_id].used = acc.used; save(); }
    else await pool.query("UPDATE accounts SET used = GREATEST(used - 1, 0) WHERE user_id = $1", [acc.user_id]);
  }
}

export async function markWelcomed(acc) {
  acc.welcomed = true;
  if (!pool) { mem.accounts[acc.user_id].welcomed = true; save(); }
  else await pool.query("UPDATE accounts SET welcomed = TRUE WHERE user_id = $1", [acc.user_id]);
}

// ---------- Commandes ----------
export async function createOrder({ reference, userId, email, amount, currency }) {
  if (!pool) {
    mem.orders[reference] = { reference, user_id: userId, email, amount, currency, status: "pending", restores: 0 };
    save();
    return;
  }
  await pool.query("INSERT INTO orders (reference, user_id, email, amount, currency) VALUES ($1, $2, $3, $4, $5)", [reference, userId, email, amount, currency]);
}

export async function setNotchRef(reference, notchRef) {
  if (!pool) { mem.orders[reference].notch_ref = notchRef; save(); return; }
  await pool.query("UPDATE orders SET notch_ref = $2 WHERE reference = $1", [reference, notchRef]);
}

/** Retrouve une commande par notre référence (ESC-…) ou par celle de Notch Pay. */
export async function getOrder(reference) {
  if (!pool) return mem.orders[reference] || Object.values(mem.orders).find((o) => o.notch_ref === reference) || null;
  const { rows } = await pool.query("SELECT * FROM orders WHERE reference = $1 OR notch_ref = $1 LIMIT 1", [reference]);
  return rows[0] || null;
}

const addDays = (from, days) => new Date(Math.max(Date.now(), from ? new Date(from).getTime() : 0) + days * 86400000);

/** Marque la commande payée et active (ou prolonge) le Premium. Sans effet si c'est déjà fait. */
export async function activateOrder(reference) {
  if (!pool) {
    const o = mem.orders[reference];
    if (!o || o.status === "paid") return false;
    const acc = mem.accounts[o.user_id] ??= { user_id: o.user_id, used: 0, premium_until: null, welcomed: false };
    const until = addDays(acc.premium_until, PREMIUM_DAYS);
    acc.premium_until = until.toISOString();
    Object.assign(o, { status: "paid", paid_at: new Date().toISOString(), expires_at: until.toISOString() });
    save();
    return true;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM orders WHERE reference = $1 FOR UPDATE", [reference]);
    const o = rows[0];
    if (!o || o.status === "paid") { await client.query("ROLLBACK"); return false; }
    await client.query("INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [o.user_id]);
    const acc = (await client.query("SELECT premium_until FROM accounts WHERE user_id = $1 FOR UPDATE", [o.user_id])).rows[0];
    const until = addDays(acc.premium_until, PREMIUM_DAYS);
    await client.query("UPDATE accounts SET premium_until = $2 WHERE user_id = $1", [o.user_id, until]);
    await client.query("UPDATE orders SET status = 'paid', paid_at = now(), expires_at = $2 WHERE reference = $1", [reference, until]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function markOrder(reference, status) {
  if (!pool) { if (mem.orders[reference] && mem.orders[reference].status !== "paid") { mem.orders[reference].status = status; save(); } return; }
  await pool.query("UPDATE orders SET status = $2 WHERE reference = $1 AND status <> 'paid'", [reference, status]);
}

/** Restauration sur un autre appareil avec la référence d'un paiement réussi. */
export async function restoreOrder(reference, userId) {
  const o = await getOrder(reference);
  if (!o || o.status !== "paid") return { ok: false, reason: "introuvable" };
  if (new Date(o.expires_at) <= new Date()) return { ok: false, reason: "expire" };
  if (o.user_id === userId) return { ok: true };
  if (o.restores >= MAX_RESTORES) return { ok: false, reason: "limite" };
  const acc = await getAccount(userId);
  const until = new Date(Math.max(new Date(o.expires_at).getTime(), acc.premium_until ? new Date(acc.premium_until).getTime() : 0));
  if (!pool) {
    mem.accounts[userId].premium_until = until.toISOString();
    mem.orders[o.reference].restores += 1;
    save();
  } else {
    await pool.query("UPDATE accounts SET premium_until = $2 WHERE user_id = $1", [userId, until]);
    await pool.query("UPDATE orders SET restores = restores + 1 WHERE reference = $1", [o.reference]);
  }
  return { ok: true };
}
