/* =====================================================================
   Western Charter House: shared content data (issues, policies, faqs).
   Drives the Research overview, the Policy library, the issue pages,
   and the home page. One source of truth across the site.

   stage: "active" = real, published position (the autism plank).
          "draft"  = placeholder layout, pending the research team's copy.
   ===================================================================== */
window.WCH = window.WCH || {};

/* category metadata (label + swatch color) shared by overview + policy library */
WCH.CATS = {
  health : {label:"Health & Family",          color:"#8a4f6d"},
  housing: {label:"Housing & Cost of Living",  color:"#a88240"},
  safety : {label:"Public Safety",             color:"#7d3b3b"},
  economy: {label:"Economy & Taxes",           color:"#2e6e4e"},
  energy : {label:"Energy & Resources",        color:"#1f5f8b"},
  book   : {label:"Education",                 color:"#b07b2e"},
  gov    : {label:"Governance",                color:"#5a4b8a"}
};

/* small inline icon set (issue cards + flow) */
WCH.ICON = {
  home:'<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M5 10v10h14V10"/></svg>',
  heart:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9Z"/></svg>',
  shield:'<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  coin:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4"/></svg>',
  bolt:'<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  book:'<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 3v16"/></svg>',
  scale:'<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z"/></svg>',
  cart:'<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.4 12.4a1 1 0 0 0 1 .6h9.2a1 1 0 0 0 1-.8L21 7H6"/></svg>'
};

/* draft scaffolds reused by the placeholder issues */
var DRAFT_FINDINGS = [
  {t:"Research in progress", d:"Our analysts are gathering the data, records, and lived experience that define this issue across British Columbia. Findings will appear here as the work is verified."},
  {t:"Stakeholder interviews underway", d:"We are speaking with the people closest to this issue and requesting the records that show how current policy is actually performing."},
  {t:"Freedom of Information requests filed", d:"Where the public record is incomplete, we file FOIs to establish the facts before we recommend anything."}
];
var DRAFT_STAKEHOLDERS = [
  {name:"Responsible ministry", role:"Government", d:"The provincial ministry that owns this file and the decisions behind the current approach."},
  {name:"Frontline providers", role:"Practitioners", d:"The professionals and organizations delivering services on the ground, who see what the data misses."},
  {name:"Affected British Columbians", role:"Lived experience", d:"The families, workers, and communities most directly affected by how this issue is handled."}
];

