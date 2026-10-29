// Offer Email Writer: connects the screen to the settings, the API calls and the checks.
import { PRODUCT_GROUPS, LENGTH_WORDS, CLOSINGS } from "./config.js";
import { t, setLanguage, getLanguage, applyTranslations } from "./i18n.js";
import { countryList, codeForName, englishCountryName } from "./countries.js";
import * as store from "./storage.js";
import { fillNames, scrubNames } from "./privacy.js";
import {
  removeDashes,
  unsupportedNumbers,
  looksInformalGerman,
  canonical,
  cleanText,
  findRuleTalk,
  findPromises,
  signatureStartsWithClosing,
  stripTrailingClosing,
} from "./checks.js";
import { markdownToHtml, markdownToPlain, signatureToHtml, plainText } from "./render.js";
import { copyRich, copyPlain } from "./clipboard.js";
import { research, write, edit, testConnection, AppError } from "./api.js";
import { buildCase, buildResearchCase } from "./prompt.js";

const DEFAULT_IDS = new Set(PRODUCT_GROUPS.flatMap((g) => g.products.map((p) => p.id)));

const $ = (id) => document.getElementById(id);

const state = {
  settings: store.loadSettings(),
  offer: new Set(),
  has: new Set(),
  custom: { offer: [], has: [] },
  emailFacts: {},
  filter: { offer: "", has: "" },
  emailLang: "en",
  length: "medium",
  busy: false,
  last: null,
};

// ---------- Products ----------

function ownGroup() {
  return {
    id: "own",
    en: "My own products",
    de: "Eigene Produkte",
    own: true,
    products: state.settings.ownProducts,
  };
}

function groups() {
  const list = [...PRODUCT_GROUPS];
  if (state.settings.ownProducts.length) list.push(ownGroup());
  return list;
}

function findProduct(id) {
  if (id.startsWith("custom:")) {
    const name = id.slice(7);
    return { id, en: name, de: name, custom: true };
  }
  for (const g of groups()) for (const p of g.products) if (p.id === id) return p;
  return null;
}

function productLabel(p) {
  if (p.en === p.de) return p.en;
  return getLanguage() === "de" ? `${p.de} (${p.en})` : `${p.en} (${p.de})`;
}

function groupLabel(g) {
  return getLanguage() === "de" ? g.de : g.en;
}

function selectedIds(kind) {
  return [...state[kind], ...state.custom[kind].map((n) => "custom:" + n)];
}

function setSelected(kind, id, on) {
  const other = kind === "offer" ? "has" : "offer";
  if (on) {
    state[kind].add(id);
    state[other].delete(id);
    if (kind === "offer") state.emailFacts[id] = { ...(state.settings.productFacts[id] || {}) };
    else delete state.emailFacts[id];
  } else {
    state[kind].delete(id);
    if (kind === "offer") delete state.emailFacts[id];
  }
}

function renderPicker(kind) {
  const box = $(`picker-${kind}`);
  const filter = state.filter[kind].toLocaleLowerCase();
  box.replaceChildren();

  const search = document.createElement("input");
  search.type = "search";
  search.className = "picker-filter";
  search.placeholder = t("ph_filter");
  search.value = state.filter[kind];
  search.setAttribute("aria-label", t("ph_filter"));
  search.addEventListener("input", () => {
    state.filter[kind] = search.value;
    renderPickerList(kind, list);
  });
  box.append(search);

  const list = document.createElement("div");
  list.className = "picker-list";
  box.append(list);
  renderPickerList(kind, list, filter);

  const chips = document.createElement("div");
  chips.className = "chips";
  for (const name of state.custom[kind]) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "chip-remove";
    x.textContent = "×";
    x.setAttribute("aria-label", `${t("btn_remove")}: ${name}`);
    x.addEventListener("click", () => {
      state.custom[kind] = state.custom[kind].filter((n) => n !== name);
      delete state.emailFacts["custom:" + name];
      renderPicker(kind);
      if (kind === "offer") renderEmailFacts();
    });
    chip.append(x);
    chips.append(chip);
  }

  const customRow = document.createElement("div");
  customRow.className = "custom-row";
  const custom = document.createElement("input");
  custom.type = "text";
  custom.placeholder = t("ph_custom");
  custom.setAttribute("aria-label", t("ph_custom"));
  custom.id = `custom-${kind}`;
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button";
  add.textContent = t("btn_add");
  const addCustom = () => {
    const name = custom.value.trim();
    if (!name || state.custom[kind].includes(name)) return;
    state.custom[kind].push(name);
    if (kind === "offer") state.emailFacts["custom:" + name] = {};
    renderPicker(kind);
    if (kind === "offer") renderEmailFacts();
    $(`custom-${kind}`).focus();
  };
  add.addEventListener("click", addCustom);
  custom.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustom();
    }
  });
  customRow.append(custom, add);
  box.append(chips, customRow);
}

