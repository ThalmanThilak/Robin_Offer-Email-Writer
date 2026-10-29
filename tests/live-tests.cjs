// Live tests with the real Claude API. They cost a little money (web searches and tokens).
// Needs the environment variable ANTHROPIC_API_KEY. The key is never written to a file.
// Run: npm install && node tests/live-tests.cjs   Results go to test-output/live/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { startServer } = require("./helpers.cjs");

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.log("ANTHROPIC_API_KEY is not set. Live tests skipped.");
  process.exit(2);
}

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "test-output", "live");
fs.mkdirSync(OUT, { recursive: true });
const OLD_COMMIT = "7f30ec6"; // the one-call flow that Thalman tested
const report = [];
const allBodies = [];
const allOutputs = [];
const costs = [];

// Runs one test block; an error fails that block but the other blocks still run.
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name} (crashed)`, false, err.message);
  }
}

function check(name, ok, detail = "") {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "\n      " + String(detail).slice(0, 600) : ""}`);
}

// Prices per million tokens and per search (Anthropic pricing page, October 2026).
const PRICES = {
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
};
function callCost(u, model = "claude-sonnet-5-5") {
  const p = PRICES[model] || PRICES["claude-sonnet-5-5"];
  return (u.input_tokens * p.input + u.cache_creation_input_tokens * p.cacheWrite + u.cache_read_input_tokens * p.cacheRead + u.output_tokens * p.output) / 1e6 + u.web_search_requests * 0.01;
}
function usageCost(usage) {
  if (!usage) return null;
  const calls = usage.calls || [{ ...usage, step: "one call", model: "claude-sonnet-5-5" }];
  const rows = calls.map((c) => ({ step: c.step, model: c.model, input: c.input_tokens, output: c.output_tokens, cacheRead: c.cache_read_input_tokens, cacheWrite: c.cache_creation_input_tokens, searches: c.web_search_requests, usd: +callCost(c, c.model).toFixed(4) }));
  return { rows, total: +rows.reduce((s, r) => s + r.usd, 0).toFixed(4) };
}

