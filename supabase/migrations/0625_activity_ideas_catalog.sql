-- 0625 · Activity: the portal side of the automation pipeline (backlog B91, stacked on 0620-0623).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0620-0623 built the recorder, the miner and the views in the database. This adds what the portal needs from them:
--     1. The allowlist gets the keys the portal now records that 0620 did not list, so they are no longer dropped:
--          * the eight commands of the command layer (src/lib/commands/catalog): every run of a command, from a screen, the
--            search box (palette) or Niva, is recorded under its own key, assistant.<area>_<verb>, with commandable_key set
--            to the command, so a pattern made only of command steps can be proposed as "something Niva could do";
--          * the two portal actions that had no key (approving a newsletter, recording an in-person pledge);
--          * the two new screens: Settings › Automation ideas and Platform › Automation backlog.
--     2. app.set_activity_recording also keeps WHEN the community's recording last changed (rules.activity.since), so
--        Platform › Centers can say "On since 12 Oct". The reason the platform admin gives travels with the change into the
--        audit log (the portal sends it as the audit reason); this function does not take it.
--   Nothing is recorded anywhere until a platform admin switches a community on (0621): this changes no behaviour by itself.
--
--   Idempotent: the registrations are upserts and the function is replaced, so running the file again changes nothing.

-- ── The community's switch also keeps its date ───────────────────────────────
-- since = when the switch last CHANGED (on to off or off to on), as an ISO time in UTC. Setting the value it already has
-- changes nothing (the date stays). Same contract as 0621: platform admins only; the grants below repeat 0621's.
create or replace function app.set_activity_recording(p_center uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_was boolean; v_now boolean := coalesce(p_enabled, false);
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Weaver team can switch activity recording on or off.' using errcode = '42501';
  end if;
  select coalesce((c.rules -> 'activity' ->> 'enabled') = 'true', false) into v_was from app.centers c where c.id = p_center;
  if not found then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  update app.centers c
     set rules = jsonb_set(coalesce(c.rules, '{}'::jsonb), '{activity}',
                           (case when jsonb_typeof(c.rules -> 'activity') = 'object' then c.rules -> 'activity' else '{}'::jsonb end)
                           || jsonb_build_object('enabled', v_now)
                           || (case when v_was is distinct from v_now
                                    then jsonb_build_object('since', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                                    else '{}'::jsonb end), true)
   where c.id = p_center;
end $$;
comment on function app.set_activity_recording(uuid, boolean) is 'Platform admins only: switch a community''s activity recording on or off (0621). Stamps rules.activity.since when the value changes (0625). The reason is the audit reason of the call.';

revoke execute on function app.set_activity_recording(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function app.set_activity_recording(uuid, boolean) to authenticated;

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
