// All calls to the Claude API. The browser talks only to api.anthropic.com.
// Step 1 (research) uses web search. Step 2 (write) and the edit buttons never search.
import Anthropic from "../vendor/anthropic-sdk.js";
import { MODEL_RESEARCH, MODEL_WRITE, EFFORT_RESEARCH, EFFORT_WRITE, EFFORT_EDIT, MAX_SEARCHES } from "./config.js";
import { RESEARCH_PROMPT, WRITING_PROMPT, WRITE_SCHEMA, researchMessage, writeMessage, editMessage } from "./prompt.js";
import { parseResearch } from "./research.js";

// If the model declines (very rare), the API retries on a fallback model by itself.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// "direct" search returns the sources as citation data on the text, which the notes need.
const SEARCH_TOOL = { type: "web_search_20260318", name: "web_search", max_uses: MAX_SEARCHES, allowed_callers: ["direct"] };

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

const cached = (text) => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

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

function usageOf(step, model, usage) {
  return {
    step,
    model,
    input_tokens: usage?.input_tokens || 0,
    output_tokens: usage?.output_tokens || 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens || 0,
    web_search_requests: usage?.server_tool_use?.web_search_requests || 0,
  };
}

function checkStop(message) {
  if (message.stop_reason === "refusal") throw new AppError("refused");
}

// Step 1: research with web search. Returns notes built from the API's citation data.
// onProgress gets { type: "search", query }.
export async function research({ apiKey, researchCase, homeCountry, onProgress }) {
  const api = client(apiKey);
  const messages = [{ role: "user", content: researchMessage(researchCase) }];
  const blocks = [];
  const usage = [];
  let message;
  try {
    // The API can pause a long search turn. We then send the turn back so it can go on.
    for (let round = 0; round < 4; round++) {
      const stream = api.beta.messages.stream({
        model: MODEL_RESEARCH,
        max_tokens: 16000,
        system: cached(RESEARCH_PROMPT),
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: EFFORT_RESEARCH },
        tools: [SEARCH_TOOL],
        messages,
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          onProgress?.({ type: "search", query: block.input?.query || "" });
        }
      });
      message = await stream.finalMessage();
      usage.push(usageOf("research", MODEL_RESEARCH, message.usage));
      blocks.push(...message.content);
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
  } catch (err) {
    throw classifyError(err);
  }
  checkStop(message);
  const notes = parseResearch(blocks, homeCountry);
  if (!notes.length) throw new AppError("research_empty");
  return { notes, usage };
}

function parseWrite(response) {
  checkStop(response);
  if (response.stop_reason === "max_tokens") throw new AppError("too_long");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const r = JSON.parse(text);
    const subjects = (r.subject_lines || []).filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
    if (!subjects.length || typeof r.email_body !== "string" || !r.email_body.trim()) throw new Error("empty");
    return {
      subject_lines: subjects,
      email_body: r.email_body,
      whatsapp_message: typeof r.whatsapp_message === "string" ? r.whatsapp_message : "",
      used_notes: Array.isArray(r.used_notes) ? r.used_notes.filter((id) => typeof id === "string") : [],
    };
  } catch {
    throw new AppError("json");
  }
}

async function writeCall(apiKey, content, effort, step) {
  const api = client(apiKey);
  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL_WRITE,
      max_tokens: 16000,
      system: cached(WRITING_PROMPT),
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema: WRITE_SCHEMA } },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw classifyError(err);
  }
  return { result: parseWrite(response), usage: [usageOf(step, MODEL_WRITE, response.usage)] };
}

// Step 2: write the email from the notes. No web search. Strict JSON mode.
export function write({ apiKey, caseData, notes }) {
  return writeCall(apiKey, writeMessage(caseData, notes), EFFORT_WRITE, "write");
}

// Edit buttons: rewrite from the saved notes. No web search.
export function edit({ apiKey, caseData, notes, current, kind }) {
  return writeCall(apiKey, editMessage(caseData, notes, current, kind), EFFORT_EDIT, "edit");
}

// A tiny request to check the key, the credit and the connection.
export async function testConnection(apiKey) {
  const api = client(apiKey);
  try {
    await api.messages.create({
      model: MODEL_WRITE,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the word OK." }],
    });
    return true;
  } catch (err) {
    throw classifyError(err);
  }
}
