-- 0667: the Learning commands are in the activity allowlist (B91, after 0625; B90 phase 4).
--
-- Every run of a command from a screen, the search box (palette) or Niva is recorded under its own key, assistant.<area>_<verb>, with
-- commandable_key set to the command, so a pattern made only of command steps can be proposed as "something Niva could do" (0625 did
-- this for the first eight commands; src/lib/commands/activity.ts builds the key). These are the ten Learning commands, all about
-- terms, levels, fees, classes and teachers (adults): five that look (a term's setup, what is missing before registration opens,
-- classes with no teacher, what is waiting, the fee totals), two that prepare (a change to a term, a teacher for a class) and three
-- that change something once a person confirms (assign a teacher, add or change a class, change the fees of levels). None of them
-- touches a learner (decision D2). Without a row a run of a command is dropped by app.record_activity, so nothing would be recorded.
--
-- It only registers keys: no table, column, policy or permission changes. Nothing is recorded anywhere until a community's own
-- administrator has agreed (0621). Idempotent: the registration is an upsert.
--
-- The label is what an administrator reads in Settings > Automation ideas: it finishes "After you ...", so it is a plain verb phrase.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.learning_term_setup',              'Look at the levels, fees and rules of a term',       'learning.term_setup'),
    ('assistant.learning_registration_checklist',  'Check what is missing before registration opens',   'learning.registration_checklist'),
    ('assistant.learning_classes_needing_teachers','Look at which classes need a teacher',              'learning.classes_needing_teachers'),
    ('assistant.learning_waiting_counts',          'Look at how many Pathshala tasks are waiting',      'learning.waiting_counts'),
    ('assistant.learning_fee_report',              'Look at the Pathshala fee totals',                  'learning.fee_report'),
    ('assistant.learning_draft_term_change',       'Prepare a change to the setup of a term',         'learning.draft_term_change'),
    ('assistant.learning_draft_teacher_assignment','Prepare a teacher for a class',                     'learning.draft_teacher_assignment'),
    ('assistant.learning_assign_teacher',          'Assign a teacher to a class',                       'learning.assign_teacher'),
    ('assistant.learning_save_class',              'Add or change a class',                             'learning.save_class'),
    ('assistant.learning_set_level_fees',          'Change the fees of Pathshala levels',               'learning.set_level_fees')
  ) as v(k, l, c);
