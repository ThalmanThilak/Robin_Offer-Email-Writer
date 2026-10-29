// All calls to the Claude API. The browser talks only to api.anthropic.com.
import Anthropic from "../vendor/anthropic-sdk.js";
import { MODEL, EFFORT_GENERATE, EFFORT_EDIT, MAX_SEARCHES } from "./config.js";
import { SYSTEM_PROMPT, RESULT_SCHEMA, generateMessage, editMessage, repairMessage } from "./prompt.js";

// If the model declines (very rare), the API retries on a fallback model by itself.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AppError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function client(apiKey) {
  if (!apiKey) throw new AppError("key");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 10 * 60 * 1000 });
}

const SYSTEM = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];

// Turns any API error into one of our plain error codes.
export function classifyError(err) {
  if (err instanceof AppError) return err;
  const message = String(err?.error?.error?.message || err?.message || "").toLowerCase();
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AppError("key");
  if (err instanceof Anthropic.APIError && err.status === 402) return new AppError("credit");
  if (err instanceof Anthropic.BadRequestError) {
    if (message.includes("credit balance") || message.includes("spend limit") || message.includes("usage limit")) return new AppError("credit");
    if (message.includes("web search") && (message.includes("not enabled") || message.includes("disabled"))) return new AppError("websearch");
    if (message.includes("x-api-key") || message.includes("api key")) return new AppError("key");
    return new AppError("unknown", message);
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return new AppError("busy");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AppError("busy");
  if (err instanceof Anthropic.APIConnectionError) return new AppError("blocked");
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status >= 500)) return new AppError("busy");
  if (err instanceof TypeError) return new AppError("blocked");
  return new AppError("unknown", message);
}

// Pulls the JSON object out of the model's text, even with code fences or extra words around it.
export function parseResult(text) {
  const cleaned = (text || "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeResult(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function normalizeResult(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.email_body !== "string" || !r.email_body.trim()) return null;
  const subjects = Array.isArray(r.subject_lines) ? r.subject_lines.filter((s) => typeof s === "string" && s.trim()) : [];
  if (!subjects.length) return null;
  return {
    subject_lines: subjects.slice(0, 3),
    email_body: r.email_body,
    whatsapp_message: typeof r.whatsapp_message === "string" ? r.whatsapp_message : "",
    facts: (Array.isArray(r.facts) ? r.facts : [])
      .filter((f) => f && typeof f.claim === "string" && f.claim.trim())
      .map((f) => ({
        claim: f.claim.trim(),
        source_title: typeof f.source_title === "string" ? f.source_title.trim() : "",
        source_url: typeof f.source_url === "string" ? f.source_url.trim() : "",
      })),
    research_notes: typeof r.research_notes === "string" ? r.research_notes : "",
  };
}

function addUsage(total, usage) {
  if (!usage) return;
  total.input_tokens += usage.input_tokens || 0;
  total.output_tokens += usage.output_tokens || 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
  total.web_search_requests += usage.server_tool_use?.web_search_requests || 0;
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };
}

// Every web link the search returned, from result blocks and from citations.
function collectSources(blocks, sources) {
  for (const block of blocks) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) sources.set(r.url, r.title || r.url);
    }
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c.url) sources.set(c.url, c.title || c.url);
    }
  }
}

// The final answer is the text after the last tool block.
function finalText(blocks) {
  let lastTool = -1;
  blocks.forEach((b, i) => {
    if (b.type !== "text") lastTool = i;
  });
  const tail = blocks.slice(lastTool + 1).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (tail.trim()) return tail;
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function checkStop(message) {
  if (message.stop_reason === "refusal") throw new AppError("refused");
}

// Fixes a broken JSON reply with one cheap call, without web search.
async function repair(api, text, usage) {
  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
    messages: [{ role: "user", content: repairMessage(text) }],
  });
  addUsage(usage, response.usage);
  checkStop(response);
  const out = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseResult(out);
}

// Generate: one call with web search. onProgress gets { type: "search", query } and { type: "writing" }.
export async function generate({ apiKey, caseData, onProgress }) {
  const api = client(apiKey);
  const usage = emptyUsage();
  const sources = new Map();
  const messages = [{ role: "user", content: generateMessage(caseData) }];
  const allBlocks = [];
  let message;
  try {
    // The API can pause a long search turn. We then send the turn back so it can go on.
    for (let round = 0; round < 4; round++) {
      const stream = api.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: EFFORT_GENERATE },
        tools: [{ type: "web_search_20260318", name: "web_search", max_uses: MAX_SEARCHES }],
        messages,
      });
      let writing = false;
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          onProgress?.({ type: "search", query: block.input?.query || "" });
        }
      });
      stream.on("text", () => {
        if (!writing) {
          writing = true;
          onProgress?.({ type: "writing" });
        }
      });
      message = await stream.finalMessage();
      addUsage(usage, message.usage);
      allBlocks.push(...message.content);
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
  } catch (err) {
    throw classifyError(err);
  }

  checkStop(message);
  collectSources(allBlocks, sources);
  const text = finalText(message.content);
  let result = parseResult(text);
  if (!result) {
    if (message.stop_reason === "max_tokens") throw new AppError("too_long");
    onProgress?.({ type: "fixing" });
    try {
      result = await repair(api, text, usage);
    } catch (err) {
      throw classifyError(err);
    }
  }
  if (!result) throw new AppError("json");
  return { result, sources, usage, model: message.model };
}

// Edit buttons: no web search. Strict JSON mode makes the reply always readable.
export async function edit({ apiKey, caseData, current, kind }) {
  const api = client(apiKey);
  const usage = emptyUsage();
  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: EFFORT_EDIT, format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages: [{ role: "user", content: editMessage(caseData, current, kind) }],
    });
  } catch (err) {
    throw classifyError(err);
  }
  addUsage(usage, response.usage);
  checkStop(response);
  if (response.stop_reason === "max_tokens") throw new AppError("too_long");
  const result = parseResult(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  if (!result) throw new AppError("json");
  return { result, usage };
}

// A tiny request to check the key, the credit and the connection.
export async function testConnection(apiKey) {
  const api = client(apiKey);
  try {
    await api.messages.create({
      model: MODEL,
      max_tokens: 16,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the word OK." }],
    });
    return true;
  } catch (err) {
    throw classifyError(err);
  }
}
