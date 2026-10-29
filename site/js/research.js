// Turns the research reply into notes: { id, product, about, country, fact, sources: [{ title, url }] }.
// Sources come from the citation data the API attaches to the text, never from text the model typed.
import { cleanText } from "./checks.js";

// Accepts "[P1|HOME] fact", also with a bullet or bold marks around the tag.
const LINE_RE = /^\s*(?:[-*\u2022]\s*)*(?:\*\*)?\[\s*(P\d+)\s*\|\s*(HOME|GERMANY|PRODUCT)\s*\](?:\*\*)?[:\s]*(.+?)\s*$/i;
const NO_SOURCE_RE = /\s*\[\s*NO[\s_-]*SOURCE\s*\]\s*/gi;

// blocks: the content blocks of the research reply (text blocks may carry "citations").
export function parseResearch(blocks, homeCountry) {
  // Join all text, and remember which part of the text each citation belongs to.
  let full = "";
  const spans = [];
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const start = full.length;
    full += block.text;
    const cites = (block.citations || []).filter((c) => c && c.url);
    if (cites.length) spans.push({ start, end: full.length, cites });
  }

  const notes = [];
  let offset = 0;
  for (const line of full.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    const m = LINE_RE.exec(line);
    if (!m) continue;

    const sources = new Map();
    for (const span of spans) {
      if (span.start < lineEnd && span.end > lineStart) {
        for (const c of span.cites) if (!sources.has(c.url)) sources.set(c.url, { title: (c.title || c.url).trim(), url: c.url });
      }
    }
    const about = m[2].toLowerCase();
    // Links the model typed are not sources and must not reach the email.
    const fact = cleanText(m[3].replace(NO_SOURCE_RE, " ").replace(/\s*\(?https?:\/\/[^\s)]+\)?/g, ""), "research note").trim();
    if (!fact) continue;
    notes.push({
      id: `N${notes.length + 1}`,
      product: m[1].toUpperCase(),
      about: about === "home" ? "home" : about === "germany" ? "germany" : "product",
      country: about === "home" ? homeCountry : "Germany",
      fact,
      sources: [...sources.values()],
    });
  }
  return notes;
}