function isRemoved(id) {
  return state.settings.removedProducts.includes(id);
}

function renderPickerList(kind, list) {
  const filter = state.filter[kind].trim().toLocaleLowerCase();
  list.replaceChildren();
  for (const g of groups()) {
    // Removed products are hidden from "Products to offer" only. A client may still have them.
    const items = g.products.filter(
      (p) => !(kind === "offer" && isRemoved(p.id)) && (!filter || `${p.en} ${p.de}`.toLocaleLowerCase().includes(filter))
    );
    if (!items.length) continue;
    const head = document.createElement("div");
    head.className = "picker-group";
    head.textContent = groupLabel(g);
    list.append(head);
    for (const p of items) {
      const label = document.createElement("label");
      label.className = "picker-item";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = p.id;
      box.checked = state[kind].has(p.id);
      box.addEventListener("change", () => {
        setSelected(kind, p.id, box.checked);
        renderPickerList("offer", $("picker-offer").querySelector(".picker-list"));
        renderPickerList("has", $("picker-has").querySelector(".picker-list"));
        renderEmailFacts();
      });
      const text = document.createElement("span");
      text.textContent = productLabel(p);
      label.append(box, text);
      if (state.settings.productFacts[p.id]) {
        const dot = document.createElement("span");
        dot.className = "badge";
        dot.textContent = t("has_facts");
        label.append(dot);
      }
      list.append(label);
    }
  }
}

const FACT_FIELDS = [
  ["allianzName", "pf_allianz_name", "input"],
  ["covers", "pf_covers", "textarea"],
  ["price", "pf_price", "input"],
  ["benefit", "pf_benefit", "textarea"],
  ["notes", "pf_notes", "textarea"],
];

function factFields(values, onChange, idPrefix) {
  const wrap = document.createElement("div");
  wrap.className = "fact-fields";
  for (const [field, labelKey, tag] of FACT_FIELDS) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = t(labelKey);
    const input = document.createElement(tag);
    if (tag === "textarea") input.rows = 2;
    else input.type = "text";
    input.value = values[field] || "";
    input.dataset.field = field;
    input.id = `${idPrefix}-${field}`;
    input.addEventListener("input", () => onChange(field, input.value));
    label.append(span, input);
    wrap.append(label);
  }
  return wrap;
}

function renderEmailFacts() {
  const box = $("email-facts");
  box.replaceChildren();
  const ids = selectedIds("offer");
  if (!ids.length) return;
  const head = document.createElement("h4");
  head.textContent = t("h_email_facts");
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = t("hint_email_facts");
  box.append(head, hint);
  for (const id of ids) {
    const p = findProduct(id);
    if (!p) continue;
    if (!state.emailFacts[id]) state.emailFacts[id] = { ...(state.settings.productFacts[id] || {}) };
    const details = document.createElement("details");
    details.className = "fact-card";
    details.dataset.product = id;
    const hasAny = Object.values(state.emailFacts[id]).some((v) => v && v.trim());
    details.open = hasAny;
    const summary = document.createElement("summary");
    summary.textContent = productLabel(p);
    details.append(summary);
    details.append(
      factFields(state.emailFacts[id], (field, value) => {
        state.emailFacts[id][field] = value;
      }, `ef-${id.replace(/[^a-z0-9]/gi, "_")}`)
    );
    box.append(details);
  }
}

// ---------- Form ----------

function segmented(id, onChange) {
  const box = $(id);
  for (const b of box.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      for (const x of box.querySelectorAll("button")) {
        x.classList.toggle("is-on", x === b);
        x.setAttribute("aria-checked", String(x === b));
      }
      onChange(b.dataset.value);
    });
  }
}

function setSegmented(id, value) {
  for (const x of $(id).querySelectorAll("button")) {
    x.classList.toggle("is-on", x.dataset.value === value);
    x.setAttribute("aria-checked", String(x.dataset.value === value));
  }
}

