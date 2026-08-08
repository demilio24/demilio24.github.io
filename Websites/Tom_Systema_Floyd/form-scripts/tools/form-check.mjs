/* ============================================================
   Systema Floyd — form/estimator discrepancy checker
   ============================================================
   Renders each live GHL form, extracts a normalized {field -> options}
   structure, diffs it against the committed baseline, classifies the
   impact on our estimator scripts, writes a dated report, refreshes the
   baseline, and (in CI) signals breaking changes so the workflow can
   open a ClickUp task.

   Runs anywhere Puppeteer + network are available:
     - Locally:  cd Tom_Systema_Floyd/.claude_unused ... (see below)
                 Run from a dir whose node_modules has puppeteer, e.g.
                 `cd .claude && node ../Tom_Systema_Floyd/form-scripts/tools/form-check.mjs`
     - In CI:    the workflow installs puppeteer then runs this directly.

   Exit code 0 always (the workflow reads BREAKING from the report/marker,
   not the exit code, so a real breaking change doesn't look like a crash).
   Writes a marker file tools/.last-result.json with {breaking, summary}.
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../.."); // .../form-scripts/tools -> repo root
const BASELINE_DIR = path.join(__dirname, "baseline");
const REPORT_DIR = path.join(REPO_ROOT, "Tom_Systema_Floyd/forms/_discrepancy-reports");
const MARKER = path.join(__dirname, ".last-result.json");

// Resolve puppeteer from whatever node_modules is available (repo root in CI,
// or .claude/ locally). createRequire lets us search multiple locations.
function loadPuppeteer() {
  const candidates = [
    REPO_ROOT,
    path.join(REPO_ROOT, ".claude"),
    process.cwd(),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(path.join(base, "noop.js"));
      return req("puppeteer");
    } catch (_) {}
  }
  throw new Error("puppeteer not found in repo root, .claude/, or cwd node_modules");
}

const BASE = "https://link.nilsdigital.com/widget/form/";
const FORMS = [
  { name: "summer-camp", id: "oEDRZoVTuCWHt5cnMLpH" },
  { name: "rent-a-sensei", id: "myEoOLL1SKGv0IvSF4ur" },
  { name: "private-lessons", id: "Cpk2gmz9dcumDiz2KFun", query: "?location=Florida" },
  { name: "vlad-seminar", id: "Zu7nHwEILIJnkKyvtnbB" },
  { name: "birthday-balloons", id: "SvXq0KmUb1Ct2AR2t8Yl" },
  { name: "free-camp", id: "3Z4E9y7WlWgkZDxViBUW" },
  { name: "after-school", id: "TkioOL4IoByeHU3K2gTs" },
];

// Field labels our scripts key on. If any of these disappears (or no field
// label contains the phrase anymore) on a form, the matching script BREAKS.
const KEYED = {
  "summer-camp": [
    "Select Camp Duration",
    "Select Camp Dates",
    "Which day(s) will you attend the week of",
    "Select lunch option",
    "Extra care options",
    "Student T-Shirt",
    "Select Breakfast Option",
  ],
  "rent-a-sensei": ["Duration"],
};

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

async function extractForm(page, url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  try {
    await page.waitForSelector("label, input, select, .multiselect", { timeout: 15000 });
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 1500));
  return await page.evaluate(() => {
    function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
    const wrappers = Array.from(
      document.querySelectorAll(".form-builder--item, .form-field-wrapper"),
    ).filter((w, _i, arr) => !arr.some((o) => o !== w && o.contains(w) && o.querySelector("label")));
    const seen = new Set();
    const fields = [];
    document.querySelectorAll("label.field-label, .form-builder--item label").forEach((lbl) => {
      const w = lbl.closest(".form-field-wrapper") || lbl.closest(".form-builder--item");
      if (!w || seen.has(w)) return;
      seen.add(w);
      const label = norm(lbl.textContent);
      if (!label) return;
      const opts = new Set();
      w.querySelectorAll("li.multiselect__element, .multiselect__option").forEach((li) => {
        const t = norm(li.textContent);
        if (t) opts.add(t);
      });
      w.querySelectorAll("select option").forEach((o) => {
        const t = norm(o.textContent);
        if (t && o.value) opts.add(t);
      });
      w.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((inp) => {
        const l = inp.closest("label") || (inp.id ? document.querySelector('label[for="' + CSS.escape(inp.id) + '"]') : null);
        const t = norm(l ? l.textContent : inp.value);
        if (t) opts.add(t);
      });
      fields.push({ label, options: Array.from(opts) });
    });
    return { fields };
  });
}

function diffForm(name, baseline, current) {
  const out = { added: [], removed: [], optionChanges: [], breaking: [] };
  const bByLabel = new Map((baseline?.fields || []).map((f) => [f.label, f]));
  const cByLabel = new Map(current.fields.map((f) => [f.label, f]));

  for (const f of current.fields) if (!bByLabel.has(f.label)) out.added.push(f.label);
  for (const f of baseline?.fields || []) if (!cByLabel.has(f.label)) out.removed.push(f.label);

  // option-level changes for fields present in both
  for (const f of current.fields) {
    const b = bByLabel.get(f.label);
    if (!b) continue;
    const bo = new Set(b.options), co = new Set(f.options);
    const addedO = f.options.filter((o) => !bo.has(o));
    const removedO = b.options.filter((o) => !co.has(o));
    if (addedO.length || removedO.length)
      out.optionChanges.push({ field: f.label, added: addedO, removed: removedO });
  }

  // breaking: a keyed phrase no longer matches ANY current field label
  const keyed = KEYED[name] || [];
  const currentLabels = current.fields.map((f) => f.label.toLowerCase());
  for (const phrase of keyed) {
    const present = currentLabels.some((l) => l.includes(phrase.toLowerCase()));
    if (!present) out.breaking.push(phrase);
  }
  return out;
}

function hasAnyChange(d) {
  return d.added.length || d.removed.length || d.optionChanges.length || d.breaking.length;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  let puppeteer;
  try {
    puppeteer = loadPuppeteer();
  } catch (e) {
    const md = `# Form / Estimator Discrepancy Report - ${today}\n\n## Status: COULD NOT RUN\n\nPuppeteer is unavailable: ${e.message}\n`;
    fs.writeFileSync(path.join(REPORT_DIR, today + ".md"), md);
    fs.writeFileSync(MARKER, JSON.stringify({ breaking: false, error: e.message, summary: "puppeteer unavailable" }));
    console.log("puppeteer unavailable:", e.message);
    return;
  }

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const lines = [`# Form / Estimator Discrepancy Report - ${today}`, ""];
  let anyBreaking = false;
  let anyChange = false;
  const firstRunForms = [];

  for (const f of FORMS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1600 });
    let current;
    try {
      current = await extractForm(page, BASE + f.id + (f.query || ""));
    } catch (e) {
      lines.push(`## ${f.name} (${f.id})`, `- FETCH ERROR: ${norm(e.message)}`, "");
      await page.close();
      continue;
    }
    await page.close();

    const baseFile = path.join(BASELINE_DIR, f.id + ".json");
    const baseline = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, "utf8")) : null;

    if (!baseline) {
      firstRunForms.push(f.name);
      lines.push(`## ${f.name} (${f.id})`, `- BASELINE CREATED (${current.fields.length} fields). No prior data to diff.`, "");
      fs.writeFileSync(baseFile, JSON.stringify({ name: f.name, id: f.id, fields: current.fields }, null, 2));
      continue;
    }

    const d = diffForm(f.name, baseline, current);
    lines.push(`## ${f.name} (${f.id})`);
    if (!hasAnyChange(d)) {
      lines.push("- NO CHANGE.", "");
    } else {
      anyChange = true;
      if (d.breaking.length) {
        anyBreaking = true;
        lines.push(`- **BREAKING**: keyed field label(s) no longer present: ${d.breaking.map((x) => `"${x}"`).join(", ")}. The matching script (${f.name === "rent-a-sensei" ? "estimators/rent-a-sensei.js" : "summer-camp-validator.js"}) needs a human code edit.`);
      }
      if (d.added.length) lines.push(`- Added field(s): ${d.added.map((x) => `"${x}"`).join(", ")} (auto-handled if priced, but confirm).`);
      if (d.removed.length) lines.push(`- Removed field(s): ${d.removed.map((x) => `"${x}"`).join(", ")}.`);
      for (const oc of d.optionChanges) {
        if (oc.added.length) lines.push(`- "${oc.field}" added options: ${oc.added.map((x) => `"${x}"`).join(", ")} (price changes auto-handled by the engine).`);
        if (oc.removed.length) lines.push(`- "${oc.field}" removed options: ${oc.removed.map((x) => `"${x}"`).join(", ")}.`);
      }
      lines.push("");
      // refresh baseline to the new state so we don't re-alert next week
      fs.writeFileSync(baseFile, JSON.stringify({ name: f.name, id: f.id, fields: current.fields }, null, 2));
    }
  }

  await browser.close();

  if (firstRunForms.length) lines.push(`_Baselines created this run for: ${firstRunForms.join(", ")}._`, "");
  const summary = anyBreaking
    ? "BREAKING form changes detected — see report."
    : anyChange
      ? "Non-breaking form changes detected (auto-handled); baselines refreshed."
      : firstRunForms.length
        ? "Baselines initialized; no diff this run."
        : "No discrepancies.";
  lines.push(`**Summary:** ${summary}`);

  fs.writeFileSync(path.join(REPORT_DIR, today + ".md"), lines.join("\n") + "\n");
  fs.writeFileSync(MARKER, JSON.stringify({ breaking: anyBreaking, anyChange, summary, date: today }, null, 2));

  // CI: expose outputs
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `breaking=${anyBreaking}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary.replace(/\n/g, " ")}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `report=Tom_Systema_Floyd/forms/_discrepancy-reports/${today}.md\n`);
  }
  console.log(summary);
}

main().catch((e) => {
  console.error("form-check fatal:", e);
  try {
    fs.writeFileSync(MARKER, JSON.stringify({ breaking: false, error: String(e), summary: "fatal error" }));
  } catch (_) {}
  process.exit(0); // never fail the build on a crash; the report/marker carries status
});
