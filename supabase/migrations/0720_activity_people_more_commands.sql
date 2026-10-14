-- 0720 · Activity: the People "More" commands are recorded under their own keys (People redesign slice 5, docs/PEOPLE_REDESIGN.md).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Four actions on the People screens become commands that the screens, the search box (palette) and Niva share:
--     people.mark_deceased     record that a person has passed away       (only the person's own screen; Niva never)
--     people.set_primary       change a household's primary member       (only the person's own screen; Niva never)
--     people.add_identifier    add another system's number or name to a household or person
--     people.retire_identifier retire such an identifier (a reason is now required)
--   This lists them in the activity allowlist, the same way 0625 and 0651 listed the commands before them, so that their runs are
--   recorded under assistant.<area>_<verb> (with commandable_key set to the command) and so that the screens' own buttons are
--   recorded under people.<verb>. Without a row the database drops the event.
--
--   It only registers keys: no table, column, function, policy or permission changes. Nothing is recorded anywhere until a
--   community's own administrator has agreed (0621). Idempotent: the registrations are upserts, so running the file again changes
--   nothing.

-- key = "assistant." + the command key with its dot written as an underscore (src/lib/commands/activity.ts). The label is what an
-- administrator reads in Settings > Automation ideas: it finishes the sentence "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.people_mark_deceased',     'Record that a person has passed away',            'people.mark_deceased'),
    ('assistant.people_set_primary',       'Change who is the primary member of a household', 'people.set_primary'),
    ('assistant.people_add_identifier',    'Add an identifier to a household or person',      'people.add_identifier'),
    ('assistant.people_retire_identifier', 'Retire an identifier',                            'people.retire_identifier')
  ) as v(k, l, c);

-- The screens' own buttons (withActivity in the Server Actions), like people.update_person in 0620.
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('people.mark_deceased',     'Record that a person has passed away',            'person'),
    ('people.set_primary',       'Change who is the primary member of a household', 'household'),
    ('people.add_identifier',    'Add an identifier to a household or person',      'household'),
    ('people.retire_identifier', 'Retire an identifier',                            'identifier')
  ) as v(k, l, e);
