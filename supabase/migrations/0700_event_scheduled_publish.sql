-- 0700: publish an event at a chosen time (the event creator's flyer and publish panel, 2026-10-11).
--
-- Owner: "need the flyer draft immediately. There, give the option to publish / schedule to publish on all channels". The
-- channels Weaver has today (the member app, the community calendar and the guest web page) all come from one change: the
-- event's status moving from draft to published. This adds the timer for that change, nothing else.
--
--   A. events.publish_at (when a person asked for the draft to be published) and events.publish_failure (why a scheduled
--      publish did not happen, in a plain sentence, until the person schedules or publishes again).
--   B. A trigger: an event that leaves draft (published by hand, cancelled, ...) forgets its schedule, so the background
--      service can never publish something twice or bring a cancelled event back.
--   C. app.worker_events_publish_due(limit): the background service's call (job events.publish_due, every 5 minutes). Each
--      due event is checked again at that moment with the same rules the portal applies before it publishes (the status
--      rule draft -> published, src/lib/events/status-machine.ts, and the publish blockers of src/lib/events/readiness.ts),
--      plus the flyer approval: the flyer a person approved must still be the event's flyer and still show the event's
--      name, date and venue. An event that was edited into a state that cannot be published is NOT published: its schedule
--      is cleared and the reason kept in publish_failure, which the panel shows with Try again.
--
-- Access is unchanged: publish_at is a column of app.events, so the existing policies decide who may set it (the people who
-- may edit the event, events.manage or the event's lead, the same people who may publish it). The worker function is the
-- worker role's alone. No money, no deletes. The flyer approval itself is kept inside events.flyer_design (key "approval",
-- written by the portal when a person approves the flyer), so it needs no column.
--
-- Idempotent: if not exists / create or replace / drop ... if exists.

-- ── A. The columns ────────────────────────────────────────────────────────────
alter table app.events add column if not exists publish_at timestamptz;
alter table app.events add column if not exists publish_failure text;
alter table app.events drop constraint if exists events_publish_failure_check;
alter table app.events add constraint events_publish_failure_check
  check (publish_failure is null or char_length(publish_failure) between 1 and 400);

comment on column app.events.publish_at is
  'When the draft event is to be published by the background service (job events.publish_due, 0700), in UTC; null when nothing is scheduled. Set and cleared by the people who may edit the event; cleared by itself when the event leaves draft.';
comment on column app.events.publish_failure is
  'Why the scheduled publish did not happen (0700): a plain sentence the event creator shows with Try again. Cleared when the event is scheduled or published again.';

create index if not exists events_publish_due_idx on app.events (publish_at) where publish_at is not null;

-- ── B. An event that leaves draft forgets its schedule ───────────────────────
create or replace function app.events_forget_publish_schedule() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if new.status::text <> 'draft' then
    new.publish_at := null;
    if new.status::text in ('published', 'rsvp_closed', 'live', 'completed') then new.publish_failure := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists events_forget_publish_schedule on app.events;
create trigger events_forget_publish_schedule before insert or update of status, publish_at on app.events
  for each row execute function app.events_forget_publish_schedule();

-- ── C. The background service's call ─────────────────────────────────────────
-- Why this event cannot be published now, in a plain sentence, or null when it can. The same blockers as the portal's
-- readiness list for publishing (readiness.ts), in the same order, then the flyer approval.
create or replace function app._event_publish_problem(e app.events) returns text
language plpgsql stable set search_path = app, public, extensions as $$
declare v_made jsonb; v_approval jsonb; v_starts timestamptz; v_ends timestamptz;
begin
  if e.status::text <> 'draft' then
    return format('it is %s now, so it was not published again.', replace(e.status::text, '_', ' '));
  end if;
  if btrim(coalesce(e.name, '')) = '' then return 'it has no name.'; end if;
  if e.starts_at is null then return 'it has no start date and time.'; end if;
  if e.starts_at <= now() then return 'its start time had already passed.'; end if;
  if e.ends_at is not null and e.ends_at <= e.starts_at then return 'it is set to end before it starts.'; end if;
  if e.rsvp_opens_at is not null and e.rsvp_closes_at is not null and e.rsvp_closes_at <= e.rsvp_opens_at then
    return 'RSVPs are set to close before they open.';
  end if;
  if e.rsvp_closes_at is not null and e.rsvp_closes_at < now() then return 'RSVPs were set to close before the publish time.'; end if;
  if e.lunch_enabled and e.lunch_starts_at is null then return 'lunch is switched on but has no start time.'; end if;
  if e.is_paid and e.member_price_cents is null then return 'it is a paid event with no member price.'; end if;

  v_approval := case when jsonb_typeof(e.flyer_design -> 'approval') = 'object' then e.flyer_design -> 'approval' end;
  if e.flyer_source is distinct from 'designed' or e.flyer_path is null or v_approval is null then
    return 'its flyer is no longer the one that was approved (it was changed or removed). Approve the flyer again.';
  end if;
  if (v_approval ->> 'name') is distinct from e.name then
    return 'its name changed after the flyer was approved, so the flyer shows the old name. Approve the flyer again.';
  end if;
  v_made := case when jsonb_typeof(e.flyer_design -> 'made_for') = 'object' then e.flyer_design -> 'made_for' end;
  if v_made is null then return 'the approved flyer does not record the date and venue it was made for. Approve the flyer again.'; end if;
  begin
    v_starts := nullif(v_made ->> 'starts_at', '')::timestamptz;
    v_ends := nullif(v_made ->> 'ends_at', '')::timestamptz;
  exception when others then
    return 'the approved flyer''s record could not be read. Approve the flyer again.';
  end;
  if v_starts is distinct from e.starts_at or v_ends is distinct from e.ends_at then
    return 'its date or time changed after the flyer was approved, so the flyer shows the old date. Approve the flyer again.';
  end if;
  if coalesce(v_made ->> 'venue', '') is distinct from btrim(regexp_replace(coalesce(e.venue, ''), '\s+', ' ', 'g')) then
    return 'its venue changed after the flyer was approved, so the flyer shows the old venue. Approve the flyer again.';
  end if;
  return null;
end $$;

create or replace function app.worker_events_publish_due(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  e app.events;
  v_problem text;
  v_published integer := 0;
  v_refused integer := 0;
  v_seen integer := 0;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Scheduled publish: an event published at the time a person chose');
  for e in
    select * from app.events
     where publish_at is not null and publish_at <= now()
     order by publish_at, id
     limit v_limit
     for update skip locked
  loop
    v_seen := v_seen + 1;
    v_problem := app._event_publish_problem(e);
    if v_problem is null then
      update app.events set status = 'published', publish_at = null, publish_failure = null where id = e.id;
      v_published := v_published + 1;
    else
      update app.events
         set publish_at = null,
             publish_failure = left('Not published at the scheduled time: ' || v_problem, 400)
       where id = e.id;
      v_refused := v_refused + 1;
    end if;
  end loop;
  return jsonb_build_object('published', v_published, 'refused', v_refused, 'more', v_seen >= v_limit);
end $$;

comment on function app.events_forget_publish_schedule() is
  'Trigger (0700): an event that is not a draft has no publish schedule; one that is published or later also forgets an old failure.';
comment on function app._event_publish_problem(app.events) is
  'Why a draft event cannot be published now (0700), or null: the portal''s publish blockers (readiness.ts) and the flyer approval (flyer_design.approval, made_for). Not callable over the API.';
comment on function app.worker_events_publish_due(integer) is
  'The worker role only (job events.publish_due, 0700): publishes the draft events whose publish_at has come, each checked again first; one that cannot be published keeps its draft status and gets publish_failure. Returns {published, refused, more}.';

revoke execute on function app.events_forget_publish_schedule() from public, anon, authenticated;
revoke execute on function app._event_publish_problem(app.events) from public, anon, authenticated;
grant execute on function app._event_publish_problem(app.events) to service_role;
revoke execute on function app.worker_events_publish_due(integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_events_publish_due(integer) to connect_worker;
