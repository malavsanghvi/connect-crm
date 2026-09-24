-- Wave 2 (stream s-core) · 2 of 5: modules an organization can switch on and off.
--
--   app.modules         the catalog (18 modules; `core` ones can never be off)
--   app.center_modules  one row per switch a center has flipped. NO ROW = ON, so
--                       every existing center keeps every module.
--   app.module_tables   which module each app table belongs to (NULL = core platform)
--
-- A switch only ever restricts: 0103 adds restrictive RLS and 0104 guards the
-- module RPCs. Switching happens only through app.set_module_enabled(), which
-- needs settings.manage (or a platform admin) and a reason, and is audited.

create table if not exists app.modules (
  key         text primary key,
  label       text not null,
  description text not null default '',
  core        boolean not null default false,
  depends_on  text[] not null default '{}',
  sort        int not null default 0
);

insert into app.modules (key, label, description, core, depends_on, sort) values
  ('people',     'Members & families',      'Households, people, household members, directory, zones, change requests and merging duplicates.', true,  '{}', 1),
  ('membership', 'Membership',              'Membership types, memberships, applications, the new-member workflow and voting eligibility.', false, '{people}', 2),
  ('events',     'Events & RSVP',           'Events, templates, RSVPs, attendees, tickets, check-in, lunch slots, event volunteers and feedback.', false, '{people}', 3),
  ('giving',     'Pledges & donations',     'Funds, campaigns, opportunities, pledges, payments, allocations, recurring gifts, labh, receipts, statements, bank and bhandar counting.', false, '{people}', 4),
  ('bolis',      'Bolis',                   'Bolis, boli entries and in-person upload.', false, '{giving}', 5),
  ('store',      'Satvik Store',            'Store items, categories, inventory, orders and pickup windows.', false, '{people}', 6),
  ('pathshala',  'Pathshala',               'Terms, tracks, levels, classes, teachers, enrollments, sessions, attendance, progress reports and the committee.', false, '{people}', 7),
  ('gyan_path',  'Gyan Path (learning)',    'Gyan goals, levels, steps, progress and teacher sign-offs.', false, '{}', 8),
  ('jain_way',   'My Jain Way',             'Practices, selections, logs, streaks, points, Saathi, anumodana, pachchakhan and daily timings.', false, '{}', 9),
  ('content',    'Content & library',       'Content items, library, guide sections, the committee roster, photos and albums.', false, '{}', 10),
  ('calendar',   'Calendar',                'Calendar layers, calendar entries and tithi days.', false, '{}', 11),
  ('comms',      'Communications',          'Campaigns and newsletters, messages, templates, inbox threads, WhatsApp groups and requests, alerts, notification topics and push devices.', false, '{people}', 12),
  ('surveys',    'Surveys & data',          'Surveys, survey responses and saved segments.', false, '{}', 13),
  ('volunteers', 'Volunteers',              'Volunteer groups, shifts, assignments, interests and background checks.', false, '{people}', 14),
  ('accounting', 'Accounting & QuickBooks', 'QuickBooks mappings, ledger postings, payouts, accounting periods and the sync log.', false, '{giving}', 15),
  ('reports',    'Reports & dashboard',     'Center health and the public community dashboard.', false, '{}', 16),
  ('niva',       'Niva assistant',          'Niva conversations.', false, '{content}', 17),
  ('governance', 'Governance',              'Resolutions, votes, concerns and comments.', false, '{people}', 18)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;

create table if not exists app.center_modules (
  center_id  uuid not null references app.centers(id) on delete cascade,
  module_key text not null references app.modules(key),
  enabled    boolean not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  reason     text,
  primary key (center_id, module_key)
);
create index if not exists center_modules_off_idx on app.center_modules (module_key, center_id) where not enabled;

create table if not exists app.module_tables (
  table_name text primary key,
  module_key text references app.modules(key)   -- NULL: core platform, never switched off
);

