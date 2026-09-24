-- Onboarding · stream o-platform · 3 of 4: go-live, owner attestations, support access,
-- and the Community Connect pipeline (ONBOARDING_PLAN §4 Steps 7–8, §6; decision O15).
--
--   app.center_attestations       the owner confirms: staff trained, health check green, pilot done
--   app.check_staff_trained_pilot_done(center)   readiness check 13 (registered here)
--   app.attest_center(center, key, note)         owner only; also completes the matching Setup step
--   app.golive_requests           requested → approved (two DIFFERENT platform admins) → live, or rejected
--   app.request_golive(center)    owner; every readiness check must pass (app.readiness_all_ok)
--   app.approve_golive(id, note)  platform admin; readiness re-checked; the second approver must differ
--   app.reject_golive(id, note)   platform admin; the note is required
--   app.support_grants            time-boxed support access the OWNER grants to a platform admin
--   app.grant_support_access / app.revoke_support_access / app.has_support_grant(center)
--   app.platform_onboarding_pipeline()   every non-live organization's stage, progress and blockers
--
-- Support access does NOT change what platform admins can see: app.has_permission
-- already gives platform admins every permission everywhere (0017). Making access
-- depend on a live grant would tighten existing platform-admin RLS; that is an
-- owner decision (listed in the stream report), so today a grant is the recorded,
-- audited consent and the console shows whether one is live.
set client_min_messages = warning;

