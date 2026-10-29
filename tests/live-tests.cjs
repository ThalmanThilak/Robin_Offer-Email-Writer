// Live tests with the real Claude API. They cost a little money (web searches and tokens).
// Needs the environment variable ANTHROPIC_API_KEY. The key is never written to a file.
// Run: node tests/live-tests.cjs   Screenshots and reports go to test-output/live/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./helpers.cjs");

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.log("ANTHROPIC_API_KEY is not set. Live tests skipped.");
  process.exit(2);
}

const OUT = path.join(__dirname, "..", "test-output", "live");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8282;
const URL = `http://localhost:${PORT}/`;

const results = [];
const allBodies = [];
const allOutputs = [];
const usages = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "\n      " + detail : ""}`);
}

const CURRENCY_NUMBER = /(?:€|EUR|euros?|Euro|₹|Rs\.?|INR|R\$|BRL|reais|\$)\s?\d[\d.,]*(?:\s?(?:million|Mio\.?|Millionen|lakh|crore))?|\d[\d.,]*\s?(?:million|Mio\.?|Millionen|lakh|crore)?\s?(?:€|EUR|euros?|Euro|₹|Rs\.?|INR|R\$|BRL|reais|\$)/gi;

async function newPage(browser, settings = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
  const page = await context.newPage();
  page.bodies = [];
  page.on("request", (req) => {
    if (req.url().startsWith("https://api.anthropic.com/") && req.method() === "POST") {
      page.bodies.push(req.postData() || "");
      allBodies.push(req.postData() || "");
    }
  });
  await page.goto(URL);
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
  }, null, { timeout: 6 * 60 * 1000 });
  const seconds = Math.round((Date.now() - start) / 1000);
  const progress = await page.locator("#progress li").allTextContents();
  const failed = await page.locator("#progress li.is-error").count();
  return { seconds, progress, failed };
}

async function outputs(page) {
  return page.evaluate(() => ({
    subjects: [...document.querySelectorAll("#subjects .subject-text")].map((e) => e.textContent),
    email: document.querySelector("#email-preview").innerText,
    whatsapp: document.querySelector("#whatsapp").textContent,
    warnings: document.querySelector("#warnings").innerText,
    facts: [...document.querySelectorAll("#facts li")].map((e) => e.innerText),
    usage: window.__oewLastUsage || null,
  }));
}

// Claude Sonnet 5.5 prices per million tokens (Anthropic pricing page, October 2026):
// input $2, cache write $2.50, cache read $0.10, output $10. Web search: $10 per 1,000 searches.
function costUsd(u) {
  if (!u) return null;
  const input = (u.input_tokens * 2 + u.cache_creation_input_tokens * 2.5 + u.cache_read_input_tokens * 0.1 + u.output_tokens * 10) / 1e6;
  return Math.round((input + u.web_search_requests * 0.01) * 1000) / 1000;
}

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch();

  const india = {
    first: "Arjun",
    last: "Venkatesh",
    gender: "male",
    age: "32",
    country: "India",
    region: "Karnataka",
    years: "2",
    job: "IT, software developer",
    family: "married",
    children: "1",
    offer: ["personal_liability", "legal_protection"],
    lang: "en",
  };

  // Test connection
  {
    const page = await newPage(browser);
    await page.click('.tab[data-view="settings"]');
    await page.click("#key-test");
    await page.waitForFunction(() => !document.querySelector("#key-test").disabled, null, { timeout: 60000 });
    const msg = await page.textContent("#key-message");
    check("Test connection works with a real key", msg.includes("connection works"), msg);
    await page.close();
  }

  // Live test 1
  {
    const page = await newPage(browser, { signature: "Kind regards\nRobin Example\nAllianz agent\nhttps://cal.example.com/robin" });
    await fill(page, india);
    const run = await generate(page);
    const out = await outputs(page);
    allOutputs.push(out);
    usages.push({ test: "1 generate", seconds: run.seconds, usage: out.usage, usd: costUsd(out.usage) });
    fs.writeFileSync(path.join(OUT, "test1-output.json"), JSON.stringify({ run, out }, null, 2));
    await page.screenshot({ path: path.join(OUT, "test1-result.png"), fullPage: true });
    check("Live 1: email generated", run.failed === 0 && out.email.length > 200, run.progress.join(" | "));
    const money = out.email.match(CURRENCY_NUMBER) || [];
    check("Live 1: no prices or cover amounts in the email", money.length === 0, money.join(", "));
    check("Live 1: greeting filled locally", out.email.startsWith("Dear Mr. Venkatesh,"), out.email.slice(0, 40));

    await page.click('[data-edit="shorter"]');
    await page.waitForFunction(() => document.querySelector("#busy-edit").hidden && !document.querySelector("[data-edit]").disabled, null, { timeout: 180000 });
    const shorter = await outputs(page);
    allOutputs.push(shorter);
    usages.push({ test: "1 shorter", usage: shorter.usage, usd: costUsd(shorter.usage) });
    check("Live 1: Shorter button makes the email shorter", shorter.email.length < out.email.length, `${out.email.length} -> ${shorter.email.length} characters`);
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return { types: items[0].types, html: await (await items[0].getType("text/html")).text() };
    });
    fs.writeFileSync(path.join(OUT, "test1-clipboard.html"), clip.html);
    check("Live 1: Copy email puts HTML on the clipboard", clip.types.includes("text/html") && /<(h3|ul|ol|p)>/.test(clip.html));
    await page.close();
  }

  // Live test 2
  {
    const page = await newPage(browser, { productFacts: { personal_liability: { price: "4,95 EUR per month", covers: "Cover up to 50 million euros for personal injury and property damage" } } });
    await fill(page, india);
    const run = await generate(page);
    const out = await outputs(page);
    allOutputs.push(out);
    usages.push({ test: "2 generate", seconds: run.seconds, usage: out.usage, usd: costUsd(out.usage) });
    fs.writeFileSync(path.join(OUT, "test2-output.json"), JSON.stringify({ run, out }, null, 2));
    await page.screenshot({ path: path.join(OUT, "test2-result.png"), fullPage: true });
    check("Live 2: email generated", run.failed === 0, run.progress.join(" | "));
    const money = out.email.match(CURRENCY_NUMBER) || [];
    const allowed = /^(?:.*\b4[.,]95\b.*|.*\b50\b.*)$/;
    const others = money.filter((m) => !allowed.test(m));
    check("Live 2: email uses the entered price and cover", /4[.,]95/.test(out.email) && /50 million|50 Mio/i.test(out.email), money.join(", "));
    check("Live 2: no other money numbers", others.length === 0, others.join(", "));
    await page.close();
  }

  // Live test 3
  {
    const page = await newPage(browser);
    await fill(page, { first: "Ana", last: "Oliveira", gender: "female", age: "45", country: "Brazil", offer: ["household_contents"], lang: "de" });
    const run = await generate(page);
    const out = await outputs(page);
    allOutputs.push(out);
    usages.push({ test: "3 generate", seconds: run.seconds, usage: out.usage, usd: costUsd(out.usage) });
    fs.writeFileSync(path.join(OUT, "test3-output.json"), JSON.stringify({ run, out }, null, 2));
    await page.screenshot({ path: path.join(OUT, "test3-result.png"), fullPage: true });
    check("Live 3: email generated", run.failed === 0, run.progress.join(" | "));
    check("Live 3: greeting 'Sehr geehrte Frau Oliveira,'", out.email.startsWith("Sehr geehrte Frau Oliveira,"), out.email.slice(0, 40));
    const informal = /(?<![\p{L}])(du|dich|dir|dein\w*|euch|euer|eure)(?![\p{L}])/iu.test(out.email + out.whatsapp);
    check("Live 3: Sie form, no du form", !informal && /\b(Sie|Ihnen|Ihr\w*)\b/.test(out.email));
    await page.close();
  }

  // Live test 4: names never in any request body
  const leaks = allBodies.filter((b) => /arjun|venkatesh|oliveira|\bana\b/i.test(b));
  check(`Live 4: no first or last name in any of the ${allBodies.length} request bodies`, leaks.length === 0, leaks.length ? "leak found" : "");
  fs.writeFileSync(path.join(OUT, "request-bodies.txt"), allBodies.map((b, i) => `----- request ${i + 1} -----\n${b.replaceAll(KEY, "[KEY]")}`).join("\n\n"));

  // Live test 5: no em or en dash in any output
  const dashHits = allOutputs.filter((o) => /[–—]/.test([o.email, o.whatsapp, ...o.subjects].join("\n")));
  check("Live 5: no em dash or en dash in any output", dashHits.length === 0);

  fs.writeFileSync(path.join(OUT, "cost.json"), JSON.stringify(usages, null, 2));
  console.log("\nCost per call (estimate from token counts):");
  for (const u of usages) console.log(`  ${u.test}: $${u.usd}${u.seconds ? `, ${u.seconds} s` : ""}, searches: ${u.usage?.web_search_requests ?? "?"}`);

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(OUT, "live-results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