function renderCountries() {
  const list = $("country-list");
  list.replaceChildren();
  for (const c of countryList(getLanguage())) {
    const o = document.createElement("option");
    o.value = c.name;
    list.append(o);
  }
}

function numberOrEmpty(id) {
  const v = $(id).value.trim();
  if (v === "") return "";
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : "";
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|\bwww\.[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

function bookingLinks() {
  return [...new Set((state.settings.signature || "").match(URL_IN_TEXT) || [])];
}

function lengthWords(level, productCount) {
  const target = LENGTH_WORDS[level] || LENGTH_WORDS.medium;
  return target.base + target.extraPerProduct * Math.max(0, productCount - 1);
}

// Reads the form. Returns { names, input } or shows an error and returns null.
function readForm() {
  const firstName = $("first-name").value.trim();
  const lastName = $("last-name").value.trim();
  const age = numberOrEmpty("age");
  const countryText = $("country").value.trim();
  const errors = [];
  if (!firstName) errors.push(t("err_first_name"));
  if (!lastName) errors.push(t("err_last_name"));
  if (age === "") errors.push(t("err_age"));
  if (!countryText) errors.push(t("err_country"));
  const offerIds = selectedIds("offer");
  if (!offerIds.length) errors.push(t("err_products"));
  const errBox = $("form-error");
  if (errors.length) {
    errBox.textContent = errors.join(" ");
    errBox.hidden = false;
    return null;
  }
  errBox.hidden = true;

  const code = codeForName(countryText);
  const toProduct = (id) => {
    const p = findProduct(id);
    return p ? { en: p.en, de: p.de, facts: state.emailFacts[id] || {} } : null;
  };
  const offer = offerIds.map(toProduct).filter(Boolean);
  return {
    names: { firstName, lastName, gender: $("gender").value, lang: state.emailLang },
    input: {
      gender: $("gender").value,
      age,
      country: code ? englishCountryName(code) : countryText,
      region: $("region").value.trim(),
      years: numberOrEmpty("years"),
      job: $("job").value.trim(),
      family: $("family").value,
      children: numberOrEmpty("children"),
      offer,
      has: selectedIds("has").map(toProduct).filter(Boolean),
      goal: $("goal").value,
      emailLanguage: state.emailLang,
      lengthWords: lengthWords(state.length, offer.length),
      bookingLinks: bookingLinks(),
      instructions: state.settings.instructions.trim(),
    },
  };
}

// Swaps any name Robin may have typed into a free text field for a placeholder.
function scrubDeep(value, names) {
  if (typeof value === "string") return scrubNames(value, names.firstName, names.lastName);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, names));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, names)]));
  }
  return value;
}

// ---------- Progress ----------

function progressReset() {
  const list = $("progress");
  list.replaceChildren();
  list.hidden = false;
}

function progressStep(text, final = false) {
  const list = $("progress");
  for (const li of list.querySelectorAll("li.is-active")) {
    li.classList.remove("is-active");
    li.classList.add("is-done");
  }
  const li = document.createElement("li");
  li.textContent = text;
  li.className = final ? "is-done" : "is-active";
  list.append(li);
}

function setBusy(on) {
  state.busy = on;
  for (const b of document.querySelectorAll("#generate, #regenerate, [data-edit]")) b.disabled = on;
  $("generate").classList.toggle("is-busy", on);
}

function errorText(err) {
  const code = err instanceof AppError ? err.code : "unknown";
  const map = {
    key: "e_key",
    credit: "e_credit",
    blocked: "e_blocked",
    busy: "e_busy",
    websearch: "e_websearch",
    refused: "e_refused",
    json: "e_json",
    too_long: "e_too_long",
    research_empty: "e_research",
  };
  return t(map[code] || "e_unknown");
}

// ---------- Result ----------

const MIN_HOME_FACTS = 2;

function agentFactsText(input) {
  return input.offer.map((p) => Object.values(p.facts || {}).join(" ")).join("\n");
}

