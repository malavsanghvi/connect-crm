-- Onboarding · stream o-platform · 4 of 4: promotion sandbox → production (ONBOARDING_PLAN §5,
-- decisions O1–O2) and sandbox expiry warnings (§3 "Expiry").
--
--   app.sandbox_promotions            one row per promotion: requested by the owner, run by the worker
--   app.promote_sandbox(sandbox, slug, reason)
--                                     owner of the sandbox + an APPROVED go-live request + a fresh 2FA
--                                     check; enqueues the worker job platform.promote.
--   app.worker_promote_sandbox(id)    connect_worker only (the job): creates the production center
--                                     <slug> (status onboarding) and copies CONFIGURATION ONLY —
--                                     profile, verification, brand kit and rules, modules, setup data,
--                                     templates, legal documents, custom-field definitions and saved
--                                     import mappings. Never people, households, transactions, messages,
--                                     files, integration connections or secrets. The owner is linked as
--                                     the first administrator; every other staff member is re-invited
--                                     (app.staff_invitations; the owner sends the links from Settings › Team).
--                                     Sets the sandbox's sandbox_for.
--   app.worker_promotion_failed(id, error)   records a failed run (the job retries).
--   When the production center goes live (status → active) its go-live request becomes 'live'.
--
--   app.sandbox_expiry_notices        the 60- and 80-day inactivity warnings sent per sandbox
--   app.worker_sandbox_expiry()       connect_worker (job platform.sandbox_expiry, daily): finds sandboxes
--                                     inactive for 60 / 80 days (entitlement expiry_days_inactive, default
--                                     90), records a notice once per threshold and emails the owner.
--                                     Nothing is ever deleted here — removing a sandbox is an owner decision.
set client_min_messages = warning;

create table if not exists app.sandbox_promotions (
  id             uuid primary key default gen_random_uuid(),
  sandbox_id     uuid not null references app.centers(id) on delete cascade,
  golive_id      uuid not null references app.golive_requests(id),
  slug           text not null,
  reason         text not null check (btrim(reason) <> ''),
  requested_by   uuid not null references auth.users(id),
  requested_at   timestamptz not null default now(),
  job_id         bigint,
  status         text not null default 'queued' check (status in ('queued','done','failed')),
  production_id  uuid references app.centers(id) on delete set null,
  result         jsonb,
  last_error     text,
  finished_at    timestamptz
);
comment on table app.sandbox_promotions is 'Promotion sandbox → production runs (ONBOARDING_PLAN §5). Configuration only; see 0203 header.';
create unique index if not exists sandbox_promotions_open_idx on app.sandbox_promotions (sandbox_id) where status in ('queued','done');
alter table app.sandbox_promotions enable row level security;
drop policy if exists sandbox_promotions_read on app.sandbox_promotions;
create policy sandbox_promotions_read on app.sandbox_promotions for select to authenticated
  using (app.is_platform_admin() or app.is_center_owner(sandbox_id) or app.has_permission(sandbox_id, 'settings.manage'));
revoke all on app.sandbox_promotions from anon;
revoke insert, update, delete, truncate on app.sandbox_promotions from authenticated;
grant select on app.sandbox_promotions to authenticated;
grant all on app.sandbox_promotions to service_role;
drop trigger if exists audit_sandbox_promotions on app.sandbox_promotions;
create trigger audit_sandbox_promotions after insert or update or delete on app.sandbox_promotions
  for each row execute function app.audit_row();

