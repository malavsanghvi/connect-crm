-- 0625 · Activity: the portal side of the automation pipeline (backlog B91, stacked on 0620-0623).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0620-0623 built the recorder, the community's agreement, the miner and the views in the database. This adds the keys the
--   portal needs in the allowlist, so that what it records is no longer dropped:
--     * the eight commands of the command layer (src/lib/commands/catalog): every run of a command, from a screen, the
--       search box (palette) or Niva, is recorded under its own key, assistant.<area>_<verb>, with commandable_key set to the
--       command, so a pattern made only of command steps can be proposed as "something Niva could do";
--     * the two portal actions that had no key (approving a newsletter, recording an in-person pledge);
--     * the two new screens: Settings › Automation ideas and Platform › Automation backlog.
--   Nothing is recorded anywhere until a community's own administrator has agreed (0621): this changes no behaviour by itself.
--   It changes no table, column, policy or function; the community's agreement, who may switch recording and who may see
--   what stay exactly as 0621 to 0623 define them.
--
--   Idempotent: the registrations are upserts, so running the file again changes nothing.

-- ── The command layer's commands ─────────────────────────────────────────────
-- key = "assistant." + the command key with its dot written as an underscore (src/lib/commands/activity.ts). The label is
-- what an administrator reads in Settings › Automation ideas: it finishes the sentence "After you ...", so it is a plain
-- verb phrase. commandable_key is the command itself.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.people_search',                  'Search people and households',          'people.search'),
    ('assistant.tasks_mine',                     'Look at your tasks',                    'tasks.mine'),
    ('assistant.events_upcoming',                'Look at upcoming events',               'events.upcoming'),
    ('assistant.giving_pledges_behind',          'Look at who is behind on pledges',      'giving.pledges_behind'),
    ('assistant.accounting_month_close_blockers','Check what is blocking month-end close', 'accounting.month_close_blockers'),
    ('assistant.messages_draft_reminder',        'Draft an event reminder',               'messages.draft_reminder'),
    ('assistant.events_draft_change',            'Draft a change to an event',            'events.draft_change'),
    ('assistant.events_set_field',               'Change a detail of an event',           'events.set_field')
  ) as v(k, l, c);

-- ── Two portal actions that had no key ───────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('comms.approve_campaign', 'Approve a newsletter', 'message'),
    ('bolis.record_pledge',    'Record an in-person pledge', 'boli')
  ) as v(k, l, e);

-- ── The two new screens ──────────────────────────────────────────────────────
select app.activity_register(v.k, 'screen', 'portal', v.l, null)
  from (values
    ('screen:/settings/automation', 'Automation ideas'),
    ('screen:/platform/automation', 'Platform: automation backlog')
  ) as v(k, l);
