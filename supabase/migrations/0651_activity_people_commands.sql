-- 0651 · Activity: the People commands are recorded under their own keys (backlog B91, B90 phase 4 People).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0625 listed the eight commands of the command layer in the activity allowlist, so that every run of a command, from a
--   screen, the search box (palette) or Niva, is recorded under its own key, assistant.<area>_<verb>, with commandable_key set
--   to the command. The People workspace now has thirteen more commands (src/lib/commands/catalog/people). This lists them the
--   same way, so their runs are recorded too and a pattern made only of command steps can be proposed as "something Niva could
--   do". Nothing is recorded anywhere until a community's own administrator has agreed (0621); this changes no behaviour by
--   itself, no table, column, policy or permission.
--
--   Idempotent: the registrations are upserts, so running the file again changes nothing.

-- key = "assistant." + the command key with its dot written as an underscore (src/lib/commands/activity.ts). The label is what
-- an administrator reads in Settings > Automation ideas: it finishes the sentence "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.people_find_household',           'Look up a household by an ID',                 'people.find_household'),
    ('assistant.people_household_summary',        'Look at a household and its IDs',              'people.household_summary'),
    ('assistant.people_pending_reviews',          'Look at the applications and requests waiting', 'people.pending_reviews'),
    ('assistant.people_suggest_duplicates',       'Look at the suggested duplicates',             'people.suggest_duplicates'),
    ('assistant.people_add_person',               'Add a person to a household',                  'people.add_person'),
    ('assistant.people_update_person',            'Change the details of a person',               'people.update_person'),
    ('assistant.people_move_person',              'Move a person to another household',           'people.move_person'),
    ('assistant.people_update_household',         'Change the details of a household',            'people.update_household'),
    ('assistant.people_merge_people',             'Merge two records of the same person',         'people.merge_people'),
    ('assistant.people_merge_households',         'Merge two duplicate households',               'people.merge_households'),
    ('assistant.people_dismiss_duplicate',        'Mark a suggested pair as not a duplicate',     'people.dismiss_duplicate'),
    ('assistant.people_decide_application',       'Decide a membership application',              'people.decide_application'),
    ('assistant.people_decide_household_request', 'Decide a family change request',               'people.decide_household_request')
  ) as v(k, l, c);
