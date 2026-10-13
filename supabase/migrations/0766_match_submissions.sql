-- 0766 · CatchTheMatch slice 2, part 2: what members know about an employer's program, sent to the shared directory and
-- checked before it counts (docs/CATCH_THE_MATCH.md section 7; B63 steps 1 and 2; owner answers of 2026-10-13). Builder MATCH2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.match_program_submissions   one row per thing someone told the community about an employer's program: the facts in
--                                   the directory's shape (0765), an optional note, which entry it would change (or none: a
--                                   company not in the directory yet), who sent it, and what was decided. From the portal now
--                                   (staff entering what a member told them); from the member app later (channel member_app).
--   A submission is the COMMUNITY'S OWN record (0757's contract): module 'matching', read only by the community's own
--   CatchTheMatch readers (matching.view or matching.manage: app.matching_org_readable_centers, 0765; NOT Weaver's filing
--   grant, which is for claims), a restrictive module_switch with no platform-admin pass, app.audit_private_row.
--   Weaver's team sees submissions only through app.platform_match_submissions: the facts, the note and the community's NAME,
--   never who sent, forwarded or decided it (owner, 2026-10-13: Weaver sees the submitting community's name, never the person).
--
--   SENDING: app.submit_match_program(center, entry or null, facts, note): the community's matching.view or matching.manage
--   holders. At most 200 waiting per community. Only Weaver's team may name a licensed database ('partner') as the source.
--   DECIDING: app.decide_match_submission(submission, decision, facts, reason, into entry, into submission)
--     approve    the facts (as sent, or as edited by the decider) go into the directory: a new entry, or the entry it changes
--                (the entry is locked and checked again in the same transaction).
--                By the community's CatchTheMatch manager (matching.manage, its own community's submissions only): published at
--                once, marked "verified by a community" with today's date, within these limits; otherwise FORWARDED to Weaver's
--                team with the manager's edits and the reason (forwarded_because):
--                  paused            Weaver's team paused this community's publishing (app.set_match_publishing)
--                  retired           the entry has ended (or the facts would bring back an ended entry's name)
--                  weaver_checked    Weaver's team checked the entry
--                  other_community   another community verified the entry: a community changes only what it verified
--                  links_changed     the portal's link or the source's link would be new or different
--                  near_duplicate    a new company whose name contains, or is contained in, a name of an entry Weaver's
--                                    team checked (the shorter at least 3 characters)
--                  name_in_use       a name another entry goes or went by (a retired alias, a merged entry)
--                A name of another ACTIVE entry is refused outright (mark it a duplicate, or approve into that entry).
--                At most app.match_publishing_cap(center) approvals that publish per community per day (20 unless Weaver's
--                team sets another; the community's own calendar day).
--                By Weaver's team (any community's, waiting or forwarded): published, marked checked by Weaver's team.
--     reject     with a reason the community sees.
--     duplicate  it repeats a directory entry or another submission: marked merged, pointing at it.
--   app.match_publishing_controls   Weaver's switch per community: publishing paused (with a reason) and the daily cap.
--   For Weaver's team: app.platform_match_recent_publishes (what communities published lately, to check),
--   app.platform_match_communities (each community's publishing, pause and cap). Every change to the directory is in its
--   own history and versions (0765) with the community named, never the person; every change to a submission is in the
--   community's private audit.
set client_min_messages = warning;

create table if not exists app.match_program_submissions (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  -- The directory entry it would change; null: a company not in the directory yet.
  program_id        uuid references app.match_programs(id),
  proposal          jsonb not null check (jsonb_typeof(proposal) = 'object'),
  note              text check (note is null or char_length(note) between 1 and 1000),
  channel           text not null default 'portal' check (channel in ('portal', 'member_app')),
  submitted_by      uuid not null references auth.users(id),
  submitted_at      timestamptz not null default now(),
  status            text not null default 'pending' check (status in ('pending', 'forwarded', 'approved', 'rejected', 'merged')),
  -- The community manager's version when it was forwarded to Weaver's team; the version published when approved.
  reviewed          jsonb check (reviewed is null or jsonb_typeof(reviewed) = 'object'),
  forwarded_by      uuid references auth.users(id),
  forwarded_at      timestamptz,
  forward_note      text check (forward_note is null or char_length(forward_note) between 1 and 500),
  forwarded_because text check (forwarded_because is null or forwarded_because in
                                ('paused', 'retired', 'weaver_checked', 'other_community', 'links_changed', 'near_duplicate', 'name_in_use')),
  decided_kind      text check (decided_kind is null or decided_kind in ('community', 'weaver')),
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_reason   text check (decision_reason is null or char_length(decision_reason) between 1 and 500),
  result_program_id uuid references app.match_programs(id),
  duplicate_of      uuid references app.match_program_submissions(id) on delete set null,
  constraint match_program_submissions_open check (
    (status in ('pending', 'forwarded')) = (decided_at is null)
    and (decided_at is null) = (decided_kind is null) and (decided_at is null) = (decided_by is null)),
  constraint match_program_submissions_forwarded check (status <> 'forwarded'
                                                        or (forwarded_at is not null and reviewed is not null and forwarded_because is not null)),
  constraint match_program_submissions_approved check (status <> 'approved' or result_program_id is not null),
  constraint match_program_submissions_rejected check (status <> 'rejected' or decision_reason is not null),
  constraint match_program_submissions_merged check (status <> 'merged' or result_program_id is not null or duplicate_of is not null),
  constraint match_program_submissions_not_itself check (duplicate_of is distinct from id)
);
create index if not exists match_program_submissions_center_idx on app.match_program_submissions (center_id, status, submitted_at desc);
create index if not exists match_program_submissions_open_idx on app.match_program_submissions (status, submitted_at)
  where status in ('pending', 'forwarded');
create index if not exists match_program_submissions_program_idx on app.match_program_submissions (program_id);
create index if not exists match_program_submissions_published_idx on app.match_program_submissions (center_id, decided_at)
  where status = 'approved' and decided_kind = 'community';
comment on table app.match_program_submissions is
  'What someone told a community about an employer''s matching program (0766, CatchTheMatch): the community''s own record (its own CatchTheMatch readers only, never Weaver''s filing grant; private audit). Weaver''s team sees the facts and the community''s name through platform_match_submissions, never who sent or decided it. Written only by submit_match_program / decide_match_submission.';

-- The shared directory's "verified by a community" points at the submission behind it (only that community can open it).
alter table app.match_programs drop constraint if exists match_programs_verified_submission_fk;
alter table app.match_programs add constraint match_programs_verified_submission_fk
  foreign key (verified_submission_id) references app.match_program_submissions(id) on delete set null;

drop trigger if exists audit_match_program_submissions on app.match_program_submissions;
create trigger audit_match_program_submissions after insert or update or delete on app.match_program_submissions
  for each row execute function app.audit_private_row('matching');
insert into app.module_tables (table_name, module_key) values ('match_program_submissions', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.match_program_submissions enable row level security;
-- The community's own CatchTheMatch readers: not Weaver's filing grant (the grant is for claims).
drop policy if exists match_program_submissions_read on app.match_program_submissions;
create policy match_program_submissions_read on app.match_program_submissions for select to authenticated
  using (center_id = any ((select app.matching_org_readable_centers())::uuid[]));
-- CatchTheMatch off: hidden from every direct read (no platform-admin pass).
drop policy if exists module_switch on app.match_program_submissions;
create policy module_switch on app.match_program_submissions as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
-- No write policies: only the functions below write.
revoke all on app.match_program_submissions from public, anon, authenticated;
grant select on app.match_program_submissions to authenticated;
grant all on app.match_program_submissions to service_role;

-- ── Weaver's switch per community ────────────────────────────────────────────
create table if not exists app.match_publishing_controls (
  center_id    uuid primary key references app.centers(id) on delete cascade,
  paused       boolean not null default false,
  pause_reason text check (pause_reason is null or (btrim(pause_reason) <> '' and char_length(pause_reason) <= 500)),
  daily_cap    integer not null default 20 check (daily_cap between 0 and 500),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  constraint match_publishing_controls_reason check (not paused or pause_reason is not null)
);
comment on table app.match_publishing_controls is
  'Weaver''s switch per community for the shared gift matching directory (0766): publishing paused (its approvals go to Weaver''s team) and the most approvals that publish per day (20 without a row). Written only by set_match_publishing.';
drop trigger if exists audit_match_publishing_controls on app.match_publishing_controls;
create trigger audit_match_publishing_controls after insert or update or delete on app.match_publishing_controls
  for each row execute function app.audit_row();
-- Core platform, like the filing grants (0758): Weaver's setting about the community, readable after CatchTheMatch is off.
insert into app.module_tables (table_name, module_key) values ('match_publishing_controls', null)
  on conflict (table_name) do update set module_key = excluded.module_key;
alter table app.match_publishing_controls enable row level security;
drop policy if exists match_publishing_controls_read on app.match_publishing_controls;
create policy match_publishing_controls_read on app.match_publishing_controls for select to authenticated
  using (app.is_platform_admin() or center_id = any ((select app.matching_org_readable_centers())::uuid[]));
revoke all on app.match_publishing_controls from public, anon, authenticated;
grant select on app.match_publishing_controls to authenticated;
grant all on app.match_publishing_controls to service_role;

create or replace function app.match_publishing_cap(p_center uuid) returns int
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select daily_cap from app.match_publishing_controls where center_id = p_center), 20)
$$;

-- How many of the community's approvals published to the directory today (the community's own calendar day).
create or replace function app._match_published_today(p_center uuid) returns int
language sql stable security definer set search_path = app, public, extensions as $$
  select count(*)::int from app.match_program_submissions s
   where s.center_id = p_center and s.status = 'approved' and s.decided_kind = 'community'
     and (s.decided_at at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'UTC'))::date
         = (now() at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'UTC'))::date