create table if not exists app.sandbox_expiry_notices (
  center_id         uuid not null references app.centers(id) on delete cascade,
  threshold_days    int not null check (threshold_days > 0),
  last_activity_at  timestamptz not null,
  notified_at       timestamptz not null default now(),
  email_status      text,
  primary key (center_id, threshold_days, last_activity_at)
);
comment on table app.sandbox_expiry_notices is 'Sandbox inactivity warnings sent (60 and 80 days of a 90-day expiry). A new activity starts a new cycle.';
alter table app.sandbox_expiry_notices enable row level security;
drop policy if exists sandbox_expiry_notices_read on app.sandbox_expiry_notices;
create policy sandbox_expiry_notices_read on app.sandbox_expiry_notices for select to authenticated
  using (app.is_platform_admin() or app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke all on app.sandbox_expiry_notices from anon;
revoke insert, update, delete, truncate on app.sandbox_expiry_notices from authenticated;
grant select on app.sandbox_expiry_notices to authenticated;
grant all on app.sandbox_expiry_notices to service_role;
drop trigger if exists audit_sandbox_expiry_notices on app.sandbox_expiry_notices;
create trigger audit_sandbox_expiry_notices after insert or update or delete on app.sandbox_expiry_notices
  for each row execute function app.audit_row('center_id', 'threshold_days');

insert into app.module_tables (table_name, module_key) values ('sandbox_promotions', null), ('sandbox_expiry_notices', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Request a promotion (owner) ──────────────────────────────────────────────
create or replace function app.promote_sandbox(p_sandbox uuid, p_slug text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; g app.golive_requests; v_slug text := lower(btrim(coalesce(p_slug, ''))); v_id uuid; v_job bigint;
begin
  if auth.uid() is null or not app.is_center_owner(p_sandbox) then
    raise exception 'Only the owner of this sandbox can promote it to production.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_sandbox for update;
  if c.environment <> 'sandbox' then raise exception 'Only a sandbox can be promoted. This organization is already in production.'; end if;
  if c.sandbox_for is not null then raise exception 'This sandbox has already been promoted.'; end if;
  if exists (select 1 from app.sandbox_promotions where sandbox_id = p_sandbox and status = 'queued') then
    raise exception 'A promotion of this sandbox is already running.';
  end if;
  select * into g from app.golive_requests where center_id = p_sandbox and status = 'approved' order by requested_at desc limit 1;
  if g.id is null then raise exception 'Community Connect must approve go-live (two approvals) before the sandbox can be promoted.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Give a reason for the promotion. It goes in the audit log.'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' or v_slug ~ '-sandbox$' then
    raise exception 'Choose the production web name: 2 to 40 lowercase letters, numbers and single dashes, without "-sandbox".';
  end if;
  if exists (select 1 from app.centers x where lower(x.slug::text) = v_slug) then
    raise exception 'The web name "%" is already taken. Choose another.', v_slug;
  end if;
  perform app.assert_step_up('platform.promote');
  perform app.set_audit_context(p_reason);
  insert into app.sandbox_promotions (sandbox_id, golive_id, slug, reason, requested_by)
  values (p_sandbox, g.id, v_slug, app.audit_clean_reason(p_reason), auth.uid()) returning id into v_id;
  v_job := app.enqueue_job(p_sandbox, 'platform.promote', jsonb_build_object('promotion_id', v_id), now(), 3);
  update app.sandbox_promotions set job_id = v_job where id = v_id;
  return v_id;
end $$;

-- ── The copy (worker) ────────────────────────────────────────────────────────
-- Configuration tables in dependency order. Each is copied row by row with new
-- ids; a foreign key to another copied table is re-pointed, one to centers goes
-- to the production center, one to auth.users is kept (logins are global), and
-- any other reference (people, households, import runs, events …) is cleared
-- when the column allows it, otherwise the row is skipped and counted.
create or replace function app.promotion_config_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['org_profiles','org_leaders','center_modules','zones','membership_types','funds','campaigns','labh_options',
               'event_templates','event_template_items','store_categories','pickup_windows','pathshala_tracks',
               'pathshala_levels','gyan_goals','practices','inboxes','guide_sections','message_templates',
               'receipt_templates','legal_documents','custom_field_definitions','import_mappings','public_kpi_settings',
               'calendar_layers','volunteer_groups']
$$;

create or replace function app.promotion_copy_table(p_table text, p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_row jsonb; v_new jsonb; v_cols text; fk record; v_old_id uuid; v_new_id uuid; v_val text; v_mapped uuid;
        v_copied int := 0; v_skipped int := 0; v_has_id boolean; v_skip boolean; v_copy_set text[] := app.promotion_config_tables();
begin
  if to_regclass('app.' || p_table) is null then
    return jsonb_build_object('table', p_table, 'copied', 0, 'skipped', 0, 'note', 'not in this database');
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = ('app.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity <> 'a';
  v_has_id := exists (select 1 from pg_attribute a where a.attrelid = ('app.' || p_table)::regclass and a.attname = 'id'
                        and a.atttypid = 'uuid'::regtype and not a.attisdropped);
  for v_row in execute format('select to_jsonb(t) from app.%I t where t.center_id = $1', p_table) using p_from loop
    v_new := v_row || jsonb_build_object('center_id', p_to);
    v_skip := false;
    if v_has_id then
      v_old_id := (v_row->>'id')::uuid;
      v_new_id := gen_random_uuid();
      v_new := v_new || jsonb_build_object('id', v_new_id);
    end if;
    for fk in
      select a.attname as col, a.attnotnull as not_null, cf.relname as ref_table, nf.nspname as ref_schema
        from pg_constraint k
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        join pg_class cf on cf.oid = k.confrelid join pg_namespace nf on nf.oid = cf.relnamespace
       where k.conrelid = ('app.' || p_table)::regclass and k.contype = 'f' and cardinality(k.conkey) = 1 and a.attname <> 'center_id'
    loop
      v_val := v_row->>fk.col;
      continue when v_val is null;
      if fk.ref_schema = 'auth' then
        continue;
      elsif fk.ref_schema = 'app' and fk.ref_table = 'centers' then
        v_new := v_new || jsonb_build_object(fk.col, p_to);
      elsif fk.ref_schema = 'app' and fk.ref_table = any (v_copy_set) then
        select m.new_id into v_mapped from pg_temp.promotion_map m where m.old_id = v_val::uuid;
        if v_mapped is not null then
          v_new := v_new || jsonb_build_object(fk.col, v_mapped);
        elsif fk.not_null then v_skip := true;
        else v_new := v_new || jsonb_build_object(fk.col, null);
        end if;
      elsif fk.not_null then
        v_skip := true;
      else
        v_new := v_new || jsonb_build_object(fk.col, null);
      end if;
    end loop;
    if v_skip then v_skipped := v_skipped + 1; continue; end if;
    execute format('insert into app.%I (%s) select %s from jsonb_populate_record(null::app.%I, $1)', p_table, v_cols, v_cols, p_table) using v_new;
    if v_has_id then insert into pg_temp.promotion_map (old_id, new_id) values (v_old_id, v_new_id); end if;
    v_copied := v_copied + 1;
  end loop;
  return jsonb_build_object('table', p_table, 'copied', v_copied, 'skipped', v_skipped);
end $$;

create or replace function app.worker_promote_sandbox(p_promotion uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.sandbox_promotions; s app.centers; v_prod uuid; t text; v_tables jsonb := '[]'::jsonb; v_owner uuid;
        v_person uuid; v_household uuid; sp record; st record; v_invited int := 0; v_mail jsonb; v_token text;
        v_mail_status text[] := '{}';
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into p from app.sandbox_promotions where id = p_promotion for update;
  if p.id is null then raise exception 'Promotion % was not found.', p_promotion; end if;
  if p.status = 'done' then return coalesce(p.result, '{}'::jsonb); end if;
  select * into s from app.centers where id = p.sandbox_id for update;
  if s.environment <> 'sandbox' then raise exception 'Center % is not a sandbox.', s.slug; end if;
  if s.sandbox_for is not null then raise exception 'Sandbox % was already promoted.', s.slug; end if;
  if not exists (select 1 from app.golive_requests g where g.id = p.golive_id and g.status = 'approved') then
    raise exception 'The go-live approval for this promotion is no longer in place.';
  end if;
  if exists (select 1 from app.centers x where lower(x.slug::text) = p.slug) then
    raise exception 'The web name "%" was taken after the promotion was requested. Ask the owner to promote again with another name.', p.slug;
  end if;
  perform app.set_audit_context('Promotion from sandbox ' || s.slug || ': ' || p.reason);

  -- The production center: the sandbox's settings, none of its test data.
  insert into app.centers (slug, name, short_name, tradition, time_zone, country, state_region, currency, branding, feature_flags,
                           rules, status, environment)
  values (p.slug, s.name, s.short_name, s.tradition, s.time_zone, s.country, s.state_region, s.currency, s.branding, s.feature_flags,
          jsonb_set(coalesce(s.rules, '{}'::jsonb), '{onboarding}',
                    coalesce(s.rules->'onboarding', '{}'::jsonb) - 'production_slug'
                      || jsonb_build_object('promoted_from', s.id, 'promotion_id', p.id, 'promoted_at', now())),
          'onboarding', 'production')
  returning id into v_prod;

  create temp table if not exists promotion_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  truncate pg_temp.promotion_map;
  foreach t in array app.promotion_config_tables() loop
    v_tables := v_tables || app.promotion_copy_table(t, s.id, v_prod);
  end loop;

  -- Setup progress for the configuration stages (0–3) carries over; records,
  -- history and go-live start again in production.
  insert into app.center_setup_steps (center_id, step_key, status, due_on, notes, completed_by, completed_at)
  select v_prod, cs.step_key, cs.status, cs.due_on, cs.notes, cs.completed_by, cs.completed_at
    from app.center_setup_steps cs join app.setup_steps st2 on st2.key = cs.step_key
   where cs.center_id = s.id and st2.stage <= 3 and cs.step_key not like 'svc.%';

  -- The owner becomes the production owner (first administrator).
  v_owner := p.requested_by;
  select pe.first_name, pe.last_name, pe.email, pe.phone_e164 into sp
    from app.center_users cu join app.people pe on pe.id = cu.person_id where cu.center_id = s.id and cu.user_id = v_owner;
  insert into app.households (center_id, display_name)
  values (v_prod, btrim(coalesce(sp.first_name, 'Owner') || ' ' || coalesce(sp.last_name, '')) || ' household')
  returning id into v_household;
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
  values (v_prod, coalesce(sp.first_name, 'Owner'), coalesce(sp.last_name, ''), sp.email, sp.phone_e164) returning id into v_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (v_household, v_person, v_prod, 'primary', true);
  insert into app.center_users (center_id, user_id, person_id) values (v_prod, v_owner, v_person);
  insert into app.role_grants (center_id, user_id, role_key, scope_kind, granted_by, reason)
  values (v_prod, v_owner, 'center_admin', 'center', v_owner, 'Promoted from sandbox ' || s.slug);
  perform app.ensure_center_owner(v_prod);

  -- Everyone else on the sandbox staff is invited again (roles held center-wide).
  for st in
    select g.user_id, lower(u.email) as email, array_agg(distinct g.role_key order by g.role_key) as roles,
           min(pe.first_name) as first_name, min(pe.last_name) as last_name
      from app.role_grants g join app.roles r on r.key = g.role_key and r.tier in ('center','operational')
      join auth.users u on u.id = g.user_id
      left join app.center_users cu on cu.center_id = g.center_id and cu.user_id = g.user_id
      left join app.people pe on pe.id = cu.person_id
     where g.center_id = s.id and g.user_id <> v_owner and g.scope_kind = 'center' and g.status = 'active'
       and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()) and u.email is not null
     group by g.user_id, u.email
  loop
    v_token := app.new_invitation_token();
    insert into app.staff_invitations (center_id, email, first_name, last_name, role_keys, invited_by, token_hash, expires_at)
    values (v_prod, st.email, st.first_name, st.last_name, st.roles, v_owner, app.invitation_token_hash(v_token), now() + interval '7 days');
    v_mail := app.platform_send_message(st.email, 'staff_invitation',
                jsonb_build_object('center_name', s.name, 'invite_path', '/invite/' || v_token, 'roles', to_jsonb(st.roles)),
                'notification');
    v_mail_status := v_mail_status || app.message_status_text(v_mail);
    v_invited := v_invited + 1;
  end loop;

  update app.centers set sandbox_for = v_prod where id = s.id;
  update app.sandbox_promotions
     set status = 'done', production_id = v_prod, finished_at = now(), last_error = null,
         result = jsonb_build_object('production_id', v_prod, 'slug', p.slug, 'tables', v_tables, 'staff_reinvited', v_invited,
                                     'invitation_emails', to_jsonb(v_mail_status))
   where id = p.id;
  return (select result from app.sandbox_promotions where id = p.id);
end $$;

create or replace function app.worker_promotion_failed(p_promotion uuid, p_error text, p_final boolean default false) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.sandbox_promotions set last_error = left(p_error, 2000),
         status = case when p_final then 'failed' else status end,
         finished_at = case when p_final then now() else finished_at end
   where id = p_promotion and status = 'queued';
end $$;

-- A promoted production center going live closes its go-live request.
create or replace function app.centers_golive_live() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' and new.environment = 'production' then
    update app.golive_requests g set status = 'live'
      from app.centers s where s.sandbox_for = new.id and g.center_id = s.id and g.status = 'approved';
    update app.golive_requests set status = 'live' where center_id = new.id and status = 'approved';
  end if;
  return null;
end $$;
drop trigger if exists centers_golive_live on app.centers;
create trigger centers_golive_live after update of status on app.centers
  for each row execute function app.centers_golive_live();

-- ── Sandbox expiry warnings (worker, daily) ──────────────────────────────────
-- The last activity: the newest audited change made by a signed-in person in
-- the sandbox (jobs and the system do not count), else its creation.
create or replace function app.sandbox_last_activity(p_center uuid) returns timestamptz
language sql stable security definer set search_path = app, public, extensions as $$
  select greatest((select c.created_at from app.centers c where c.id = p_center),
                  (select max(l.occurred_at) from app.audit_log l where l.center_id = p_center and l.actor_user_id is not null))
$$;

create or replace function app.worker_sandbox_expiry() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; v_last timestamptz; v_days int; v_expiry int; th int; v_mail jsonb; v_sent int := 0; v_email text;
        v_out jsonb := '[]'::jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for c in select x.id, x.slug::text as slug, x.name from app.centers x where x.environment = 'sandbox' and x.sandbox_for is null loop
    v_expiry := coalesce((app.entitlement(c.id, 'expiry_days_inactive') #>> '{}')::int, null);
    continue when v_expiry is null;
    v_last := app.sandbox_last_activity(c.id);
    v_days := floor(extract(epoch from now() - v_last) / 86400)::int;
    -- Warnings at 60 and 80 days of a 90-day expiry (scaled for other values).
    foreach th in array array[round(v_expiry * 2.0 / 3)::int, round(v_expiry * 8.0 / 9)::int] loop
      continue when v_days < th;
      continue when exists (select 1 from app.sandbox_expiry_notices n where n.center_id = c.id and n.threshold_days = th
                                                                        and n.last_activity_at = v_last);
      -- Only the highest threshold reached in this cycle is emailed.
      continue when th < round(v_expiry * 8.0 / 9)::int and v_days >= round(v_expiry * 8.0 / 9)::int;
      select lower(u.email) into v_email from app.center_owners o join auth.users u on u.id = o.user_id where o.center_id = c.id;
      v_mail := case when v_email is null then jsonb_build_object('status', 'failed', 'error', 'the sandbox has no owner')
                     else app.platform_send_message(v_email, 'sandbox_expiry',
                            jsonb_build_object('org_name', c.name, 'slug', c.slug, 'inactive_days', v_days, 'expiry_days', v_expiry,
                                               'last_activity_at', v_last), 'notification') end;
      perform app.set_audit_context('Sandbox inactive for ' || v_days || ' days (warning at ' || th || ')');
      insert into app.sandbox_expiry_notices (center_id, threshold_days, last_activity_at, email_status)
      values (c.id, th, v_last, app.message_status_text(v_mail));
      v_sent := v_sent + 1;
      v_out := v_out || jsonb_build_object('center', c.slug, 'threshold_days', th, 'inactive_days', v_days, 'email', app.message_status_text(v_mail));
    end loop;
  end loop;
  return jsonb_build_object('warnings', v_sent, 'details', v_out);
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.promotion_config_tables(), app.promotion_copy_table(text, uuid, uuid), app.worker_promote_sandbox(uuid),
  app.worker_promotion_failed(uuid, text, boolean), app.centers_golive_live(), app.sandbox_last_activity(uuid),
  app.worker_sandbox_expiry() from public, anon, authenticated;
revoke execute on function app.promote_sandbox(uuid, text, text) from public, anon;
grant execute on function app.promote_sandbox(uuid, text, text) to authenticated;
grant execute on function app.worker_promote_sandbox(uuid), app.worker_promotion_failed(uuid, text, boolean),
  app.worker_sandbox_expiry() to connect_worker;
grant execute on all functions in schema app to service_role;
