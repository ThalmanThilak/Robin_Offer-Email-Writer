// Automated tests with a fake Anthropic API. No real API key, no cost.
// Run: node tests/run-tests.cjs   Screenshots go to test-output/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { startServer, fakeApi, streamReply, jsonReply, apiError } = require("./helpers.cjs");

const OUT = path.join(__dirname, "..", "test-output");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8181;
const URL = `http://localhost:${PORT}/`;
const EM = "—";
const EN = "–";
const FAKE_KEY = "sk-ant-test-0000000000000000";

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const SOURCES = [
  { url: "https://example.org/india-civil-courts", title: "Civil courts in India" },
  { url: "https://example.org/germany-liability", title: "Liability law in Germany (BGB 823)" },
];

function sampleResult(extra = {}) {
  return {
    subject_lines: [`Two things that work differently in Germany ${EM} a short note`, "Your liability and legal costs in Germany"],
    email_body: [
      "{{SALUTATION}}",
      "",
      `I hope you are settling in well ${EN} two years in Germany already.`,
      "",
      "## Personal liability (Privathaftpflichtversicherung)",
      "",
      "Imagine your child scratches a parked car while playing.",
      "",
      "- In India, such cases are often settled informally.",
      "- In Germany, you are liable for the full damage by law.",
      "",
      "## Legal protection (Rechtsschutzversicherung)",
      "",
      "1. Civil cases in India can take 7 years.",
      "2. In Germany, you pay lawyer costs up front.",
      "",
      "Would a **15-minute call** next week suit you?",
      "",
      "Kind regards,",
    ].join("\n"),
    whatsapp_message: `{{SALUTATION}} I wrote you an email about liability ${EM} could we talk for 15 minutes?`,
    facts: [
      { claim: "Civil cases in India can take 7 years.", source_title: SOURCES[0].title, source_url: SOURCES[0].url },
      { claim: "In Germany you are liable for damage you cause (BGB 823).", source_title: "Made up", source_url: "https://not-in-search.example.com/x" },
    ],
    research_notes: "notes",
    ...extra,
  };
}

async function newPage(browser, { key = FAKE_KEY, settings } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.evaluate(
    ({ key, settings }) => {
      localStorage.clear();
      if (key) localStorage.setItem("oew.apiKey", key);
      if (settings) localStorage.setItem("oew.settings", JSON.stringify(settings));
    },
    { key, settings }
  );
  await page.reload();
  return page;
}

async function fillClient(page, { first = "Priya", last = "Ramanathan", gender = "female", age = "32", country = "India", region = "Karnataka", years = "2", job = "Software engineer", family = "married", children = "1" } = {}) {
  await page.fill("#first-name", first);
  await page.fill("#last-name", last);
  await page.selectOption("#gender", gender);
  await page.fill("#age", age);
  await page.fill("#country", country);
  await page.fill("#region", region);
  await page.fill("#years", years);
  await page.fill("#job", job);
  await page.selectOption("#family", family);
  await page.fill("#children", children);
}

async function pickOffer(page, ids) {
  for (const id of ids) await page.check(`#picker-offer input[value="${id}"]`);
}