-- ── Attestations (readiness 13) ──────────────────────────────────────────────
create table if not exists app.center_attestations (
  center_id    uuid not null references app.centers(id) on delete cascade,
  key          text not null check (key in ('staff_trained','health_check_green','pilot_done')),
  attested_by  uuid not null references auth.users(id),
  attested_at  timestamptz not null default now(),
  note         text check (note is null or length(note) <= 1000),
  primary key (center_id, key)
);
comment on table app.center_attestations is 'Owner confirmations behind readiness check 13 (staff trained, health check green, pilot done).';
alter table app.center_attestations enable row level security;
drop policy if exists center_attestations_read on app.center_attestations;
create policy center_attestations_read on app.center_attestations for select to authenticated
  using (app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke all on app.center_attestations from anon;
revoke insert, update, delete, truncate on app.center_attestations from authenticated;
grant select on app.center_attestations to authenticated;
grant all on app.center_attestations to service_role;
drop trigger if exists audit_center_attestations on app.center_attestations;
create trigger audit_center_attestations after insert or update or delete on app.center_attestations
  for each row execute function app.audit_row('center_id', 'key');

create or replace function app.attestation_label(p_key text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_key when 'staff_trained' then 'staff trained' when 'health_check_green' then 'sandbox health check green'
                    when 'pilot_done' then 'pilot with champion families done' else p_key end
$$;

create or replace function app.check_staff_trained_pilot_done(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_missing text; v_done text;
begin
  select string_agg(app.attestation_label(k), ', ' order by o) filter (where a.key is null),
         string_agg(app.attestation_label(k) || ' (' || to_char(a.attested_at at time zone 'UTC', 'FMMon FMDD') || ')', ', ' order by o)
           filter (where a.key is not null)
    into v_missing, v_done
    from unnest(array['staff_trained','health_check_green','pilot_done']) with ordinality as t(k, o)
    left join app.center_attestations a on a.center_id = p_center and a.key = t.k;
  if v_missing is null then
    return jsonb_build_object('ok', true, 'detail', 'The owner confirmed: ' || v_done || '.');
  end if;
  return jsonb_build_object('ok', false, 'detail', 'The owner has not confirmed yet: ' || v_missing || ' (Setup › Go-live).');
end $$;

insert into app.readiness_checks (key, title, sort, check_fn) values
  ('staff_trained_pilot_done', 'Staff trained, health check green, pilot done', 130, 'app.check_staff_trained_pilot_done'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

-- A Setup step completed by a database action (manual steps whose evidence is
-- recorded elsewhere). Never downgrades a step a person marked done.
create or replace function app.complete_setup_step(p_center uuid, p_step text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.center_setup_steps (center_id, step_key, status, notes, completed_by, completed_at)
  values (p_center, p_step, p_status, left(p_note, 2000), case when p_status = 'done' then auth.uid() end,
          case when p_status = 'done' then now() end)
  on conflict (center_id, step_key) do update
     set status = excluded.status, notes = coalesce(excluded.notes, app.center_setup_steps.notes),
         completed_by = coalesce(excluded.completed_by, app.center_setup_steps.completed_by),
         completed_at = coalesce(excluded.completed_at, app.center_setup_steps.completed_at)
   where app.center_setup_steps.status <> 'done' or excluded.status = 'done';
end $$;

create or replace function app.attest_center(p_center uuid, p_key text, p_note text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not app.is_center_owner(p_center) then
    raise exception 'Only the owner of this organization confirms training, the health check and the pilot.' using errcode = 'insufficient_privilege';
  end if;
  if p_key not in ('staff_trained','health_check_green','pilot_done') then
    raise exception 'Choose what you are confirming: staff trained, health check green or pilot done.';
  end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'Keep the note under 1,000 characters.'; end if;
  perform app.set_audit_context(coalesce(v_note, 'Owner confirmed: ' || app.attestation_label(p_key)));
  insert into app.center_attestations (center_id, key, attested_by, note) values (p_center, p_key, auth.uid(), v_note)
  on conflict (center_id, key) do update set attested_by = excluded.attested_by, attested_at = now(), note = excluded.note;
  perform app.complete_setup_step(p_center,
    case p_key when 'staff_trained' then 'test.training' when 'health_check_green' then 'test.health_check' else 'test.pilot' end,
    'done', 'Confirmed by the owner' || coalesce(': ' || v_note, '.'));
end $$;

-- ── Go-live requests ─────────────────────────────────────────────────────────
create table if not exists app.golive_requests (
  id                  uuid primary key default gen_random_uuid(),
  center_id           uuid not null references app.centers(id) on delete cascade,
  requested_by        uuid not null references auth.users(id),
  requested_at        timestamptz not null default now(),
  status              text not null default 'requested' check (status in ('requested','approved','rejected','live')),
  first_approver      uuid references auth.users(id),
  first_approved_at   timestamptz,
  second_approver     uuid references auth.users(id),
  second_approved_at  timestamptz,
  rejected_by         uuid references auth.users(id),
  rejected_at         timestamptz,
  note                text check (note is null or length(note) <= 2000),
  -- The readiness results at request time (evidence for the approvers).
  readiness           jsonb not null default '[]'::jsonb,
  constraint golive_two_people check (second_approver is null or (first_approver is not null and second_approver <> first_approver)),
  constraint golive_approved check (status not in ('approved','live') or second_approver is not null)
);
comment on table app.golive_requests is 'Go-live requests (ONBOARDING_PLAN Step 8); two different platform admins approve (decision O15).';
create unique index if not exists golive_requests_open_idx on app.golive_requests (center_id) where status in ('requested','approved');
alter table app.golive_requests enable row level security;
drop policy if exists golive_requests_read on app.golive_requests;
create policy golive_requests_read on app.golive_requests for select to authenticated
  using (app.is_platform_admin() or app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke all on app.golive_requests from anon;
revoke insert, update, delete, truncate on app.golive_requests from authenticated;
grant select on app.golive_requests to authenticated;
grant all on app.golive_requests to service_role;
drop trigger if exists audit_golive_requests on app.golive_requests;
create trigger audit_golive_requests after insert or update or delete on app.golive_requests
  for each row execute function app.audit_row();

create or replace function app.readiness_failures(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select string_agg(r.title, '; ' order by r.title) from app.readiness(p_center) r where not r.ok
$$;

create or replace function app.request_golive(p_center uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_fail text;
begin
  if auth.uid() is null or not app.is_center_owner(p_center) then
    raise exception 'Only the owner of this organization can request go-live.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from app.golive_requests where center_id = p_center and status in ('requested','approved')) then
    raise exception 'A go-live request is already open for this organization.';
  end if;
  if exists (select 1 from app.centers where id = p_center and sandbox_for is not null) then
    raise exception 'This sandbox has already been promoted to production.';
  end if;
  if not app.readiness_all_ok(p_center) then
    v_fail := app.readiness_failures(p_center);
    raise exception 'Every go-live readiness check must pass first. Not passing yet: %.', coalesce(v_fail, 'no checks are registered')
      using errcode = 'CCRDY';
  end if;
  perform app.set_audit_context('Go-live requested');
  insert into app.golive_requests (center_id, requested_by, readiness)
  values (p_center, auth.uid(), (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from app.readiness(p_center) r))
  returning id into v_id;
  perform app.complete_setup_step(p_center, 'golive.request', 'needs_review', 'Requested; waiting for two Community Connect approvals.');
  return v_id;
end $$;

create or replace function app.approve_golive(p_request uuid, p_note text default null) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.golive_requests; v_fail text; v_note text := app.audit_clean_reason(p_note);
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team approves go-live.' using errcode = 'insufficient_privilege';
  end if;
  select * into g from app.golive_requests where id = p_request for update;
  if g.id is null then raise exception 'That go-live request was not found.'; end if;
  if g.status <> 'requested' then raise exception 'This go-live request is % — nothing to approve.', g.status; end if;
  if g.requested_by = auth.uid() then raise exception 'You requested this go-live, so you cannot approve it.'; end if;
  if g.first_approver = auth.uid() then
    raise exception 'You already approved this request. A second, different Community Connect admin must approve it too.';
  end if;
  if not app.readiness_all_ok(g.center_id) then
    v_fail := app.readiness_failures(g.center_id);
    raise exception 'The readiness checks no longer all pass: %. Ask the organization to fix them first.', coalesce(v_fail, 'unknown') using errcode = 'CCRDY';
  end if;
  perform app.assert_step_up('golive.approve');
  perform app.set_audit_context(coalesce(v_note, case when g.first_approver is null then 'Go-live: first approval' else 'Go-live: second approval' end));
  if g.first_approver is null then
    update app.golive_requests set first_approver = auth.uid(), first_approved_at = now(),
           note = coalesce(v_note, note) where id = p_request;
    return 'first_approval';
  end if;
  update app.golive_requests set second_approver = auth.uid(), second_approved_at = now(), status = 'approved',
         note = coalesce(v_note, note) where id = p_request;
  perform app.complete_setup_step(g.center_id, 'golive.request', 'in_progress', 'Approved by Community Connect; promote the sandbox to production.');
  return 'approved';
end $$;

create or replace function app.reject_golive(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.golive_requests; v_note text := app.audit_clean_reason(p_note);
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team decides go-live.' using errcode = 'insufficient_privilege';
  end if;
  select * into g from app.golive_requests where id = p_request for update;
  if g.id is null then raise exception 'That go-live request was not found.'; end if;
  if g.status <> 'requested' then raise exception 'This go-live request is % — it cannot be sent back now.', g.status; end if;
  if v_note is null then raise exception 'Say what must change before go-live. The organization sees it.'; end if;
  perform app.set_audit_context(v_note);
  update app.golive_requests set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), note = v_note where id = p_request;
  perform app.complete_setup_step(g.center_id, 'golive.request', 'in_progress', 'Sent back by Community Connect: ' || v_note);
end $$;

-- ── Support access ───────────────────────────────────────────────────────────
create table if not exists app.support_grants (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  grantee_user_id  uuid not null references auth.users(id),
  granted_by       uuid not null references auth.users(id),
  granted_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id),
  reason           text not null check (btrim(reason) <> '' and length(reason) <= 500),
  constraint support_grants_window check (expires_at > granted_at and expires_at <= granted_at + interval '30 days')
);
comment on table app.support_grants is
  'Time-boxed support access the organization owner grants to a Community Connect platform admin (ONBOARDING_PLAN §6). Consent record; see 0202 header.';
create index if not exists support_grants_center_idx on app.support_grants (center_id, expires_at desc);
alter table app.support_grants enable row level security;
drop policy if exists support_grants_read on app.support_grants;
create policy support_grants_read on app.support_grants for select to authenticated
  using (app.is_platform_admin() or app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke all on app.support_grants from anon;
revoke insert, update, delete, truncate on app.support_grants from authenticated;
grant select on app.support_grants to authenticated;
grant all on app.support_grants to service_role;
drop trigger if exists audit_support_grants on app.support_grants;
create trigger audit_support_grants after insert or update or delete on app.support_grants
  for each row execute function app.audit_row();

insert into app.module_tables (table_name, module_key) values
  ('center_attestations', null), ('golive_requests', null), ('support_grants', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- Platform admins the owner can choose from (names and emails of the CC team only).
create or replace function app.support_staff_options(p_center uuid) returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not (app.is_center_owner(p_center) or app.has_permission(p_center, 'settings.manage')) then
    raise exception 'Support access is managed by the organization''s owner.' using errcode = 'insufficient_privilege';
  end if;
  return query select a.user_id, u.email::text from app.accounts a join auth.users u on u.id = a.user_id
                where a.is_platform_admin order by u.email;
end $$;

create or replace function app.grant_support_access(p_center uuid, p_grantee uuid, p_hours int, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  if auth.uid() is null or not app.is_center_owner(p_center) then
    raise exception 'Only the owner of this organization can grant support access.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from app.accounts where user_id = p_grantee and is_platform_admin) then
    raise exception 'Support access can be given only to a member of the Community Connect team.';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'Choose how long, from 1 hour to 30 days.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say what the support is for. It goes in the audit log.'; end if;
  perform app.assert_step_up('support.grant');
  perform app.set_audit_context(p_reason);
  insert into app.support_grants (center_id, grantee_user_id, granted_by, expires_at, reason)
  values (p_center, p_grantee, auth.uid(), now() + make_interval(hours => p_hours), app.audit_clean_reason(p_reason))
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.revoke_support_access(p_grant uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.support_grants;
begin
  select * into g from app.support_grants where id = p_grant for update;
  if g.id is null then raise exception 'That support grant was not found.'; end if;
  if auth.uid() is null or not (app.is_center_owner(g.center_id) or g.grantee_user_id = auth.uid()) then
    raise exception 'Only the owner (or the person given access) can end support access.' using errcode = 'insufficient_privilege';
  end if;
  if g.revoked_at is not null or g.expires_at <= now() then return; end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Support access ended'));
  update app.support_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant;
end $$;

create or replace function app.has_support_grant(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and exists (select 1 from app.support_grants g where g.center_id = p_center and g.grantee_user_id = auth.uid()
                                                 and g.revoked_at is null and g.expires_at > now())
$$;

-- ── The pipeline (platform console) ──────────────────────────────────────────
-- Stage: request → sandbox (setup) → go-live requested → approved → promoted → live.
create or replace function app.platform_onboarding_pipeline()
returns table (center_id uuid, slug text, name text, environment text, status text, stage text, stage_since timestamptz,
               steps_done int, steps_total int, readiness_ok int, readiness_total int, blockers text[],
               owner_name text, owner_email text, owner_phone text, golive_id uuid, golive_status text,
               promoted_to text, last_activity_at timestamptz, support_live boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c record; v_steps record; v_ready record; g app.golive_requests;
begin
  if not app.is_platform_admin() then
    raise exception 'The onboarding pipeline is for the Community Connect team.' using errcode = 'insufficient_privilege';
  end if;
  for c in select x.* from app.centers x where x.status = 'onboarding' or x.environment = 'sandbox' order by x.created_at loop
    select * into g from app.golive_requests gr where gr.center_id = c.id order by gr.requested_at desc limit 1;
    begin
      select count(*) filter (where s.status in ('done','skipped'))::int as done, count(*)::int as total into v_steps
        from app.setup_checklist(c.id) s where s.required;
    exception when others then
      v_steps := null;
    end;
    begin
      select count(*) filter (where r.ok)::int as ok, count(*)::int as total,
             coalesce(array_agg(r.title || ': ' || r.detail order by r.title) filter (where not r.ok), '{}') as fails
        into v_ready from app.readiness(c.id) r;
    exception when others then
      v_ready := null;
    end;
    center_id := c.id; slug := c.slug::text; name := c.name; environment := c.environment; status := c.status;
    promoted_to := (select p.slug::text from app.centers p where p.id = c.sandbox_for);
    stage := case when c.sandbox_for is not null then 'promoted'
                  when g.status = 'approved' then 'approved'
                  when g.status = 'requested' then 'golive_requested'
                  when c.environment = 'sandbox' then 'sandbox'
                  else 'setup' end;
    stage_since := case stage when 'approved' then g.second_approved_at when 'golive_requested' then g.requested_at
                              else c.created_at end;
    steps_done := v_steps.done; steps_total := v_steps.total;
    readiness_ok := v_ready.ok; readiness_total := v_ready.total; blockers := v_ready.fails;
    select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name, u.email::text,
           nullif(u.phone, '')
      into owner_name, owner_email, owner_phone
      from app.center_owners o join auth.users u on u.id = o.user_id
      left join app.center_users cu on cu.center_id = o.center_id and cu.user_id = o.user_id
      left join app.people pe on pe.id = cu.person_id
     where o.center_id = c.id;
    golive_id := g.id; golive_status := g.status;
    last_activity_at := (select max(l.occurred_at) from app.audit_log l where l.center_id = c.id and l.actor_user_id is not null);
    support_live := exists (select 1 from app.support_grants sg where sg.center_id = c.id and sg.revoked_at is null and sg.expires_at > now());
    return next;
  end loop;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.attestation_label(text), app.complete_setup_step(uuid, text, text, text),
  app.check_staff_trained_pilot_done(uuid), app.readiness_failures(uuid) from public, anon, authenticated;
revoke execute on function app.attest_center(uuid, text, text), app.request_golive(uuid), app.approve_golive(uuid, text),
  app.reject_golive(uuid, text), app.support_staff_options(uuid), app.grant_support_access(uuid, uuid, int, text),
  app.revoke_support_access(uuid, text), app.has_support_grant(uuid), app.platform_onboarding_pipeline() from public, anon;
grant execute on function app.attest_center(uuid, text, text), app.request_golive(uuid), app.approve_golive(uuid, text),
  app.reject_golive(uuid, text), app.support_staff_options(uuid), app.grant_support_access(uuid, uuid, int, text),
  app.revoke_support_access(uuid, text), app.has_support_grant(uuid), app.platform_onboarding_pipeline() to authenticated;
grant execute on all functions in schema app to service_role;