const MONEY = /(?:€|EUR|euros?|Euro|₹|Rs\.?|INR|R\$|BRL|reais|\$)\s?\d[\d.,]*(?:\s?(?:million|Mio\.?|Millionen|lakh|crore))?|\d[\d.,]*\s?(?:million|Mio\.?|Millionen|lakh|crore)?\s?(?:€|EUR|euros?|Euro|₹|Rs\.?|INR|R\$|BRL|reais|\$)/gi;
const MARKUP = /<\/?[a-z][^>]*>|\bindex\s*=|\[\d+(?:[-,]\s*\d+)*\]|【|\[P\d+\||\[NO SOURCE\]/i;
const RULE_TALK = /will not guess|won'?t guess|not guess|could not find|couldn'?t find|my research|search results?|you know better than I|nicht raten|keine Quelle/i;

async function newPage(browser, url, settings = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  const page = await context.newPage();
  page.bodies = [];
  page.warnings = [];
  page.on("console", (m) => m.type() === "warning" && page.warnings.push(m.text()));
  page.on("request", (req) => {
    if (req.url().startsWith("https://api.anthropic.com/") && req.method() === "POST") {
      page.bodies.push(req.postData() || "");
      allBodies.push(req.postData() || "");
    }
  });
  await page.goto(url);
  await page.evaluate(
    ({ key, settings }) => {
      localStorage.clear();
      localStorage.setItem("oew.apiKey", key);
      localStorage.setItem("oew.settings", JSON.stringify(settings));
    },
    { key: KEY, settings }
  );
  await page.reload();
  return page;
}

async function fill(page, c) {
  await page.fill("#first-name", c.first);
  await page.fill("#last-name", c.last);
  await page.selectOption("#gender", c.gender);
  await page.fill("#age", c.age);
  await page.fill("#country", c.country);
  if (c.region) await page.fill("#region", c.region);
  if (c.years) await page.fill("#years", c.years);
  if (c.job) await page.fill("#job", c.job);
  if (c.family) await page.selectOption("#family", c.family);
  if (c.children) await page.fill("#children", c.children);
  for (const id of c.offer) await page.check(`#picker-offer input[value="${id}"]`);
  if (c.lang === "de") await page.click('#email-lang button[data-value="de"]');
}

async function generate(page) {
  const start = Date.now();
  await page.click("#generate");
  await page.waitForFunction(() => {
    const items = document.querySelectorAll("#progress li");
    const last = items[items.length - 1];
    return last && last.classList.contains("is-done") && !document.querySelector("#generate").disabled;
  }, null, { timeout: 8 * 60 * 1000 });
  return {
    seconds: Math.round((Date.now() - start) / 1000),
    progress: await page.locator("#progress li").allTextContents(),
    failed: await page.locator("#progress li.is-error").count(),
  };
}

async function outputs(page) {
  return page.evaluate(() => ({
    subjects: [...document.querySelectorAll("#subjects .subject-text")].map((e) => e.textContent),
    email: document.querySelector("#email-preview").innerText,
    whatsapp: document.querySelector("#whatsapp").textContent,
    warnings: document.querySelector("#warnings").innerText,
    facts: [...document.querySelectorAll("#facts li.fact")].map((e) => ({ text: e.innerText, links: [...e.querySelectorAll("a")].map((a) => a.href) })),
    usage: window.__oewLastUsage || null,
    result: window.__oewLastResult || null,
  }));
}

// A second model reads each email and checks the story parts and the product claims.
let grader;
async function grade(email, products, lang) {
  try {
    return await gradeOnce(email, products, lang);
  } catch (err) {
    check("Grader call", false, err.message);
    return { products: [] };
  }
}

async function gradeOnce(email, products, lang) {
  if (!grader) {
    const Anthropic = require("@anthropic-ai/sdk");
    grader = new Anthropic({ apiKey: KEY });
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["products"],
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["product", "situation", "problem", "impact", "ending_with_and_without", "home_concrete_facts", "friendly_line", "claims_beyond_agent_facts", "comment"],
          properties: {
            product: { type: "string" },
            situation: { type: "boolean" },
            problem: { type: "boolean" },
            impact: { type: "boolean" },
            ending_with_and_without: { type: "boolean" },
            home_concrete_facts: { type: "array", items: { type: "string" } },
            friendly_line: { type: "string", enum: ["none", "after_facts", "before_facts", "instead_of_facts"] },
            claims_beyond_agent_facts: { type: "array", items: { type: "string" } },
            comment: { type: "string" },
          },
        },
      },
    },
  };
  const prompt = `You check a sales email (language: ${lang}). For each product section, answer:
- situation: does the story describe a situation fitted to the client (age, family or job)?
- problem: does it say what goes wrong or what is needed?
- impact: does it say what this means for the client (money, time or stress)?
- ending_with_and_without: does it say how the story ends both without the product and with the product?
- home_concrete_facts: list each concrete, practical fact about the client's home country in this section (not general phrases, not legal theory). Quote them short.
- friendly_line: is there a line like "you may know this better from your own experience"? "none", "after_facts", "before_facts" or "instead_of_facts".
- claims_beyond_agent_facts: list every statement about what the agent's product covers, pays or promises that is NOT supported by the agent_facts below. If agent_facts is "none", list every promise about the agent's product (general statements about this type of insurance in Germany are fine).

<agent_facts>
${JSON.stringify(products, null, 2)}
</agent_facts>

<email>
${email}
</email>`;
  const res = await grader.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 8000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  const u = res.usage;
  costs.push({ test: "grader", ...usageCost({ calls: [{ step: "grader", model: "claude-sonnet-5-5", input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens || 0, cache_creation_input_tokens: u.cache_creation_input_tokens || 0, web_search_requests: 0 }] }) });
  return JSON.parse(res.content.find((b) => b.type === "text").text);
}

function storyChecks(label, graded) {
  for (const p of graded.products) {
    const parts = ["situation", "problem", "impact", "ending_with_and_without"].filter((k) => !p[k]);
    check(`${label}: story has all 4 parts (${p.product})`, parts.length === 0, parts.length ? "missing: " + parts.join(", ") + ". " + p.comment : "");
    check(`${label}: at least 2 concrete home country facts (${p.product})`, p.home_concrete_facts.length >= 2, p.home_concrete_facts.join(" | "));
    check(`${label}: friendly line only after facts (${p.product})`, p.friendly_line === "none" || p.friendly_line === "after_facts", p.friendly_line);
  }
}