// Runs the code checks on a reply: markup out, dashes out, closing out, then content checks.
function checkResult(raw, notes, input) {
  let dashesFixed = false;
  const fix = (s, where) => {
    const r = removeDashes(cleanText(s, where));
    if (r.changed) dashesFixed = true;
    return r.text;
  };
  const result = {
    subject_lines: raw.subject_lines.map((s) => fix(s, "subject line")),
    email_body: stripTrailingClosing(fix(raw.email_body, "email")),
    whatsapp_message: fix(plainText(raw.whatsapp_message), "WhatsApp message"),
    used_notes: raw.used_notes,
  };

  const byId = new Map(notes.map((n) => [n.id, n]));
  const used = result.used_notes.map((id) => byId.get(id)).filter(Boolean);
  const factsPanel = used.length ? used : notes;

  const allowed = [
    agentFactsText(input),
    ...notes.filter((n) => n.sources.length).map((n) => n.fact),
    input.instructions,
    String(input.age),
    String(input.years),
    String(input.children),
  ];
  const checkedText = [result.email_body, result.whatsapp_message, ...result.subject_lines].join("\n");
  const homeShort = input.offer
    .map((p, i) => ({ p, key: `P${i + 1}` }))
    .filter(({ key }) => used.filter((n) => n.product === key && n.about === "home").length < MIN_HOME_FACTS)
    .map(({ p }) => productLabel(p));

  return {
    result,
    factsPanel,
    badNumbers: unsupportedNumbers(checkedText, allowed),
    informal: input.emailLanguage === "de" && looksInformalGerman(checkedText),
    ruleTalk: findRuleTalk(checkedText),
    promises: findPromises(checkedText, agentFactsText(input)),
    homeShort,
    dashesFixed,
  };
}

function filled(text) {
  return fillNames(text, state.last.names);
}

// Email body plus the closing line in the email's language. No closing if the signature starts with one.
function composedBody() {
  const body = filled(state.last.checked.result.email_body);
  const signature = state.settings.signature || "";
  if (signatureStartsWithClosing(signature)) return body;
  return `${body}\n\n${CLOSINGS[state.last.names.lang] || CLOSINGS.en}`;
}

function renderFacts(notes) {
  const facts = $("facts");
  facts.replaceChildren();
  if (!notes.length) {
    const li = document.createElement("li");
    li.className = "fact-empty";
    li.textContent = t("facts_none");
    facts.append(li);
    return;
  }
  const input = state.last.input;
  input.offer.forEach((p, i) => {
    const key = `P${i + 1}`;
    const mine = notes.filter((n) => n.product === key);
    if (!mine.length) return;
    const head = document.createElement("li");
    head.className = "fact-group";
    head.textContent = productLabel(p);
    facts.append(head);
    for (const n of mine) {
      const li = document.createElement("li");
      li.className = "fact " + (n.sources.length ? "is-verified" : "is-unverified");
      const about = document.createElement("p");
      about.className = "fact-about";
      about.textContent = n.about === "product" ? t("about_product") : n.country;
      const claim = document.createElement("p");
      claim.className = "fact-claim";
      claim.textContent = n.fact;
      li.append(about, claim);
      for (const s of n.sources) {
        const a = document.createElement("a");
        a.href = /^https?:\/\//i.test(s.url) ? s.url : "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = s.title || s.url;
        li.append(a);
      }
      if (!n.sources.length) {
        const status = document.createElement("p");
        status.className = "fact-status";
        status.textContent = t("fact_no_source");
        li.append(status);
      }
      facts.append(li);
    }
  });
}

function renderResult() {
  const last = state.last;
  if (!last) return;
  const { result, badNumbers, informal, ruleTalk, promises, homeShort, dashesFixed, factsPanel } = last.checked;
  $("result-empty").hidden = true;
  $("result").hidden = false;

  const subjects = $("subjects");
  subjects.replaceChildren();
  result.subject_lines.forEach((s, i) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "subject-text";
    text.textContent = filled(s);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button small";
    btn.textContent = t("btn_copy");
    btn.id = `copy-subject-${i}`;
    const note = document.createElement("span");
    note.className = "copied";
    note.hidden = true;
    note.textContent = t("copied");
    btn.addEventListener("click", async () => flash(note, await copyPlain(filled(s))));
    li.append(text, btn, note);
    subjects.append(li);
  });

  const bad = new Set(badNumbers.map(canonical));
  const marks = bad.size ? (n) => bad.has(canonical(n)) : null;
  $("email-preview").innerHTML = markdownToHtml(composedBody(), marks) + signatureToHtml(state.settings.signature);
  $("whatsapp").textContent = filled(result.whatsapp_message);

  const warnings = $("warnings");
  warnings.replaceChildren();
  const warn = (text) => {
    const p = document.createElement("p");
    p.className = "message warn";
    p.textContent = text;
    warnings.append(p);
  };
  if (homeShort.length) warn(t("warn_home_facts", { list: homeShort.join(", ") }));
  if (promises.length) warn(t("warn_promises", { list: promises.map((p) => `"${p}"`).join(", ") }));
  if (ruleTalk.length) warn(t("warn_rule_talk", { list: ruleTalk.map((p) => `"${p}"`).join(", ") }));
  if (badNumbers.length) warn(t("warn_numbers", { list: badNumbers.join(", ") }));
  if (informal) warn(t("warn_du"));
  if (dashesFixed) warn(t("warn_dashes"));

  renderFacts(factsPanel);
}

