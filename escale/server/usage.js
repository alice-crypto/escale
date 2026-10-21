import fs from "node:fs";

// Compteur d'analyses par utilisateur (fichier JSON pour le prototype).
export const FREE_ANALYSES = Number(process.env.FREE_ANALYSES || 3);
const USAGE_FILE = new URL("./usage.json", import.meta.url);

let usage = {};
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
} catch {
  usage = {};
}
const saveUsage = () => fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));

export function account(userId) {
  usage[userId] ??= { used: 0, paidCredits: 0 };
  return usage[userId];
}

export function creditsLeft(acc) {
  return Math.max(0, FREE_ANALYSES - acc.used) + acc.paidCredits;
}

/** Consomme une analyse. Renvoie "free", "paid", ou null s'il n'en reste plus. */
export function consumeCredit(acc) {
  if (creditsLeft(acc) <= 0) return null;
  let consumed;
  if (acc.used < FREE_ANALYSES) {
    acc.used += 1;
    consumed = "free";
  } else {
    acc.paidCredits -= 1;
    consumed = "paid";
  }
  saveUsage();
  return consumed;
}

/** Rend une analyse consommée (en cas de panne côté serveur). */
export function refundCredit(acc, consumed) {
  if (consumed === "free") acc.used -= 1;
  if (consumed === "paid") acc.paidCredits += 1;
  if (consumed) saveUsage();
}
