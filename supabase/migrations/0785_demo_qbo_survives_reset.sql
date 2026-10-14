-- 0785 · A demo community keeps its QuickBooks setup across its nightly reset (B88; docs/DEMO_QUICKBOOKS.md).
--
-- The demo communities (0627-0629, 0678-0679) start over every night: app.demo_populate clears the community and loads its pack
-- again. A clear keeps the QuickBooks CONNECTION and the lists pulled from it (0310 demo_keep_tables, 0580) but removes
--   * the account mapping (app.qbo_account_mappings: which QuickBooks account each kind of money posts to), and
--   * the QuickBooks class of every fund and the QuickBooks account of every bank account (columns of rows the clear deletes
--     and the pack loads again).
-- The connection still says "mapping approved" and "test post approved", so after the first night QuickBooks looked connected
-- but the poster refused (app.qbo_post_ready: a required account is not mapped) and the treasurer had to map and approve again
-- every day. That is no way to show QuickBooks. This migration makes a demo community behave the way a real one does:
--
--   1. The account mapping of a DEMO community is not cleared. Every other sandbox (JSH's, a new organization's) clears exactly
--      what it cleared before: the rule is added to app.demo_clear_filter, which is where each table's condition lives, so the
--      list of kept tables that every sandbox shares (app.demo_keep_tables) is not touched.
--   2. A fund's class and a bank account's QuickBooks account are remembered across the reload (app.demo_qbo_links) and put back
--      on the freshly loaded rows. Record ids are stable (app.demo_id: the same ids every load, 0629), so a remembered id finds
--      its row again. The change goes through the same applier a confirmed request uses (app._apply_account_mapping), so the
--      database guards of 0779 are satisfied by the real route and not bypassed. A choice that can no longer be restored
--      (an account made inactive in QuickBooks, say) is skipped with a warning and never stops the reset: the poster then says
--      plainly which account is missing, as it does anywhere else.
--
-- Nothing changes for a community that is not a demo, no policy or grant of an existing object is changed, and nothing is posted
-- or sent. app.demo_populate is 0679's body with the two marked calls added; app.demo_clear_filter is 0310's with one more case.
set client_min_messages = warning;

-- ── What to put back ─────────────────────────────────────────────────────────
create table if not exists app.demo_qbo_links (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  subject    text not null check (subject in ('fund_class', 'bank_account')),
  row_id     uuid not null,                 -- the fund / bank account (stable id: app.demo_id)
  qbo_id     text not null,                 -- the QuickBooks class / account id it was linked to
  saved_at   timestamptz not null default now(),
  unique (center_id, subject, row_id)
);
comment on table app.demo_qbo_links is
  'What a demo community''s reset puts back after it loads the pack again (0785): the QuickBooks class of each fund and the QuickBooks account of each bank account. Written and read only by app.demo_qbo_save / app.demo_qbo_restore; kept by a clear (app.demo_keep_tables).';
alter table app.demo_qbo_links enable row level security;
revoke all on app.demo_qbo_links from public, anon, authenticated;
grant all on app.demo_qbo_links to service_role;
drop trigger if exists audit_demo_qbo_links on app.demo_qbo_links;
create trigger audit_demo_qbo_links after insert or update or delete on app.demo_qbo_links
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('demo_qbo_links', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- A clear leaves it alone (it is bookkeeping about the demo community, not demo data). 0580's list plus this table.
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs',
    -- 0785: what a demo community's reset puts back
    'demo_qbo_links'
  ]::text[]
$$;

-- ── Which rows a clear removes: 0310's conditions, plus the demo community's account mapping stays ───────────────
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
    -- 0785: a demo community's QuickBooks account mapping stays (it is part of how the demo is connected, and the connection
    -- itself stays); every other sandbox still clears it.
    when 'qbo_account_mappings' then format('%1$s.center_id = $1 and not app.is_demo_center($1)', a)
    when 'gyan_levels' then format('%1$s.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)', a)
    when 'gyan_steps' then format('%1$s.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)', a)
    else format('%1$s.center_id = $1', a)
  end;
end $$;

