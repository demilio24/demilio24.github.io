# Technical Analysis & Development Plan

## Systema Floyd

**Prepared by:** Nils Digital
**Engagement:** The 14-Day Audit
**Document type:** Build-ready development plan
**Status:** Delivered, Day 14

---

## Cover note

Tom,

Over the last two weeks we sat inside Systema Floyd's operation, traced every form submission, every spreadsheet, every dollar of revenue, and every place work is currently falling through the cracks. This document is the result.

It is not a pitch deck and it is not a sales document. It is a build-ready architecture and execution plan. Every integration is specified, every automation is named, every decision is recorded. Any competent technical team can take this document, quote it, and execute it.

The plan is yours. Forever. Whether we build it together, you hire someone else, or you build it in-house, the answers do not change and the document does not expire.

Three things to know before you start reading:

1. **The recommendation is a single integrated system, not a stack of point tools.** You currently have eight surfaces (forms, sheets, GHL, paper, email, manual reminders, the dashboard you wish you had, and the billing reconciliation you do each month). The plan collapses that into one source of truth (Google Sheets), one operational view (the Camp Dashboard), and one financial view (the Billing Dashboard), with everything else feeding those two.

2. **Google Sheets stays as the source of truth on purpose.** We looked at moving you to a custom database. Sheets wins. Your team already lives there, you can correct data in two clicks without a developer, and every other system can read from it. Trading that flexibility for a "real database" is the wrong tradeoff at your scale.

3. **The failsafe pattern is the spine of the system.** Every primary writer (GHL workflows, Apps Script jobs, n8n flows) gets a secondary watcher whose only job is to catch missed writes and patch them silently. You will not lose registrations, you will not lose billing rows, you will not lose waiver matches, and you will be told within 24 hours if any of the bots themselves go quiet.

The rest of this document is the build.

