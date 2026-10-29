// Automated tests with a fake Anthropic API. No real API key, no cost.
// Run: node tests/run-tests.cjs   Screenshots go to test-output/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { startServer, fakeApi, researchStream, jsonReply, apiError } = require("./helpers.cjs");

const OUT = path.join(__dirname, "..", "test-output");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8181;
const URL = `http://localhost:${PORT}/`;
const EM = "\u2014";
const EN = "\u2013";
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

const SRC = {
  courts: { url: "https://example.org/india-courts", title: "How long civil cases take in India" },
  rent: { url: "https://example.org/bengaluru-rent", title: "Renting in Bengaluru: deposits" },
  bgb: { url: "https://example.org/germany-liability", title: "Liability in Germany (BGB 823)" },
};

const RESEARCH_LINES = [
  { tag: "[P1|HOME]", text: "In Bengaluru, landlords often ask for a deposit of up to 10 months of rent.", source: SRC.rent },
  { tag: "[P1|HOME]", text: "Small damage to a neighbour's property is often settled by a direct payment between families.", source: SRC.courts },
  { tag: "[P1|HOME]", text: "In many cases personal liability insurance is not common for families in India. [NO SOURCE]" },
  { tag: "[P1|GERMANY]", text: "In Germany, a person who causes damage must pay for all of it by law.", source: SRC.bgb },
  { tag: "[P1|GERMANY]", text: "About 85 percent of households in Germany have personal liability insurance.", source: SRC.bgb },
  { tag: "[P2|HOME]", text: "Civil court cases in India can take 7 years or more.", source: SRC.courts },
  { tag: "[P2|HOME]", text: "Many people settle disputes through family or community elders.", source: SRC.courts },
  { tag: "[P2|GERMANY]", text: "In Germany, each side usually pays its own lawyer in the first labour court instance.", source: SRC.bgb },
];

function writeResult(extra = {}) {
  return {
    subject_lines: [`Two things that work differently in Germany ${EM} a short note`, "Your liability and legal costs in Germany"],
    email_body: [
      "{{SALUTATION}}",
      "",
      `I hope you are settling in well ${EN} two years in Germany already.`,
      "",
      "## Personal liability (Privathaftpflichtversicherung)",
      "",
      "Imagine your child scratches a parked car while playing. The owner wants the repair paid.",
      "",
      "- In Bengaluru, such cases are often settled by a direct payment between families.",
      "- In Germany, you must pay the full damage by law.",
      "",
      "## Legal protection (Rechtsschutzversicherung)",
      "",
      "1. Civil cases in India can take 7 years or more.",
      "2. In Germany, each side usually pays its own lawyer.",
      "",
      "Would a **short call** next week suit you?",
    ].join("\n"),
    whatsapp_message: `{{SALUTATION}} I wrote you an email about liability ${EM} could we talk briefly?`,
    used_notes: ["N1", "N2", "N4", "N6", "N7", "N8"],
    ...extra,
  };
}

// The default fake API: research streams fact lines, writing and edits return JSON.
function defaultApi(overrides = {}) {
  return (body) => {
    if (body.stream) return { stream: researchStream({ query: "civil court duration India", results: Object.values(SRC), lines: overrides.lines || RESEARCH_LINES }) };
    const isEdit = JSON.stringify(body.messages).includes("Change request");
    return { json: jsonReply(isEdit ? overrides.edit || writeResult({ email_body: "{{SALUTATION}}\n\nShorter text." }) : overrides.write || writeResult()) };
  };
}

async function newPage(browser, { key = FAKE_KEY, settings } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
  const page = await context.newPage();
  page.errors = [];
  page.warnings = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "warning" && page.warnings.push(m.text()));
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

