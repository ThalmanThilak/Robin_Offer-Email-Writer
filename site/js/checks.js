// Checks on the model's reply, done in code so nothing depends on the model alone.

// Every dash character except the normal hyphen (written as codes, U+2012 to U+2015 and others).
const DASHES = new RegExp("[\\u2012\\u2013\\u2014\\u2015\\u2E3A\\u2E3B\\uFE58\\uFE63\\uFF0D]");
const DASHES_ALL = new RegExp(DASHES.source, "g");

// Replaces em dashes and en dashes. A range like "3 (dash) 5" becomes 3-5,
// a dash at the start of a line becomes a bullet, any other dash becomes a comma.
export function removeDashes(text) {
  if (!text || !DASHES.test(text)) return { text, changed: false };
  let out = text
    .replace(new RegExp(`(\\d)[ \\t]*(?:${DASHES.source})[ \\t]*(\\d)`, "g"), "$1-$2")
    .replace(new RegExp(`^([ \\t]*)(?:${DASHES.source})[ \\t]+`, "gm"), "$1- ")
    .replace(new RegExp(`[ \\t]*(?:${DASHES.source})[ \\t]*$`, "gm"), "")
    .replace(new RegExp(`[ \\t]*(?:${DASHES.source})[ \\t]*`, "g"), ", ")
    .replace(/,[ \t]*,/g, ",")
    .replace(/,[ \t]*([.!?:;])/g, "$1")
    .replace(/ {2,}/g, " ");
  out = out.replace(DASHES_ALL, ",");
  return { text: out, changed: true };
}

export function hasDashes(text) {
  return DASHES.test(text || "");
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const NUMBER_RE = /\d+(?:[.,]\d{3}(?!\d))*(?:[.,]\d+)?/g;

// "1.500,00" and "1,500.00" and "1500" all become "1500" so they compare as the same number.
export function canonical(num) {
  const m = num.match(/^(.*?)(?:[.,](\d{1,2}))?$/);
  const whole = (m[1] || "").replace(/[.,]/g, "");
  const frac = m[2] && !/^0+$/.test(m[2]) ? "." + m[2].replace(/0+$/, "") : "";
  return String(Number(whole || "0")) + frac;
}

function numbersIn(text) {
  const found = [];
  const withoutUrls = (text || "").replace(URL_RE, " ");
  // Numbered list markers like "1. " at the start of a line are not facts.
  const withoutMarkers = withoutUrls.replace(/^\s*\d+[.)]\s+/gm, " ");
  for (const m of withoutMarkers.matchAll(NUMBER_RE)) found.push(m[0].trim());
  return found;
}

// Finds numbers in the email that come from none of the allowed texts.
// Allowed texts: Robin's product facts, the sourced facts, the client details.
export function unsupportedNumbers(emailText, allowedTexts) {
  const allowed = new Set();
  for (const t of allowedTexts) for (const n of numbersIn(t)) allowed.add(canonical(n));
  const bad = [];
  const seen = new Set();
  for (const n of numbersIn(emailText)) {
    const c = canonical(n);
    if (!allowed.has(c) && !seen.has(c)) {
      seen.add(c);
      bad.push(n);
    }
  }
  return bad;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    let s = u.protocol + "//" + u.host.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search;
    try {
      s = decodeURI(s);
    } catch {}
    return s;
  } catch {
    return (url || "").trim();
  }
}

// Marks each fact as verified when its link came back from the web search.
export function verifyFacts(facts, sourceUrls) {
  const known = new Set([...sourceUrls].map(normalizeUrl));
  return facts.map((f) => ({
    ...f,
    verified: Boolean(f.source_url) && known.has(normalizeUrl(f.source_url)),
  }));
}

// Light check for informal German ("du" form).
export function looksInformalGerman(text) {
  return /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure)(?![\p{L}])/iu.test(text || "");
}
