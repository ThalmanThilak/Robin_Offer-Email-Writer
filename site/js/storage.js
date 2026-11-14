// Saves settings in this browser only (localStorage). Nothing here goes to a server.

const KEY_API = "oew.apiKey";
const KEY_SETTINGS = "oew.settings";
const BACKUP_APP = "offer-email-writer";
const BACKUP_VERSION = 1;

const PRODUCT_FACT_FIELDS = ["allianzName", "covers", "price", "benefit", "notes"];

function defaults() {
  return {
    uiLanguage: "en",
    signature: "",
    instructions: "",
    productFacts: {},
    ownProducts: [],
    removedProducts: [],
  };
}

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadApiKey() {
  return read(KEY_API) || "";
}

export function saveApiKey(key) {
  return write(KEY_API, key.trim());
}

export function deleteApiKey() {
  return write(KEY_API, null);
}

// Keeps only known fields with the right types, so a broken file can't break the app.
function clean(raw) {
  const out = defaults();
  if (!raw || typeof raw !== "object") return out;
  if (raw.uiLanguage === "de" || raw.uiLanguage === "en") out.uiLanguage = raw.uiLanguage;
  if (typeof raw.signature === "string") out.signature = raw.signature;
  if (typeof raw.instructions === "string") out.instructions = raw.instructions;
  if (raw.productFacts && typeof raw.productFacts === "object") {
    for (const [id, facts] of Object.entries(raw.productFacts)) {
      if (!facts || typeof facts !== "object") continue;
      const entry = {};
      for (const field of PRODUCT_FACT_FIELDS) {
        if (typeof facts[field] === "string" && facts[field].trim()) entry[field] = facts[field];
      }
      if (Object.keys(entry).length) out.productFacts[id] = entry;
    }
  }
  if (Array.isArray(raw.ownProducts)) {
    for (const p of raw.ownProducts) {
      if (!p || typeof p.id !== "string") continue;
      const en = typeof p.en === "string" ? p.en.trim() : "";
      const de = typeof p.de === "string" ? p.de.trim() : "";
      if (en || de) out.ownProducts.push({ id: p.id, en: en || de, de: de || en });
    }
  }
  if (Array.isArray(raw.removedProducts)) {
    out.removedProducts = [...new Set(raw.removedProducts.filter((id) => typeof id === "string" && id))];
  }
  return out;
}

export function loadSettings() {
  try {
    return clean(JSON.parse(read(KEY_SETTINGS) || "null"));
  } catch {
    return defaults();
  }
}

export function saveSettings(settings) {
  return write(KEY_SETTINGS, JSON.stringify(clean(settings)));
}

// The backup never contains the API key.
export function exportBackup(settings) {
  const data = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: clean(settings),
  };
  return JSON.stringify(data, null, 2);
}

// Returns the cleaned settings, or null if the text is not a backup from this app.
export function parseBackup(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.app !== BACKUP_APP || !data.settings) return null;
    return clean(data.settings);
  } catch {
    return null;
  }
}

// ---------- Saved research ----------
// Facts for one home country and one product. No client details are saved here.

const KEY_RESEARCH = "oew.research";
const MAX_RESEARCH_ENTRIES = 200;

function loadResearch() {
  try {
    const data = JSON.parse(read(KEY_RESEARCH) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function researchKey(country, region, product) {
  return [country, region || "", product.en, product.de].map((s) => String(s).trim().toLocaleLowerCase()).join("|");
}

// Returns { at, notes } or null. needProduct: the email needs general facts about this type of insurance.
export function getResearch(key, needProduct, keepDays) {
  const entry = loadResearch()[key];
  if (!entry || !Array.isArray(entry.notes) || !entry.notes.length) return null;
  const age = Date.now() - Date.parse(entry.at);
  if (!Number.isFinite(age) || age > keepDays * 24 * 60 * 60 * 1000) return null;
  if (needProduct && !entry.withProduct) return null;
  return entry;
}

// withProduct: this research also looked for general facts about this type of insurance.
export function putResearch(key, notes, withProduct) {
  const all = loadResearch();
  all[key] = {
    at: new Date().toISOString(),
    withProduct: Boolean(withProduct),
    notes: notes.map((n) => ({ about: n.about, country: n.country, fact: n.fact, sources: n.sources })),
  };
  // Keep the newest entries only, so the browser storage never fills up.
  const keys = Object.keys(all).sort((a, b) => Date.parse(all[b].at) - Date.parse(all[a].at));
  for (const old of keys.slice(MAX_RESEARCH_ENTRIES)) delete all[old];
  return write(KEY_RESEARCH, JSON.stringify(all));
}

export function countResearch() {
  return Object.keys(loadResearch()).length;
}

export function clearResearch() {
  return write(KEY_RESEARCH, null);
}

export { PRODUCT_FACT_FIELDS };
