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
--   It changes no table, column or policy. The one function it replaces is the guard on centers.rules (below), and only the
--   wording of its two refusals: they sent people to "the Privacy page", but the agreement is made on Settings › Automation
--   ideas. Who may agree, who may switch recording and who may see what stay exactly as 0621 to 0623 define them.
--
--   Idempotent: the registrations are upserts and the function is replaced, so running the file again changes nothing.

-- ── The guard on centers.rules: where the refusals point ─────────────────────
-- Copied from 0621 as it is applied; the only change is the place named in the two messages. Same signature, same
-- security definer and pinned search path; the trigger centers_activity_guard keeps using it, and nobody may call it.
create or replace function app.centers_activity_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_old jsonb := case when jsonb_typeof(old.rules -> 'activity') = 'object' then old.rules -> 'activity' else '{}'::jsonb end;
  v_new jsonb := case when jsonb_typeof(new.rules -> 'activity') = 'object' then new.rules -> 'activity' else '{}'::jsonb end;
begin
  -- The database owner, the background service and migrations (no signed-in person), and the agreement functions below,
  -- which have checked who may do it.
  if auth.uid() is null or coalesce(current_setting('app.activity_apply', true), '') = 'on' then return new; end if;
  -- An ordinary write by a signed-in person may not touch the agreement or the sharing.
  if (v_new - 'enabled') is distinct from (v_old - 'enabled') then
    raise exception 'Agreeing to activity recording, and sharing it with Weaver, is done on Settings > Automation ideas with a 2FA check, not by editing the rules.'
      using errcode = '42501';
  end if;
  -- ... nor the switch, except that a platform admin may switch it off.
  if (v_new ->> 'enabled') is distinct from (v_old ->> 'enabled') then
    if not (app.is_platform_admin() and coalesce(v_new ->> 'enabled', 'false') <> 'true') then
      raise exception 'Activity recording is switched on or off on Settings > Automation ideas by the community''s administrator, not by editing the rules.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.centers_activity_guard() from public, anon, authenticated, service_role;

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
