-- Onboarding · stream o-demo · 1 of 4: the Demo data pack — catalog, per-center state, the
-- sandbox-only guard and the machinery that clears a sandbox.
--
-- The owner (2026-09-24): "Create a 'Demo' data pack that would setup data for ALL various
-- streams … activate … clear entire Sandbox and repopulate it with test data again. This option
-- would NOT be available once the organization is in Live mode." Deleting data was explicitly
-- authorized for sandboxes only; this file makes deleting in production impossible in the
-- database itself, not just hidden in the portal:
--
--   app.demo_packs                  the catalog (key, version, title, description, contents)
--   app.center_demo_state           one row per center: which pack, status, progress, last run
--   app.demo_center_problem(c)      NULL when the center may hold demo data / be cleared; otherwise
--                                   the plain reason ("Demo data is only for sandboxes. …")
--   app.demo_assert_sandbox(c)      raises that reason (SQLSTATE CCDMO)
--   app.demo_clear_center(c)        deletes everything the organization entered or loaded, keeping
--                                   the organization itself (see "What clearing keeps" below).
--                                   Re-checks the guard with the center row locked, so a center
--                                   cannot become production half-way. Internal: callable only
--                                   from the worker functions in 0311.
--   app.demo_data_counts(c)         rows per table the pack and the organization's own data fill
--
-- What clearing keeps (contract o-demo): the center row, its owner, every login that holds an
-- active role (and their person, household, emails, consents and opt-ins), role grants,
-- agreements, integration connections and vault secrets and everything the providers returned
-- (QuickBooks lists and customers, payment processors, email domains, texting registrations …),
-- the organization's profile, brand kit, leaders and documents, the Setup checklist, go-live
-- records, entitlements, module switches, numbering, saved import mappings, message templates,
-- receipt templates, legal documents, member join codes, sandbox test recipients, the job
-- history and the audit log (never deleted). Everything else that belongs to the center —
-- setup data (stage 3), records (stage 4), history and transactions (stage 5) and every
-- module's activity — is removed. A new center table is cleared unless it is added to
-- app.demo_keep_tables(), so a new module never leaves rows pointing at removed people.
set client_min_messages = warning;

