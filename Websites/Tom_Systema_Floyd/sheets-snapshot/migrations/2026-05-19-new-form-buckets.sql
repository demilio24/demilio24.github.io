-- Allow the new booking forms (Private Lessons, Rent-A-Sensei, Balloons,
-- Vladimir Vasiliev Seminar) to write into public.sf_form_submissions.
--
-- Apply via the Supabase SQL editor or `apply_migration` MCP tool when
-- you're ready to activate the new-form wiring in DiscrepancyCheck.js.
-- Until then the bot's `_dcCheck<Form>()` helpers all early-return on
-- empty form IDs, so this constraint expansion is decoupled from any
-- live writes.
--
-- Rollback: drop the new constraint, restore the old one:
--   ALTER TABLE public.sf_form_submissions
--     DROP CONSTRAINT sf_form_submissions_form_check,
--     ADD CONSTRAINT sf_form_submissions_form_check
--       CHECK (form IN ('free_camp','summer_camp','after_school'));

ALTER TABLE public.sf_form_submissions
  DROP CONSTRAINT IF EXISTS sf_form_submissions_form_check;

ALTER TABLE public.sf_form_submissions
  ADD CONSTRAINT sf_form_submissions_form_check
    CHECK (form IN (
      'free_camp',
      'summer_camp',
      'after_school',
      'private_lessons',
      'rent_a_sensei',
      'balloons',
      'vasiliev_seminar'
    ));

-- Sanity check, should return 7:
-- SELECT array_length(
--   regexp_split_to_array(consrc, ''''), 1
-- ) FROM pg_constraint WHERE conname = 'sf_form_submissions_form_check';