-- ── Remember, and put back ───────────────────────────────────────────────────
-- Before a reset clears the community: write down the QuickBooks class of each fund and the QuickBooks account of each bank
-- account (replacing what was written down last time, so a change made since is what comes back).
create or replace function app.demo_qbo_save(p_center uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int := 0; k int;
begin
  if not app.is_demo_center(p_center) then return 0; end if;
  delete from app.demo_qbo_links where center_id = p_center;
  insert into app.demo_qbo_links (center_id, subject, row_id, qbo_id)
  select f.center_id, 'fund_class', f.id, f.qbo_class_id
    from app.funds f where f.center_id = p_center and nullif(btrim(coalesce(f.qbo_class_id, '')), '') is not null;
  get diagnostics k = row_count; n := n + k;
  insert into app.demo_qbo_links (center_id, subject, row_id, qbo_id)
  select b.center_id, 'bank_account', b.id, b.qbo_account_id
    from app.bank_accounts b where b.center_id = p_center and nullif(btrim(coalesce(b.qbo_account_id, '')), '') is not null;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- After the pack is loaded again: put each remembered link back on its row, through the same applier a confirmed request uses.
-- One that cannot be put back is skipped (the poster names the account that is missing); it never stops the reset.
create or replace function app.demo_qbo_restore(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_ok int := 0; v_skipped int := 0;
begin
  if not app.is_demo_center(p_center) then return jsonb_build_object('restored', 0, 'skipped', 0); end if;
  for r in select l.subject, l.row_id, l.qbo_id from app.demo_qbo_links l where l.center_id = p_center order by l.subject, l.row_id loop
    begin
      if r.subject = 'fund_class' and exists (select 1 from app.funds f where f.id = r.row_id and f.center_id = p_center) then
        perform app._apply_account_mapping(p_center, 'fund_class', r.row_id::text, r.qbo_id, 'confirmed');
        v_ok := v_ok + 1;
      elsif r.subject = 'bank_account' and exists (select 1 from app.bank_accounts b where b.id = r.row_id and b.center_id = p_center) then
        perform app._apply_account_mapping(p_center, 'bank_account', r.row_id::text, r.qbo_id, 'confirmed');
        v_ok := v_ok + 1;
      else
        v_skipped := v_skipped + 1;   -- the pack no longer has that row
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      raise warning 'demo QuickBooks link not restored (% %): %', r.subject, r.row_id, sqlerrm;
    end;
  end loop;
  perform set_config('app.account_map_apply', '', true);
  return jsonb_build_object('restored', v_ok, 'skipped', v_skipped);
end $$;

-- ── The reset calls them (0679's body, two marked lines added) ────────────────
create or replace function app.demo_populate(p_center uuid, p_operation text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; v_pack text; v_cleared jsonb := '{}'::jsonb; v_loaded jsonb; v_personas int; v_missing text[]; v_actor uuid;
        v_steps int; v_qbo jsonb := '{}'::jsonb;
begin
  perform 1 from app.centers where id = p_center for update;
  if not app.is_demo_center(p_center) then
    raise exception 'This is not a demo community, so nothing was changed.';
  end if;
  -- Sandbox only, never live, never promoted: the same guard that protects every sandbox from a clear.
  perform app.demo_assert_sandbox(p_center);
  v_pack := (select c.rules->>'demo_pack' from app.centers c where c.id = p_center);
  select * into p from app.demo_packs where key = v_pack and content is not null;
  if p.key is null then raise exception 'This demo community has no pack to load.'; end if;
  v_actor := coalesce(p_actor, app.demo_actor(p_center));
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Demo community · ' || case p_operation when 'reset' then 'reset' else 'create' end || ' · ' || p.title, p_center);
  insert into app.center_demo_state (center_id) values (p_center) on conflict (center_id) do nothing;
  if p_operation = 'reset' then
    perform app.demo_qbo_save(p_center);           -- 0785: the QuickBooks classes and accounts are written down before they go
    perform app.demo_unlink_personas(p_center);   -- 0679: the demo sign-ins are taken apart, so nothing a visitor changed is kept
    v_cleared := app.demo_clear_center(p_center);
    -- Member and household numbers start again from the beginning, so every night gives the same numbers (a clear keeps
    -- the numbering of a real organization; a demo community has nothing to protect).
    delete from app.number_sequences where center_id = p_center;
    -- A new community gets its standard family-relationship choices from a trigger (0491); a clear removes them with the
    -- rest, so put the same ones back.
    insert into app.relationship_options (center_id, name, sort) values
      (p_center, 'Spouse', 1), (p_center, 'Child', 2), (p_center, 'Parent', 3), (p_center, 'Sibling', 4),
      (p_center, 'Grandparent', 5), (p_center, 'Grandchild', 6), (p_center, 'Guardian', 7),
      (p_center, 'Other relative', 8), (p_center, 'Other', 9)
    on conflict (center_id, name) do nothing;
  end if;
  v_loaded := app.demo_load_pack(p_center, p.key, v_actor);
  v_qbo := app.demo_qbo_restore(p_center);         -- 0785: and put back on the freshly loaded funds and bank accounts
  v_personas := app.demo_make_personas(p_center, p.key);
  if v_personas <> jsonb_array_length(p.content->'personas') then
    raise exception 'The demo pack % names % demo people but only % could be made (a person or role is missing).',
      p.key, jsonb_array_length(p.content->'personas'), v_personas;
  end if;
  v_missing := app.demo_missing_roles(p_center);
  if cardinality(v_missing) > 0 then
    raise exception 'The demo pack % has no demo person for these roles: %.', p.key, array_to_string(v_missing, ', ');
  end if;
  perform app.demo_link_personas(p_center);   -- 0679: and put back on the freshly loaded people
  v_steps := jsonb_array_length(p.content->'order');
  update app.center_demo_state
     set pack_key = p.key, version = p.version, status = 'loaded',
         operation = case when p_operation = 'reset' then 'reset' else 'activate' end, reason = 'Demo community',
         requested_by = coalesce(auth.uid(), requested_by), requested_at = now(), steps_done = v_steps, steps_total = v_steps, step_label = null,
         load_seed = p_center, loaded_at = now(), loaded_by = v_actor,
         cleared_at = case when p_operation = 'reset' then now() else cleared_at end,
         cleared_by = case when p_operation = 'reset' then v_actor else cleared_by end,
         last_error = null,
         detail = jsonb_build_object('loaded', v_loaded->'loaded', 'cleared', v_cleared->'removed', 'personas', v_personas, 'quickbooks', v_qbo),
         updated_at = now()
   where center_id = p_center;
  return jsonb_build_object('center_id', p_center, 'loaded', v_loaded->'loaded', 'personas', v_personas);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.demo_qbo_save(uuid), app.demo_qbo_restore(uuid) from public, anon, authenticated;
