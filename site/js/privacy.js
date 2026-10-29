// Name privacy. Claude only ever sees placeholders. Names are filled in here, in the browser.

export const PH_SALUTATION = "{{SALUTATION}}";
export const PH_FIRST = "{{FIRST_NAME}}";
export const PH_LAST = "{{LAST_NAME}}";

const SALUTATIONS = {
  en: {
    male: "Dear Mr. {{LAST_NAME}},",
    female: "Dear Ms. {{LAST_NAME}},",
    other: "Dear {{FIRST_NAME}} {{LAST_NAME}},",
  },
  de: {
    male: "Sehr geehrter Herr {{LAST_NAME}},",
    female: "Sehr geehrte Frau {{LAST_NAME}},",
    other: "Guten Tag {{FIRST_NAME}} {{LAST_NAME}},",
  },
};

export function salutationTemplate(lang, gender) {
  const byLang = SALUTATIONS[lang] || SALUTATIONS.en;
  return byLang[gender] || byLang.other;
}

// Replaces the placeholders with the real salutation and names.
export function fillNames(text, { lang, gender, firstName, lastName }) {
  if (!text) return "";
  return text
    .replaceAll(PH_SALUTATION, salutationTemplate(lang, gender))
    .replaceAll(PH_FIRST, firstName.trim())
    .replaceAll(PH_LAST, lastName.trim());
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match, so "Ali" does not match inside "quality".
function wordPattern(word) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, "giu");
}

function nameParts(name) {
  const full = name.trim();
  if (!full) return [];
  const parts = full.split(/[\s\-]+/).filter((p) => p.length >= 2);
  return [...new Set([full, ...parts])].sort((a, b) => b.length - a.length);
}

// Safety net: if Robin typed the client's name into a free text field,
// it is swapped for a placeholder before anything is sent.
export function scrubNames(text, firstName, lastName) {
  if (!text) return text;
  let out = text;
  for (const part of nameParts(lastName)) out = out.replace(wordPattern(part), PH_LAST);
  for (const part of nameParts(firstName)) out = out.replace(wordPattern(part), PH_FIRST);
  return out;
}

// True if the text still contains the first or last name as a whole word.
export function containsName(text, firstName, lastName) {
  return [...nameParts(firstName), ...nameParts(lastName)].some((part) => wordPattern(part).test(text));
}
