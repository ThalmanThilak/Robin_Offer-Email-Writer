// Turns the model's simple Markdown into simple HTML (for Outlook) and plain text.
// Allowed HTML: p, h3, strong, ul, ol, li, br, a. No colors, no fonts.

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
const NUMBER_RE = /\d+(?:[.,]\d{3}(?!\d))*(?:[.,]\d+)?/g;

// Bold and number marks inside one piece of text that has no links.
function inlineNoLinks(text, marks) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts
    .map((part) => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      const raw = bold ? bold[1] : part.replace(/\*\*/g, "");
      let html = escapeHtml(raw);
      if (marks) {
        html = html.replace(NUMBER_RE, (n) => (marks(n) ? `<mark>${n}</mark>` : n));
      }
      return bold ? `<strong>${html}</strong>` : html;
    })
    .join("");
}

function withLinks(text, renderPlainPart) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out += renderPlainPart(text.slice(last, m.index));
    const url = m[0];
    out += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    last = m.index + url.length;
  }
  return out + renderPlainPart(text.slice(last));
}

function inline(text, marks) {
  return withLinks(text, (part) => inlineNoLinks(part, marks));
}

function parseBlocks(md) {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = null;
  let list = null;
  const close = () => {
    if (para) blocks.push({ type: "p", lines: para });
    if (list) blocks.push(list);
    para = null;
    list = null;
  };
  for (const line of lines) {
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      close();
    } else if (heading) {
      close();
      blocks.push({ type: "h", text: heading[1].replace(/\*\*/g, "").trim() });
    } else if (bullet) {
      if (para || (list && list.type !== "ul")) close();
      list = list || { type: "ul", items: [] };
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (para || (list && list.type !== "ol")) close();
      list = list || { type: "ol", items: [], start: Number(numbered[1]) };
      list.items.push(numbered[2]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      // An indented line continues the last list item.
      list.items[list.items.length - 1] += " " + line.trim();
    } else {
      if (list) close();
      para = para || [];
      para.push(line.trim());
    }
  }
  close();
  return blocks;
}

// marks: optional function (number text) => true to highlight it. Only for the preview, never for copying.
export function markdownToHtml(md, marks) {
  return parseBlocks(md)
    .map((b) => {
      if (b.type === "h") return `<h3>${inline(b.text)}</h3>`;
      if (b.type === "p") return `<p>${b.lines.map((l) => inline(l, marks)).join("<br>")}</p>`;
      const items = b.items.map((i) => `<li>${inline(i, marks)}</li>`).join("");
      if (b.type === "ol") return b.start && b.start !== 1 ? `<ol start="${b.start}">${items}</ol>` : `<ol>${items}</ol>`;
      return `<ul>${items}</ul>`;
    })
    .join("\n");
}

export function markdownToPlain(md) {
  return parseBlocks(md)
    .map((b) => {
      if (b.type === "h") return b.text;
      if (b.type === "p") return b.lines.map((l) => l.replace(/\*\*/g, "")).join("\n");
      return b.items
        .map((i, n) => (b.type === "ol" ? `${(b.start || 1) + n}. ` : "- ") + i.replace(/\*\*/g, ""))
        .join("\n");
    })
    .join("\n\n");
}

// The signature is used exactly as typed. In HTML, line breaks become <br> and links become clickable.
export function signatureToHtml(signature) {
  const text = (signature || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  return `<p>${text.split("\n").map((l) => withLinks(l, escapeHtml)).join("<br>")}</p>`;
}

export function plainText(text) {
  return (text || "").replace(/\*\*/g, "").replace(/^\s*#{1,6}\s+/gm, "");
}
