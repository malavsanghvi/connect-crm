-- 0766 · CatchTheMatch slice 2, part 2: what members know about an employer's program, sent to the shared directory and
-- checked before it counts (docs/CATCH_THE_MATCH.md section 7; B63 steps 1 and 2; owner answers of 2026-10-13). Builder MATCH2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.match_program_submissions   one row per thing someone told the community about an employer's program: the facts in
--                                   the directory's shape (0765), an optional note, which entry it would change (or none: a
--                                   company not in the directory yet), who sent it, and what was decided. From the portal now
--                                   (staff entering what a member told them); from the member app later (channel member_app).
--   A submission is the COMMUNITY'S OWN record (0757's contract): module 'matching', read only by the community's
--   CatchTheMatch readers (app.matching_readable_centers, 0758), a restrictive module_switch with no platform-admin pass, and
--   app.audit_private_row (who, when, which columns; the platform admins never read those entries).
--   Weaver's team sees submissions only through app.platform_match_submissions: the facts, the note and the community's NAME,
--   never who sent or decided it (owner, 2026-10-13: Weaver sees the submitting community's name, never the person).
--
--   SENDING: app.submit_match_program(center, entry or null, facts, note): the community's matching.view or matching.manage
--   holders (0757's check; not Weaver's filing grant, which edits nothing here). At most 200 waiting per community.
--   DECIDING: app.decide_match_submission(submission, decision, facts, reason, into entry, into submission)
--     approve    the facts (as sent, or as edited by the decider) go into the directory: a new entry, or the entry it changes.
--                By the community's CatchTheMatch manager (matching.manage, its own community's submissions only): published at
--                once, marked "verified by a community" with today's date; but an entry Weaver's team checked (or a retired
--                one) is not changed by a community: the submission is FORWARDED to Weaver's team, with the manager's edits.
--                By Weaver's team (any community's, waiting or forwarded): published, marked checked by Weaver's team.
--     reject     with a reason the community sees.
--     duplicate  it repeats a directory entry or another submission: marked merged, pointing at it.
--   Every change to the directory is in its own history (0765's app.audit_shared_row), with the community named in the reason
--   and no person; every change to a submission is in the community's private audit.
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
  decided_kind      text check (decided_kind is null or decided_kind in ('community', 'weaver')),
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_reason   text check (decision_reason is null or char_length(decision_reason) between 1 and 500),
  result_program_id uuid references app.match_programs(id),
  duplicate_of      uuid references app.match_program_submissions(id) on delete set null,
  constraint match_program_submissions_open check (
    (status in ('pending', 'forwarded')) = (decided_at is null)
    and (decided_at is null) = (decided_kind is null) and (decided_at is null) = (decided_by is null)),
  constraint match_program_submissions_forwarded check (status <> 'forwarded' or (forwarded_at is not null and reviewed is not null)),
  constraint match_program_submissions_approved check (status <> 'approved' or result_program_id is not null),
  constraint match_program_submissions_rejected check (status <> 'rejected' or decision_reason is not null),
  constraint match_program_submissions_merged check (status <> 'merged' or result_program_id is not null or duplicate_of is not null),
  constraint match_program_submissions_not_itself check (duplicate_of is distinct from id)
);
create index if not exists match_program_submissions_center_idx on app.match_program_submissions (center_id, status, submitted_at desc);
create index if not exists match_program_submissions_open_idx on app.match_program_submissions (status, submitted_at)
  where status in ('pending', 'forwarded');
create index if not exists match_program_submissions_program_idx on app.match_program_submissions (program_id);
comment on table app.match_program_submissions is
  'What someone told a community about an employer''s matching program (0766, CatchTheMatch): the community''s own record (matching_can readers, private audit). Weaver''s team sees the facts and the community''s name through platform_match_submissions, never who sent or decided it. Written only by submit_match_program / decide_match_submission.';

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
drop policy if exists match_program_submissions_read on app.match_program_submissions;
create policy match_program_submissions_read on app.match_program_submissions for select to authenticated
  using (center_id = any ((select app.matching_readable_centers())::uuid[]));