function flash(note, ok) {
  note.textContent = ok ? t("copied") : t("copy_failed");
  note.classList.toggle("is-error", !ok);
  note.hidden = false;
  clearTimeout(note._timer);
  note._timer = setTimeout(() => (note.hidden = true), ok ? 2000 : 6000);
}

function showResultError(err) {
  const box = $("result-error");
  if (!err) {
    box.hidden = true;
    return;
  }
  box.textContent = errorText(err);
  box.hidden = false;
}

// Token use of the last action, and the notes behind it. Read by the live tests. Holds no names.
function recordUsage(calls) {
  window.__oewLastUsage = { calls };
  const c = state.last?.checked;
  window.__oewLastResult = c
    ? { notes: state.last.notes, usedNotes: c.result.used_notes, homeShort: c.homeShort, ruleTalk: c.ruleTalk, promises: c.promises, badNumbers: c.badNumbers }
    : null;
}

async function onGenerate() {
  if (state.busy) return;
  const form = readForm();
  if (!form) return;
  const apiKey = store.loadApiKey();
  const researchCase = scrubDeep(buildResearchCase(form.input), form.names);
  const caseData = scrubDeep(buildCase(form.input), form.names);

  setBusy(true);
  progressReset();
  progressStep(t("progress_research"));
  showResultError(null);
  try {
    const found = await research({
      apiKey,
      researchCase,
      homeCountry: form.input.country,
      onProgress: (p) => {
        if (p.type === "search") progressStep(t("progress_search", { q: p.query }));
      },
    });
    progressStep(t("progress_writing"));
    const written = await write({ apiKey, caseData, notes: found.notes });
    progressStep(t("progress_checking"));
    state.last = {
      names: form.names,
      input: form.input,
      caseData,
      notes: found.notes,
      checked: checkResult(written.result, found.notes, form.input),
    };
    recordUsage([...found.usage, ...written.usage]);
    renderResult();
    progressStep(t("progress_done"), true);
  } catch (err) {
    progressStep(errorText(err), true);
    $("progress").lastElementChild.classList.add("is-error");
    if (state.last) showResultError(err);
  } finally {
    setBusy(false);
  }
}

async function onEdit(kind) {
  if (state.busy || !state.last) return;
  const last = state.last;
  const r = last.checked.result;
  const current = scrubDeep({ subject_lines: r.subject_lines, email_body: r.email_body, whatsapp_message: r.whatsapp_message }, last.names);
  setBusy(true);
  $("busy-edit").hidden = false;
  showResultError(null);
  try {
    const out = await edit({ apiKey: store.loadApiKey(), caseData: last.caseData, notes: last.notes, current, kind });
    last.checked = checkResult(out.result, last.notes, last.input);
    recordUsage(out.usage);
    renderResult();
  } catch (err) {
    showResultError(err);
  } finally {
    $("busy-edit").hidden = true;
    setBusy(false);
  }
}

async function onCopyEmail() {
  if (!state.last) return;
  const body = composedBody();
  const sig = (state.settings.signature || "").replace(/\r\n?/g, "\n").trim();
  const html = markdownToHtml(body) + signatureToHtml(sig);
  const text = markdownToPlain(body) + (sig ? "\n\n" + sig : "");
  flash(document.querySelector('[data-copied-for="copy-email"]'), await copyRich(html, text));
}

async function onCopyWhatsapp() {
  if (!state.last) return;
  const ok = await copyPlain(filled(state.last.checked.result.whatsapp_message));
  flash(document.querySelector('[data-copied-for="copy-whatsapp"]'), ok);
}

// ---------- Settings ----------