$$;

-- Weaver's team pauses or resumes a community's publishing (p_paused null keeps it), and sets its daily cap (null keeps it),
-- with a reason the community's managers see.
create or replace function app.set_match_publishing(p_center uuid, p_paused boolean, p_daily_cap int, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_reason text := app.audit_clean_reason(p_reason);
begin
  perform app._assert_weaver('pause a community''s publishing or change its daily cap');
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if v_reason is null then raise exception 'Say why. The community''s managers see it.' using errcode = '22023'; end if;
  if p_daily_cap is not null and (p_daily_cap < 0 or p_daily_cap > 500) then
    raise exception 'The daily cap is from 0 to 500 approvals.' using errcode = '22023';
  end if;
  perform app.set_audit_context('Weaver''s team: ' || v_reason);
  insert into app.match_publishing_controls (center_id, paused, pause_reason, daily_cap, updated_at, updated_by)
  values (p_center, coalesce(p_paused, false), case when coalesce(p_paused, false) then v_reason end,
          coalesce(p_daily_cap, 20), now(), auth.uid())
  on conflict (center_id) do update
    set paused = coalesce(p_paused, app.match_publishing_controls.paused),
        pause_reason = case when coalesce(p_paused, app.match_publishing_controls.paused)
                            then case when p_paused is null then app.match_publishing_controls.pause_reason else v_reason end end,
        daily_cap = coalesce(p_daily_cap, app.match_publishing_controls.daily_cap),
        updated_at = now(), updated_by = auth.uid();
end $$;

-- The entry a submission names, followed once when it was merged into another; null when there is none.
create or replace function app._match_program_current(p_id uuid) returns app.match_programs
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select m from app.match_programs m where m.id = g.merged_into), g)
    from app.match_programs g
   where g.id = p_id