async function generateWith(browser, { settings, api = defaultApi(), client = {}, offer = ["personal_liability", "legal_protection"], lang } = {}) {
  const page = await newPage(browser, { settings });
  const bodies = await fakeApi(page, api);
  await fillClient(page, client);
  await pickOffer(page, offer);
  if (lang === "de") await page.click('#email-lang button[data-value="de"]');
  await page.click("#generate");
  await waitDone(page);
  return { page, bodies };
}

async function waitEdit(page) {
  await page.waitForFunction(() => document.querySelector("#busy-edit").hidden && !document.querySelector("[data-edit]").disabled);
}

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch();

  // ---------- Two-step flow ----------

  await test("Two calls: research with web search, then writing without web search", async () => {
    const { page, bodies } = await generateWith(browser, { settings: { signature: "Robin Example\nhttps://cal.example.com/robin" } });
    assert(bodies.length === 2, "expected 2 calls, got " + bodies.length);
    const research = JSON.parse(bodies[0].raw);
    const writing = JSON.parse(bodies[1].raw);
    fs.writeFileSync(path.join(OUT, "request-research.json"), JSON.stringify(research, null, 2));
    fs.writeFileSync(path.join(OUT, "request-writing.json"), JSON.stringify(writing, null, 2));
    assert(research.tools?.[0]?.type === "web_search_20260318" && research.tools[0].max_uses === 10, "research call has no web search with 10 searches");
    assert(JSON.stringify(research.tools[0].allowed_callers) === '["direct"]', "research search is not direct");
    assert(!writing.tools, "writing call has tools");
    assert(writing.output_config?.format?.type === "json_schema", "writing call is not strict JSON");
    const msg = writing.messages[0].content;
    assert(msg.includes("<notes>") && msg.includes('"has_source": true') && msg.includes('"has_source": false'), "notes not sent to the writer");
    assert(!msg.includes("example.org"), "source links were sent to the writer");
    assert(msg.includes("https://cal.example.com/robin"), "booking link not sent");
    assert(!msg.includes("Robin Example"), "signature text was sent");
    assert((await page.textContent("#email-preview")).includes("Dear Ms. Ramanathan,"), "greeting not filled");
  });

  await test("Facts to check is built from the research notes: sources from citation data, 'No source found' otherwise", async () => {
    const { page } = await generateWith(browser, { api: defaultApi({ write: writeResult({ used_notes: ["N1", "N2", "N3", "N4", "N6", "N7", "N8"] }) }) });
    const groups = await page.locator("#facts .fact-group").allTextContents();
    assert(groups.length === 2, "expected 2 product groups, got " + JSON.stringify(groups));
    const verified = await page.locator("#facts .fact.is-verified").count();
    const noSource = await page.locator("#facts .fact.is-unverified").count();
    assert(verified === 6 && noSource === 1, `verified ${verified}, no source ${noSource}`);
    const noSourceText = await page.textContent("#facts .fact.is-unverified");
    assert(noSourceText.includes("No source found") && !noSourceText.includes("[NO SOURCE]"), "no-source note shown wrongly: " + noSourceText);
    const links = await page.locator("#facts a").evaluateAll((as) => as.map((a) => a.href));
    assert(links.includes(SRC.rent.url) && links.includes(SRC.bgb.url), "source links missing: " + links);
    assert((await page.textContent("#facts")).includes("India"), "country label missing");
    await page.screenshot({ path: path.join(OUT, "facts-panel.png"), fullPage: true });
  });

  await test("Warning when the home country part has fewer than 2 facts", async () => {
    const { page } = await generateWith(browser, { api: defaultApi({ write: writeResult({ used_notes: ["N1", "N4", "N6", "N7"] }) }) });
    const warn = await page.textContent("#warnings");
    assert(warn.includes("fewer than 2 facts") && warn.includes("Personal liability") && !warn.includes("Legal protection ("), "home facts warning wrong: " + warn);
  });

  await test("Research with no usable lines shows a clear message", async () => {
    const page = await newPage(browser);
    await fakeApi(page, (body) => (body.stream ? { stream: researchStream({ lines: [{ tag: "", text: "I searched but here is a summary." }] }) } : { json: jsonReply(writeResult()) }));
    await fillClient(page);
    await pickOffer(page, ["personal_liability"]);
    await page.click("#generate");
    await waitDone(page);
    assert((await page.textContent("#progress li:last-child")).includes("research found nothing useful"), "no clear message");
  });

  await test("Research reader: tags with bullets or bold, sources only from citation data", async () => {
    const page = await newPage(browser);
    const notes = await page.evaluate(async () => {
      const { parseResearch } = await import("./js/research.js");
      const blocks = [
        { type: "text", text: "Some intro text without a tag.\n- **[P1|HOME]** " },
        { type: "text", text: "Landlords ask for 10 months of rent.", citations: [{ type: "web_search_result_location", url: "https://example.org/a", title: "Source A" }] },
        { type: "text", text: "\n[p1|germany]: The deposit is at most 3 months of rent. https://typed-by-model.example.com\n[P2|HOME] People often settle things privately. [NO SOURCE]\n" },
      ];
      return parseResearch(blocks, "India");
    });
    assert(notes.length === 3, "expected 3 notes, got " + JSON.stringify(notes));
    assert(notes[0].about === "home" && notes[0].country === "India" && notes[0].sources[0].url === "https://example.org/a", "first note wrong: " + JSON.stringify(notes[0]));
    assert(notes[1].about === "germany" && notes[1].sources.length === 0, "a link typed by the model became a source");
    assert(!notes[1].fact.includes("http"), "typed link left in the fact text: " + notes[1].fact);
    assert(notes[2].product === "P2" && !notes[2].fact.includes("NO SOURCE"), "no-source tag not removed");
  });

  // ---------- Problem 3: markup ----------

  await test("Clean-up step removes fake cite tags, index codes and broken tags (unit test)", async () => {
    const page = await newPage(browser);
    const out = await page.evaluate(async () => {
      const { cleanText } = await import("./js/checks.js");
      return [
        cleanText('In India, <cite index="3-1,3-2">courts can take 10 years</cite> to decide.', "test"),
        cleanText('Landlords ask for a deposit index="4-7" of 10 months.', "test"),
        cleanText('Ends with a broken tag <cite index="1-2', "test"),
        cleanText("A note [1] and [2, 3] and (N3) and [P1|HOME] and [NO SOURCE] here.", "test"),
        cleanText("<b>Bold</b> and &lt;cite index=\"1\"&gt;y&lt;/cite&gt;", "test"),
        cleanText("Keep this: less than 5 < 6 and 7 > 2.", "test"),
      ];
    });
    fs.writeFileSync(path.join(OUT, "cleanup-unit.json"), JSON.stringify(out, null, 2));
    assert(out[0] === "In India, courts can take 10 years to decide.", out[0]);
    assert(out[1] === "Landlords ask for a deposit of 10 months.", out[1]);
    assert(out[2] === "Ends with a broken tag", out[2]);
    assert(!/\[|\(N3\)/.test(out[3]), out[3]);
    assert(out[4] === "Bold and y", out[4]);
    assert(out[5] === "Keep this: less than 5 < 6 and 7 > 2.", "normal text changed: " + out[5]);
    assert(page.warnings.filter((w) => w.includes("removed markup")).length === 5, "console warnings: " + page.warnings.length);
  });

  await test("No markup reaches the email, subject lines, WhatsApp or the clipboard", async () => {
    const dirty = writeResult({
      subject_lines: ['Your <cite index="1-1">liability</cite> in Germany', "Legal costs [1]"],
      email_body: '{{SALUTATION}}\n\n<cite index="2-3">In Bengaluru, landlords ask for 10 months of rent.</cite> index="4-1"\n\n## Personal liability\n\nCourts take 7 years [2]. <span>Text</span>\n\nA broken end <cite index="5',
      whatsapp_message: '{{SALUTATION}} <cite index="1-2">Short note</cite> about liability [3].',
    });
    const { page } = await generateWith(browser, { api: defaultApi({ write: dirty }) });
    const shown = await page.evaluate(() => document.querySelector("#result").innerText);
    for (const bad of ["<cite", "</cite", "index=", "[1]", "[2]", "[3]", "<span"]) assert(!shown.includes(bad), `"${bad}" shown on screen`);
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return (await (await items[0].getType("text/html")).text()) + (await (await items[0].getType("text/plain")).text());
    });
    for (const bad of ["cite", "index=", "[2]", "<span"]) assert(!clip.includes(bad), `"${bad}" in copied email`);
    assert(page.warnings.some((w) => w.includes("removed markup from email")), "no console warning logged");
  });

  // ---------- Problem 4: closing ----------

  await test("Closing: one 'Kind regards,' in English, even if the model wrote other closings", async () => {
    const write = writeResult({ email_body: writeResult().email_body + "\n\nMit freundlichen Grüßen,\nThanks," });
    const { page } = await generateWith(browser, { api: defaultApi({ write }), settings: { signature: "Robin Example\nAllianz agent" } });
    const text = await page.evaluate(() => document.querySelector("#email-preview").innerText);
    assert((text.match(/Kind regards,/g) || []).length === 1, "Kind regards count wrong");
    assert(!/Mit freundlichen|Thanks,/.test(text), "wrong closing left in English email");
    assert(/Kind regards,\s*\n+\s*Robin Example/.test(text), "closing not right before the signature: " + text.slice(-80));
  });

  await test("Closing: 'Mit freundlichen Grüßen' in German", async () => {
    const write = writeResult({ email_body: "{{SALUTATION}}\n\nIch freue mich auf Ihre Antwort." });
    const { page } = await generateWith(browser, { api: defaultApi({ write }), lang: "de", client: { first: "Ana", last: "Souza", country: "Brazil", age: "45", region: "" }, offer: ["household_contents"] });
    const text = await page.evaluate(() => document.querySelector("#email-preview").innerText);
    assert(text.startsWith("Sehr geehrte Frau Souza,"), "German greeting wrong");
    assert((text.match(/Mit freundlichen Grüßen/g) || []).length === 1 && !text.includes("Kind regards"), "German closing wrong: " + text.slice(-60));
  });

  await test("Closing: none added when the signature starts with one; empty signature adds no signature", async () => {
    const write = writeResult({ email_body: writeResult().email_body + "\n\nKind regards," });
    let r = await generateWith(browser, { api: defaultApi({ write }), settings: { signature: "Thanks,\nRobin Example" } });
    let text = await r.page.evaluate(() => document.querySelector("#email-preview").innerText);
    assert(!text.includes("Kind regards") && (text.match(/Thanks,/g) || []).length === 1, "double closing: " + text.slice(-60));
    r = await generateWith(browser, { api: defaultApi({ write }), settings: { signature: "" } });
    text = await r.page.evaluate(() => document.querySelector("#email-preview").innerText.trim());
    assert(text.endsWith("Kind regards,"), "email with empty signature should end with the closing: " + text.slice(-40));
  });

  // ---------- Problems 1 and 5: content checks ----------

  await test("Warning when the email talks about its own rules ('I will not guess')", async () => {
    const write = writeResult({ email_body: writeResult().email_body.replace("Imagine", "In India, I will not guess at the details. You know better than I do. Imagine") });
    const { page } = await generateWith(browser, { api: defaultApi({ write }) });
    const warn = await page.textContent("#warnings");
    assert(warn.includes("talks about its own research or rules") && warn.includes("will not guess"), "rule-talk warning missing: " + warn);
  });

  await test("Promise check: warns on 'no questions asked' unless it is in My products", async () => {
    const write = writeResult({ email_body: "{{SALUTATION}}\n\n## Glass\n\nIt covers any kind of damage, no questions asked." });
    let r = await generateWith(browser, { api: defaultApi({ write }), offer: ["glass"], settings: { productFacts: { glass: { covers: "Glass breakage of windows and doors" } } } });
    let warn = await r.page.textContent("#warnings");
    assert(warn.includes("may promise more") && warn.includes("no questions asked") && warn.includes("any kind of"), "promise warning missing: " + warn);
    r = await generateWith(browser, { api: defaultApi({ write }), offer: ["glass"], settings: { productFacts: { glass: { covers: "Any kind of damage to glass, no questions asked" } } } });
    warn = await r.page.textContent("#warnings");
    assert(!warn.includes("may promise more"), "warned although Robin wrote it: " + warn);
  });

  await test("Writer gets agent facts for one product and 'none' for the other", async () => {
    const { bodies } = await generateWith(browser, { settings: { productFacts: { personal_liability: { price: "4,95 EUR per month", covers: "Cover up to 50 million euros" } } } });
    const research = JSON.parse(bodies[0].raw).messages[0].content;
    const msg = JSON.parse(bodies[1].raw).messages[0].content;
    assert(msg.includes('"price": "4,95 EUR per month"') && msg.includes('"agent_facts": "none"'), "agent facts not sent correctly");
    assert(research.includes('"has_agent_facts": true') && research.includes('"has_agent_facts": false'), "research does not know which product has facts");
    assert(!research.includes("4,95"), "prices were sent to the research step");
  });

  await test("Numbers without a source are marked; numbers from notes and My products are not", async () => {
    const write = writeResult({ email_body: writeResult().email_body + "\n\nMost claims cost around 1,500 euros. It costs 4,95 EUR per month." });
    const { page } = await generateWith(browser, { api: defaultApi({ write }), settings: { productFacts: { personal_liability: { price: "4,95 EUR per month" } } } });
    const marks = await page.locator("#email-preview mark").allTextContents();
    assert(marks.includes("1,500"), "1,500 not marked: " + JSON.stringify(marks));
    assert(!marks.includes("7") && !marks.includes("4,95"), "sourced numbers marked: " + JSON.stringify(marks));
  });

  // ---------- Privacy ----------

  await test("Privacy: names never appear in any request body (research, writing, edit)", async () => {
    const { page, bodies } = await generateWith(browser, { settings: { instructions: "Mention that Priya likes cricket. Ramanathan family." } });
    await page.click('[data-edit="shorter"]');
    await waitEdit(page);
    assert(bodies.length === 3, `expected 3 requests, got ${bodies.length}`);
    for (const b of bodies) {
      assert(!/priya/i.test(b.raw), "first name found in a request body");
      assert(!/ramanathan/i.test(b.raw), "last name found in a request body");
    }
    assert(bodies[1].raw.includes("{{FIRST_NAME}} likes cricket"), "name typed in instructions was not replaced");
  });

  await test("Edit buttons: no new research, notes sent, strict JSON, no web search", async () => {
    const { page, bodies } = await generateWith(browser);
    for (const kind of ["shorter", "longer", "warmer", "formal"]) {
      await page.click(`[data-edit="${kind}"]`);
      await waitEdit(page);
    }
    assert(bodies.length === 6, "expected 2 + 4 calls, got " + bodies.length);
    for (const b of bodies.slice(2).map((x) => JSON.parse(x.raw))) {
      assert(!b.tools && !b.stream, "edit call searched the web");
      assert(b.output_config?.format?.type === "json_schema", "edit call without strict JSON");
      assert(b.messages[0].content.includes("<notes>") && b.messages[0].content.includes("<current_email>"), "notes or email not sent");
    }
    assert((await page.textContent("#email-preview")).includes("Shorter text."), "edited email not shown");
  });

  // ---------- Earlier features ----------

  await test("No em dash or en dash in any output", async () => {
    const { page } = await generateWith(browser);
    const all = await page.evaluate(() => document.querySelector("#result").innerText);
    assert(!all.includes("\u2014") && !all.includes("\u2013"), "dash found in result area");
    assert(all.includes("settling in well, two years"), "dash not replaced by a comma");
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

  await test("Per-email fact edits are not saved", async () => {
    const page = await newPage(browser, { settings: { productFacts: { personal_liability: { price: "5,50 EUR" } } } });
    await pickOffer(page, ["personal_liability"]);
    await page.fill('#email-facts [data-product="personal_liability"] [data-field="price"]', "9,99 EUR");
    await page.reload();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("oew.settings")).productFacts.personal_liability.price);
    assert(saved === "5,50 EUR", "per-email edit leaked into saved settings: " + saved);
  });

  // ---------- New feature: remove products ----------

  await test("Remove a product: gone from 'Products to offer' after reload, still in 'already has'", async () => {
    const page = await newPage(browser, { settings: { productFacts: { glass: { covers: "Glass breakage" } }, ownProducts: [{ id: "own_cyber", en: "Cyber protection", de: "Internetschutz" }] } });
    await page.click('.tab[data-view="settings"]');
    await page.click('[data-remove-for="glass"]');
    await page.click('[data-remove-for="own_cyber"]');
    await page.reload();
    assert((await page.locator('#picker-offer input[value="glass"]').count()) === 0, "glass still in Products to offer");
    assert((await page.locator('#picker-offer input[value="own_cyber"]').count()) === 0, "own product still in Products to offer");
    assert((await page.locator('#picker-has input[value="glass"]').count()) === 1, "glass missing from already has");
    await page.click('.tab[data-view="settings"]');
    assert((await page.textContent('#my-products details[data-product="glass"] > summary')).includes("Removed"), "no Removed badge");
    await page.screenshot({ path: path.join(OUT, "settings-removed.png") });
    await page.click("#restore-defaults");
    await page.reload();
    assert((await page.locator('#picker-offer input[value="glass"]').count()) === 1, "glass not back after restore");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("oew.settings")));
    assert(saved.productFacts.glass.covers === "Glass breakage", "restore deleted product facts");
    assert(saved.ownProducts.length === 1 && saved.removedProducts.includes("own_cyber"), "restore changed own products: " + JSON.stringify(saved));
    assert((await page.locator('#picker-offer input[value="own_cyber"]').count()) === 0, "restore brought back the removed own product");
  });

  await test("Backup: removed products are exported and imported; no API key in the file", async () => {
    const page = await newPage(browser, { settings: { signature: "SIG-123", instructions: "INSTR-456", productFacts: { car: { price: "40 EUR" } }, removedProducts: ["glass", "motorcycle"] } });
    await page.click('.tab[data-view="settings"]');
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
    const file = path.join(OUT, "backup-export.json");
    await download.saveAs(file);
    const content = fs.readFileSync(file, "utf8");
    const data = JSON.parse(content);
    assert(!content.includes(FAKE_KEY) && !/apikey/i.test(content), "backup file contains the API key");
    assert(JSON.stringify(data.settings.removedProducts) === '["glass","motorcycle"]', "removed products not in backup");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    assert((await page.locator('#picker-offer input[value="glass"]').count()) === 1, "storage not cleared");
    await page.click('.tab[data-view="settings"]');
    await page.setInputFiles("#import", file);
    await page.waitForSelector("#backup-message:not([hidden])");
    assert((await page.textContent("#backup-message")).includes("No API key is saved"), "no API key reminder");
    assert((await page.inputValue("#signature")) === "SIG-123", "signature not imported");
    await page.click('.tab[data-view="write"]');
    assert((await page.locator('#picker-offer input[value="glass"]').count()) === 0, "removed product came back after import");
    assert((await page.locator('#picker-has input[value="glass"]').count()) === 1, "removed product missing from already has after import");
  });

  await test("Settings stay after reload (API key, instructions, signature, product facts, own product)", async () => {
    const page = await newPage(browser, { key: "" });
    await page.click('.tab[data-view="settings"]');
    await page.fill("#api-key", FAKE_KEY);
    await page.click("#key-save");
    await page.fill("#signature", "Robin Example\nAllianz agent\nhttps://cal.example.com/robin");
    await page.fill("#instructions", "Keep it short. Mention my weekend appointments.");
    await page.locator('#my-products details[data-product="legal_protection"] > summary .product-name').click();
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
  });

  await test("Screen language switch to German changes labels, not the email language", async () => {
    const page = await newPage(browser);
    await page.click('.tab[data-view="settings"]');
    await page.click('#ui-lang button[data-value="de"]');
    assert((await page.textContent('.tab[data-view="write"]')) === "E-Mail schreiben", "nav not German");
    assert((await page.textContent("#restore-defaults")) === "Standardprodukte wiederherstellen", "restore button not German");
    assert((await page.textContent('[data-remove-for="glass"]')) === "Entfernen", "remove button not German");
    await page.screenshot({ path: path.join(OUT, "settings-german.png") });
    await page.click('.tab[data-view="write"]');
    assert((await page.getAttribute('#email-lang button[data-value="en"]', "aria-checked")) === "true", "email language changed");
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
      if (name.startsWith("Web search")) return;
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
  });

  await test("Writing reply not readable: clear error message", async () => {
    const { page } = await generateWith(browser, { api: (body) => (body.stream ? { stream: researchStream({ results: Object.values(SRC), lines: RESEARCH_LINES }) } : { json: jsonReply("not json") }) });
    assert((await page.textContent("#progress li:last-child")).includes("could not be read"), "no clear error");
  });

  await test("Copy email: HTML and plain text, greeting to signature, facts panel not copied", async () => {
    const { page } = await generateWith(browser, { settings: { signature: "Robin Example\nhttps://cal.example.com/robin" } });
    await page.click("#copy-email");
    await page.waitForSelector('[data-copied-for="copy-email"]:not([hidden])');
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return { types: items[0].types, html: await (await items[0].getType("text/html")).text(), text: await (await items[0].getType("text/plain")).text() };
    });
    fs.writeFileSync(path.join(OUT, "clipboard-email.html"), clip.html);
    fs.writeFileSync(path.join(OUT, "clipboard-email.txt"), clip.text);
    assert(clip.types.includes("text/html") && clip.types.includes("text/plain"), "types: " + clip.types);
    assert(clip.html.includes("<h3>") && clip.html.includes("<ul>") && clip.html.includes("<ol>") && clip.html.includes("<strong>"), "HTML format missing");
    assert(!/style=|<font|<mark/i.test(clip.html), "HTML has styles, fonts or marks");
    assert(clip.text.startsWith("Dear Ms. Ramanathan,") && clip.text.trim().endsWith("https://cal.example.com/robin"), "plain text not greeting to signature");
    assert(clip.text.includes("Kind regards,\n\nRobin Example"), "closing missing before signature");
    assert(!clip.html.includes("How long civil cases take"), "facts panel was copied");
    await page.click("#copy-whatsapp");
    const wa = await page.evaluate(() => navigator.clipboard.readText());
    assert(wa.startsWith("Dear Ms. Ramanathan,") && !wa.includes("**"), "WhatsApp copy wrong: " + wa);
  });

  await test("Copy fallback (no ClipboardItem) still puts HTML on the clipboard", async () => {
    const { page } = await generateWith(browser);
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
  });

  await test("No script errors on the page", async () => {
    const { page } = await generateWith(browser);
    await page.click('.tab[data-view="settings"]');
    await page.click('.tab[data-view="write"]');
    assert(page.errors.length === 0, page.errors.join("; "));
    await page.screenshot({ path: path.join(OUT, "result-new-flow.png"), fullPage: true });
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  fs.writeFileSync(path.join(OUT, "test-results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