function saveSettings(noteFor) {
  store.saveSettings(state.settings);
  if (noteFor) {
    const note = document.querySelector(`[data-saved-for="${noteFor}"]`);
    if (note) {
      note.hidden = false;
      clearTimeout(note._timer);
      note._timer = setTimeout(() => (note.hidden = true), 1500);
    }
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function showMessage(id, text, kind = "ok") {
  const box = $(id);
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = false;
}

function updateKeyBanner() {
  $("key-banner").hidden = Boolean(store.loadApiKey());
}

// Fills a product's summary line in Settings: name, badges and the Remove or Bring back button.
function fillSummary(summary, p) {
  summary.replaceChildren();
  const name = document.createElement("span");
  name.className = "product-name";
  name.textContent = productLabel(p);
  summary.append(name);
  if (state.settings.productFacts[p.id]) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = t("has_facts");
    summary.append(badge);
  }
  const removed = isRemoved(p.id);
  if (removed) {
    const badge = document.createElement("span");
    badge.className = "badge is-removed";
    badge.textContent = t("removed_badge");
    summary.append(badge);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button small summary-button";
  btn.textContent = removed ? t("btn_bring_back") : t("btn_remove_product");
  btn.dataset.removeFor = p.id;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRemoved(p.id, !removed);
  });
  summary.append(btn);
}

function setRemoved(id, removed) {
  const list = state.settings.removedProducts.filter((x) => x !== id);
  if (removed) {
    list.push(id);
    setSelected("offer", id, false);
  }
  state.settings.removedProducts = list;
  saveSettings();
  renderAllProducts();
}

function restoreDefaults() {
  state.settings.removedProducts = state.settings.removedProducts.filter((id) => !DEFAULT_IDS.has(id));
  saveSettings();
  renderAllProducts();
  showMessage("restore-message", t("restored"));
}

function renderMyProducts() {
  const box = $("my-products");
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.product));
  box.replaceChildren();
  for (const g of groups()) {
    const head = document.createElement("h3");
    head.className = "group-head";
    head.textContent = groupLabel(g);
    box.append(head);
    for (const p of g.products) {
      const details = document.createElement("details");
      details.className = "fact-card" + (isRemoved(p.id) ? " is-removed" : "");
      details.dataset.product = p.id;
      details.open = open.has(p.id);
      const summary = document.createElement("summary");
      fillSummary(summary, p);
      details.append(summary);
      const values = state.settings.productFacts[p.id] || {};
      details.append(
        factFields(values, (field, value) => {
          const facts = { ...(state.settings.productFacts[p.id] || {}), [field]: value };
          if (!value.trim()) delete facts[field];
          if (Object.keys(facts).length) state.settings.productFacts[p.id] = facts;
          else delete state.settings.productFacts[p.id];
          saveProductsSoon();
        }, `mp-${p.id}`)
      );
      if (g.own) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "button danger small";
        del.textContent = t("btn_delete_product");
        del.addEventListener("click", () => {
          if (!confirm(t("confirm_delete_product"))) return;
          state.settings.ownProducts = state.settings.ownProducts.filter((x) => x.id !== p.id);
          state.settings.removedProducts = state.settings.removedProducts.filter((x) => x !== p.id);
          delete state.settings.productFacts[p.id];
          setSelected("offer", p.id, false);
          setSelected("has", p.id, false);
          saveSettings();
          renderAllProducts();
        });
        details.append(del);
      }
      box.append(details);
    }
  }
}

const saveProductsSoon = debounce(() => {
  saveSettings();
  // Refresh the "facts saved" badges without closing the open card.
  for (const kind of ["offer", "has"]) renderPickerList(kind, $(`picker-${kind}`).querySelector(".picker-list"));
  for (const summary of $("my-products").querySelectorAll("details > summary")) {
    const p = findProduct(summary.parentElement.dataset.product);
    if (p) fillSummary(summary, p);
  }
}, 400);

function renderAllProducts() {
  renderPicker("offer");
  renderPicker("has");
  renderEmailFacts();
  renderMyProducts();
}

function addOwnProduct() {
  const en = $("own-en").value.trim();
  const de = $("own-de").value.trim();
  if (!en && !de) return showMessage("own-message", t("own_empty"), "error");
  const exists = groups().some((g) =>
    g.products.some((p) => [p.en, p.de].map((s) => s.toLocaleLowerCase()).some((s) => s === en.toLocaleLowerCase() || s === de.toLocaleLowerCase()))
  );
  if (exists) return showMessage("own-message", t("own_exists"), "error");
  state.settings.ownProducts.push({ id: "own_" + Date.now().toString(36), en: en || de, de: de || en });
  saveSettings();
  $("own-en").value = "";
  $("own-de").value = "";
  renderAllProducts();
  showMessage("own-message", t("own_added"));
}