$$;

-- ── Sending ──────────────────────────────────────────────────────────────────
create or replace function app.submit_match_program(p_center uuid, p_program uuid, p_proposal jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare c jsonb; v_id uuid; g app.match_programs; v_note text;
begin
  if auth.uid() is null or not app._matching_org_can(p_center) then
    raise exception 'Sending what someone knows about an employer''s program needs a CatchTheMatch role (matching.view or matching.manage) in this community.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_program is not null then
    g := app._match_program_current(p_program);
    if g.id is null then raise exception 'That directory entry was not found.'; end if;
  end if;
  c := app._match_program_clean(p_proposal, 'submission');
  if c->>'source' = 'partner' then
    raise exception 'Only Weaver''s team can name a licensed matching-gift database as the source.' using errcode = 'insufficient_privilege';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 1000 then raise exception 'The note can be at most 1000 characters.' using errcode = '22023'; end if;
  if (select count(*) from app.match_program_submissions s where s.center_id = p_center and s.status in ('pending', 'forwarded')) >= 200 then
    raise exception 'This community has 200 submissions waiting. Decide some of them first.';
  end if;
  perform app.set_audit_context('Sent to the gift matching directory');
  insert into app.match_program_submissions (center_id, program_id, proposal, note, channel, submitted_by)
  values (p_center, g.id, c, v_note, 'portal', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ── Deciding ─────────────────────────────────────────────────────────────────
-- Returns {"status": "approved" | "forwarded" | "rejected" | "merged", "program_id": <entry or null>, "because": <why it was
-- forwarded, or null>}.
create or replace function app.decide_match_submission(p_submission uuid, p_decision text, p_program jsonb default null,
                                                       p_reason text default null, p_into_program uuid default null,
                                                       p_into_submission uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.match_program_submissions; d app.match_program_submissions; v_kind text; g app.match_programs; c jsonb;
        v_reason text := app.audit_clean_reason(p_reason); v_who text; v_id uuid; v_label text; v_target uuid;
        v_because text; v_keys text[]; v_clash jsonb; v_verifier uuid; v_center_name text;
begin
  select * into s from app.match_program_submissions where id = p_submission for update;
  if s.id is null then raise exception 'That submission was not found.'; end if;
  -- Weaver's team, or the CatchTheMatch manager of the community that sent it (never both: 0757 keeps Weaver's team out
  -- of the organization's roles).
  if auth.uid() is not null and app.is_platform_admin() then
    v_kind := 'weaver';
  elsif app.matching_can(s.center_id, 'manage') then
    v_kind := 'community';
  else
    raise exception 'Deciding a submission needs the CatchTheMatch manager role (matching.manage) in the community that sent it.'
      using errcode = 'insufficient_privilege';
  end if;
  v_label := app._module_label(s.center_id, 'matching');
  if not app._org_private_module_on(s.center_id, 'matching') then
    raise exception '% is not on for this community, so its submission waits.', v_label using errcode = 'insufficient_privilege';
  end if;
  if s.status not in ('pending', 'forwarded') then
    raise exception 'This submission was already decided.';
  end if;
  if s.status = 'forwarded' and v_kind = 'community' then
    raise exception 'This submission is with Weaver''s team, who decide it.';
  end if;
  select c2.name into v_center_name from app.centers c2 where c2.id = s.center_id;
  v_who := case v_kind when 'weaver' then 'Weaver''s team' else 'Verified by a community (' || v_center_name || ')' end;

  if p_decision = 'reject' then
    if v_reason is null then
      raise exception 'Say why it is rejected. The community that sent it sees the reason.' using errcode = '22023';
    end if;
    perform app.set_audit_context('Rejected a gift matching submission: ' || v_reason);
    update app.match_program_submissions
       set status = 'rejected', decided_kind = v_kind, decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
     where id = s.id;
    return jsonb_build_object('status', 'rejected', 'program_id', null, 'because', null);

  elsif p_decision = 'duplicate' then
    if (p_into_program is null) = (p_into_submission is null) then
      raise exception 'Choose the directory entry or the submission it repeats.' using errcode = '22023';
    end if;
    if p_into_program is not null then
      g := app._match_program_current(p_into_program);
      if g.id is null then raise exception 'That directory entry was not found.'; end if;
    else
      select * into d from app.match_program_submissions where id = p_into_submission;
      if d.id is null or (v_kind = 'community' and d.center_id <> s.center_id) then
        raise exception 'That submission was not found.';
      end if;
      if d.id = s.id then raise exception 'A submission cannot repeat itself.' using errcode = '22023'; end if;
    end if;
    perform app.set_audit_context('Marked a gift matching submission as a duplicate' || coalesce(': ' || v_reason, ''));
    update app.match_program_submissions
       set status = 'merged', decided_kind = v_kind, decided_by = auth.uid(), decided_at = now(),
           decision_reason = coalesce(v_reason, 'A duplicate'), result_program_id = g.id, duplicate_of = d.id
     where id = s.id;
    return jsonb_build_object('status', 'merged', 'program_id', g.id, 'because', null);

  elsif p_decision is null or p_decision <> 'approve' then
    raise exception 'Unknown decision "%". Choose approve, reject or duplicate.', p_decision using errcode = '22023';
  end if;

  -- ── approve ──
  c := app._match_program_clean(coalesce(p_program, s.reviewed, s.proposal), 'submission');
  if v_kind = 'community' and c->>'source' = 'partner' then
    raise exception 'Only Weaver''s team can name a licensed matching-gift database as the source.' using errcode = 'insufficient_privilege';
  end if;
  v_keys := app._match_keys(c);
  -- The entry it changes, followed when merged, LOCKED, and read again: what is checked below is what is changed.
  v_target := coalesce(p_into_program, s.program_id);
  if v_target is not null then
    g := app._match_program_current(v_target);
    if g.id is null then raise exception 'That directory entry was not found.'; end if;
    select * into g from app.match_programs where id = g.id for update;
  end if;
  -- Another ACTIVE entry with one of these names: refused for everyone (a duplicate, or approve into that entry).
  v_clash := app._match_name_clash(v_keys, c->>'country', g.id);
  if v_clash is not null and v_clash->>'status' = 'active' then
    raise exception '"%" is already in the directory%. Open it to change it, or mark this one a duplicate of it.',
      v_clash->>'company_name', case when c->>'country' is not null then ' for ' || (c->>'country') else '' end
      using errcode = '23505';
  end if;

  if v_kind = 'community' then
    if g.id is not null and g.verified_by_kind = 'community' then
      select x.center_id into v_verifier from app.match_program_submissions x where x.id = g.verified_submission_id;
    end if;
    v_because := case
      when coalesce((select pc.paused from app.match_publishing_controls pc where pc.center_id = s.center_id), false) then 'paused'
      when g.id is not null and g.status <> 'active' then 'retired'
      when v_clash is not null then 'retired'
      when g.id is not null and g.verified_by_kind = 'weaver' then 'weaver_checked'
      when g.id is not null and v_verifier is distinct from s.center_id then 'other_community'
      when (c->>'portal_url') is distinct from g.portal_url or (c->>'source_url') is distinct from g.source_url then 'links_changed'
      when g.id is null and app._match_near_weaver(v_keys, c->>'country', null) then 'near_duplicate'
      when app._match_name_used(v_keys, c->>'country', g.id) then 'name_in_use'
    end;
    if v_because is not null then
      perform app.set_audit_context('Sent a gift matching submission to Weaver''s team (' || v_because || ')' || coalesce(': ' || v_reason, ''));
      update app.match_program_submissions
         set status = 'forwarded', program_id = g.id, reviewed = c, forwarded_by = auth.uid(), forwarded_at = now(),
             forward_note = v_reason, forwarded_because = v_because
       where id = s.id;
      return jsonb_build_object('status', 'forwarded', 'program_id', g.id, 'because', v_because);
    end if;
    -- The daily cap, counted under a lock per community so two approvals at once cannot both pass it.
    perform pg_advisory_xact_lock(hashtextextended('match_publish:' || s.center_id::text, 0));
    if app._match_published_today(s.center_id) >= app.match_publishing_cap(s.center_id) then
      raise exception 'Your community has published % approvals to the directory today, the most for one day. The rest can wait until tomorrow.',
        app.match_publishing_cap(s.center_id) using errcode = 'check_violation';
    end if;
  end if;

  perform app.set_audit_context(v_who || ': approved a submission' || coalesce(' (' || v_reason || ')', ''));
  if g.id is not null and g.status = 'retired' then
    update app.match_programs set status = 'active', status_reason = null where id = g.id;
  end if;
  v_id := app._match_program_write(g.id, c, v_kind, current_date, case when v_kind = 'community' then s.id end,
                                   s.center_id, v_who || ': approved a submission' || coalesce(' (' || v_reason || ')', ''));
  update app.match_program_submissions
     set status = 'approved', program_id = coalesce(program_id, v_id), reviewed = c, decided_kind = v_kind,
         decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason, result_program_id = v_id
   where id = s.id;
  return jsonb_build_object('status', 'approved', 'program_id', v_id, 'because', null);
end $$;

-- ── What Weaver's team sees ──────────────────────────────────────────────────
-- The submissions of the communities where CatchTheMatch is on: the facts, the note, the community's name and what was
-- decided. Never who sent, forwarded or decided it. p_view: open (waiting or forwarded, forwarded first), forwarded,
-- decided, all; p_program: only those about one entry (or that made it).
create or replace function app.platform_match_submissions(p_view text default 'open', p_program uuid default null,
                                                          p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_view text := case when p_view in ('open', 'forwarded', 'decided', 'all') then p_view else 'open' end;
        v_rows jsonb;
begin
  perform app._assert_weaver('see the gift matching submissions of every community');
  select coalesce(jsonb_agg(r.j order by r.ord), '[]'::jsonb) into v_rows
    from (select jsonb_build_object(
                   'id', s.id, 'center_id', s.center_id, 'community', c.name, 'program_id', s.program_id,
                   'program_name', g.company_name, 'proposal', s.proposal, 'reviewed', s.reviewed, 'note', s.note,
                   'channel', s.channel, 'status', s.status, 'submitted_at', s.submitted_at, 'forwarded_at', s.forwarded_at,
                   'forward_note', s.forward_note, 'forwarded_because', s.forwarded_because, 'decided_kind', s.decided_kind,
                   'decided_at', s.decided_at, 'decision_reason', s.decision_reason, 'result_program_id', s.result_program_id,
                   'duplicate_of', s.duplicate_of) as j,
                 row_number() over (order by (s.status = 'forwarded') desc, (s.status = 'pending') desc,
                                             case when s.status in ('pending', 'forwarded') then s.submitted_at end asc,
                                             coalesce(s.decided_at, s.submitted_at) desc, s.id) as ord
            from app.match_program_submissions s
            join app.centers c on c.id = s.center_id
            left join app.match_programs g on g.id = s.program_id
           where app._org_private_module_on(s.center_id, 'matching')
             and (v_view = 'all'
                  or (v_view = 'open' and s.status in ('pending', 'forwarded'))
                  or (v_view = 'forwarded' and s.status = 'forwarded')
                  or (v_view = 'decided' and s.status in ('approved', 'rejected', 'merged')))
             and (p_program is null or s.program_id = p_program or s.result_program_id = p_program)
           order by 2
           limit least(greatest(coalesce(p_limit, 100), 1), 500)) r;
  return v_rows;
end $$;

-- What communities published to the directory lately, newest first, for Weaver's team to check: the entry, the version,
-- the community's name, when, and whether the entry has changed since.
create or replace function app.platform_match_recent_publishes(p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app._assert_weaver('see what communities published to the directory');
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'program_id', v.program_id, 'company_name', g.company_name, 'version', v.version,
                     'current_version', g.version, 'status', g.status, 'community', c.name, 'written_at', v.written_at,
                     'note', v.note) order by v.written_at desc, v.version desc)
                     from app.match_program_versions v
                     join app.match_programs g on g.id = v.program_id
                     left join app.centers c on c.id = v.written_center_id
                    where v.written_kind = 'community'
                      and v.written_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 365))),
                  '[]'::jsonb);