async function waitDone(page) {
  await page.waitForFunction(() => {
    const items = document.querySelectorAll("#progress li");
    const last = items[items.length - 1];
    return last && last.classList.contains("is-done") && !document.querySelector("#generate").disabled;
  }, null, { timeout: 15000 });
}

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch();

  await test("Privacy: names never appear in any request body (generate and edit)", async () => {
    const page = await newPage(browser, { settings: { instructions: "Mention that Priya likes cricket. Ramanathan family.", signature: "Kind regards\nRobin\nhttps://cal.example.com/robin" } });
    const bodies = await fakeApi(page, (body) => {
      if (body.stream) return { stream: streamReply({ query: "civil court duration India", results: SOURCES, json: sampleResult() }) };
      return { json: jsonReply(sampleResult()) };
    });
    await fillClient(page);
    await pickOffer(page, ["personal_liability", "legal_protection"]);
    await page.click("#generate");
    await waitDone(page);
    await page.click('[data-edit="shorter"]');
    await page.waitForFunction(() => document.querySelector("#busy-edit").hidden);
    assert(bodies.length === 2, `expected 2 requests, got ${bodies.length}`);
    for (const b of bodies) {
      assert(!/priya/i.test(b.raw), "first name found in a request body");
      assert(!/ramanathan/i.test(b.raw), "last name found in a request body");
    }
    assert(bodies[0].raw.includes("{{FIRST_NAME}} likes cricket"), "name typed in instructions was not replaced by a placeholder");
    fs.writeFileSync(path.join(OUT, "request-body-generate.json"), JSON.stringify(JSON.parse(bodies[0].raw), null, 2));
    const preview = await page.textContent("#email-preview");
    assert(preview.includes("Dear Ms. Ramanathan,"), "salutation not filled in locally");
  });

  await test("Generate request: web search on, Sonnet 5.5, medium length for 2 products, booking link sent, signature not sent", async () => {
    const body = JSON.parse(fs.readFileSync(path.join(OUT, "request-body-generate.json"), "utf8"));
    assert(body.model === "claude-sonnet-5-5", "wrong model " + body.model);
    assert(body.tools?.[0]?.type === "web_search_20260318" && body.tools[0].max_uses === 5, "web search tool missing");
    const msg = body.messages[0].content;
    assert(msg.includes('"target_length_words": 450'), "length target not 450 for 2 products at medium");
    assert(msg.includes("https://cal.example.com/robin"), "booking link not sent");
    assert(!msg.includes("Robin\\n"), "signature text was sent");
    assert(msg.includes('"signature_has_closing": true'), "closing line in signature not detected");
    assert(msg.includes('"home_country": "India"') && msg.includes("Karnataka"), "client details missing");
  });

  await test("No em dash or en dash in any output (subject, email, WhatsApp, copied text)", async () => {
    const page = await newPage(browser);
    await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: sampleResult() }) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    const all = await page.evaluate(() => document.querySelector("#result").innerText);
    assert(!all.includes("—") && !all.includes("–"), "dash found in result area");
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const html = await (await items[0].getType("text/html")).text();
      const text = await (await items[0].getType("text/plain")).text();
      return html + text;
    });
    assert(!clip.includes("—") && !clip.includes("–"), "dash found in copied email");
    const warn = await page.textContent("#warnings");
    assert(warn.includes("Long dashes were replaced"), "dash warning not shown");
    assert(all.includes("Kind regards,"), "comma after 'Kind regards' was lost");
    assert(all.includes("settling in well, two years"), "dash was not replaced by a comma");
  });

  await test("Facts panel: source checked against search results; unsupported numbers marked", async () => {
    const page = await newPage(browser);
    const result = sampleResult();
    result.email_body += "\n\nMost claims cost around 1,500 euros.";
    await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: result }) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    const verified = await page.locator("#facts .fact.is-verified").count();
    const unverified = await page.locator("#facts .fact.is-unverified").count();
    assert(verified === 1 && unverified === 1, `verified ${verified}, unverified ${unverified}`);
    const marks = await page.locator("#email-preview mark").allTextContents();
    assert(marks.includes("1,500"), "1,500 not marked: " + JSON.stringify(marks));
    assert(!marks.includes("7"), "7 is sourced and must not be marked");
    const warn = await page.textContent("#warnings");
    assert(warn.includes("1,500"), "number warning missing");
    await page.screenshot({ path: path.join(OUT, "result-with-checks.png"), fullPage: true });
  });

  await test("Product facts: price and cover from Robin are sent and numbers from them are allowed", async () => {
    const page = await newPage(browser, {
      settings: { productFacts: { personal_liability: { price: "5,50 EUR per month", covers: "Cover up to 50 million euros" } } },
    });
    const result = sampleResult();
    result.email_body += "\n\nThe cover is up to 50 million euros for 5,50 EUR per month.";
    const bodies = await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: result }) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    const priceField = page.locator('#email-facts [data-product="personal_liability"] [data-field="price"]');
    assert((await priceField.inputValue()) === "5,50 EUR per month", "saved price not shown under the product");
    await page.click("#generate");
    await waitDone(page);
    const msg = JSON.parse(bodies[0].raw).messages[0].content;
    assert(msg.includes('"price": "5,50 EUR per month"') && msg.includes("50 million"), "facts not sent");
    const marks = await page.locator("#email-preview mark").allTextContents();
    assert(!marks.includes("50") && !marks.includes("5,50"), "Robin's numbers were marked: " + JSON.stringify(marks));
  });

  await test("Per-email fact edits are not saved", async () => {
    const page = await newPage(browser, { settings: { productFacts: { personal_liability: { price: "5,50 EUR" } } } });
    await pickOffer(page, ["personal_liability"]);
    await page.fill('#email-facts [data-product="personal_liability"] [data-field="price"]', "9,99 EUR");
    await page.reload();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("oew.settings")).productFacts.personal_liability.price);
    assert(saved === "5,50 EUR", "per-email edit leaked into saved settings: " + saved);
  });

  await test("German email: 'Sehr geehrte Frau' greeting and du-form warning", async () => {
    const page = await newPage(browser);
    const result = sampleResult({ email_body: "{{SALUTATION}}\n\nWir können dir helfen.\n\nMit freundlichen Grüßen," });
    const bodies = await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: result }) }));
    await fillClient(page, { first: "Ana", last: "Souza", country: "Brazil", age: "45", region: "" });
    await pickOffer(page, ["household_contents"]);
    await page.click('#email-lang button[data-value="de"]');
    await page.click("#generate");
    await waitDone(page);
    const preview = await page.textContent("#email-preview");
    assert(preview.includes("Sehr geehrte Frau Souza,"), "German female greeting wrong: " + preview.slice(0, 60));
    assert(JSON.parse(bodies[0].raw).messages[0].content.includes('"email_language": "German"'), "language not sent as German");
    assert((await page.textContent("#warnings")).includes('"du"'), "du warning missing");
  });

  await test("Greetings for all genders in English and German", async () => {
    const page = await newPage(browser);
    const cases = [
      ["male", "en", "Dear Mr. Kumar,"],
      ["female", "en", "Dear Ms. Kumar,"],
      ["other", "en", "Dear Arjun Kumar,"],
      ["male", "de", "Sehr geehrter Herr Kumar,"],
      ["female", "de", "Sehr geehrte Frau Kumar,"],
      ["other", "de", "Guten Tag Arjun Kumar,"],
    ];
    const got = await page.evaluate(async (cases) => {
      const { fillNames } = await import("./js/privacy.js");
      return cases.map(([gender, lang]) => fillNames("{{SALUTATION}}", { gender, lang, firstName: "Arjun", lastName: "Kumar" }));
    }, cases);
    cases.forEach(([, , want], i) => assert(got[i] === want, `got "${got[i]}", want "${want}"`));
  });

  await test("Settings stay after reload (API key, instructions, signature, product facts, own product)", async () => {
    const page = await newPage(browser, { key: "" });
    await page.click('.tab[data-view="settings"]');
    await page.fill("#api-key", FAKE_KEY);
    await page.click("#key-save");
    await page.fill("#signature", "Robin Example\nAllianz agent\nhttps://cal.example.com/robin");
    await page.fill("#instructions", "Keep it short. Mention my weekend appointments.");
    await page.locator('#my-products details[data-product="legal_protection"] > summary').click();
    await page.fill("#mp-legal_protection-price", "19,90 EUR per month");
    await page.fill("#own-en", "Cyber protection");
    await page.fill("#own-de", "Internetschutz");
    await page.click("#own-add");
    await page.waitForTimeout(600);
    await page.reload();
    await page.click('.tab[data-view="settings"]');
    assert((await page.inputValue("#api-key")) === FAKE_KEY, "API key lost");
    assert((await page.inputValue("#signature")).includes("Allianz agent"), "signature lost");
    assert((await page.inputValue("#instructions")).includes("weekend"), "instructions lost");
    assert((await page.inputValue("#mp-legal_protection-price")) === "19,90 EUR per month", "product facts lost");
    assert((await page.locator('#picker-offer .picker-item:has-text("Cyber protection")').count()) === 1, "own product not in offer list");
    assert((await page.locator('#picker-has .picker-item:has-text("Cyber protection")').count()) === 1, "own product not in has list");
    assert(!(await page.isVisible("#key-banner")), "key banner shown although key is saved");
  });

  await test("Backup: export has no API key; import restores settings and reminds about the key", async () => {
    const page = await newPage(browser, {
      settings: { signature: "SIG-123", instructions: "INSTR-456", productFacts: { car: { price: "40 EUR" } }, ownProducts: [{ id: "own_x", en: "Cyber", de: "Cyber" }] },
    });
    await page.click('.tab[data-view="settings"]');
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
    const file = path.join(OUT, "backup-export.json");
    await download.saveAs(file);
    const content = fs.readFileSync(file, "utf8");
    assert(!content.includes(FAKE_KEY) && !/apikey/i.test(content), "backup file contains the API key");
    assert(content.includes("SIG-123") && content.includes("INSTR-456") && content.includes("40 EUR"), "backup is missing settings");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('.tab[data-view="settings"]');
    await page.setInputFiles("#import", file);
    await page.waitForSelector("#backup-message:not([hidden])");
    const msg = await page.textContent("#backup-message");
    assert(msg.includes("No API key is saved"), "no reminder about the API key: " + msg);
    assert((await page.inputValue("#signature")) === "SIG-123", "signature not imported");
    assert((await page.inputValue("#instructions")) === "INSTR-456", "instructions not imported");
    await page.screenshot({ path: path.join(OUT, "backup-import.png") });
  });

  await test("Screen language switch to German changes labels, not the email language", async () => {
    const page = await newPage(browser);
    await page.click('.tab[data-view="settings"]');
    await page.click('#ui-lang button[data-value="de"]');
    assert((await page.textContent('.tab[data-view="write"]')) === "E-Mail schreiben", "nav not German");
    assert((await page.textContent("#key-test")) === "Verbindung testen", "button not German");
    await page.screenshot({ path: path.join(OUT, "settings-german.png") });
    await page.click('.tab[data-view="write"]');
    assert((await page.textContent("#generate")) === "Erstellen", "Generate button not German");
    assert((await page.getAttribute('#email-lang button[data-value="en"]', "aria-checked")) === "true", "email language changed");
    await page.screenshot({ path: path.join(OUT, "write-german.png") });
    await page.reload();
    assert((await page.textContent("#generate")) === "Erstellen", "German not kept after reload");
  });

  const errorCases = [
    ["Wrong API key (401)", () => ({ error: apiError(401, "authentication_error", "invalid x-api-key") }), "API key is wrong or missing"],
    ["No credit (402)", () => ({ error: apiError(402, "billing_error", "billing") }), "no credit left"],
    ["No credit (400 credit balance)", () => ({ error: apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.") }), "no credit left"],
    ["Busy (529 overloaded)", () => ({ error: apiError(529, "overloaded_error", "Overloaded") }), "busy"],
    ["Busy (429 rate limit)", () => ({ error: apiError(429, "rate_limit_error", "Rate limited") }), "busy"],
    ["Busy (500 server error)", () => ({ error: apiError(500, "api_error", "Internal") }), "busy"],
    ["Connection blocked (network failure)", () => ({ abort: true }), "connection to Anthropic is blocked"],
    ["Web search turned off (400)", () => ({ error: apiError(400, "invalid_request_error", "Web search is not enabled for this organization.") }), "Web search is turned off"],
  ];
  for (const [name, handler, expected] of errorCases) {
    await test(`Error message: ${name}`, async () => {
      const page = await newPage(browser);
      await fakeApi(page, handler);
      await fillClient(page);
      await pickOffer(page, ["personal_liability"]);
      await page.click("#generate");
      await waitDone(page);
      const text = await page.textContent("#progress li:last-child");
      assert(text.includes(expected), `got "${text}"`);
      assert(!/\b(4\d\d|5\d\d)\b/.test(text), "raw error code shown: " + text);
      await page.click('.tab[data-view="settings"]');
      await page.click("#key-test");
      await page.waitForFunction(() => !document.querySelector("#key-test").disabled);
      const msg = await page.textContent("#key-message");
      assert(msg.includes(expected), `test connection got "${msg}"`);
    });
  }

  await test("Error message: missing API key", async () => {
    const page = await newPage(browser, { key: "" });
    await fakeApi(page, () => ({ json: {} }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    assert((await page.textContent("#progress li:last-child")).includes("API key is wrong or missing"), "no key message");
    await page.screenshot({ path: path.join(OUT, "error-missing-key.png") });
  });

  await test("Broken JSON reply: one repair call, then the email shows", async () => {
    const page = await newPage(browser);
    let calls = 0;
    await fakeApi(page, (body) => {
      calls++;
      if (body.stream) return { stream: streamReply({ query: "q", results: SOURCES, json: '{"subject_lines": ["a", broken' }) };
      return { json: jsonReply(sampleResult()) };
    });
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    assert(calls === 2, "expected generate + one repair call, got " + calls);
    assert((await page.textContent("#email-preview")).includes("Dear Ms. Ramanathan"), "email not shown after repair");
  });

  await test("Broken JSON twice: clear error message", async () => {
    const page = await newPage(browser);
    await fakeApi(page, (body) => (body.stream ? { stream: streamReply({ query: "q", results: SOURCES, json: "not json" }) } : { json: jsonReply("still not json") }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    assert((await page.textContent("#progress li:last-child")).includes("could not be read"), "no clear JSON error");
  });

  await test("Edit buttons: no web search, strict JSON, current email sent", async () => {
    const page = await newPage(browser);
    const bodies = await fakeApi(page, (body) => (body.stream ? { stream: streamReply({ query: "q", results: SOURCES, json: sampleResult() }) } : { json: jsonReply(sampleResult({ email_body: "{{SALUTATION}}\n\nShorter text." })) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    for (const kind of ["shorter", "longer", "warmer", "formal"]) {
      await page.click(`[data-edit="${kind}"]`);
      await page.waitForFunction(() => document.querySelector("#busy-edit").hidden && !document.querySelector("[data-edit]").disabled);
    }
    const edits = bodies.slice(1).map((b) => JSON.parse(b.raw));
    assert(edits.length === 4, "expected 4 edit calls, got " + edits.length);
    for (const e of edits) {
      assert(!e.tools, "edit call has tools");
      assert(e.output_config?.format?.type === "json_schema", "edit call without strict JSON");
      assert(e.messages[0].content.includes("<current_email>"), "current email not sent");
    }
    assert((await page.textContent("#email-preview")).includes("Shorter text."), "edited email not shown");
  });

  await test("Copy email puts HTML and plain text on the clipboard (with signature)", async () => {
    const page = await newPage(browser, { settings: { signature: "Robin Example\nhttps://cal.example.com/robin" } });
    await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: sampleResult() }) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return {
        types: items[0].types,
        html: await (await items[0].getType("text/html")).text(),
        text: await (await items[0].getType("text/plain")).text(),
      };
    });
    fs.writeFileSync(path.join(OUT, "clipboard-email.html"), clip.html);
    fs.writeFileSync(path.join(OUT, "clipboard-email.txt"), clip.text);
    assert(clip.types.includes("text/html") && clip.types.includes("text/plain"), "types: " + clip.types);
    assert(clip.html.includes("<h3>") && clip.html.includes("<ul>") && clip.html.includes("<ol>") && clip.html.includes("<strong>"), "HTML format missing");
    assert(!/style=|<font|<mark/i.test(clip.html), "HTML has styles, fonts or marks");
    assert(clip.html.includes("Dear Ms. Ramanathan,") && clip.html.includes("Robin Example"), "greeting or signature missing in HTML");
    assert(clip.text.startsWith("Dear Ms. Ramanathan,") && clip.text.trim().endsWith("https://cal.example.com/robin"), "plain text not complete greeting to signature");
    assert(!clip.html.includes("Civil courts in India"), "facts panel was copied");
    await page.click("#copy-whatsapp");
    const wa = await page.evaluate(() => navigator.clipboard.readText());
    assert(wa.startsWith("Dear Ms. Ramanathan,") && !wa.includes("**"), "WhatsApp copy wrong: " + wa);
    await page.screenshot({ path: path.join(OUT, "result-copied.png"), fullPage: true });
  });

  await test("Copy fallback (no ClipboardItem) still puts HTML on the clipboard", async () => {
    const page = await newPage(browser);
    await fakeApi(page, () => ({ stream: streamReply({ query: "q", results: SOURCES, json: sampleResult() }) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    await page.evaluate(() => {
      window.ClipboardItem = undefined;
    });
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const html = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items[0].types.includes("text/html") ? await (await items[0].getType("text/html")).text() : "";
    });
    assert(html.includes("<h3>") && html.includes("Dear Ms. Ramanathan"), "fallback did not keep HTML");
    assert((await page.textContent('[data-copied-for="copy-email"]')) === "Copied", "no Copied message");
  });

  await test("Form check: missing fields show a clear message and nothing is sent", async () => {
    const page = await newPage(browser);
    const bodies = await fakeApi(page, () => ({ json: {} }));
    await page.click("#generate");
    const msg = await page.textContent("#form-error");
    assert(msg.includes("first name") && msg.includes("at least one product"), "missing message: " + msg);
    assert(bodies.length === 0, "a request was sent");
  });

  await test("Security rules: the page cannot connect to any other website", async () => {
    const page = await newPage(browser);
    const blocked = await page.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return false;
      } catch {
        return true;
      }
    });
    assert(blocked, "fetch to example.com was not blocked");
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', "content");
    assert(csp.includes("connect-src https://api.anthropic.com") && csp.includes("script-src 'self'"), "CSP missing");
  });

  await test("No script errors on the page", async () => {
    const page = await newPage(browser);
    await page.click('.tab[data-view="settings"]');
    await page.click('.tab[data-view="write"]');
    assert(page.errors.length === 0, page.errors.join("; "));
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  fs.writeFileSync(path.join(OUT, "test-results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