function exportSettings() {
  const blob = new Blob([store.exportBackup(state.settings)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `offer-email-writer-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importSettings(file) {
  const text = await file.text();
  const imported = store.parseBackup(text);
  if (!imported) return showMessage("backup-message", t("import_bad"), "error");
  state.settings = imported;
  saveSettings();
  setLanguage(state.settings.uiLanguage);
  loadSettingsIntoForm();
  refreshLanguage();
  const hasKey = Boolean(store.loadApiKey());
  showMessage("backup-message", hasKey ? t("import_ok") : t("import_ok_no_key"), hasKey ? "ok" : "warn");
}

function loadSettingsIntoForm() {
  $("signature").value = state.settings.signature;
  $("instructions").value = state.settings.instructions;
  $("api-key").value = store.loadApiKey();
  setSegmented("ui-lang", state.settings.uiLanguage);
}

function refreshLanguage() {
  applyTranslations();
  renderCountries();
  renderAllProducts();
  $("key-toggle").textContent = $("api-key").type === "password" ? t("btn_show") : t("btn_hide");
  if (state.last) renderResult();
}

function showView(view) {
  $("view-write").hidden = view !== "write";
  $("view-settings").hidden = view !== "settings";
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("is-active", tab.dataset.view === view);
  window.scrollTo(0, 0);
}

// ---------- Start ----------

function init() {
  setLanguage(state.settings.uiLanguage);
  loadSettingsIntoForm();
  refreshLanguage();
  updateKeyBanner();

  for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => showView(tab.dataset.view));
  for (const link of document.querySelectorAll("[data-goto]")) link.addEventListener("click", () => showView(link.dataset.goto));

  segmented("email-lang", (v) => (state.emailLang = v));
  segmented("length", (v) => (state.length = v));
  segmented("ui-lang", (v) => {
    state.settings.uiLanguage = v;
    saveSettings();
    setLanguage(v);
    refreshLanguage();
  });

  $("generate").addEventListener("click", onGenerate);
  $("regenerate").addEventListener("click", onGenerate);
  for (const b of document.querySelectorAll("[data-edit]")) b.addEventListener("click", () => onEdit(b.dataset.edit));
  $("copy-email").addEventListener("click", onCopyEmail);
  $("copy-whatsapp").addEventListener("click", onCopyWhatsapp);

  $("key-toggle").addEventListener("click", () => {
    const field = $("api-key");
    field.type = field.type === "password" ? "text" : "password";
    $("key-toggle").textContent = field.type === "password" ? t("btn_show") : t("btn_hide");
  });
  $("key-save").addEventListener("click", () => {
    const key = $("api-key").value.trim();
    if (!key) return showMessage("key-message", t("key_empty"), "error");
    store.saveApiKey(key);
    updateKeyBanner();
    showMessage("key-message", t("key_saved"));
  });
  $("key-delete").addEventListener("click", () => {
    if (!confirm(t("confirm_delete_key"))) return;
    store.deleteApiKey();
    $("api-key").value = "";
    updateKeyBanner();
    showMessage("key-message", t("key_deleted"));
  });
  $("key-test").addEventListener("click", async () => {
    const typed = $("api-key").value.trim();
    const key = typed || store.loadApiKey();
    if (!key) return showMessage("key-message", t("e_key"), "error");
    showMessage("key-message", t("key_testing"), "info");
    $("key-test").disabled = true;
    try {
      await testConnection(key);
      showMessage("key-message", t("key_ok"));
    } catch (err) {
      showMessage("key-message", errorText(err), "error");
    } finally {
      $("key-test").disabled = false;
    }
  });

  const saveSignature = debounce(() => {
    state.settings.signature = $("signature").value;
    saveSettings("signature");
    if (state.last) renderResult();
  }, 400);
  $("signature").addEventListener("input", saveSignature);
  const saveInstructions = debounce(() => {
    state.settings.instructions = $("instructions").value;
    saveSettings("instructions");
  }, 400);
  $("instructions").addEventListener("input", saveInstructions);

  $("own-add").addEventListener("click", addOwnProduct);
  $("restore-defaults").addEventListener("click", restoreDefaults);
  $("export").addEventListener("click", exportSettings);
  $("import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await importSettings(file);
    e.target.value = "";
  });
}

init();
