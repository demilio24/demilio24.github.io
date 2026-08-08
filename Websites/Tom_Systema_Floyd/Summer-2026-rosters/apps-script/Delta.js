// Delta data: new students to add and students to remove (cancelled per Tom's May 7 reply).
// Hand-curated from email/form/CSV cross-reference. See GAP_REPORT.md.
//
// Pricing-syntax conventions for the billing dashboard (see Tom_Systema_Floyd/Billing dashboard/docs/pricing-syntax.md):
//   - Per-day items use `$N/day`           e.g. Pizza ($7.75/day), Before care ($20/day), Aftercare ($25/day)
//   - Per-week items use `$N/week`         e.g. Pizza ($30/week), Aftercare Weekly ($175/week)
//   - No spaces around the slash, no "per day" wording. The regex is exact.
//
// `days`: array of 5 strings for Mon/Tue/Wed/Thu/Fri (use "Yes" for attending). Omit for unknown.

var NEW_STUDENTS = [
  // --- 9 missing students from May 8 form screenshots ---
  {
    studentName: "Hannah Bennett", age: "5", email: "savannahhuizenga@icloud.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "Small", additionalNotes: "Potty trained; Full Week",
    campus: "lower",
    weeks: [3],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Miles Younes", age: "5", email: "kimyounes11@gmail.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "", additionalNotes: "Potty trained; Full Week",
    campus: "lower",
    weeks: [3],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Sloane Kassatly", age: "7", email: "stacykassatly@gmail.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "Medium", additionalNotes: "No shirt needed; potty trained; Full Week",
    campus: "upper",
    weeks: [6],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Liam McPherson", age: "6", email: "allisonm.mcpherson@gmail.com",
    breakfast: "None", lunch: "Pizza ($7.75/day)", beforeAfterCare: "None",
    shirtSize: "Small (+$30)", additionalNotes: "3 days only; days TBD",
    campus: "upper",
    weeks: [8]
    // days unknown — form said "3 days" without specifying which
  },
  {
    studentName: "Luke McPherson", age: "5", email: "allisonm.mcpherson@gmail.com",
    breakfast: "None", lunch: "Pizza ($30/week)", beforeAfterCare: "None",
    shirtSize: "Small (+$30)", additionalNotes: "4 days only; days TBD",
    campus: "lower",
    weeks: [8]
    // days unknown — form said "4 days" without specifying which
  },
  {
    studentName: "Bennett Carter", age: "5", email: "shelleycarterrn@gmail.com",
    breakfast: "None", lunch: "Pizza ($30/week)", beforeAfterCare: "Before care ($20/day)",
    shirtSize: "Extra Small (+$30)", additionalNotes: "Full Week",
    campus: "lower",
    weeks: [1, 2],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Saylor Carter", age: "9", email: "shelleycarterrn@gmail.com",
    breakfast: "None", lunch: "Pizza ($30/week)", beforeAfterCare: "Before care ($20/day)",
    shirtSize: "Medium (+$30)", additionalNotes: "Full Week",
    campus: "upper",
    weeks: [1, 2],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Norah Skaar", age: "6", email: "cdenisew@icloud.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "Medium (+$30)", additionalNotes: "Full Week",
    campus: "upper",
    weeks: [2, 8],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Anna McIntosh", age: "6", email: "lpratka@pm.me",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "", additionalNotes: "Gluten/dairy/sugar/hand-sanitizer allergy; potty trained; sibling of Paul; 3 days only; days TBD",
    campus: "upper",
    weeks: [2]
    // 3 days, days TBD
  },
  // --- Section B: Aria Falzone Week 12 (per May 7 batch CSV) ---
  {
    studentName: "Aria Falzone", age: "4", email: "marilyn@thefalzones.net",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "Extra Small", additionalNotes: "Peanut, sesame seed, and green pea allergy; EpiPens required; Full Week",
    campus: "lower",
    weeks: [12],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  // --- Section C: May 11 reinstatements + new kids Tom flagged as missing from dashboard ---
  {
    studentName: "Hawthorn Fennell", age: "9", email: "fennelljason42@gmail.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "After care ($25/day)",
    shirtSize: "Medium", additionalNotes: "Reinstated 2026-05-11 per Tom email (was previously SKIP/cancelled, now active again); Full Week",
    campus: "upper",
    weeks: [2, 5, 6],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Jack Schwencke", age: "5", email: "kristenlee724@gmail.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "", additionalNotes: "May 11 form (Kristen Schwencke); 4 days only; days TBD",
    campus: "lower",
    weeks: [5]
  },
  {
    studentName: "Eliana Loupis", age: "7", email: "loupisfamily@gmail.com",
    breakfast: "None", lunch: "None", beforeAfterCare: "None",
    shirtSize: "", additionalNotes: "May 11 form (Annie Loupis). Parent asked for BOTH sisters (Eliana 7, Sofia 5) in LOWER together. Existing Upper Wk5 row should be deleted by the team.",
    campus: "lower",
    weeks: [5],
    days: ["Yes", "Yes", "Yes", "Yes", "Yes"]
  },
  {
    studentName: "Lilly Heyes", age: "5", email: "priscilla-ten@hotmail.com",
    breakfast: "With fruit ($10/day)", lunch: "Pizza ($30/week)", beforeAfterCare: "After care ($25/day)",
    shirtSize: "Small (+$30)", additionalNotes: "Reinstated 2026-05-11 per Tom email (was previously SKIP/cancelled, now active again); 2 days only per week",
    campus: "lower",
    weeks: [6, 7, 8, 9]
  }
];

// Students to remove from sheets.
// Updated 2026-05-11: removed Hawthorn Fennell and Lilly Heyes (Tom changed his mind,
// they're active again — see NEW_STUDENTS Section C above).
// Benjamin Mosst (Georgia student) and Lyla Falzone (cancelled) remain SKIP.
var SKIP_STUDENTS = [
  { studentName: "Benjamin Mosst", email: "jennifermosst@gmail.com" },
  { studentName: "Lyla Falzone", email: "marilyn@thefalzones.net" }
];