end $$;

-- Each community where CatchTheMatch is on, with its publishing: paused or not (and why), its daily cap, what it published
-- today and in the last 7 days, and what it has waiting.
create or replace function app.platform_match_communities() returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app._assert_weaver('see each community''s gift matching publishing');
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'center_id', c.id, 'community', c.name,
                     'paused', coalesce(pc.paused, false), 'pause_reason', pc.pause_reason,
                     'daily_cap', coalesce(pc.daily_cap, 20), 'published_today', app._match_published_today(c.id),
                     'published_week', (select count(*) from app.match_program_submissions s
                                         where s.center_id = c.id and s.status = 'approved' and s.decided_kind = 'community'
                                           and s.decided_at > now() - interval '7 days'),
                     'waiting', (select count(*) from app.match_program_submissions s
                                  where s.center_id = c.id and s.status in ('pending', 'forwarded'))) order by c.name)
                     from app.centers c
                     left join app.match_publishing_controls pc on pc.center_id = c.id
                    where app._org_private_module_on(c.id, 'matching')),
                  '[]'::jsonb);
end $$;

-- What the community's managers see of Weaver's switch: paused (and why), the daily cap, published today.
create or replace function app.match_publishing_state(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not (app.is_platform_admin() or app._matching_org_can(p_center)) then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  return (select jsonb_build_object('paused', coalesce(pc.paused, false), 'pause_reason', pc.pause_reason,
                                    'daily_cap', app.match_publishing_cap(p_center),
                                    'published_today', app._match_published_today(p_center))
            from (select 1) one left join app.match_publishing_controls pc on pc.center_id = p_center);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._match_program_current(uuid), app._match_published_today(uuid) from public, anon, authenticated;
revoke execute on function app.submit_match_program(uuid, uuid, jsonb, text),
  app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid), app.platform_match_submissions(text, uuid, int),
  app.platform_match_recent_publishes(int), app.platform_match_communities(), app.match_publishing_state(uuid),
  app.set_match_publishing(uuid, boolean, int, text), app.match_publishing_cap(uuid)
  from public, anon;
grant execute on function app.submit_match_program(uuid, uuid, jsonb, text),
  app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid), app.platform_match_submissions(text, uuid, int),
  app.platform_match_recent_publishes(int), app.platform_match_communities(), app.match_publishing_state(uuid),
  app.set_match_publishing(uuid, boolean, int, text), app.match_publishing_cap(uuid)
  to authenticated;