-- CatchTheMatch off: hidden from every direct read (no platform-admin pass).
drop policy if exists module_switch on app.match_program_submissions;
create policy module_switch on app.match_program_submissions as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
-- No write policies: only the functions below write.
revoke all on app.match_program_submissions from public, anon, authenticated;
grant select on app.match_program_submissions to authenticated;
grant all on app.match_program_submissions to service_role;

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
  if auth.uid() is null
     or not (app.org_private_can(p_center, 'matching.view') or app.org_private_can(p_center, 'matching.manage')) then
    raise exception 'Sending what someone knows about an employer''s program needs a CatchTheMatch role (matching.view or matching.manage) in this community.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_program is not null then
    g := app._match_program_current(p_program);
    if g.id is null then raise exception 'That directory entry was not found.'; end if;
  end if;
  c := app._match_program_clean(p_proposal, 'submission');
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
-- Returns {"status": "approved" | "forwarded" | "rejected" | "merged", "program_id": <entry or null>}.
create or replace function app.decide_match_submission(p_submission uuid, p_decision text, p_program jsonb default null,
                                                       p_reason text default null, p_into_program uuid default null,
                                                       p_into_submission uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.match_program_submissions; d app.match_program_submissions; v_kind text; g app.match_programs; c jsonb;
        v_reason text := app.audit_clean_reason(p_reason); v_who text; v_id uuid; v_label text;
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
    raise exception 'This submission is with Weaver''s team: the entry it changes was checked by them.';
  end if;
  v_who := case v_kind when 'weaver' then 'Weaver''s team'
                       else 'Verified by a community (' || (select c2.name from app.centers c2 where c2.id = s.center_id) || ')' end;

  if p_decision = 'reject' then
    if v_reason is null then
      raise exception 'Say why it is rejected. The community that sent it sees the reason.' using errcode = '22023';
    end if;
    perform app.set_audit_context('Rejected a gift matching submission: ' || v_reason);
    update app.match_program_submissions
       set status = 'rejected', decided_kind = v_kind, decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
     where id = s.id;
    return jsonb_build_object('status', 'rejected', 'program_id', null);

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
    return jsonb_build_object('status', 'merged', 'program_id', g.id);

  elsif p_decision = 'approve' then
    c := app._match_program_clean(coalesce(p_program, s.reviewed, s.proposal), 'submission');
    if coalesce(p_into_program, s.program_id) is not null then
      g := app._match_program_current(coalesce(p_into_program, s.program_id));
      if g.id is null then raise exception 'That directory entry was not found.'; end if;
    end if;
    -- A community does not change what Weaver's team checked, or bring back a retired entry: it goes to Weaver's team.
    if v_kind = 'community' and g.id is not null and (g.verified_by_kind = 'weaver' or g.status <> 'active') then
      perform app.set_audit_context('Sent a gift matching submission to Weaver''s team' || coalesce(': ' || v_reason, ''));
      update app.match_program_submissions
         set status = 'forwarded', program_id = g.id, reviewed = c, forwarded_by = auth.uid(), forwarded_at = now(),
             forward_note = v_reason
       where id = s.id;
      return jsonb_build_object('status', 'forwarded', 'program_id', g.id);
    end if;
    perform app.set_audit_context(v_who || ': approved a submission' || coalesce(' (' || v_reason || ')', ''));
    if g.id is not null and g.status = 'retired' then
      update app.match_programs set status = 'active', status_reason = null where id = g.id;
    end if;
    v_id := app._match_program_write(g.id, c, v_kind, current_date, case when v_kind = 'community' then s.id end);
    update app.match_program_submissions
       set status = 'approved', program_id = coalesce(program_id, v_id), reviewed = c, decided_kind = v_kind,
           decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason, result_program_id = v_id
     where id = s.id;
    return jsonb_build_object('status', 'approved', 'program_id', v_id);

  else
    raise exception 'Unknown decision "%". Choose approve, reject or duplicate.', p_decision using errcode = '22023';
  end if;
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
                   'forward_note', s.forward_note, 'decided_kind', s.decided_kind, 'decided_at', s.decided_at,
                   'decision_reason', s.decision_reason, 'result_program_id', s.result_program_id,
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

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._match_program_current(uuid) from public, anon, authenticated;
revoke execute on function app.submit_match_program(uuid, uuid, jsonb, text),
  app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid), app.platform_match_submissions(text, uuid, int)
  from public, anon;
grant execute on function app.submit_match_program(uuid, uuid, jsonb, text),
  app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid), app.platform_match_submissions(text, uuid, int)
  to authenticated;