— Nils Digital

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current-State Diagnosis](#2-current-state-diagnosis)
3. [Target-State Architecture](#3-target-state-architecture)
4. [Component Specifications](#4-component-specifications)
5. [Tool Stack & Rationale](#5-tool-stack--rationale)
6. [Data Model](#6-data-model)
7. [Build Sequence](#7-build-sequence)
8. [Decision Log](#8-decision-log)
9. [Risk Register](#9-risk-register)
10. [Out of Scope](#10-out-of-scope)
11. [Appendices](#11-appendices)

---

## 1. Executive Summary

### What we found

Systema Floyd operates across two campuses (Upper and Lower), three states (Florida, Georgia, and planned Virginia), and eight distinct programs (summer camp, free camp, after-school, private lessons, rent-a-sensei, birthday parties, spirit dance, and seminars). The school serves roughly 120 active students and 80 paying customer households at the time of the audit.

The operation runs. It is not broken. But it runs on six different surfaces that do not talk to each other:

- Registrations arrive across multiple GoHighLevel forms with no central roster view.
- Billing is reconciled by hand against a mix of GHL submissions, paper notes, and the head of one staff member.
- Waivers are signed in one system and matched to rosters by eye.
- After-school enrollments at partner schools are tracked in per-school spreadsheets that nobody owns.
- The dashboard staff actually need (who is enrolled, who is here today, who is missing lunch) does not exist.
- The financial dashboard ownership reconciles against does not exist either.

Manual work absorbing the gap is on the order of **15 to 25 hours per week** across the operations team, depending on registration season.

### What we recommend

A single integrated system with eight subsystems, all connected, with one source of truth (Google Sheets), two operator dashboards (operational and financial), and a failsafe layer underneath that catches missed work automatically.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│    PARENTS                STAFF                  TOM             │
│       │                     │                     │              │
│       ▼                     ▼                     ▼              │
│  ┌─────────┐         ┌─────────────┐     ┌────────────────┐      │
│  │  GHL    │         │  Operations │     │   Financial    │      │
│  │  Forms  │────────▶│  Dashboard  │     │   Dashboard    │      │
│  └────┬────┘         └──────┬──────┘     └────────┬───────┘      │
│       │                     ▲                     ▲              │
│       │ routing             │                     │              │
│       ▼ workflows           │                     │              │
│  ┌──────────────────────────┴─────────────────────┘              │
│  │  Google Sheets   (source of truth)                            │
│  │  • 4 roster sheets   • Billing Dashboard sheet                │
│  │  • Per-school sheets • Pricing catalog                        │
│  │  • Waiver app sheet                                           │
│  └──────────────────────────┬────────────────────────────────────┘
│                             │                                    │
│                  ┌──────────┴──────────┐                         │
│                  ▼                     ▼                         │
│          ┌──────────────┐      ┌──────────────┐                  │
│          │ Failsafe     │      │ Supabase     │                  │
│          │ Discrepancy  │      │ shared state │                  │
│          │ Check        │      │ (attendance, │                  │
│          │ (15-min cron)│      │  tombstones) │                  │
│          └──────────────┘      └──────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Build at a glance

| Phase | Scope | Effort |
|---|---|---|
| 1. Foundation | GHL location structure, source sheets, core registration forms, validator | 2 weeks |
| 2. Visibility | Snapshot pipeline + Camp Dashboard (roster, KPIs, lunches view) | 2 weeks |
| 3. Billing | Billing Dashboard + pricing catalog + sheet-driven reconcile | 3 weeks |
| 4. Hardening | Discrepancy Check failsafe + Waiver Matcher + heartbeat-guard | 2 weeks |
| 5. Expansion | School Enrollment Router + additional forms + funnel pages | 2 weeks |
| 6. Polish | Operator training, monitoring, handoff | 1 week |
| | **Total** | **12 weeks** |

### What changes for the team

| Today | After |
|---|---|
| Registration tracked across 6 surfaces | One roster per campus, one tab per week, auto-populated from forms |
| Billing reconciled monthly by hand | Reconciled every 5 minutes, balance always current |
| Waivers matched to rosters by eye | Auto-matched with name fuzzy logic + cell notes for allergies |
| "Who's here today?" unanswered until 9am | Visible in the dashboard before 7am |
| New form requires a developer | New form requires a 30-minute conversation with us |
| Lost registrations caught at week's end | Caught within 15 minutes and patched automatically |

---

## 2. Current-State Diagnosis

This section maps what we found inside Systema Floyd's operation as of Day 1 of the audit. Every claim here is grounded in interviews, observed workflows, or data we pulled from the existing systems.

### 2.1 The shape of the operation

| Dimension | Count | Notes |
|---|---|---|
| Campuses | 2 | Upper, Lower |
| States | 3 | Florida (active), Georgia (active), Virginia (planned) |
| Programs | 8 | Summer camp, free camp, after-school, private lessons, rent-a-sensei, birthday parties, spirit dance, seminars |
| Active students | ~120 | Across summer + free camp rosters |
| Paying customer households | ~80 | At time of audit |
| Instructors | ~7 | FL roster + 1 GA instructor (Sean Nasiff) |
| Partner schools (after-school) | 5+ | Westward Elementary, Northboro, U.B. Kinsey, Pleasant City, Roosevelt |
| Annual revenue (estimate) | $250k–$500k | Based on visible billing volume |

### 2.2 The six surfaces

Today, the operation lives across six surfaces that do not talk to each other.

1. **GHL forms.** Multiple registration and booking forms exist, each writing into its own holding area. Nothing aggregates them into a single operational view.
2. **Google Sheets.** The team uses spreadsheets, but they are personal, ad-hoc, and not the source of truth for anything. Knowledge of which sheet is current lives in staff memory.
3. **Paper and shared docs.** The legacy registration process used paper forms and shared Google Docs. Migration from this surface to a structured system is partial.
4. **Email threads.** Decisions, exceptions, and one-off arrangements are tracked in email. Nothing flows back into a system.
5. **GHL contact records.** Some customer data is in GHL, some is not. The GHL data is also not always current; manual edits to contact records get overwritten on the next form submission.
6. **Tom's head.** Pricing exceptions, sibling discounts, scholarship status, and which families "are good" all live here.

### 2.3 Where work is leaking

Each leak below was observed during the audit. Hours estimates are conservative.

| Leak | Where | Estimated time lost |
|---|---|---|
| Re-typing data from forms into rosters | Operations team | ~4 hrs/week |
| Reconciling GHL submissions vs actual revenue | Tom + bookkeeper | ~6 hrs/month |
| Manual roster build for the day's camp | Operations team | ~1 hr/day during camp |
| Manually cross-referencing waivers with rosters | Operations team | ~2 hrs/week during enrollment |
| Tracking after-school enrollments across 5 schools | Operations team | ~3 hrs/week |
| Answering "who's coming today" questions | All staff | ~30 min/day |
| Catching missed registrations after the fact | Operations team | Variable, sometimes a week late |
| Re-issuing waivers because the previous one is lost | Operations team | ~1 hr/week |

Aggregate: roughly **15 to 25 hours per week** during peak season. The dollar value of that time at $25/hr fully loaded is $19,500 to $32,500 per year. The real cost is higher because it crowds out the work the team should be doing instead, which is teaching, recruiting, and growing the school.

### 2.4 Specific data risks we observed

1. **Multi-week registrations risk being dropped.** Parents register for multiple camp weeks in one form. If the routing logic between GHL and the sheets misses one week, the kid shows up Monday and the staff has no record. There is no automated catch for this today.

2. **Sibling pricing is inconsistent.** Sibling discounts are applied manually. Across a busy week we found at least three instances of the same family being charged different amounts on different rows.

3. **Waivers and rosters drift.** A waiver signed in one system does not write back into the roster. Staff cross-references manually. During the audit we found at least one student on a roster with no waiver matched, and one waiver with no matching roster entry.

4. **Manual billing entries get overwritten.** The few cases where staff manually corrected a billing row in GHL got overwritten the next time the contact submitted a form. This is a structural problem, not a one-off; the current system has no way to express "this manual edit beats the form."

5. **Tab order matters in spreadsheets.** Roster rows are categorized by which tab they live in (one tab per week). Inserting a new tab anywhere in the sequence silently shifts every downstream tab's meaning. This has happened. Multiple billing rows got assigned to the wrong week as a result.

6. **OAuth tokens expire silently.** GHL tokens stop refreshing if the upstream automation fails. There is no alerting today; staff finds out when a workflow that depended on the token stops working.

### 2.5 What is working today (do not break)

The audit also surfaced operational strengths that the new system should preserve, not replace:

- **Tom's pricing flexibility.** Custom prices, scholarship rates, and family deals are part of the brand. The new system must support manual overrides without making them feel like exceptions.
- **The teaching staff's autonomy.** Instructors run their own programs. The system should not require them to learn new tools.
- **Cash and check still work.** Some families pay in person. The billing system must record these without forcing every payment through GHL.
- **GoHighLevel for marketing, calendars, and contacts.** The forms layer, calendar booking, and CRM functions of GHL are working and should stay.

---

## 3. Target-State Architecture

### 3.1 Components

The target architecture has eight subsystems. Each has a clear purpose, one set of inputs, one set of outputs, and a defined failure mode.

| # | Subsystem | Purpose | Primary writer | Failsafe |
|---|---|---|---|---|
| 1 | Registration System | Convert form submissions into roster rows | GHL routing workflow | Discrepancy Check (15-min cron) |
| 2 | Camp Day Validator | Block invalid camp registrations at the form level | Browser JS in GHL Custom Code | None needed (client-side gate) |
| 3 | Camp Dashboard | Operational view of who is enrolled, who is here, what lunch they need | Snapshot.js (5-min cron) | Daily history archive |
| 4 | Billing Dashboard | Financial view: every enrollment priced, every payment recorded, balance always current | BillingFromSheets.js (5-min trigger) | Manual Items dialog for any row that does not come from a form |
| 5 | School Enrollment Router | Route after-school enrollments from a central intake into per-school sheets | Apps Script bound to Main Table | Three-tier name matching (exact → case-insensitive → fuzzy) |
| 6 | Waiver Matcher | Cross-reference waivers with camp rosters, surface allergies and health notes inline | Apps Script bound to Waiver app sheet | Manual override via cell notes |
| 7 | Forms System | All client-facing intake (8 forms) feeding the systems above | GHL forms + Custom Code | Per-form notification template + sheet write workflow |
| 8 | Client-Facing Funnel | 12 HTML pages embedded in GHL, hosted on GitHub Pages | Static files | None needed (static hosting) |

### 3.2 Data flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ INTAKE                                                                │
│ GHL forms (8) → routing workflows → 4 roster sheets + per-school     │
│ sheets + waiver app sheet + Billing Dashboard sheet (via pipeline)   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ SOURCE OF TRUTH                                                       │
│ Google Sheets (operator-editable, version-controlled by Google)      │
│   • 4 roster sheets, one tab per week                                │
│   • Per-school enrollment sheets                                     │
│   • Billing Dashboard (canonical financial record)                   │
│   • Pricing catalog (team-editable, drives billing math)             │
│   • Manual Items (hidden tab for non-form billing rows)              │
└──────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌───────────┐   ┌───────────┐   ┌──────────────┐
       │ Snapshot  │   │ Billing   │   │ Waiver       │
       │ pipeline  │   │ pipeline  │   │ Matcher      │
       │ (5 min)   │   │ (5 min)   │   │ (on-change)  │
       └─────┬─────┘   └─────┬─────┘   └──────┬───────┘
             │               │                │
             ▼               ▼                ▼
       ┌─────────────────────────────────────────────┐
       │ OPERATOR VIEWS                              │
       │   • Camp Dashboard (snapshot.json + HTML)   │
       │   • Billing Dashboard (live Sheet)          │
       │   • Lunches prep view                       │
       │   • Per-school admin views                  │
       └─────────────────────────────────────────────┘
                              │
                              ▼
       ┌─────────────────────────────────────────────┐
       │ SHARED STATE (Supabase)                     │
       │   • Daily attendance picks (cross-device)   │
       │   • Tombstones (prevent reverting deletes)  │
       │   • Snapshot mirror (for external tools)    │
       └─────────────────────────────────────────────┘
                              │
                              ▼
       ┌─────────────────────────────────────────────┐
       │ MONITORING                                  │
       │   • Discrepancy Check (15-min cron)         │
       │   • Heartbeat guard (24h alert)             │
       │   • Daily snapshot history archive          │
       └─────────────────────────────────────────────┘
```

### 3.3 Failsafe pattern

The single most important architectural decision in this system is the failsafe pattern. Every primary writer has a secondary watcher.

| Primary writer | Failure mode | Secondary watcher | What it does on detection |
|---|---|---|---|
| GHL routing workflow → sheet | Workflow misfires, field maps wrong | Discrepancy Check (15-min cron) | Writes the missing row, emails Tom |
| BillingFromSheets pipeline → Billing Dashboard | Apps Script quota hit, trigger fails | Manual Items dialog as backup ingress | Operator can add the missing row by hand |
| Snapshot push → GitHub Pages | Token expired, push fails | Heartbeat guard | Emails Tom if snapshot is >24h stale |
| Waiver Matcher → roster cell notes | Apps Script disabled | Manual cell-note entry | Operator can annotate by hand without breaking the flow |
| Snapshot.json | Repo gets corrupted | Daily history archive | Roll back to any prior day's snapshot |

The failsafe pattern is what lets us promise the team that they will not lose work. Even if every bot dies, the source of truth (Sheets) is editable by hand, and the manual paths are first-class entry points, not exception handlers.

---

## 4. Component Specifications

### 4.1 Registration System

**Purpose.** Convert every form submission into a structured row in the right roster sheet, in the right tab, with the right columns. Catch any missed write within 15 minutes.

**Inputs.**
- Free Camp form submissions (GHL form)
- Summer Camp form submissions (GHL form)
- After-School form submissions (GHL form)

**Outputs.**
- One row per kid-per-week-per-program in the matching roster sheet
- Optional cell note with any free-text "additional info" the parent provided

**Components.**
- **GHL routing workflow** — one workflow per camp-week pair. Triggered by form submission. Reads the parent's selected weeks, fires one "Add Row to Sheet" action per selected week into the correct campus sheet.
- **Camp Day Validator** — client-side JS in the GHL form's Custom Code element. Validates that the parent has ticked the right number of day checkboxes for the duration they selected before allowing submission.
- **Discrepancy Check** — Apps Script bound to the Waiver app sheet (uses Sheet as a host, runs every 15 min). Reads every form submission from GHL, reads every row from every roster sheet, diffs them. If a submission has no matching row, writes the row and emails Tom with the workflow ID that should have caught it.
- **Tombstones** — Supabase table that records intentionally-deleted roster entries. The Discrepancy Check checks for a tombstone before re-adding a row, so deletes by staff stick.

**Key decisions.**
- **Source of truth is the sheet, not GHL.** If the team deletes a row in the sheet, the system honors the delete (via tombstone). If GHL claims the kid exists and the sheet does not, we trust the sheet.
- **Name-based week resolution.** Rows are categorized by tab name (`6/15-6/19`), not by tab position. Inserting or removing a tab anywhere in the sequence does not silently mis-categorize rows.
- **Fuzzy-name dedup.** A kid named "Aria" and a kid named "Aria Falzone" with the same parent email is treated as the same student, not as two enrollments. Jaro-Winkler similarity threshold of 0.85.

### 4.2 Camp Day Validator

**Purpose.** Prevent parents from submitting a registration form with the wrong number of days picked. Keeps the downstream billing math correct.

**Inputs.** The user's selections in the camp signup form.

**Outputs.** A blocked submission with an inline error message, or a passed submission.

**Implementation.** A self-contained JavaScript snippet pasted into the GHL form's Custom Code element. Re-attaches change handlers on every DOM mutation (GHL re-renders the form on conditional logic changes). Reads the "Camp Duration" dropdown, counts the checked day boxes per week, blocks submission until they match.

**Why client-side.** Server-side validation would require a custom backend in front of GHL. The form is already in GHL. The browser is already executing arbitrary code there. Client-side validation is the right place for this gate.

### 4.3 Camp Dashboard

**Purpose.** The operator's single view of who is enrolled, who is here, who needs what lunch, and what is leaking.

**Inputs.** The 4 roster sheets.

**Outputs.**
- `dashboard/snapshot.json` — read by the browser dashboard
- `dashboard/history/YYYY-MM-DD.json` — daily archive
- Supabase mirror tables (for external tools)

**Components.**
- **Snapshot.js** — Apps Script polling the 4 roster sheets every 5 minutes. Builds the JSON, pushes to GitHub Pages, mirrors to Supabase.
- **Browser dashboard (`dashboard/index.html`)** — static HTML/CSS/JS hosted on GitHub Pages, embedded into GHL. Reads `snapshot.json` and renders KPIs (enrollment count, capacity %, lunch orders, allergies), a 14-day growth sparkline, a click-to-expand student roster with filters, a Data Issues panel (one row per data problem with a deep-link to the offending cell), an attendance modal with per-person ticks, and a lunches prep view.
- **Daily history** — every Snapshot run also writes a dated snapshot to `dashboard/history/`. Used for trend analysis and for rolling back if the snapshot ever gets corrupted.

**Key decisions.**
- **Static hosting.** The dashboard is HTML + JSON. It loads in 200ms, works on any device, costs nothing, and has no backend to break.
- **Read-only by default.** Staff editing the source sheets is the write path. The dashboard is for viewing and for one specific write (daily attendance), which goes through Supabase.
- **Per-person attendance with bulk operations.** Staff can mark "all Upper Paid present" without touching other camps. Picks sync across devices in real time via Supabase.
- **Deep-linkable data issues.** Every data anomaly the dashboard surfaces has its own labeled row with an "Open ↗" button that lands on the exact cell. No more "we know there's a problem with Aria but we can't find which row."

### 4.4 Billing Dashboard

**Purpose.** The canonical financial record. Every enrollment priced, every payment recorded, every refund tracked, balance always current.

**Inputs.**
- 4 roster sheets (kids enrolled, what they signed up for)
- Pricing catalog tab on the Billing Dashboard sheet (team-editable)
- Manual Items tab (hidden, for non-form billing rows: cash payments, scholarships, partial refunds)
- GHL Transactions API (Florida + Georgia + future Virginia subaccounts)

**Outputs.**
- Billing Dashboard sheet (canonical) — one row per billable item per customer, grouped by family
- GHL contact upserts (push phone numbers, addresses, and tags back to GHL for the team)

**Components.**
- **BillingFromSheets.js** — the main pipeline. Runs every 5 minutes via time-driven trigger. Walks the 4 roster sheets + the Manual Items source tab, prices each enrollment via the Pricing catalog, applies sales tax by state (FL 6%, GA 4%, VA 5.3% — confirmed with finance team), inflates with the GHL processing fee, diffs the result against the live Dashboard sheet, and applies the diff with proper lifecycle (new → owed, dropped → canceled, paid-then-dropped → refund-needed).
- **PricingGuide.js** — pricing lookup keyed by enrollment type and duration. Team-editable in a Pricing tab on the Sheet; code reads the tab at runtime, no redeploy needed to change prices.
- **Manual Items dialog** — operator clicks `Add Item → + New manual item`, fills out a sidebar, and the system writes a row to the hidden `Manual Items` source tab with a stable UUID fingerprint. A one-time trigger fires the pipeline ~10 seconds later so the row lands on the Dashboard within seconds.
- **Polling.js** — separate every-5-min trigger that pulls the $1 GHL credit-card verification fee transactions from each subaccount, for audit purposes. (The CC verification is a known GHL behavior; this exists to make sure we account for it.)
- **RemoteTrigger.js** — webapp that exposes a whitelist of administrative RPCs (force a rebuild, restore lost profile links, run dedup, list customer emails) via authenticated HTTPS. Used for diagnostics and recovery.

**Key decisions.**
- **Fingerprint-based reconcile, not submission-ID-based.** Manual rows have no submission ID. Cash payments have no submission ID. The system uses a content fingerprint (customer email + product key + period) so that manual and automated entries are equal first-class rows.
- **Sheet is canonical, not GHL.** GHL submissions feed the system, but Dashboard rows are the truth. Operators can correct a Dashboard row by hand (through the Manual Items dialog), and the system will not overwrite the correction on the next pipeline run.
- **Idempotency on every operation.** Every audit, dedup, restore, and import function can be run multiple times without corrupting data. Critical for confidence when recovering from outages.
- **Hierarchical row grouping.** Customer rows are parent rows; transaction rows are children. The team can collapse a customer's transactions to see only the family-level balance.

### 4.5 School Enrollment Router

**Purpose.** Route after-school enrollments from a single central intake into the right per-school spreadsheet.

**Inputs.** Form submissions for after-school, into a single Main Table.

**Outputs.** One row per enrollment, written into the correct per-school sheet (Westward Elementary, Northboro, U.B. Kinsey, Pleasant City, Roosevelt, and any future schools).

**Components.**
- **Apps Script bound to the Main Table.** On every new row, the script reads the school name, matches it against the registered list of per-school sheets, and writes the row into the matching destination.
- **Auto-create on first use.** If the school is new (no destination sheet yet), the script creates the destination sheet from a Monthly or Quarterly template and lands the first row.
- **Three-tier name matching.** Exact match → case-insensitive match → Levenshtein fuzzy match. Critical because the form does not enforce a controlled vocabulary on school names ("U.B. Kinsey" vs "UB Kinsey" vs "Kinsey").

**Key decision.** Each school's spreadsheet is independent. The school's administrator gets read access to their sheet only. No cross-school data leakage. The Router is the only piece that has access to all of them.

### 4.6 Waiver Matcher

**Purpose.** Cross-reference signed waivers with roster entries. Surface allergies and health notes inline on the roster so staff sees them before camp starts.

**Inputs.**
- Waiver app sheet (one row per signed waiver)
- All 4 roster sheets

**Outputs.**
- Roster cells highlighted green where a waiver matches
- Cell notes on the roster row with the waiver's health/allergy info

**Components.**
- **Apps Script bound to the Waiver app sheet.** On every change, scans all camp roster sheets in Drive, fuzzy-matches student names from waiver rows against camp rows by email + Jaro-Winkler name similarity.
- **Cell-level highlighting.** Matched cells get green background. Unmatched cells stay white. Operator can scan a roster and see who is missing a waiver at a glance.
- **Cell-note injection.** Allergy info, medication notes, and "in case of emergency" contact lives in the cell note of the matched roster row, so staff opening the roster on camp day sees the safety info inline.

**Key decision.** Waivers and rosters stay separate sheets, owned separately, with the matcher running between them. Merging them into one sheet was considered and rejected: the waiver app has different access controls and a different lifecycle than the rosters.

### 4.7 Forms System

**Purpose.** All client-facing intake. Eight forms total, each feeding one or more downstream systems.

| Form | Feeds | Notes |
|---|---|---|
| Summer Camp Registration | Registration System | Validated by Camp Day Validator. Routes per-week. |
| Free Camp Registration | Registration System | Validated by Camp Day Validator. Routes per-week. No billing. |
| After-School Registration | School Enrollment Router | Routes by school name. |
| Private Lessons Booking | Billing Dashboard (via sheet) | Conditional logic on instructor → discipline. |
| Rent-A-Sensei Booking | Billing Dashboard (via sheet) | Confirmation step: "this is not a party booking." |
| Birthday Parties Booking | Billing Dashboard (via sheet) | Three-step structure: location → size → basics. |
| Balloons (Custom Decor Add-On) | Routed to vendor (Emily) | Sub-form triggered from Birthday Parties. |
| Vladimir Seminar Registration | Billing Dashboard (via sheet) | Pass selection + Friday Private opt-in. |

**Key decisions.**
- **One form, one purpose.** Tempting to build one mega-form with conditional logic. Wrong call: every conditional adds maintenance, every shared field adds drift. Eight distinct forms is easier to maintain, easier to debug, and easier to redirect to the right thank-you page.
- **Per-form Google Sheet.** Each form writes to its own sheet. The Billing pipeline reads from the relevant sheets. Sheets are operator-editable, GHL forms are not, and we want the operator to be able to correct a typo without a developer.
- **Conditional logic at the form layer, not the workflow layer.** GHL conditional logic on form fields is fine. GHL conditional logic on workflows is fragile (we have seen it break silently). Forms decide what fields to show; workflows just take what the form gives them.

### 4.8 Client-Facing Funnel

**Purpose.** All public-facing pages that drive enrollments. Hosted on GitHub Pages, embedded into GHL via iframes (with email passthrough), so they look like part of the GHL site.

| Page | Role |
|---|---|
| `home.html` | Landing page with program cards |
| `camps.html` | Summer camp overview |
| `summer-camp-scholarship.html` | Scholarship application |
| `after-school.html` | After-school program info |
| `private-lessons.html` | Private lessons page with embedded form |
| `spirit-dance.html` | Spirit Dance overview |
| `birthday-parties.html` | Party booking page with embedded form |
| `rent-a-sensei.html` | Rent-A-Sensei page with embedded form |
| `waiver.html` | Post-purchase waiver flow |
| `waiver-free.html` | Free-camp waiver variant |
| `thankyou.html` | Generic thank-you / confirmation |
| `vlad-seminar.html` | Seminar registration page |

**Hosting.** Static HTML/CSS/JS, no framework, hosted on GitHub Pages at `https://demilio24.github.io/Websites/Tom_Systema_Floyd/funnel/<page>.html`. Embedded into GHL via a custom-code iframe wrapper that handles full-width breakout and email passthrough.

**Why not native GHL.** GHL's site builder is fine for landing pages but constrains custom interactions (the camp day validator, the embedded forms, the three-step birthday party booking flow). Static HTML gives us full control and is trivially fast.

---

## 5. Tool Stack & Rationale

| Tool | Role | Why this one | Monthly cost |
|---|---|---|---|
| **GoHighLevel** | Forms, CRM, transactions, calendars, marketing | Already in use; consolidating around it avoids fragmenting the team's tools | $97–$497 (existing) |
| **Google Sheets** | Source of truth for rosters, billing, waivers, pricing | Operator-editable, version-controlled by Google, no backend to maintain | $0 (existing Workspace) |
| **Google Apps Script** | Server-side automation, scheduled triggers, sheet-bound logic | Native to Sheets, free, deploys in seconds, no servers to maintain | $0 |
| **GitHub Pages** | Static funnel + dashboard hosting | Free, fast, version-controlled, embeds cleanly into GHL via iframe | $0 |
| **GitHub Actions** | Snapshot fetcher cron, deploy automation | Free for public repos, runs every 5 minutes for free | $0 |
| **Supabase** | Cross-device shared state (attendance, tombstones) | Generous free tier, Postgres-backed, simple RPC model | $0 (free tier) |
| **n8n** | OAuth token refresh, ancillary integrations | Flexible, version-controlled workflows, easy to maintain | $20–$50 |

**Total tooling cost (incremental, on top of existing GHL): ~$20–$50/month.**

### Alternatives we considered

| What we did not choose | Why not |
|---|---|
| Airtable as source of truth | More expensive, less team-familiar, locks data behind their API |
| A custom Postgres backend | Adds a server to maintain, an API to keep up, and a developer dependency for every schema change |
| Zapier instead of Apps Script | Brittle on long-running flows, expensive at the volume of triggers we need, no native sheet binding |
| Webflow or Framer for the funnel | Adds another tool to learn; GitHub Pages embedded into GHL gets us the same outcome with one less dependency |
| Notion as the dashboard | Beautiful for reading, painful for live data; no good story for the 5-min refresh cycle |

---

## 6. Data Model

### 6.1 Source sheets

| Sheet | Purpose | Owner | Tabs |
|---|---|---|---|
| Summer Camp Upper Paid | Roster, paid summer camp, Upper campus | `systemafloydsheets@gmail.com` | One per week (`6/15-6/19`, `6/22-6/26`, ...) |
| Summer Camp Lower Paid | Roster, paid summer camp, Lower campus | Same | Same |
| Free Camp Upper | Roster, free camp, Upper campus | Same | Same |
| Free Camp Lower | Roster, free camp, Lower campus | Same | Same |
| Billing Dashboard | Canonical financial record | Same | `Dashboard`, `Pricing`, `Manual Items` (hidden), `Transactions`, `Logs` |
| Private Lesson Booking | Sheet1 of private-lesson form submissions | Same | One tab |
| Rent-A-Sensei Booking | Sheet1 of rent-a-sensei submissions | Same | One tab |
| Birthday Parties Booking | Party form submissions | Same | One tab |
| Vladimir Seminar | Seminar registrations | Same | One tab |
| Waiver App | All signed waivers | Same | One tab |
| Main Table (After-School) | Central intake before routing | Same | One tab |
| Per-school sheets (5+) | Auto-created by the Router | Same | One per month or quarter |

### 6.2 Supabase tables

| Table | Purpose |
|---|---|
| `sf_camp_enrollments` | Mirror of the rosters, queryable by external tools |
| `sf_camp_snapshots` | Daily snapshot archive, programmatic access |
| `sf_daily_attendance` | Per-day totals (Upper Free, Upper Paid, Lower Free, Lower Paid) |
| `sf_daily_attendance_people` | Per-person ticks for a given week + day |
| `ghl_tokens` | OAuth tokens for FL/GA/VA subaccounts, refreshed by n8n |

### 6.3 GHL contact custom fields

The system creates and maintains custom fields on every GHL contact for:
- Program of interest (multi-select)
- Closest location
- Per-form fields (Private Lesson instructor, Rent-A-Sensei service type, etc.)
- Sibling/family relationships (computed)

---

## 7. Build Sequence

12-week build, divided into 6 phases. Each phase is independently shippable; the team gets value from each one without waiting for the next.

### Phase 1, weeks 1–2: Foundation

**Goal.** A parent can submit the Summer Camp form and the row lands on the right sheet.

- Audit and clean the existing GHL forms (Summer Camp + Free Camp)
- Lock the source-of-truth Google Sheets (4 roster sheets, one tab per week)
- Build the Camp Day Validator and paste it into the form's Custom Code element
- Wire one GHL routing workflow per camp-week pair (~20 workflows)
- End-to-end test with `test@nilsllc.com` for every week

**Deliverable.** Forms are live, every submission lands on the right sheet.

### Phase 2, weeks 3–4: Visibility

**Goal.** Tom and the operations team have a live dashboard of every enrollment, updated every 5 minutes.

- Build Snapshot.js (Apps Script bound to a standalone project, reads the 4 sheets)
- Deploy to a pinned web app deployment
- Wire GitHub Actions to fetch `snapshot.json` every 5 min and commit it to the repo
- Build the browser dashboard (KPIs, sparkline, roster with filters)
- Add the lunches prep view for kitchen staff
- Embed the dashboard in GHL via the iframe template

**Deliverable.** Staff can open the dashboard in the morning and know who is enrolled.

### Phase 3, weeks 5–7: Billing

**Goal.** Every enrollment is priced, every payment is recorded, the balance is always current.

- Define the Pricing catalog (team-editable)
- Build BillingFromSheets pipeline (every-5-min trigger)
- Wire the Manual Items dialog
- Wire the $1 GHL CC verification fee polling
- Build RemoteTrigger.js webapp with admin RPCs
- Build the QA harness (idempotent dedup, audit, restore functions)
- Operator training on the Add Item dialog

**Deliverable.** Tom can open the Billing Dashboard sheet and see the current balance, the canonical record of every transaction, and a clean audit trail.

### Phase 4, weeks 8–9: Hardening

**Goal.** No registration ever falls through, no waiver is ever lost, and any system failure is caught within 24 hours.

- Build the Discrepancy Check failsafe
- Add Supabase tombstones for intentional deletes
- Add the heartbeat-guard email
- Build the Waiver Matcher (Apps Script bound to the Waiver app sheet)
- Wire allergy + health cell notes into rosters

**Deliverable.** The system is self-healing. The team is informed when the system itself goes silent.

### Phase 5, weeks 10–11: Expansion

**Goal.** Cover the remaining programs and the rest of the public funnel.

- Build the School Enrollment Router for after-school
- Build the Private Lessons, Rent-A-Sensei, Birthday Parties, and Vladimir Seminar forms
- Build the 12 client-facing funnel pages
- Embed each form into the matching funnel page
- Verify each form's workflow chain (form submission → sheet write → notification email)

**Deliverable.** Every public-facing program has a working booking flow, every booking flows into the right system.

### Phase 6, week 12: Polish and handoff

**Goal.** The operations team can run the system without us.

- Operator runbook (one page per subsystem)
- Recorded video walkthroughs of the Billing Dashboard, Add Item dialog, and Camp Dashboard
- 60-minute team training session
- 30-day support window

**Deliverable.** Operators are trained, runbooks are written, the team is independent.

---

## 8. Decision Log

The key architectural decisions and why we made them.

### D1. Google Sheets as source of truth

**Decision.** Google Sheets is the canonical record for every dataset in the system. Not a database, not Airtable, not GHL.

**Why.** The team already lives in Sheets. Sheets is operator-editable without a developer. Every system that needs to read can read; every system that needs to write can write. Trading that flexibility for the structural guarantees of a real database would slow down every "fix this one row" request from a 30-second sheet edit to a developer ticket.

**Tradeoffs accepted.** Sheets has no schema enforcement, so we accept that data validation is a defensive coding problem in every reader. Sheets has rate limits, so we accept that we polite-cache instead of polling aggressively.

### D2. Apps Script for automation, not n8n or Zapier

**Decision.** Apps Script is the primary automation runtime.

**Why.** Apps Script binds natively to the source-of-truth sheets, deploys in seconds, costs nothing, and runs server-side without us managing infrastructure. n8n was considered for some flows but adds a separate tool to maintain and a separate place data can break. n8n stays for OAuth token refresh because Apps Script's OAuth story for cross-domain GHL is more painful than n8n's.

**Tradeoffs accepted.** Apps Script has execution quotas. We design every job to be idempotent and chunked so quota hits do not corrupt state.

### D3. Fingerprint-based billing reconcile

**Decision.** Billing rows are identified by content fingerprint (customer email + product key + period), not by GHL submission ID.

**Why.** Manual rows, cash payments, and legacy imports do not have submission IDs. Treating them as second-class would force the team into the GHL form pipeline for every billing entry, which is wrong. Fingerprints make manual and automated rows equal.

**Tradeoffs accepted.** Fingerprint collisions are possible. We accept the risk and add a content-hash on each row for de-dup safety.

### D4. Name-based week resolution

**Decision.** Roster rows are categorized by their tab's name (`6/15-6/19`), not by tab position.

**Why.** We watched the positional model break in production: inserting a tab anywhere in the sequence silently shifted every downstream tab's meaning. Name-based resolution survives tab reordering, tab insertion, tab deletion.

**Tradeoffs accepted.** Tab names must follow a documented format. Renaming a tab freehand can desync the system. The operator runbook covers the rename procedure.

### D5. Failsafe-first architecture

**Decision.** Every primary writer has a secondary watcher.

**Why.** A single point of failure that quietly misses a write is the worst possible outcome. The team won't know for a week, and by then the data is gone. The cost of running a 15-minute watcher cron is trivial; the cost of one missed registration during enrollment season is enormous.

**Tradeoffs accepted.** Two writers means double the surface area to reason about. We handle this with idempotency on the watcher side (it can rewrite the same row 100 times and the dataset stays correct).

### D6. GitHub Pages for the funnel

**Decision.** The 12 funnel pages are static HTML hosted on GitHub Pages, embedded into GHL via iframes.

**Why.** GHL's native page builder is fine for landing pages but cannot host the camp day validator, the embedded forms, or the three-step birthday party booking. GitHub Pages is free, fast, version-controlled, and embeds cleanly. Iframe embedding means the GHL URL stays canonical for SEO and email links.

**Tradeoffs accepted.** Iframes have some cross-origin friction (parent email passthrough, full-width breakout). We handle these in the standard iframe wrapper template.

### D7. One form per purpose

**Decision.** Eight distinct GHL forms, not one mega-form with conditional logic.

**Why.** Each conditional in a form is a maintenance liability. Distinct forms are easier to debug, easier to redirect to the right thank-you page, easier to A/B test, and easier to retire when a program changes.

**Tradeoffs accepted.** Eight forms means eight Google Sheets and eight workflows. We handle this with documentation and a per-form spec ([App_documentation/new_forms_spec.md](../Tom_Systema_Floyd/App_documentation/new_forms_spec.md)).

---

## 9. Risk Register

Risks we identified during the audit, ranked by combined likelihood × impact. Every entry includes the mitigation already baked into the recommended architecture.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | GHL routing workflow misfires; registration row never lands | Medium | High | Discrepancy Check failsafe (15-min cron), auto-patches missed writes, emails Tom with the workflow ID |
| R2 | OAuth tokens for GHL expire silently | Medium | High | n8n token-refresh cron + heartbeat guard. If the cron fails 24h, Tom is emailed |
| R3 | Sheet tab order changes, breaking week assignment | Medium | High | Name-based week resolution (D4). Tab order is irrelevant to the pipeline |
| R4 | Apps Script execution quota hit during peak enrollment | Low | Medium | Idempotent jobs, chunked reads, time-driven re-trigger |
| R5 | Manual billing correction overwritten by next form submission | High (today) | High | Sheet-canonical model + fingerprint reconcile (D3). Manual edits beat automated writes |
| R6 | Snapshot push to GitHub Pages fails (token expired, repo full) | Low | Medium | Daily history archive on Supabase. Worst case: dashboard goes stale for 24h before alert fires |
| R7 | Waiver Matcher disabled by Drive permission changes | Low | Medium | Matcher can be re-bound to a new sheet in 5 minutes. Roster annotations are preserved |
| R8 | Operator deletes a Dashboard row by hand and `nuclearResetBilling` wipes it | Medium | Medium | Manual Items dialog is the ONLY supported edit path; Dashboard rows are derived |
| R9 | New school added to after-school program, no destination sheet exists | Medium | Low | Auto-create from template on first row routed |
| R10 | Sibling discount applied inconsistently across rows | Medium (today) | Medium | Pricing catalog includes a "family relationship" override; Billing pipeline reads it |
| R11 | Form spec drifts from implementation | High over time | Low | Per-form spec doc in `App_documentation/` with a "build status" table updated on every change |
| R12 | Subaccount expansion (Virginia) breaks single-state assumptions | Low (today), High (with VA) | Medium | Sales-tax matrix is multi-state from day 1; subaccount lookup is parameterized |

---

## 10. Out of Scope

Things this plan does NOT cover. If any of these matter, they become a separate engagement.

- **Email marketing campaigns.** GHL handles this natively. We integrate with it but do not design campaigns.
- **Payment processor selection.** Stripe via GHL is the current path. Switching processors is out of scope.
- **Booking calendar UX.** GHL native calendars are used as-is for staff bookings.
- **Brand identity / visual redesign.** We use the existing brand. Visual refresh is a separate engagement.
- **Mobile app.** All operator views are responsive web; native mobile is out of scope.
- **Multi-language support.** English only. Spanish-language forms would be a separate phase.
- **Custom HR / payroll integration.** Instructor scheduling and payroll happen outside this system.
- **AI-assisted features.** Could be added in a follow-on engagement (auto-summarize parent notes, predict no-shows, draft enrollment emails). Out of scope for the core build.
- **Migrating the legacy paper-based history.** Old paper registrations from prior years can be brought in as a one-time import; ongoing paper intake is not supported.

---

## 11. Appendices

### Appendix A: Glossary

| Term | Meaning |
|---|---|
| **Discrepancy Check** | The 15-minute failsafe cron that catches missed registrations |
| **Heartbeat guard** | A second-tier alert that fires when the failsafe itself goes silent for 24h |
| **Fingerprint** | A deterministic hash of `email + product + period` used to identify billing rows |
| **Source of truth** | The single authoritative system for a piece of data (Google Sheets in this architecture) |
| **Manual Item** | A billing row created via the operator dialog, not from a form |
| **Tombstone** | A Supabase row recording an intentional delete, so the failsafe does not re-add the row |
| **Pinned deployment** | An Apps Script deployment URL that does not change when the script is updated |
| **Subaccount** | A separate GoHighLevel location (FL, GA, future VA) |

### Appendix B: Tool stack monthly recurring (estimate)

| Tool | Cost | Notes |
|---|---|---|
| GoHighLevel | $97–$497 | Existing |
| Google Workspace (Sheets, Drive, Apps Script) | $0 incremental | Existing |
| GitHub | $0 | Public repo, free Pages + Actions |
| Supabase | $0 | Free tier covers the projected volume |
| n8n | $20–$50 | Cloud-hosted, used for token refresh |
| **Total incremental** | **$20–$50 / month** | |

### Appendix C: Operator runbook index

Every subsystem ships with a runbook. The full list:

1. Registration system runbook
2. Camp Dashboard operator guide
3. Billing Dashboard operator guide (with Add Item walkthrough)
4. Manual Items procedure
5. Form spec reference
6. Waiver Matcher procedure
7. School Enrollment Router admin guide
8. Discrepancy Check + heartbeat guard procedure
9. Recovery procedures (rollback, restore lost links, dedup)
10. OAuth token refresh procedure

Each runbook is a single page. The team gets a printed binder on Day 1.

---

**End of document.**

Prepared by Nils Digital. This document is the property of Systema Floyd. Hand it to any competent team and they will know exactly what to build.