function commonChecks(label, out, lang, signature) {
  const text = [out.email, out.whatsapp, ...out.subjects].join("\n");
  check(`${label}: no markup, cite tags or index numbers`, !MARKUP.test(text), (text.match(MARKUP) || [""])[0]);
  console.log(`INFO  ${label}: the clean-up step removed markup ${out.cleanupWarnings || 0} time(s)`);
  check(`${label}: no 'I will not guess' style lines`, !RULE_TALK.test(text), (text.match(RULE_TALK) || [""])[0]);
  check(`${label}: no em dash or en dash`, !/[\u2013\u2014]/.test(text));
  const closing = lang === "de" ? "Mit freundlichen Grüßen" : "Kind regards,";
  const other = lang === "de" ? /Kind regards|Best regards|Thanks,/ : /Mit freundlichen|Thanks,|Best regards/;
  const count = (out.email.match(new RegExp(closing, "g")) || []).length;
  check(`${label}: one closing, in the right language`, count === 1 && !other.test(out.email), `"${closing}" x${count}`);
  if (signature) check(`${label}: signature at the end`, out.email.trim().endsWith(signature.trim().split("\n").pop()));
  const r = out.result;
  if (r) {
    const used = new Set(r.usedNotes);
    const products = [...new Set(r.notes.map((n) => n.product))];
    for (const key of products) {
      const home = r.notes.filter((n) => n.product === key && n.about === "home" && used.has(n.id));
      check(`${label}: ${key} uses at least 2 home country notes`, home.length >= 2, home.map((n) => `${n.sources.length ? "[source]" : "[NO SOURCE]"} ${n.fact}`).join(" | "));
    }
    const shown = out.facts.every((f) => f.links.length > 0 || f.text.includes("No source found") || f.text.includes("Keine Quelle gefunden"));
    check(`${label}: every fact in 'Facts to check' has a source or says 'No source found'`, shown, `${out.facts.length} facts, ${out.facts.filter((f) => f.links.length).length} with a source`);
  }
}