-- ── Catalog ──────────────────────────────────────────────────────────────────
create table if not exists app.demo_packs (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version      int not null check (version > 0),
  title        text not null check (btrim(title) <> ''),
  description  text not null default '',
  -- What the pack loads, per module: [{module, label, items: [{table, label, rows}]}]. The DB
  -- test loads the pack and checks these numbers against the rows it really creates.
  contents     jsonb not null default '[]'::jsonb check (jsonb_typeof(contents) = 'array'),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
comment on table app.demo_packs is 'Demo data packs a sandbox can load (o-demo). Deterministic content, dates relative to the day it is loaded.';
alter table app.demo_packs enable row level security;
drop policy if exists demo_packs_read on app.demo_packs;
create policy demo_packs_read on app.demo_packs for select to authenticated using (true);
revoke all on app.demo_packs from anon;
revoke insert, update, delete, truncate on app.demo_packs from authenticated;
grant select on app.demo_packs to authenticated;
grant all on app.demo_packs to service_role;
drop trigger if exists audit_demo_packs on app.demo_packs;
create trigger audit_demo_packs after insert or update or delete on app.demo_packs
  for each row execute function app.audit_row('key');

-- ── Per-center state ─────────────────────────────────────────────────────────
create table if not exists app.center_demo_state (
  center_id    uuid primary key references app.centers(id) on delete cascade,
  pack_key     text references app.demo_packs(key),
  version      int,
  status       text not null default 'empty' check (status in ('empty','loading','loaded','clearing','failed')),
  operation    text check (operation in ('activate','reset','clear')),
  reason       text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz,
  job_id       bigint,
  steps_done   int not null default 0,
  steps_total  int not null default 0,
  step_label   text,
  -- Ids of the records one load creates are derived from this seed (app.demo_id), so the
  -- load's steps (separate transactions, resumable) find each other's records.
  load_seed    uuid,
  loaded_at    timestamptz,
  loaded_by    uuid references auth.users(id),
  cleared_at   timestamptz,
  cleared_by   uuid references auth.users(id),
  last_error   text,
  -- {steps_completed: [..], counts_before, counts_after, loaded: {table: rows}, cleared: {table: rows}}
  detail       jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  updated_at   timestamptz not null default now()
);
comment on table app.center_demo_state is 'Demo data state per center (o-demo): which pack is loaded, the running load/clear and its progress, the last run. Written only by the demo RPCs and the worker.';
alter table app.center_demo_state enable row level security;
drop policy if exists center_demo_state_read on app.center_demo_state;
create policy center_demo_state_read on app.center_demo_state for select to authenticated
  using (app.is_platform_admin() or app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke all on app.center_demo_state from anon;
revoke insert, update, delete, truncate on app.center_demo_state from authenticated;
grant select on app.center_demo_state to authenticated;
grant all on app.center_demo_state to service_role;
drop trigger if exists audit_center_demo_state on app.center_demo_state;
create trigger audit_center_demo_state after insert or update or delete on app.center_demo_state
  for each row execute function app.audit_row('center_id');

insert into app.module_tables (table_name, module_key) values ('demo_packs', null), ('center_demo_state', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The guard: sandboxes only, never production, never once live or promoted ──
-- NULL = this center may load, clear and reset demo data. Otherwise the reason, in plain words.
create or replace function app.demo_center_problem(p_center uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return 'Demo data is only for sandboxes. This organization was not found.'; end if;
  if c.environment is distinct from 'sandbox' then
    return 'Demo data is only for sandboxes. ' || c.name || ' is a production organization, so its data can never be cleared or replaced with demo data.';
  end if;
  if c.sandbox_for is not null then
    return 'Demo data is only for sandboxes that have not gone live. This sandbox was promoted to production, so it is kept as it is.';
  end if;
  if c.status = 'active' then
    return 'Demo data is only for sandboxes. ' || c.name || ' is live.';
  end if;
  if c.status in ('suspended','exited') then
    return 'Demo data is only for open sandboxes. This sandbox is ' || c.status || '.';
  end if;
  return null;
end $$;

create or replace function app.demo_assert_sandbox(p_center uuid) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text := app.demo_center_problem(p_center);
begin
  if v is not null then
    raise exception using errcode = 'CCDMO', message = v, hint = 'Demo data is only for sandboxes.';
  end if;
end $$;

-- Who may load or clear demo data: the owner, or settings.manage (platform admins included).
create or replace function app.demo_can_manage(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (app.is_center_owner(p_center) or app.has_permission(p_center, 'settings.manage'))
$$;

-- The word an admin types to confirm a reset or clear: the short name, else the web name.
create or replace function app.demo_confirm_word(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(c.short_name), ''), c.slug::text) from app.centers c where c.id = p_center
$$;

-- A stable id for one record of one load (the pack's steps run in separate transactions).
create or replace function app.demo_id(p_seed uuid, p_ref text) returns uuid
language sql immutable set search_path = app, public, extensions as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    from (select md5(p_seed::text || ':' || p_ref) as h) x
$$;

-- The e-mail domain every demo person uses (never a real inbox).
create or replace function app.demo_email_domain() returns text
language sql immutable set search_path = app, public, extensions as $$ select 'demo.communityconnect.test'::text $$;

-- ── Which tables clearing leaves alone ───────────────────────────────────────
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2) and saved import mappings
    'legal_documents','message_templates','receipt_templates','import_mappings',
    -- history that is never deleted
    'audit_log','jobs'
  ]::text[]
$$;

-- Tables clearing works on: every app table with a center_id outside the keep list, plus the
-- Gyan Path levels and steps (they belong to a goal, not directly to a center).
create or replace function app.demo_clear_tables() returns text[]
language sql stable set search_path = app, public, extensions as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
          or c.relname in ('gyan_levels','gyan_steps'))
     and c.relname <> all (app.demo_keep_tables())
$$;

-- The rows of one table that clearing removes, as a SQL condition on alias p_alias ($1 = center).
-- The kept logins, their people and households are in temp tables made by demo_clear_center.
create or replace function app.demo_clear_filter(p_table text, p_alias text default 't') returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare a text := quote_ident(p_alias);
        kp text := '(select id from pg_temp.demo_keep_people)';
        kh text := '(select id from pg_temp.demo_keep_households)';
begin
  return case p_table
    when 'people' then format('%1$s.center_id = $1 and %1$s.id not in %2$s', a, kp)
    when 'households' then format('%1$s.center_id = $1 and %1$s.id not in %2$s', a, kh)
    when 'household_members' then format('%1$s.center_id = $1 and not (%1$s.person_id in %2$s and %1$s.household_id in %3$s)', a, kp, kh)
    when 'center_users' then format('%1$s.center_id = $1 and %1$s.user_id not in (select user_id from pg_temp.demo_keep_users)', a)
    -- A kept person keeps what is only about them: extra emails, opt-ins, consents, preferences.
    when 'person_emails' then format('%1$s.center_id = $1 and %1$s.person_id not in %2$s', a, kp)
    when 'channel_optins' then format('%1$s.center_id = $1 and %1$s.person_id not in %2$s', a, kp)
    when 'consents' then format('%1$s.center_id = $1 and %1$s.person_id not in %2$s', a, kp)
    when 'notification_preferences' then format('%1$s.center_id = $1 and %1$s.person_id not in %2$s', a, kp)
    when 'external_ids' then format('%1$s.center_id = $1 and coalesce(%1$s.person_id not in %2$s, true) and coalesce(%1$s.household_id not in %3$s, true)', a, kp, kh)
    -- Demo staff invitations go; the organization's own invitations stay.
    when 'staff_invitations' then format('%1$s.center_id = $1 and %1$s.accepted_at is null and lower(coalesce(%1$s.email, %2$L)) like %3$L',
                                         a, '', '%@' || app.demo_email_domain())
    -- The roster lines mirrored from the organization's leaders stay with the leaders.
    when 'role_roster' then format('%1$s.center_id = $1 and %1$s.org_leader_id is null', a)
    when 'gyan_levels' then format('%1$s.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)', a)
    when 'gyan_steps' then format('%1$s.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)', a)
    else format('%1$s.center_id = $1', a)
  end;
end $$;

-- The order to delete in (tables nothing still points at first) and the nullable references to
-- clear first where two tables point at each other (bolis ↔ boli_entries, payments ↔ bank lines).
-- Worked out from the database's own foreign keys, so a new table needs no change here.
create or replace function app.demo_clear_plan() returns jsonb
language plpgsql set search_path = app, public, extensions as $$
declare v_tables text[] := app.demo_clear_tables(); v_left text[] := app.demo_clear_tables(); v_ready text[];
        v_order text[] := '{}'; v_nulls jsonb := '[]'::jsonb; e record;
begin
  create temp table if not exists demo_plan_edges (child text, col text, parent text, nullable boolean, broken boolean) on commit drop;
  truncate pg_temp.demo_plan_edges;
  insert into pg_temp.demo_plan_edges
  select c.relname, a.attname, p.relname, not a.attnotnull, false
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
   where k.contype = 'f' and cardinality(k.conkey) = 1 and n.nspname = 'app' and pn.nspname = 'app'
     and c.relname = any (v_tables) and p.relname = any (v_tables) and c.relname <> p.relname;
  while cardinality(v_left) > 0 loop
    select coalesce(array_agg(t order by t), '{}') into v_ready from unnest(v_left) t
     where not exists (select 1 from pg_temp.demo_plan_edges d where d.parent = t and d.child = any (v_left) and not d.broken);
    if cardinality(v_ready) = 0 then
      -- A cycle: clear one nullable reference inside it first.
      select * into e from pg_temp.demo_plan_edges d
       where d.child = any (v_left) and d.parent = any (v_left) and not d.broken and d.nullable
       order by d.child, d.col limit 1;
      if e.child is null then
        raise exception 'Clearing cannot work out an order for: % (a required reference cycle).', array_to_string(v_left, ', ');
      end if;
      update pg_temp.demo_plan_edges set broken = true where child = e.child and col = e.col;
      v_nulls := v_nulls || jsonb_build_object('table', e.child, 'column', e.col);
      continue;
    end if;
    v_order := v_order || v_ready;
    v_left := array(select t from unnest(v_left) t where t <> all (v_ready));
  end loop;
  return jsonb_build_object('order', to_jsonb(v_order), 'nulls', v_nulls);
end $$;

-- ── Points: append-only, except when a sandbox is cleared ────────────────────
-- points_ledger used the audit log's append-only trigger. It stays append-only everywhere
-- else; the one exception is app.demo_clear_center on a sandbox (checked again here, per row).
create or replace function app.points_ledger_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_op = 'DELETE' and current_setting('app.demo_clearing', true) = old.center_id::text
     and app.demo_center_problem(old.center_id) is null then
    return old;
  end if;
  raise exception 'points_ledger is append-only';
end $$;
drop trigger if exists points_ledger_immutable on app.points_ledger;
create trigger points_ledger_immutable before update or delete on app.points_ledger
  for each row execute function app.points_ledger_guard();

-- ── Clearing ─────────────────────────────────────────────────────────────────
create or replace function app.demo_clear_center(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_plan jsonb; t text; n bigint; v_counts jsonb := '{}'::jsonb; v_fixed jsonb := '{}'::jsonb; x jsonb; fk record;
        v_total bigint := 0; v_filter text;
begin
  -- Lock the center: its environment cannot change while it is being cleared.
  perform 1 from app.centers where id = p_center for update;
  perform app.demo_assert_sandbox(p_center);
  perform set_config('app.demo_clearing', p_center::text, true);

  -- Who and what stays: the owner and every login with an active role, their people and households.
  create temp table if not exists demo_keep_users (user_id uuid primary key) on commit drop;
  create temp table if not exists demo_keep_people (id uuid primary key) on commit drop;
  create temp table if not exists demo_keep_households (id uuid primary key) on commit drop;
  truncate pg_temp.demo_keep_users, pg_temp.demo_keep_people, pg_temp.demo_keep_households;
  insert into pg_temp.demo_keep_users
  select o.user_id from app.center_owners o where o.center_id = p_center
  union
  select g.user_id from app.role_grants g
   where g.center_id = p_center and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now());
  insert into pg_temp.demo_keep_people
  select distinct cu.person_id from app.center_users cu join pg_temp.demo_keep_users k on k.user_id = cu.user_id
   where cu.center_id = p_center;
  insert into pg_temp.demo_keep_households
  select distinct hm.household_id from app.household_members hm join pg_temp.demo_keep_people k on k.id = hm.person_id
   where hm.center_id = p_center and hm.left_at is null;

  v_plan := app.demo_clear_plan();

  -- 1. Rows that stay but point at rows that go: clear the reference (a required one stops everything).
  for fk in
    select c.relname as child, a.attname as col, not a.attnotnull as nullable, p.relname as parent
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and cardinality(k.conkey) = 1 and k.confdeltype in ('a','r')
       and n.nspname = 'app' and pn.nspname = 'app' and p.relname = any (app.demo_clear_tables())
       and (c.relname <> all (app.demo_clear_tables())
            or c.relname in ('people','households','household_members','center_users','person_emails','channel_optins',
                             'consents','notification_preferences','external_ids','staff_invitations','role_roster'))
       and a.attname <> 'center_id'
     order by c.relname, a.attname
  loop
    v_filter := case when fk.child = any (app.demo_clear_tables()) then ' and not (' || app.demo_clear_filter(fk.child, 't') || ')' else '' end;
    if not fk.nullable then
      execute format('select count(*) from app.%I t where t.%I in (select p.id from app.%I p where %s)%s',
                     fk.child, fk.col, fk.parent, app.demo_clear_filter(fk.parent, 'p'), v_filter) into n using p_center;
      if n > 0 then
        raise exception 'Clearing stopped: % %s that stay point at % rows being removed.', n, fk.child, fk.parent;
      end if;
      continue;
    end if;
    execute format('update app.%I t set %I = null where t.%I in (select p.id from app.%I p where %s)%s',
                   fk.child, fk.col, fk.col, fk.parent, app.demo_clear_filter(fk.parent, 'p'), v_filter) using p_center;
    get diagnostics n = row_count;
    if n > 0 then v_fixed := v_fixed || jsonb_build_object(fk.child || '.' || fk.col, n); end if;
  end loop;

  -- 2. Break the reference cycles among the rows that go.
  for x in select * from jsonb_array_elements(v_plan->'nulls') loop
    execute format('update app.%I t set %I = null where %s and t.%I is not null',
                   x->>'table', x->>'column', app.demo_clear_filter(x->>'table', 't'), x->>'column') using p_center;
  end loop;

  -- 3. Delete, children first.
  for t in select jsonb_array_elements_text(v_plan->'order') loop
    execute format('delete from app.%I t where %s', t, app.demo_clear_filter(t, 't')) using p_center;
    get diagnostics n = row_count;
    if n > 0 then v_counts := v_counts || jsonb_build_object(t, n); v_total := v_total + n; end if;
  end loop;

  -- 4. QuickBooks history that had been brought in waits again (its matches were removed).
  update app.qbo_transactions set cc_status = 'pending', cc_detail = null
   where center_id = p_center and cc_status in ('brought_in','needs_review') and cc_payment_id is null and cc_pledge_id is null;

  perform set_config('app.demo_clearing', '', true);
  return jsonb_build_object('removed', v_counts, 'removed_total', v_total, 'references_cleared', v_fixed,
                            'kept_logins', (select count(*) from pg_temp.demo_keep_users),
                            'kept_people', (select count(*) from pg_temp.demo_keep_people));
end $$;

-- ── What is in the center now ────────────────────────────────────────────────
-- Rows per clearable table (only tables with rows), for the Demo data screen and the checks.
create or replace function app.demo_data_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t text; n bigint; v jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null and not app.demo_can_manage(p_center) then
    raise exception 'Only the owner or an administrator with settings.manage can see this.' using errcode = '42501';
  end if;
  foreach t in array app.demo_clear_tables() loop
    execute format('select count(*) from app.%I t where %s', t,
                   case t when 'gyan_levels' then 't.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)'
                          when 'gyan_steps' then 't.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)'
                          else 't.center_id = $1' end) into n using p_center;
    if n > 0 then v := v || jsonb_build_object(t, n); end if;
  end loop;
  return v;
end $$;

revoke execute on function app.demo_clear_center(uuid), app.demo_clear_plan(), app.demo_clear_filter(text, text),
  app.demo_clear_tables(), app.points_ledger_guard() from public, anon, authenticated;
revoke execute on function app.demo_center_problem(uuid), app.demo_assert_sandbox(uuid), app.demo_can_manage(uuid),
  app.demo_confirm_word(uuid), app.demo_data_counts(uuid) from public, anon;
grant execute on function app.demo_center_problem(uuid), app.demo_can_manage(uuid), app.demo_confirm_word(uuid),
  app.demo_data_counts(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
