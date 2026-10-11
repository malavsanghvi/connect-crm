-- 0655: the Events commands in the activity allowlist (B91, after 0625; B90 phase 4).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>,
-- with commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do"
-- (0625 did this for the first eight commands; src/lib/commands/activity.ts builds the key). These are the nine Events commands
-- added with 0653 and 0654. Without a row a run of the command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.events_summary',          'Look at how an event is doing',              'events.summary'),
    ('assistant.events_readiness',        'Check what is blocking an event going live', 'events.readiness'),
    ('assistant.events_audience_preview', 'Preview who a reminder would reach',         'events.audience_preview'),
    ('assistant.events_rsvps',            'Look at the RSVPs of an event',              'events.rsvps'),
    ('assistant.events_clone_draft',      'Prepare a copy of an earlier event',         'events.clone_draft'),
    ('assistant.events_set_status',       'Change the status of an event',              'events.set_status'),
    ('assistant.events_set_rsvp_status',  'Change the RSVP of a family',                'events.set_rsvp_status'),
    ('assistant.events_assign_volunteer', 'Assign a volunteer to a shift',              'events.assign_volunteer'),
    ('assistant.events_create_from_clone','Create a draft event from an earlier one',    'events.create_from_clone')
  ) as v(k, l, c);