(async () => {
  // The new site, and the old one-call version from git for the cost comparison.
  const oldDir = path.join(ROOT, "test-output", "old-site");
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.mkdirSync(oldDir, { recursive: true });
  execSync(`git archive ${OLD_COMMIT} site | tar -x -C "${oldDir}"`, { cwd: ROOT });
  const server = await startServer(8282);
  const oldServer = await startServer(8383, path.join(oldDir, "site"));
  const NEW = "http://localhost:8282/";
  const OLD = "http://localhost:8383/";
  const browser = await chromium.launch();

  const SIGNATURE = "Robin Example\nAllianz agent\nhttps://cal.example.com/robin";
  const india = { first: "Arjun", last: "Venkatesh", gender: "male", age: "32", country: "India", region: "Karnataka", years: "2", job: "IT, software developer", family: "married", children: "1", offer: ["personal_liability", "legal_protection"], lang: "en" };

  // Test connection
  await step("Test connection", async () => {
    const page = await newPage(browser, NEW);
    await page.click('.tab[data-view="settings"]');
    await page.click("#key-test");
    await page.waitForFunction(() => !document.querySelector("#key-test").disabled, null, { timeout: 60000 });
    const msg = await page.textContent("#key-message");
    check("Test connection works with a real key", msg.includes("connection works"), msg);
    await page.close();
  });

  // Live test 1: India, no product facts, English
  await step("Live test 1: India, no product facts, English", async () => {
    const page = await newPage(browser, NEW, { signature: SIGNATURE });
    await fill(page, india);
    const run = await generate(page);
    const out = await outputs(page);
    out.cleanupWarnings = page.warnings.filter((w) => w.includes("removed markup")).length;
    allOutputs.push(out);
    costs.push({ test: "Test 1, new two-call flow", seconds: run.seconds, ...usageCost(out.usage) });
    fs.writeFileSync(path.join(OUT, "test1-output.json"), JSON.stringify({ run, out }, null, 2));
    fs.writeFileSync(path.join(OUT, "test1-email.txt"), [`Subject options:\n- ${out.subjects.join("\n- ")}`, "", out.email, "", "WhatsApp:", out.whatsapp].join("\n"));
    await page.screenshot({ path: path.join(OUT, "test1-result.png"), fullPage: true });
    check("Live 1: email generated", run.failed === 0, run.progress.join(" | "));
    const money = out.email.match(MONEY) || [];
    check("Live 1: no prices or cover amounts", money.length === 0, money.join(", "));
    check("Live 1: greeting filled locally", out.email.startsWith("Dear Mr. Venkatesh,"), out.email.slice(0, 40));
    commonChecks("Live 1", out, "en", SIGNATURE);
    const graded = await grade(out.email, [{ product: "Personal liability", agent_facts: "none" }, { product: "Legal protection", agent_facts: "none" }], "English");
    fs.writeFileSync(path.join(OUT, "test1-grade.json"), JSON.stringify(graded, null, 2));
    storyChecks("Live 1", graded);
    for (const p of graded.products) check(`Live 1: no promises about Robin's product without facts (${p.product})`, p.claims_beyond_agent_facts.length === 0, p.claims_beyond_agent_facts.join(" | "));

    const before = page.bodies.length;
    await page.click('[data-edit="shorter"]');
    await page.waitForFunction(() => document.querySelector("#busy-edit").hidden && !document.querySelector("[data-edit]").disabled, null, { timeout: 180000 });
    const shorter = await outputs(page);
    allOutputs.push(shorter);
    costs.push({ test: "Test 1, Shorter button", ...usageCost(shorter.usage) });
    const editBody = JSON.parse(page.bodies[before]);
    check("Live 1: Shorter uses the saved notes and does not search again", page.bodies.length === before + 1 && !editBody.tools && editBody.messages[0].content.includes("<notes>"));
    check("Live 1: Shorter makes the email shorter", shorter.email.length < out.email.length, `${out.email.length} -> ${shorter.email.length} characters`);
    await page.close();
  });

  // Live test 2: same client, price and cover for personal liability, nothing for legal protection
  await step("Live test 2: same client, price and cover for personal liability, nothing for legal protection", async () => {
    const facts = { price: "4,95 EUR per month", covers: "Cover up to 50 million euros for personal injury and property damage" };
    const page = await newPage(browser, NEW, { signature: SIGNATURE, productFacts: { personal_liability: facts } });
    await fill(page, india);
    const run = await generate(page);
    const out = await outputs(page);
    out.cleanupWarnings = page.warnings.filter((w) => w.includes("removed markup")).length;
    allOutputs.push(out);
    costs.push({ test: "Test 2, new two-call flow", seconds: run.seconds, ...usageCost(out.usage) });
    fs.writeFileSync(path.join(OUT, "test2-output.json"), JSON.stringify({ run, out }, null, 2));
    fs.writeFileSync(path.join(OUT, "test2-email.txt"), [`Subject options:\n- ${out.subjects.join("\n- ")}`, "", out.email, "", "WhatsApp:", out.whatsapp].join("\n"));
    await page.screenshot({ path: path.join(OUT, "test2-result.png"), fullPage: true });
    check("Live 2: email generated", run.failed === 0, run.progress.join(" | "));
    const money = out.email.match(MONEY) || [];
    const others = money.filter((m) => !/4[.,]95|\b50\b/.test(m));
    check("Live 2: email uses the entered price and cover", /4[.,]95/.test(out.email) && /50 million|50 Mio/i.test(out.email), money.join(", "));
    check("Live 2: no other money amounts", others.length === 0, others.join(", "));
    commonChecks("Live 2", out, "en", SIGNATURE);
    const graded = await grade(out.email, [{ product: "Personal liability", agent_facts: facts }, { product: "Legal protection", agent_facts: "none" }], "English");
    fs.writeFileSync(path.join(OUT, "test2-grade.json"), JSON.stringify(graded, null, 2));
    storyChecks("Live 2", graded);
    for (const p of graded.products) check(`Live 2: product claims match My products (${p.product})`, p.claims_beyond_agent_facts.length === 0, p.claims_beyond_agent_facts.join(" | "));
    await page.close();
  });

  // Live test 3: Brazil, German email
  await step("Live test 3: Brazil, German email", async () => {
    const page = await newPage(browser, NEW, { signature: "Robin Example\nAllianz Vertretung" });
    await fill(page, { first: "Ana", last: "Oliveira", gender: "female", age: "45", country: "Brazil", offer: ["household_contents"], lang: "de" });
    const run = await generate(page);
    const out = await outputs(page);
    out.cleanupWarnings = page.warnings.filter((w) => w.includes("removed markup")).length;
    allOutputs.push(out);
    costs.push({ test: "Test 3, new two-call flow (1 product)", seconds: run.seconds, ...usageCost(out.usage) });
    fs.writeFileSync(path.join(OUT, "test3-output.json"), JSON.stringify({ run, out }, null, 2));
    fs.writeFileSync(path.join(OUT, "test3-email.txt"), [`Betreff:\n- ${out.subjects.join("\n- ")}`, "", out.email, "", "WhatsApp:", out.whatsapp].join("\n"));
    await page.screenshot({ path: path.join(OUT, "test3-result.png"), fullPage: true });
    check("Live 3: email generated", run.failed === 0, run.progress.join(" | "));
    check("Live 3: greeting 'Sehr geehrte Frau Oliveira,'", out.email.startsWith("Sehr geehrte Frau Oliveira,"), out.email.slice(0, 40));
    const informal = /(?<![\p{L}])(du|dich|dir|dein\w*|euch|euer|eure)(?![\p{L}])/iu.test(out.email + out.whatsapp);
    check("Live 3: Sie form, no du form", !informal && /\b(Sie|Ihnen|Ihr\w*)\b/.test(out.email));
    commonChecks("Live 3", out, "de", "Robin Example\nAllianz Vertretung");
    const graded = await grade(out.email, [{ product: "Hausratversicherung", agent_facts: "none" }], "German");
    fs.writeFileSync(path.join(OUT, "test3-grade.json"), JSON.stringify(graded, null, 2));
    storyChecks("Live 3", graded);
    await page.close();
  });

  // Cost: the old one-call flow with the client from test 1
  await step("Cost: the old one-call flow with the client from test 1", async () => {
    const page = await newPage(browser, OLD, { signature: SIGNATURE });
    await fill(page, india);
    const run = await generate(page);
    const out = await outputs(page);
    costs.push({ test: "Test 1, old one-call flow", seconds: run.seconds, ...usageCost(out.usage) });
    fs.writeFileSync(path.join(OUT, "old-flow-email.txt"), out.email);
    const markupOld = MARKUP.test(out.email);
    console.log(`Old flow: ${run.failed ? "failed" : "ok"}, markup in email: ${markupOld}`);
    await page.close();
  });

  // Test 4: names never in any request body
  const leaks = allBodies.filter((b) => /arjun|venkatesh|oliveira|\bana\b/i.test(b));
  check(`Live 4: no first or last name in any of the ${allBodies.length} request bodies`, leaks.length === 0);
  fs.writeFileSync(path.join(OUT, "request-bodies.txt"), allBodies.map((b, i) => `----- request ${i + 1} -----\n${b.split(KEY).join("[KEY]")}`).join("\n\n"));

  // Test 5: no dash anywhere
  check("Live 5: no em dash or en dash in any output", allOutputs.every((o) => !/[\u2013\u2014]/.test([o.email, o.whatsapp, ...o.subjects].join("\n"))));

  fs.writeFileSync(path.join(OUT, "cost.json"), JSON.stringify(costs, null, 2));
  console.log("\nCost (from the token counts the API returned):");
  for (const c of costs) {
    console.log(`  ${c.test}: $${c.total}${c.seconds ? `, ${c.seconds} s` : ""}`);
    for (const r of c.rows || []) console.log(`      ${r.step}: ${r.input} in, ${r.output} out, ${r.cacheRead} cache read, ${r.searches} searches = $${r.usd}`);
  }

  await browser.close();
  server.close();
  oldServer.close();
  const failed = report.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(OUT, "live-results.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
