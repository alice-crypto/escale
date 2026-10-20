// Outils que l'agent peut appeler lui-même.
// Tous gratuits et sans clé : météo (Open-Meteo) et guides de voyage (Wikivoyage).

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_HORIZON_DAYS = 15;
const MAX_PERIOD_DAYS = 31;

export const toolDefinitions = [
  {
    name: "get_weather",
    description:
      "Donne la météo d'une ville pour une période. Si la période est dans les 15 prochains jours, " +
      "renvoie la vraie prévision. Sinon, renvoie la météo réelle de la même période l'année dernière " +
      "(bon indicateur du climat à attendre). Sans dates : les 7 prochains jours. " +
      "Utilise-la pour comparer des destinations ou vérifier si une période est adaptée.",
    input_schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "Nom de la ville, avec le pays si ambigu. Ex : 'Lisbonne, Portugal'",
        },
        start_date: { type: "string", description: "Date de début AAAA-MM-JJ (optionnel)" },
        end_date: { type: "string", description: "Date de fin AAAA-MM-JJ (optionnel)" },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "get_travel_guide",
    description:
      "Lit le guide de voyage Wikivoyage d'une destination (ville, région ou pays) : présentation, " +
      "quartiers, que voir, que faire, se déplacer, budget, sécurité, quand partir. " +
      "Utilise-le pour donner des conseils concrets et vérifiés plutôt que de mémoire.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Nom de la destination. Ex : 'Lisbonne'" },
        language: { type: "string", description: "Code langue du guide : 'fr' (défaut) ou 'en' (plus complet)" },
      },
      required: ["destination"],
      additionalProperties: false,
    },
  },
];

const isoDate = (d) => d.toISOString().slice(0, 10);

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Escale/0.1 (extension voyage)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
  return res.json();
}

async function getWeather({ city, start_date, end_date }) {
  if (typeof city !== "string" || !city.trim()) throw new Error("Paramètre 'city' manquant");

  const name = city.split(",")[0].trim();
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=fr`,
  );
  if (!geo.results?.length) return { error: `Ville introuvable : ${city}` };

  // Si un pays est précisé, on préfère le résultat qui correspond.
  const countryHint = city.split(",")[1]?.trim().toLowerCase();
  const place =
    (countryHint && geo.results.find((r) => r.country?.toLowerCase().includes(countryHint))) ||
    geo.results[0];

  const today = new Date(isoDate(new Date()) + "T00:00:00Z");
  let start = parseDate(start_date) ?? today;
  let end = parseDate(end_date) ?? new Date(start.getTime() + 6 * DAY_MS);
  if (end < start) [start, end] = [end, start];
  if ((end - start) / DAY_MS > MAX_PERIOD_DAYS) end = new Date(start.getTime() + MAX_PERIOD_DAYS * DAY_MS);

  const daysAhead = (end - today) / DAY_MS;
  const isForecast = start >= today && daysAhead <= FORECAST_HORIZON_DAYS;

  let host = "api.open-meteo.com/v1/forecast";
  let qStart = start;
  let qEnd = end;
  let source = "prévision météo";
  if (!isForecast) {
    // Hors horizon de prévision : on regarde la même période l'an dernier.
    host = "archive-api.open-meteo.com/v1/archive";
    // L'archive a quelques jours de retard : on prend l'année la plus récente déjà observée.
    const archiveLimit = new Date(today.getTime() - 7 * DAY_MS);
    let shiftYears = 1;
    while (true) {
      qEnd = new Date(end);
      qEnd.setUTCFullYear(end.getUTCFullYear() - shiftYears);
      if (qEnd <= archiveLimit) break;
      shiftYears += 1;
    }
    qStart = new Date(start);
    qStart.setUTCFullYear(start.getUTCFullYear() - shiftYears);
    source = `météo réelle observée du ${isoDate(qStart)} au ${isoDate(qEnd)} (même période, année passée)`;
  }

  const data = await fetchJson(
    `https://${host}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&start_date=${isoDate(qStart)}&end_date=${isoDate(qEnd)}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`,
  );

  const max = data.daily?.temperature_2m_max?.filter((v) => v != null) ?? [];
  const min = data.daily?.temperature_2m_min?.filter((v) => v != null) ?? [];
  const rain = data.daily?.precipitation_sum?.filter((v) => v != null) ?? [];
  if (!max.length) return { error: "Pas de données météo disponibles pour cette période." };

  const avg = (a) => Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10;
  return {
    lieu: `${place.name}${place.admin1 ? ", " + place.admin1 : ""}, ${place.country}`,
    periode_demandee: `${isoDate(start)} → ${isoDate(end)}`,
    source,
    temp_max_moyenne_c: avg(max),
    temp_min_moyenne_c: avg(min),
    temp_max_record_c: Math.max(...max),
    pluie_totale_mm: Math.round(rain.reduce((s, v) => s + v, 0)),
    jours_de_pluie: rain.filter((v) => v >= 1).length,
    nombre_de_jours: max.length,
  };
}

const GUIDE_TEXT_LIMIT = 8000;

async function getTravelGuide({ destination, language }) {
  if (typeof destination !== "string" || !destination.trim()) throw new Error("Paramètre 'destination' manquant");
  const lang = language === "en" ? "en" : "fr";
  const data = await fetchJson(
    `https://${lang}.wikivoyage.org/w/api.php?action=query&generator=search&gsrlimit=1` +
      `&gsrsearch=${encodeURIComponent(destination)}&prop=extracts&explaintext=1&redirects=1&format=json`,
  );
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.extract) return { error: `Pas de guide Wikivoyage trouvé pour ${destination}` };
  return {
    guide: page.title,
    source: `https://${lang}.wikivoyage.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    texte: page.extract.replace(/\n{3,}/g, "\n\n").slice(0, GUIDE_TEXT_LIMIT),
  };
}

const handlers = { get_weather: getWeather, get_travel_guide: getTravelGuide };

export async function runTool(name, input) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Outil inconnu : ${name}`);
  return handler(input ?? {});
}
