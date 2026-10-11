-- 0632: the matching questions, part 3 of 3 — what the portal records about them (B87, B91).
--
-- The screen of the matching questions (Setup > Guided onboarding > Questions) and the four things a person does there are
-- recorded in the activity stream under their own keys, so the stream can show how often a suggestion is taken and where people
-- stop. Without a row here an event with the key is dropped by app.record_activity, silently, so nothing would be recorded (0620).
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). The keys carry no value, name or answer: only what was done and whether it worked.
-- Idempotent: the registration is an upsert.
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('onboarding.find_matches',    'Look for matches in an import',                  'import_run'),
    ('onboarding.answer_question', 'Answer a matching question',                     'import_run'),
    ('onboarding.defer_question',  'Put off, skip or pass on a matching question',   'import_run'),
    ('onboarding.reopen_question', 'Reopen a matching question',                     'import_run')
  ) as v(k, l, e);

select app.activity_register('screen:/setup/onboarding/questions', 'screen', 'portal', 'Matching questions', null);