insert into app.module_tables (table_name, module_key) values
  -- core platform
  ('accounts', null), ('audit_log', null), ('center_modules', null), ('center_users', null), ('centers', null),
  ('consents', null), ('data_requests', null), ('import_runs', null), ('integration_connections', null),
  ('module_tables', null), ('modules', null), ('number_sequences', null), ('role_grants', null), ('roles', null),
  ('webhook_events', null),
  -- Legal documents back the consent flow (terms, privacy), which is core
  -- platform; they stay readable when Content is switched off.
  ('legal_documents', null),
  -- people (core module)
  ('households', 'people'), ('people', 'people'), ('household_members', 'people'), ('zones', 'people'),
  ('household_change_requests', 'people'), ('merge_candidates', 'people'), ('person_emails', 'people'),
  ('external_ids', 'people'), ('special_days', 'people'),
  -- membership
  ('membership_types', 'membership'), ('memberships', 'membership'), ('membership_applications', 'membership'),
  ('eligibility_snapshots', 'membership'),
  -- events
  ('event_templates', 'events'), ('event_template_items', 'events'), ('events', 'events'), ('actions', 'events'),
  ('rsvps', 'events'), ('attendees', 'events'), ('lunch_slots', 'events'), ('scan_log', 'events'),
  -- giving
  ('funds', 'giving'), ('campaigns', 'giving'), ('opportunities', 'giving'), ('pledges', 'giving'),
  ('payments', 'giving'), ('payment_allocations', 'giving'), ('recurring_gifts', 'giving'), ('statements', 'giving'),
  ('counting_sessions', 'giving'), ('valuables_register', 'giving'), ('bank_accounts', 'giving'),
  ('bank_statement_imports', 'giving'), ('bank_transactions', 'giving'), ('known_originators', 'giving'),
  ('receipt_templates', 'giving'), ('labh_options', 'giving'), ('labh_fulfillments', 'giving'),
  -- bolis
  ('bolis', 'bolis'), ('boli_entries', 'bolis'),
  -- store
  ('store_categories', 'store'), ('store_items', 'store'), ('pickup_windows', 'store'), ('store_orders', 'store'),
  ('store_order_lines', 'store'), ('inventory_movements', 'store'),
  -- pathshala
  ('pathshala_terms', 'pathshala'), ('pathshala_tracks', 'pathshala'), ('pathshala_levels', 'pathshala'),
  ('pathshala_classes', 'pathshala'), ('pathshala_teachers', 'pathshala'), ('pathshala_enrollments', 'pathshala'),
  ('pathshala_sessions', 'pathshala'), ('pathshala_attendance', 'pathshala'), ('pathshala_progress_reports', 'pathshala'),
  ('class_announcements', 'pathshala'), ('teacher_positions', 'pathshala'), ('teacher_applications', 'pathshala'),
  -- gyan_path
  ('gyan_goals', 'gyan_path'), ('gyan_levels', 'gyan_path'), ('gyan_steps', 'gyan_path'), ('gyan_progress', 'gyan_path'),
  ('gyan_signoffs', 'gyan_path'),
  -- jain_way
  ('practices', 'jain_way'), ('practice_selections', 'jain_way'), ('practice_logs', 'jain_way'), ('points_ledger', 'jain_way'),
  ('streaks', 'jain_way'), ('saathi_settings', 'jain_way'), ('anumodana', 'jain_way'), ('daily_timings', 'jain_way'),
  -- content
  ('content_items', 'content'), ('photo_albums', 'content'), ('photos', 'content'), ('guide_sections', 'content'),
  ('role_roster', 'content'),
  -- calendar
  ('calendar_layers', 'calendar'), ('calendar_entries', 'calendar'), ('tithi_days', 'calendar'),
  -- comms
  ('notification_topics', 'comms'), ('notification_preferences', 'comms'), ('channel_optins', 'comms'),
  ('push_devices', 'comms'), ('message_templates', 'comms'), ('messages', 'comms'), ('comms_campaigns', 'comms'),
  ('inboxes', 'comms'), ('threads', 'comms'), ('thread_messages', 'comms'), ('whatsapp_groups', 'comms'),
  ('whatsapp_join_requests', 'comms'), ('alerts', 'comms'),
  -- surveys
  ('surveys', 'surveys'), ('survey_responses', 'surveys'), ('saved_segments', 'surveys'),
  -- volunteers
  ('volunteer_groups', 'volunteers'), ('volunteer_shifts', 'volunteers'), ('volunteer_assignments', 'volunteers'),
  ('volunteer_interests', 'volunteers'), ('background_checks', 'volunteers'),
  -- accounting
  ('qbo_account_mappings', 'accounting'), ('ledger_postings', 'accounting'), ('accounting_periods', 'accounting'),
  ('payouts', 'accounting'), ('sync_log', 'accounting'),
  -- reports
  ('public_kpi_settings', 'reports'),
  -- niva
  ('niva_conversations', 'niva'),
  -- governance
  ('concerns', 'governance'), ('resolutions', 'governance'), ('resolution_comments', 'governance'),
  ('resolution_votes', 'governance')
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Reads ────────────────────────────────────────────────────────────────────

