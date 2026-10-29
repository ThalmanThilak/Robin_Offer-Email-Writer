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

export { PRODUCT_FACT_FIELDS };
