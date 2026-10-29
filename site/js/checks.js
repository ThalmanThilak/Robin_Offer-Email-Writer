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

// ---------- Clean-up of model text ----------

// Markup that must never reach the email: citation tags, other tags, index codes, note ids.
const CLEANUPS = [
  [/&lt;\/?cite\b.*?&gt;/gi, "encoded cite tag"],
  [/<\/?cite\b[^>]*>/gi, "cite tag"],
  [/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, "HTML tag"],
  [/<\/?[a-z][a-z0-9-]*\b[^<>\n]*(?=\n|$)/gi, "broken tag"],
  [/\s*\bindex\s*=\s*(?:"[^"\n]*"?|'[^'\n]*'?|[\d][\d,.:\s-]*)/gi, "index code"],
  [/\u3010[^\u3011\n]*\u3011/g, "citation bracket"],
  [/\s?\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g, "number reference"],
  [/\s?\[\s*P\d+\s*\|\s*\w+\s*\]/gi, "research tag"],
  [/\s?\[\s*NO[\s_-]*SOURCE\s*\]/gi, "no-source tag"],
  [/\s?[\[(]\s*N\d+(?:\s*,\s*N\d+)*\s*[\])]/g, "note id"],
];

// Removes markup from model text before it is shown or copied.
// Logs a console warning when something was removed, so we can see if the prompt still fails.
export function cleanText(text, where = "text") {
  if (!text) return text || "";
  let out = text;
  const removed = [];
  for (const [re, label] of CLEANUPS) {
    out = out.replace(re, (m) => {
      removed.push(`${label}: ${m.trim()}`);
      return "";
    });
  }
  if (!removed.length) return text;
  out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]+$/gm, "");
  console.warn(`Offer Email Writer: removed markup from ${where}`, removed);
  return out;
}

// ---------- Content checks ----------

// Sentences where the model talks about its own rules or research instead of giving facts.
const RULE_TALK = [
  /\bwill not guess\b/i, /\bwon'?t guess\b/i, /\bnot (?:going to )?guess\b/i, /\bcannot verify\b/i, /\bcan'?t verify\b/i,
  /\bcould not find\b/i, /\bcouldn'?t find\b/i, /\bno (?:reliable )?sources?\b/i, /\bmy research\b/i, /\bsearch results?\b/i,
  /\byou know (?:this )?better than I\b/i, /\bI do not have (?:reliable|exact) (?:data|information)\b/i,
  /\bnicht raten\b/i, /\bkeine (?:verl\u00e4sslichen? )?Quellen?\b/i, /\bkonnte (?:ich )?(?:keine|nicht) \w* ?finden\b/i, /\bmeine(?:r)? Recherche\b/i, /\bSuchergebnis/i,
];

export function findRuleTalk(text) {
  const hits = [];
  for (const re of RULE_TALK) {
    const m = re.exec(text || "");
    if (m) hits.push(m[0]);
  }
  return hits;
}

// Wording that promises more than a product description should. Allowed only if Robin wrote it in his facts.
const PROMISES = [
  "any kind of", "no questions asked", "always covered", "fully covered", "everything is covered", "covers everything",
  "all damage", "any damage", "guarantee", "guaranteed", "100%", "100 %", "whatever happens", "completely covered", "without any limit",
  "jede art", "ohne fragen", "garantiert", "immer abgedeckt", "alles abgedeckt", "vollst\u00e4ndig abgedeckt", "jeden schaden", "egal was passiert",
];

export function findPromises(text, agentFactsText) {
  const lower = (text || "").toLowerCase();
  const facts = (agentFactsText || "").toLowerCase();
  return PROMISES.filter((p) => lower.includes(p) && !facts.includes(p));
}

// ---------- Closing line ----------

const CLOSING_LINE = /^(kind regards|best regards|warm regards|regards|best wishes|all the best|best|sincerely|yours sincerely|yours faithfully|yours truly|thanks|thank you|many thanks|cheers|mit freundlichen gr\u00fc(?:\u00df|ss)en|freundliche gr\u00fc(?:\u00df|ss)e|viele gr\u00fc(?:\u00df|ss)e|beste gr\u00fc(?:\u00df|ss)e|herzliche gr\u00fc(?:\u00df|ss)e|liebe gr\u00fc(?:\u00df|ss)e|sch\u00f6ne gr\u00fc(?:\u00df|ss)e|gru(?:\u00df|ss)|danke|vielen dank|mfg|lg|vg)\b[\s,.!]*$/i;

export function isClosingLine(line) {
  return CLOSING_LINE.test((line || "").trim());
}

export function signatureStartsWithClosing(signature) {
  const first = (signature || "").split(/\r?\n/).find((l) => l.trim());
  return Boolean(first) && isClosingLine(first);
}

// Removes closing lines the model may have written at the end of the email body.
export function stripTrailingClosing(body) {
  const lines = (body || "").replace(/\s+$/, "").split("\n");
  while (lines.length && (isClosingLine(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join("\n");
}

// Light check for informal German ("du" form).
export function looksInformalGerman(text) {
  return /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure)(?![\p{L}])/iu.test(text || "");
}