-- One primary-key probe. A NULL center (a global row) is never switched off.
create or replace function app.module_enabled(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not exists (select 1 from app.center_modules
                      where center_id = p_center and module_key = p_module and not enabled)
$$;

-- Centers that switched a module off. Policies call it as an InitPlan
-- ((select ...)), so a query evaluates it once instead of once per row.
create or replace function app.module_off_centers(p_module text) returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(center_id), '{}') from app.center_modules where module_key = p_module and not enabled
$$;

-- For RPCs: raises in plain English when the module is off. Platform admins
-- pass, as they do in the RLS policies. Returns true so SQL functions can use
-- it in a WHERE clause.
create or replace function app.assert_module_enabled(p_center uuid, p_module text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if app.module_enabled(p_center, p_module) or app.is_platform_admin() then return true; end if;
  raise exception 'The % module is switched off for this community.',
    coalesce((select label from app.modules where key = p_module), p_module)
    using errcode = 'insufficient_privilege', hint = 'An administrator can switch it on in Settings › Modules.';
end $$;

create or replace function app.my_modules(p_center uuid)
returns table (key text, label text, enabled boolean, core boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select m.key, m.label, m.core or app.module_enabled(p_center, m.key), m.core
    from app.modules m
   where app.is_member_of(p_center) or app.has_permission(p_center, 'settings.manage')
   order by m.sort, m.key
$$;

-- ── The switch ───────────────────────────────────────────────────────────────

create or replace function app.set_module_enabled(p_center uuid, p_module text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.modules; v_names text;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Switching modules on or off needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select * into m from app.modules where key = p_module;
  if m.key is null then raise exception 'There is no module called "%".', p_module; end if;
  if p_enabled is null then raise exception 'Choose whether to switch the % module on or off.', m.label; end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for switching the % module %. It goes in the audit log.', m.label,
      case when p_enabled then 'on' else 'off' end;
  end if;
  -- One switch at a time per community, so two admins cannot race a dependency.
  perform pg_advisory_xact_lock(hashtextextended('app.center_modules:' || p_center::text, 0));

  if not p_enabled then
    if m.core then
      raise exception 'The % module is part of the core platform and cannot be switched off.', m.label;
    end if;
    select string_agg(d.label, ', ' order by d.sort) into v_names
      from app.modules d
     where p_module = any(d.depends_on) and (d.core or app.module_enabled(p_center, d.key));
    if v_names is not null then
      raise exception 'The % module cannot be switched off while % %, which depends on it. Switch that off first.',
        m.label, v_names, case when v_names like '%,%' then 'are on' else 'is on' end;
    end if;
  else
    select string_agg(d.label, ', ' order by d.sort) into v_names
      from app.modules d
     where d.key = any(m.depends_on) and not d.core and not app.module_enabled(p_center, d.key);
    if v_names is not null then
      raise exception 'The % module needs % switched on first.', m.label, v_names;
    end if;
  end if;

  perform app.set_audit_context(p_reason);
  insert into app.center_modules (center_id, module_key, enabled, changed_by, changed_at, reason)
  values (p_center, p_module, p_enabled, auth.uid(), now(), app.audit_clean_reason(p_reason))
  on conflict (center_id, module_key) do update
    set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at, reason = excluded.reason;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────

alter table app.modules enable row level security;
alter table app.center_modules enable row level security;
alter table app.module_tables enable row level security;

drop policy if exists modules_read on app.modules;
create policy modules_read on app.modules for select to authenticated using (true);
drop policy if exists module_tables_read on app.module_tables;
create policy module_tables_read on app.module_tables for select to authenticated using (true);
-- Any member of the center (the member app needs it), its settings managers,
-- and platform admins. No write policies: writes go through set_module_enabled.
drop policy if exists center_modules_read on app.center_modules;
create policy center_modules_read on app.center_modules for select to authenticated
  using (center_id in (select app.my_center_ids()) or app.has_permission(center_id, 'settings.manage')
         or app.is_platform_admin());

revoke insert, update, delete, truncate on app.modules, app.center_modules, app.module_tables from anon, authenticated;
grant select on app.modules, app.center_modules, app.module_tables to authenticated;
grant all on app.modules, app.center_modules, app.module_tables to service_role;

grant execute on function app.module_enabled(uuid, text), app.module_off_centers(text) to anon, authenticated;
grant execute on function app.assert_module_enabled(uuid, text), app.my_modules(uuid),
  app.set_module_enabled(uuid, text, boolean, text) to authenticated;
revoke execute on function app.set_module_enabled(uuid, text, boolean, text) from public, anon;
grant execute on all functions in schema app to service_role;
