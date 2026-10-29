// Test helpers: a small static web server and a fake Anthropic API.
const http = require("http");
const fs = require("fs");
const path = require("path");

const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain" };

function startServer(port = 8181) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(SITE, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-expose-headers": "*",
};

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

// A streamed reply with one web search, its results, and the final JSON text.
function streamReply({ query, results, json, stopReason = "end_turn" }) {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  const chunks = text.match(/[\s\S]{1,80}/g) || [""];
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query }) } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "enc", page_age: null })),
      },
    },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    ...chunks.map((c) => ({ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: c } })),
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 900, server_tool_use: { web_search_requests: 1 } } },
    { type: "message_stop" },
  ];
  return sse(events);
}

function jsonReply(json) {
  return {
    id: "msg_edit",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 800, output_tokens: 400 },
  };
}

function apiError(status, type, message) {
  return { status, body: JSON.stringify({ type: "error", error: { type, message } }) };
}

// Installs a fake API on the page. handler(body) returns { stream } or { json } or { error: {status, body} } or { abort: true }.
// Every request body is saved in the returned list, so tests can check it.
async function fakeApi(page, handler) {
  const bodies = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const raw = req.postData() || "";
    bodies.push({ url: req.url(), headers: req.headers(), raw });
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const out = await handler(body, req);
    if (out.abort) return route.abort("failed");
    if (out.error) return route.fulfill({ status: out.error.status, headers: { ...CORS, "content-type": "application/json" }, body: out.error.body });
    if (out.stream) return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: out.stream });
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(out.json) });
  });
  return bodies;
}

module.exports = { startServer, fakeApi, streamReply, jsonReply, apiError };