/* ====================== ISSUES (research -> policy) ====================== */
/* n  = display/sort number; id = page slug (issue.html?id=...) */
WCH.ISSUES = [
  {
    n:1, id:"autism", cat:"health", ic:"heart", stage:"active", status:"Research in progress",
    title:"Protect Every Child, Restore Direct Autism Funding",
    summary:"British Columbia is ending direct, individualized autism funding. We document who loses support and set out a funded plan to restore it.",
    research:{
      context:"In 2022 the government promised to maintain individualized autism funding. In February 2026 it moved to end it. Direct funding is set to terminate on March 31, 2027, replaced by a hub model and a new income test that ties a child's disability support to their parents' income. Our research follows the families this affects and the numbers behind the decision.",
      findings:[
        {t:"About 5,200 children lose all support", d:"Children who currently receive individualized funding face losing it entirely when direct funding ends, with more than 10,000 families receiving less than they do today."},
        {t:"A new income test on disability support", d:"For the first time, a child's access to autism support would be tied to household income, rather than the child's diagnosed need."},
        {t:"Assessment waits near 80 weeks", d:"Families routinely wait roughly 80 weeks for a diagnostic assessment, delaying early intervention during the years it matters most."},
        {t:"A promise reversed", d:"The 2026 change reverses a 2022 commitment to maintain individualized funding, which is the core of the public record we are documenting."}
      ],
      stakeholders:[
        {name:"Ministry of Children and Family Development", role:"Government", d:"Owns the funding model and the decision to move from individualized funding to a hub model with income testing."},
        {name:"BC Families for Fair Autism Funding", role:"Parent advocates", d:"A parent-led group documenting the real impact on children and families across the province."},
        {name:"Autism clinicians and therapists", role:"Service providers", d:"Behaviour analysts, occupational and speech therapists whose early-intervention work depends on how funding is structured."},
        {name:"Representative for Children and Youth", role:"Oversight", d:"An independent office that monitors outcomes for children receiving provincial services."}
      ],
      evidence:[
        {type:'link', href:'https://www.bcfairautism.com/', title:'BC Families for Fair Autism Funding', source:'Parent advocacy group', date:'2026'},
        {type:'link', href:'https://news.gov.bc.ca/releases/2022CFD0027-001535', title:'2022 commitment to maintain individualized autism funding', source:'Government of B.C. news release', date:'Sep 2022'}
      ]
    },
    policy:{
      problem:"Ending direct, individualized funding cuts off about 5,200 children entirely, gives more than 10,000 families less, and for the first time ties a child's disability support to their parents' income, all while diagnostic waits stretch toward 80 weeks.",
      alternative:"Restore and protect direct, individualized funding, with no income test, and guarantee timely assessment so early intervention reaches children when it does the most good.",
      outcome:"No child currently receiving support loses it, parents and clinicians direct the care plan instead of a ministry checklist, and early intervention starts years sooner.",
      recs:[
        "Restore direct, individualized funding of up to $22,000 a year per child.",
        "Guarantee a $6,500 minimum for every diagnosed child at any age.",
        "End income testing so support follows the child's need, not the parents' paycheque.",
        "Legislate a Family Advisory Council so families have a permanent seat at the table.",
        "Guarantee a diagnostic assessment within 90 days, down from roughly 80 weeks.",
        "Expand the therapy workforce and keep inclusive education funded."
      ],
      action:"Email your MLA to ask that direct autism funding be restored with no income test, and add your name to the BC Families for Fair Autism Funding petition."
    },
    howToPay:"The plan is costed at roughly $375 to $440 million a year. It is funded within the existing children and families budget by keeping direct, individualized funding rather than building a new administrative hub model, and by redirecting those administrative savings back to families.",
    qa:[
      {q:"Does this keep funding for every child?", a:"Yes. Every diagnosed child keeps direct, individualized funding, with a guaranteed minimum at any age and no income test."},
      {q:"How is it paid for?", a:"Within the existing budget, by keeping direct funding instead of standing up new administrative hubs, and redirecting those savings to families."},
      {q:"Is this a partisan position?", a:"No. This is about the outcome for children. We will work with any MLA, of any party, who will restore the funding."}
    ],
    conclusion:"No child who depends on this support should lose it, and no child's care should be rationed by their parents' income. Restoring direct funding is affordable, it is the right thing to do, and it can be done before the March 2027 deadline.",
    lead:{name:"Western Charter House Policy Team", role:"Research & Policy"},
    sections: [
      {
        id: "issue",
        title: "1. Funding Policy Issue: Protect Every Child, Restore Direct Autism Funding",
        content: '<p>This report evaluates a narrow but high-impact funding policy issue: whether British Columbia\'s replacement of diagnosis-based autism funding with a broader disability-benefit model protects children who currently rely on direct autism funding, and whether the new model contains adequate legal, administrative, financial and clinical safeguards.</p><p>The evaluation does not reject broader disability equity. The central issue is whether equity is being achieved by expanding access upward or by redistributing risk downward from autistic children who already have a known, predictable funding pathway. A sound model should expand supports to children with non-autism disabilities without creating avoidable losses, therapy disruption or administrative uncertainty for autistic children.</p><div class="ev-block" style="margin-top: 24px;"><div class="ev-head"><span class="ev-eyebrow">Source note</span><p>The Province states that the new model is intended to expand direct funding across diagnoses and reach more children with significant needs; the current Autism Funding Program remains in place during transition but is scheduled to end in 2027 [BC GOV 2026a; BC GOV 2026c].</p></div></div><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:24px; font-size:14.5px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:12px; border:1px solid var(--hair-2); text-align:left;">Evaluation question</th><th style="padding:12px; border:1px solid var(--hair-2); text-align:left;">Working answer</th><th style="padding:12px; border:1px solid var(--hair-2); text-align:left;">Implication</th></tr></thead><tbody><tr><td style="padding:12px; border:1px solid var(--hair-2);"><b>Who is most at risk of losing support?</b></td><td style="padding:12px; border:1px solid var(--hair-2);">Children under age six who currently receive up to $22,000 and do not receive the higher $17,000 tier plus a full supplement; children who do not meet the new functional-needs threshold; families without DTC approval; and children newly diagnosed after the legacy program closes.</td><td style="padding:12px; border:1px solid var(--hair-2);">These groups require explicit no-loss, review and appeal safeguards.</td></tr><tr><td style="padding:12px; border:1px solid var(--hair-2);"><b>Who may gain?</b></td><td style="padding:12px; border:1px solid var(--hair-2);">Children with significant disabilities outside autism; older autistic children who qualify for at least the base benefit; lower-income DTC-approved families receiving both the benefit and supplement.</td><td style="padding:12px; border:1px solid var(--hair-2);">The expansion objective is legitimate and should be preserved.</td></tr><tr><td style="padding:12px; border:1px solid var(--hair-2);"><b>What is the policy design flaw?</b></td><td style="padding:12px; border:1px solid var(--hair-2);">The new model improves disability equity but weakens the diagnosis-based guarantee and creates eligibility, timing, review and income/DTC dependency risks.</td><td style="padding:12px; border:1px solid var(--hair-2);">A hybrid floor-plus-top-up model is lower risk than a full replacement.</td></tr></tbody></table>'
      },
      {
        id: "overview",
        title: "2. Overview",
        content: '<p>British Columbia is transitioning from the Autism Funding Program to the B.C. Children and Youth Disability Benefit and the B.C. Children and Youth Disability Supplement. The Province has announced $475 million in new funding over three years, alongside redirection of $289 million in existing autism-funding resources. The new model includes a non-income-tested Disability Benefit of $6,500 or $17,000 per year based on functional support needs, and an income-tested Disability Supplement of up to $6,000 per child linked to federal Disability Tax Credit eligibility [BC GOV 2026a; BC GOV 2026b; BC GOV 2026e].</p><p>The model\'s strength is its stated movement toward cross-disability inclusion. Its weakness is transition risk. The legacy autism model is diagnosis-based and predictable. The new model is needs-based, tiered, partially income-tested, and partly dependent on the federal tax system. This creates a practical risk that some families will be told the new system is more equitable in the aggregate while their child experiences a specific service loss.</p><p>The evaluation therefore uses a public-sector evaluation structure similar to an AANDC-style evaluation report: relevance, success/effectiveness, efficiency/economy, evidence triangulation, risk analysis and recommendations. The report is written as a policy evaluation rather than a campaign statement; advocacy claims are treated as claims requiring verification unless supported by public records or peer-reviewed evidence.</p>'
      },
      {
        id: "background",
        title: "3. Background",
        content: '<p>The Autism Funding Program was created in 2002. Under the current program, autism funding provides up to $22,000 per year for children under age six and up to $6,000 per year for children aged six to eighteen. Funding can be used for eligible services and supports that promote skill development, including behaviour intervention, speech-language supports, occupational therapy, family counselling, social skills programming, training, equipment and travel within program rules [BC GOV 2026f].</p><p>In 2022, the Province publicly stated that individualized funding for children with an autism diagnosis would be maintained rather than phased out after 2025. That commitment is now a central governance fact because the 2026 reform replaces the autism-specific program with a broader disability-benefit model. The administrative-law issue is not merely that government changed policy; governments can change policy. The issue is whether the change is transparent, rationally explained, procedurally fair and protected by adequate transition measures given prior reliance by families [BC GOV 2022].</p><p>The Province\'s stated rationale is that many children with significant disabilities outside the autism diagnosis stream have not received comparable support. That problem is real and material. However, the policy response should not force a binary choice between autistic children and other children with disabilities. A better public-policy framing is expansion without avoidable regression.</p>'
      },
      {
        id: "scope-activities",
        title: "4. Scope and Activities",
        content: '<p>The evaluation scope includes the policy design, transition process, fiscal architecture and legal-administrative safeguards associated with replacing direct autism funding. The scope is limited to child and youth disability funding; it does not evaluate the whole school-inclusion system, the full mental-health system, or every disability-support program in British Columbia.</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:14px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">In scope</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Out of scope</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Reason for boundary</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);">Autism Funding Program transition</td><td style="padding:10px; border:1px solid var(--hair-2);">Full review of all MCFD programs</td><td style="padding:10px; border:1px solid var(--hair-2);">The immediate risk is the replacement of a specific direct-funding pathway.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Children and Youth Disability Benefit</td><td style="padding:10px; border:1px solid var(--hair-2);">Clinical review of each eligible diagnosis</td><td style="padding:10px; border:1px solid var(--hair-2);">The evaluation assesses policy architecture, not individual clinical eligibility.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Children and Youth Disability Supplement</td><td style="padding:10px; border:1px solid var(--hair-2);">Federal tax-policy redesign</td><td style="padding:10px; border:1px solid var(--hair-2);">The supplement relies on DTC/tax filing, but federal law is not the main object of reform.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Transition safeguards, appeals and no-loss options</td><td style="padding:10px; border:1px solid var(--hair-2);">Litigation strategy</td><td style="padding:10px; border:1px solid var(--hair-2);">This is a policy and administrative-law review, not legal advice.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Budget logic and public-value risks</td><td style="padding:10px; border:1px solid var(--hair-2);">Precise actuarial costing</td><td style="padding:10px; border:1px solid var(--hair-2);">A full fiscal model requires caseload and utilization data not publicly available.</td></tr></tbody></table><h4 style="margin-top:24px; font-weight:600; font-size:16px;">Activities evaluated:</h4><ul style="margin-left:20px; margin-top:8px; line-height:1.7;"><li>Termination or replacement of the diagnosis-based Autism Funding Program.</li><li>Introduction of tiered direct funding based on functional support needs.</li><li>Use of the Disability Tax Credit and income tax data to deliver the supplement.</li><li>Transition communications, eligibility review, support planning and notification processes.</li><li>Public claims that no child will be left behind and that supports will be expanded.</li><li>Options to preserve a direct autism-funding floor while expanding cross-disability supports.</li></ul>'
      },
      {
        id: "methods",
        title: "5. Methods",
        content: '<p>The methodology follows a structured policy-evaluation approach using document review, literature review, jurisdictional scan, stakeholder-risk mapping, budget comparison and administrative-law analysis. Evidence was triangulated across official government sources, user-supplied research materials, peer-reviewed studies and public reporting.</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:13.5px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Line of evidence</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Use in report</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Strength</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Limitation</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Official BC sources</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Regulatory scan, budget structure, program timelines and eligibility descriptions.</td><td style="padding:10px; border:1px solid var(--hair-2);">Authoritative for current policy design.</td><td style="padding:10px; border:1px solid var(--hair-2);">Does not independently verify family impact or implementation outcomes.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>User-supplied WCH spreadsheet</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Identifies public articles, advocacy concerns and academic research relevant to funding risk.</td><td style="padding:10px; border:1px solid var(--hair-2);">Useful issue map and evidence inventory.</td><td style="padding:10px; border:1px solid var(--hair-2);">Not all claims are independently verified in this draft.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Peer-reviewed literature</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Assesses risk associated with service disruption, mental-health vulnerability and need for autism-informed supports.</td><td style="padding:10px; border:1px solid var(--hair-2);">High evidentiary value for general risk context.</td><td style="padding:10px; border:1px solid var(--hair-2);">Does not calculate BC-specific funding losses.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Jurisdictional scan</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Compares BC with Ontario, Alberta, Saskatchewan and Manitoba.</td><td style="padding:10px; border:1px solid var(--hair-2);">Shows policy alternatives across Canadian systems.</td><td style="padding:10px; border:1px solid var(--hair-2);">Cross-provincial comparability is imperfect because eligibility and delivery systems differ.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Administrative-law review</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Assesses procedural fairness, transparency, legitimate expectations and reviewability.</td><td style="padding:10px; border:1px solid var(--hair-2);">Identifies governance safeguards.</td><td style="padding:10px; border:1px solid var(--hair-2);">Not a legal opinion and does not predict court outcomes.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Interviews &amp; FOI of Key Stakeholders</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Review of procedural fairness, transparency, legitimate expectations and reviewability.</td><td style="padding:10px; border:1px solid var(--hair-2);">Shows perspectives of various stakeholders involved in this policy change.</td><td style="padding:10px; border:1px solid var(--hair-2);">Getting interview access to all key stakeholders is limited and supplemented with FOIs.</td></tr></tbody></table>'
      },
      {
        id: "literature-review",
        title: "6. Literature Review",
        content: '<p>The critical literature does not support a simplistic claim that every dollar of autism funding produces the same outcome, nor does it support eliminating predictable supports without safeguards. The stronger conclusion is that autism-informed, timely and continuous supports can reduce downstream risks, while service disruption, administrative burden and uncertainty can increase family stress and destabilize care planning.</p><h4 style="margin-top:20px; font-weight:600;">1. Autism-related vulnerability and mental-health risk</h4><p>Population-based research from Ontario found increased risks of self-harm events and suicide death among autistic individuals, with psychiatric diagnoses significantly associated with increased risk. A Swedish population-based study similarly found elevated risks of suicide attempts and suicide in autism, especially among individuals without intellectual disability and with comorbid ADHD. The policy implication is direct: service transitions affecting autistic children should be treated as high-sensitivity transitions, not routine benefit administration [Lai et al. 2023; Hirvikoski et al. 2020].</p><h4 style="margin-top:20px; font-weight:600;">2. Early and continuous intervention</h4><p>The literature and program logic around early intervention point toward continuity, parent engagement and timely access as core design principles. For under-six children, the current BC program recognizes the higher intensity of early intervention by providing a higher funding ceiling. A reform that drops a child from a $22,000 early-intervention ceiling to $17,000 or $6,500 without a bridge plan risks undermining the very period when service continuity is most valuable [BC GOV 2026f].</p><h4 style="margin-top:20px; font-weight:600;">3. Parent-directed funding versus centralized/community services</h4><p>Direct funding and community-based services solve different problems. Direct funding gives families choice, continuity and individualized purchasing power. Community services can expand access, build regional capacity and reduce inequity. The policy error is treating one as a full substitute for the other. A stronger model uses community services as a platform while preserving direct funding as a floor where private-provider continuity is clinically important.</p><h4 style="margin-top:20px; font-weight:600;">4. Administrative burden as policy risk</h4><p>A benefit can be formally available but practically inaccessible if families face unclear eligibility rules, long review timelines, tax-credit barriers, provider shortages or weak appeal rights. This is especially relevant where the supplement depends on federal DTC approval and tax filing. Families without DTC approval, or with delayed approval, may experience a funding gap even if they have real support needs [CRA 2026; BC GOV 2026e].</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:24px; font-size:14px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Critical literature finding</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Policy implication</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);">Autistic individuals show elevated self-harm and suicide risk in population studies.</td><td style="padding:10px; border:1px solid var(--hair-2);">Funding transitions should include mental-health and crisis-risk safeguards.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Early intervention is time-sensitive.</td><td style="padding:10px; border:1px solid var(--hair-2);">Under-six funding reductions require strict no-loss or bridge mechanisms.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Family choice supports individualized fit.</td><td style="padding:10px; border:1px solid var(--hair-2);">Community services should supplement, not automatically replace, direct funding.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);">Administrative barriers can convert nominal eligibility into real exclusion.</td><td style="padding:10px; border:1px solid var(--hair-2);">Eligibility, review and appeal pathways must be transparent and fast.</td></tr></tbody></table>'
      },
      {
        id: "key-findings-1",
        title: "7. Key Findings - Relevance, Stakeholders, Departments Involved, Budgets",
        content: "<p>Coming soon</p>"
      },
      {
        id: "key-findings-2",
        title: "8. Key Findings - Success/Effectiveness",
        content: "<p>Coming soon</p>"
      },
      {
        id: "key-findings-3",
        title: "9. Key Findings - Efficiency/Economy",
        content: "<p>Coming soon</p>"
      },
      {
        id: "regulatory-framework",
        title: "10. Current BC Regulatory Framework",
        content: '<p>This scan summarizes the live BC policy environment relevant to direct autism funding as of July 2026. It is a regulatory and program scan, not a full legal opinion.</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:13.5px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Instrument / policy area</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Current position</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Policy evaluation risk</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Autism Funding Program</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Continues unchanged during transition and accepts new applications until March 2027; funding supports eligible services and supports for autistic children [BC GOV 2026f].</td><td style="padding:10px; border:1px solid var(--hair-2);">Families may rely on a program that is scheduled to close, creating planning uncertainty.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Autism Funding end date</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Families continue to have access up to March 31, 2027; program ends as Disability Benefit becomes available [BC GOV 2026c].</td><td style="padding:10px; border:1px solid var(--hair-2);">Hard end date creates risk if eligibility decisions, reviews or provider transitions are late.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>BC Children &amp; Youth Disability Benefit</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Direct funding for ages 0-19 with lifelong disability causing significant and/or complex support needs; $6,500 base tier or $17,000 higher tier [BC GOV 2026b].</td><td style="padding:10px; border:1px solid var(--hair-2);">Needs-based eligibility must be transparent and reviewable.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>BC Children &amp; Youth Disability Supplement</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Up to $6,000/year, income-tested and DTC-linked, paid through the family benefit structure starting July 2027 [BC GOV 2026e].</td><td style="padding:10px; border:1px solid var(--hair-2);">DTC and income testing can create gaps for families with real therapy needs.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>At Home Program and SAET</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Some At Home/SAET benefits transition to the new benefit; medical equipment and supplies are stated to remain [BC GOV 2026d].</td><td style="padding:10px; border:1px solid var(--hair-2);">Overlap rules must be clear to prevent double gaps or duplication.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>2022 individualized funding commitment</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Province committed to maintaining individualized funding for autism diagnosis after 2025 [BC GOV 2022].</td><td style="padding:10px; border:1px solid var(--hair-2);">Creates legitimate-expectations and public-trust issue unless government explains departure and provides transitional fairness.</td></tr></tbody></table>'
      },
      {
        id: "jurisdictional-scan",
        title: "11. Jurisdictional Scan",
        content: '<p>The jurisdictional scan shows that Canadian provinces use materially different models: diagnosis-specific autism funding, needs-based disability supports, mixed service/funding models and provider-delivered programs. The comparison supports a hybrid recommendation: preserve the family-directed floor while expanding broader disability access.</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:13.5px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Jurisdiction</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Model observed</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Relevance to BC</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>British Columbia</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Transitioning from autism-specific funding to a broader Disability Benefit/Supplement model; current autism funding is up to $22,000 under age six and $6,000 ages six to eighteen.</td><td style="padding:10px; border:1px solid var(--hair-2);">BC is moving from diagnosis guarantee to functional-needs tiers. Main risk is loss of continuity for current autism families.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Ontario</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Ontario Autism Program includes multiple streams such as foundational family services, caregiver-mediated early years, core clinical services, school entry supports and urgent response services. The 2026 Ontario Budget provides $965M to OAP, including $186M in new funding.</td><td style="padding:10px; border:1px solid var(--hair-2);">Ontario demonstrates that autism-specific programming can coexist with broader developmental services, but waitlists and access limits remain critical risks.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Alberta</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Family Support for Children with Disabilities works with eligible families to tailor supports and services based on the child and family\'s needs under an FSCD statutory/policy framework.</td><td style="padding:10px; border:1px solid var(--hair-2);">Alberta is a needs-based family-support comparator. BC should borrow transparent planning/review structures, not just needs-based language.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Saskatchewan</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Autism Spectrum Disorder Individualized Funding provides up to $8,000 annually for children under six and up to $6,000 annually for children aged six to eleven with ASD.</td><td style="padding:10px; border:1px solid var(--hair-2);">Saskatchewan remains an example of diagnosis-specific individualized autism funding, albeit at lower amounts than BC\'s under-six ceiling.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Manitoba</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Children\'s disABILITY Services includes autism services such as autism outreach and ABA programming, with services based on individual assessment and available resources.</td><td style="padding:10px; border:1px solid var(--hair-2);">Manitoba illustrates a service-delivery model; BC should avoid replacing direct funding with services unless capacity, access and wait times are proven.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Federal Canada</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Child Disability Benefit is a tax-free monthly payment for families caring for a child under 18 eligible for the DTC, up to $3,480 for July 2026-June 2027.</td><td style="padding:10px; border:1px solid var(--hair-2);">Federal benefits can supplement provincial support but should not be treated as a full substitute for provincial therapy funding.</td></tr></tbody></table><h4 style="margin-top:24px; font-weight:600;">Best province in Canada: Ontario on paper; B.C. historically for simplicity.</h4><p>For the kind of direct, individualized autism funding you are defending, the strongest Canadian comparator is now <b>Ontario</b>, because the Ontario Autism Program can provide annual Core Clinical Services funding from <b>$6,600 to $65,000</b>, depending on age and assessed intensity of need. OECD specifically identifies Ontario’s Autism Program as one of the proactive individualized-budget models, alongside Australia’s NDIS.</p><p>But there is a major caveat: Ontario is best on maximum entitlement, not necessarily on access. Families can face long waits and administrative complexity. So for advocacy purposes, B.C. should keep the simplicity of its legacy direct-funding model, but add Ontario-style needs-based top-ups.</p><h4 style="margin-top:24px; font-weight:600;">The best country in the world for this model: Australia.</h4><p>The strongest international comparator is <b>Australia’s National Disability Insurance Scheme (NDIS)</b>. It is not autism-specific, but it is the most developed large-scale individualized disability funding system. OECD describes the NDIS as providing individualized funding packages so participants can purchase therapies, assistive equipment, personal care, training, and other supports under an approved plan. OECD also reports that, in 2025, the average annual NDIS budget for a child with ASD was about <b>AUD $24,000</b>, with no standardized cap because funding varies by assessed need.</p><p>Australia is also moving toward a second stream called <b>Thriving Kids</b>, with governments committing <b>$4 billion over five years</b> for children aged 8 and under with developmental delay and/or autism with low-to-moderate support needs, while children with permanent and significant disability are expected to remain NDIS-eligible.</p>'
      },
      {
        id: "media-scan",
        title: "12. Media Scan",
        content: '<p><b>Purpose of the Media Scan:</b> This media scan reviews public, media, government, advocacy and sector-facing commentary on British Columbia’s transition from the Autism Funding Program to the B.C. Children and Youth Disability Benefit and B.C. Children and Youth Disability Supplement. The scan is intended to assess how the policy change has been framed publicly, what concerns have been raised, what counterarguments have been advanced, and how the media environment affects the policy case for restoring direct autism funding.</p><p><b>Summary Finding:</b> Media and public commentary show a consistent tension between two competing but not mutually exclusive narratives. The Province’s narrative emphasizes equity, broader eligibility, cross-disability inclusion, simplified access and additional investment. The family and autism-advocacy narrative emphasizes loss of predictability, breach of trust, DTC barriers, subjective needs assessment, under-six funding reductions and the absence of a publicly quantified no-loss guarantee.</p><p><b>Advocacy Activity and Timeline of Key Events:</b> Public advocacy around the autism funding transition has developed across B.C. through parent-led groups, service providers, autism organizations and disability-sector advocates. Main advocates and organizations involved include BC Families for Fair Autism Funding, AutismBC, Autism Alliance of Canada, Solidarity Collective, local parent advocates, and service-provider voices such as Nicole Grocock of Social Butterflies Kamloops, Sara Lindberg of BC Families for Fair Autism Funding, and Amanda Claeys of Monarch House.</p><h4 style="margin-top:20px; font-weight:600;">Brief Timeline of Key Events</h4><ul style="margin-left:20px; line-height:1.7;"><li><b>2021:</b> Families and advocates protested the earlier proposed shift from direct autism funding to a hub-style model, arguing it would increase waitlists and reduce family control over services.</li><li><b>2022:</b> The Province committed to maintaining individualized autism funding for children with an autism diagnosis, creating an important public-trust and reliance issue for later reforms.</li><li><b>February 10–11, 2026:</b> MCFD announced the new Children and Youth Disability Benefit/Supplement model, replacing the existing Autism Funding Program by March 31, 2027; advocacy petitions began shortly after.</li><li><b>March 14, 2026:</b> Rallies were held in Kamloops and the Lower Mainland/Vancouver-Burnaby area calling for fair autism funding and protection against loss of individualized support.</li><li><b>April 24, 2026:</b> Families protested outside Minister Jodie Wickens’ Coquitlam–Burke Mountain constituency office; advocates raised concerns about dramatic funding reductions and provider instability.</li><li><b>April 30, 2026:</b> Families and advocacy organizations rallied at the B.C. Legislature, with BC Families for Fair Autism Funding calling for answers on how children receiving reduced or no individualized funding would be prioritized.</li><li><b>May 24, 2026:</b> Global News reported a Coquitlam protest over autism funding restructuring as part of broader public concern about B.C. budget impacts.</li><li><b>June 27, 2026:</b> A second Kamloops rally was planned outside the Kamloops Law Courts, reflecting continued concern that parent and provider questions remained unresolved.</li></ul><h4 style="margin-top:20px; font-weight:600;">Media and Public Narrative Themes</h4><ol style="margin-left:20px; line-height:1.7;"><li><b>Government framing:</b> equity expansion across diagnoses.</li><li><b>Parent and autism-family framing:</b> uncertainty, eligibility risk and loss of direct control.</li><li><b>Trust and reversal narrative:</b> the 2022 commitment remains a live media issue.</li><li><b>Disability-sector framing:</b> cautious support with structural concerns.</li><li><b>DTC and income-testing narrative:</b> benefit access may be administratively unequal.</li><li><b>Provider and implementation narrative:</b> funding change may destabilize service continuity.</li></ol>'
      },
      {
        id: "stakeholder-engagement",
        title: "13. Stakeholder Engagement Interviews & Analysis",
        content: '<p>From an administrative-law perspective, the main issues are procedural fairness, transparency, reviewability, legitimate expectations, non-arbitrariness and equality/accessibility of access. This section is not legal advice; it identifies governance risks that should be addressed in policy design before conflict escalates.</p><table class="grid-table" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:13.5px;"><thead><tr style="background:var(--ink); color:#fff;"><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Administrative-law principle</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Risk in current transition</th><th style="padding:10px; border:1px solid var(--hair-2); text-align:left;">Safeguard</th></tr></thead><tbody><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Procedural fairness</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Families may face eligibility decisions affecting significant supports without clear reasons or review rights.</td><td style="padding:10px; border:1px solid var(--hair-2);">Written decisions, reasons, reconsideration route and independent review mechanism.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Legitimate expectations</b></td><td style="padding:10px; border:1px solid var(--hair-2);">The 2022 statement that individualized autism funding would be maintained may have created reliance by families and providers.</td><td style="padding:10px; border:1px solid var(--hair-2);">Explain policy departure and provide transition/no-loss protection for those who relied on the prior commitment.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Reasonableness / rationality</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Tier decisions must be based on intelligible criteria and evidence, not opaque classification.</td><td style="padding:10px; border:1px solid var(--hair-2);">Publish criteria, assessment tools, examples and quality-assurance process.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Accessibility</b></td><td style="padding:10px; border:1px solid var(--hair-2);">DTC dependency, tax filing, language barriers and assessment paperwork can exclude families in practice.</td><td style="padding:10px; border:1px solid var(--hair-2);">Navigation support, multilingual materials, DTC assistance and interim bridge funding.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Equality and non-discrimination</b></td><td style="padding:10px; border:1px solid var(--hair-2);">A needs-based model is defensible, but income/DTC/design barriers may disproportionately affect families with complex needs or limited administrative capacity.</td><td style="padding:10px; border:1px solid var(--hair-2);">Equity audit and public reporting by region, income band, Indigenous status where appropriate, age and disability category.</td></tr><tr><td style="padding:10px; border:1px solid var(--hair-2);"><b>Reliance and transition fairness</b></td><td style="padding:10px; border:1px solid var(--hair-2);">Therapy providers, staffing and child plans are built on predictable annual funding.</td><td style="padding:10px; border:1px solid var(--hair-2);">Grandfathering, phased step-down only where clinically safe, and emergency exceptions.</td></tr></tbody></table>'
      },
      { id: "foi-requests", title: "14. F.O.I Requests and Hansard Committee Analysis", content: "<p>Coming soon</p>" },
      { id: "risk-gap-analysis", title: "15. Risk & Gap Analysis", content: "<p>Coming soon</p>" },
      { id: "swot-analysis", title: "16. SWOT Analysis", content: "<p>Coming soon</p>" },
      { id: "recommendations", title: "17. Recommendations", content: "<p>Coming soon</p>" },
      { id: "worst-case-recs", title: "18. Worst Case Recommendations", content: "<p>Coming soon</p>" },
      { id: "suggested-case-recs", title: "19. Suggested Case Recommendations", content: "<p>Coming soon</p>" },
      { id: "optimal-case-recs", title: "20. Optimal or Best Case Recommendations", content: "<p>Coming soon</p>" },
      { id: "conclusions", title: "21. Conclusions", content: "<p>Coming soon</p>" },
      { id: "citation", title: "22. Citation", content: "<p>Coming soon</p>" }
    ]
  },
  {
    n:2, id:"housing", cat:"housing", ic:"home", stage:"draft", status:"Research Coming Soon",
    title:"Build, Don't Hoard",
    summary:"Permitting delays and speculation keep supply scarce and ownership out of reach. We are documenting where the bottlenecks actually are.",
    research:{
      context:"This issue page is a working draft. It shows how each issue moves from research into policy. The research team's verified findings, stakeholders, and final recommendations will replace this placeholder content.",
      findings:DRAFT_FINDINGS,
      stakeholders:[
        {name:"Ministry of Housing", role:"Government", d:"Owns provincial housing targets, permitting rules, and the policies that shape supply."},
        {name:"Local governments", role:"Permitting", d:"Municipalities that control zoning and the approval timelines where homes actually get built."},
        {name:"Builders and trades", role:"Industry", d:"The people who build, and who feel permitting delays and input costs first."}
      ]
    },
    policy:{
      problem:"Permitting delays and speculation keep supply scarce and prices out of reach.",
      alternative:"Cut municipal permitting timelines and shift the tax burden off building and onto idle land.",
      outcome:"More homes built faster, and a real path back to ownership for young families.",
      recs:[
        "Set and publish hard permitting timelines for municipalities.",
        "Shift tax weight off new construction and onto idle, speculative land.",
        "Report supply progress riding by riding."
      ],
      action:"Email your MLA the model permitting-reform letter once it is published."
    }
  },
  {
    n:3, id:"cost-of-living", cat:"housing", ic:"cart", stage:"draft", status:"Research Coming Soon",
    title:"Relief Families Can Feel",
    summary:"Everyday costs have outpaced wages for a decade. We are pulling the numbers on where the squeeze is sharpest.",
    research:{
      context:"This issue page is a working draft showing the research-to-policy flow. Verified findings and recommendations will replace this placeholder.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Everyday costs have outpaced wages for a decade across British Columbia.",
      alternative:"Targeted tax relief funded by spending discipline, not new income taxes.",
      outcome:"Hundreds of dollars back in the average household budget each year.",
      recs:["Target relief at the costs families feel most.","Fund it through spending discipline, not new taxes.","Measure the household impact and publish it."],
      action:"Sign the cost-of-living petition and share your monthly numbers."
    }
  },
  {
    n:4, id:"public-safety", cat:"safety", ic:"shield", stage:"active", status:"Research Coming Soon",
    title:"No Tolerance for Crime",
    summary:"Violent crime is rising in British Columbia and appears increasingly tolerated with weak consequences. This research will examine who is dropping the ball — lenient judges, under-resourced police and prosecutors, or federal and provincial policies that have reduced deterrence. It will also assess whether solutions such as building more prisons, hiring more judges, and tougher enforcement are needed.",
    research:{
      context:"This issue is actively being researched by our civic team. Lived experiences and verified data from court records and police files will be posted here as they are reviewed.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Violent crime is rising in British Columbia and appears increasingly tolerated with weak consequences.",
      alternative:"Establish strict deterrence, restore frontline resources, and audit judicial outcomes.",
      outcome:"Safer streets, transit systems, and public spaces through consistent enforcement and real accountability.",
      recs:[
        "Audit judicial decisions on repeat offenses and publish safety scorecards.",
        "Ensure police and prosecutors are fully resourced to enforce the law.",
        "Assess prison capacity and rehabilitation program success rates."
      ],
      action:"Sign the public safety pledge to demand judicial accountability."
    }
  },
  {
    n:5, id:"taxes", cat:"economy", ic:"coin", stage:"draft", status:"Research Coming Soon",
    title:"Stop Punishing Work",
    summary:"High, complex taxes drive investment and talent out of the province. We are mapping the real burden on workers and small businesses.",
    research:{
      context:"This issue page is a working draft showing the research-to-policy flow. Verified findings and recommendations will replace this placeholder.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"High, complex taxes drive investment and talent out of the province.",
      alternative:"Simplify and lower the burden on workers and small business owners.",
      outcome:"More jobs created and kept in BC, and a broader, healthier tax base.",
      recs:["Simplify the tax workers and small businesses actually face.","Lower the burden where it does the most harm to jobs.","Show the trade-offs transparently."],
      action:"Use the tax-impact calculator and send the result to your MLA."
    }
  },
  {
    n:6, id:"energy", cat:"energy", ic:"bolt", stage:"active", status:"Research Coming Soon",
    title:"True North resources, True North benefits",
    summary:"Western Canada possesses significant energy resources with strong demand in Global markets. However, the federal north coast crude tanker moratorium, regulatory delays, and uncertainties around Indigenous consent under DRIPA block the pipelines and refining capacity needed for efficient exports. Royalty revenues flow entirely into general government spending rather than direct citizen dividends like Alaska’s Permanent Fund.",
    research:{
      context:"This energy project is actively being researched by our team to establish a path forward for Western Canada's resources.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Tanker moratoriums, regulatory delays, and DRIPA consent barriers block pipelines and refining capacity needed for resource exports, while royalty revenues disappear into general government spending.",
      alternative:"Establish predictable permitting timelines, clear consent frameworks, and direct royalty revenues into citizen dividends.",
      outcome:"A strong resource export economy combined with direct financial dividends for all citizens.",
      recs:[
        "Reform regulatory processes to guarantee predictable permitting decisions.",
        "Establish a direct citizen dividend fund modeled on Alaska's Permanent Fund.",
        "Clarify DRIPA consent protocols to align stakeholders early."
      ],
      action:"Support the resource reform letter and dividend plan."
    }
  },
  {
    n:7, id:"education", cat:"book", ic:"book", stage:"draft", status:"Research Coming Soon",
    title:"Trades at Sixteen",
    summary:"Students are funneled toward debt, not the skills BC actually needs. We are gathering the data on pathways and outcomes.",
    research:{
      context:"This issue page is a working draft showing the research-to-policy flow. Verified findings and recommendations will replace this placeholder.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Students are funneled toward debt, not the skills BC actually needs.",
      alternative:"Early apprenticeship pathways, real standards, and school choice.",
      outcome:"A pipeline of tradespeople and graduates ready for real careers.",
      recs:["Open early-apprenticeship pathways in high school.","Hold real, measurable standards.","Give families genuine choice."],
      action:"Ask your school board to back early-apprenticeship options."
    }
  },
  {
    n:8, id:"governance", cat:"gov", ic:"scale", stage:"draft", status:"Research Coming Soon",
    title:"Every Dollar Accounted For",
    summary:"Citizens cannot see how their money is spent or who decided. We are testing how open the public record really is.",
    research:{
      context:"This issue page is a working draft showing the research-to-policy flow. Verified findings and recommendations will replace this placeholder.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Citizens cannot see how their money is spent or who decided.",
      alternative:"Open, real-time disclosure of major government spending.",
      outcome:"Less waste, more trust, and decisions that can be questioned.",
      recs:["Disclose major spending in close to real time.","Make the decision-maker visible for every major call.","Give the public usable FOI tools."],
      action:"Support the transparency brief and file an FOI with our toolkit."
    }
  },
  {
    n:9, id:"healthcare", cat:"health", ic:"heart", stage:"active", status:"Research Coming Soon",
    title:"Patients First, Results First",
    summary:"British Columbia’s public healthcare system is failing patients with excessively long wait times for both routine and specialized care, often stretching six months or more and creating widespread stress and uncertainty. Health authorities are burdened with excessive layers of administrators and bureaucrats while front-line capacity remains strained. Patient data security is also poorly managed across the system.",
    research:{
      context:"Our research team is documenting B.C.'s healthcare delivery bottlenecks, wait times, and administrative overlays.",
      findings:DRAFT_FINDINGS, stakeholders:DRAFT_STAKEHOLDERS
    },
    policy:{
      problem:"Excessive wait times, top-heavy health bureaucracies, frontline staffing capacity issues, and poorly managed patient data systems.",
      alternative:"Re-allocate funding from administrative layers directly to frontline patient care and streamline diagnostic/treatment waits.",
      outcome:"Shorter waits for routine/specialized care and high standards of patient data security.",
      recs:[
        "Streamline healthcare boards and transfer administrative savings to frontline hiring.",
        "Publish transparent, weekly wait times for all key clinical procedures.",
        "Implement modern, secure patient data platforms across all health authorities."
      ],
      action:"Add your name to the patient outcomes mandate."
    }
  }
];

/* ====================== FAQ ====================== */
WCH.FAQS = [
  {q:"Is Western Charter House a political party?", a:"No. We are an independent, non-partisan civic institution. We research issues, publish principled policy, and build a lasting public record of where British Columbia stands, regardless of party."},
  {q:"Does it cost anything to sign up?", a:"No. Signing up is completely free. We take no government funding; the work is backed independently. We just ask for your name, your riding, and a way to reach you."},
  {q:"Why do you ask for my riding?", a:"British Columbia has 93 electoral districts. Knowing yours lets us connect you to the people organizing where you live and send you updates and action that actually apply to your MLA."},
  {q:"What happens after I sign up?", a:"You start getting briefings on the issues in your district, and an invitation to your riding's channel so you can follow the research, the policy work, and the issues that matter where you live."},
  {q:"How is my information used?", a:"Only to keep you informed and to organize locally. We never sell your data, and you can unsubscribe at any time."}
];
