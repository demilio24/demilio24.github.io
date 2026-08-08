# demilio24.github.io (legacy Pages serving shim)

**Purpose:** emergency restore, created 2026-08-08. When `demilio24/Websites`
went private on 2026-08-03 (free plan), GitHub stopped serving its Pages site
and every GoHighLevel page that iframes `demilio24.github.io/Websites/...`
went blank (nilsdigital.com home, presentation, marketing, VSL, onboarding,
terms, Floyd dashboard embeds).

This user-site repo re-serves the exact `Websites` tree from
`demilio24/Websites@f108d4dd84` (the last commit that was live) under the
same `/Websites/...` paths. GitHub routes those paths here because the
private repo's project site is unpublished.

**Excluded from the original tree:** `.claude/`, `.github/`, `docs/`,
`NILS-SKILLS/`, `scripts/`, `supabase/`, internal markdown (PROJECT/HANDOFF/
README/session notes), Floyd `billing-app` + `supabase` backend code,
Lowcountry `Contacts/` import scripts, VeLUS `comparisons/` originals.
GoHighLevel Private Integration Tokens found embedded in 6 files were
replaced with `PIT-REMOVED-ROTATE-ME` (rotate them in GHL; they were public
since the pages first shipped).

**Teardown criteria:** delete this repo once every GHL page embed has been
re-pointed to the `NILS-DIGITAL-COM` org Pages URLs (the repo transition's
end state) and a full-funnel sweep shows zero `demilio24.github.io`
references. Until then, do not rename or make this repo private: the live
funnels depend on it.
