-- Onboarding Wave D · stream o-golive · 3 of 3: the Setup checklist, complete end to end
-- for an organization admin (ONBOARDING_PLAN §4; ONBOARDING_WAVE_D "o-golive").
--
--  * Every step's route now opens a working screen:
--      rec.* / hist.*           → /settings/import (the import engine's screen; "/imports" never existed)
--      test.* (health check, training, pilot) → /setup/go-live, where the owner confirms each one
--      svc.storage              → /settings/storage (new screen: areas, usage, retention)
--      data.numbering           → /settings/numbering (new screen: prefixes and next numbers)
--      tpl.messages             → /settings/email (senders, footer and a test send; the template
--                                 editor itself is deferred by the owner and the step says so)
--  * Every step whose completion the database can see is computed from real data
--    (auto = true): 2FA, the team, agreements, the vault, email, texting, WhatsApp, push,
--    QuickBooks and its chart of accounts, the statement approval, records and history
--    imports, recurring gifts, Niva, the owner's confirmations and the go-live request.
--    Everything else keeps its manual status (a person marks it).
--  * app.save_numbering(center, items, reason)       settings.manage; prefixes and next numbers
--  * app.center_storage_overview(center)             settings.manage; areas, limits, this org's usage
--
-- app.setup_auto_status is o-setup's (already wrapped by o-payments in 0213); it is wrapped
-- again here the same way, never rewritten.
set client_min_messages = warning;

-- ── Catalog: routes and what is computed ─────────────────────────────────────
update app.setup_steps set route = '/settings/import' where key in ('rec.people','rec.memberships','hist.giving','hist.statements','hist.other');
update app.setup_steps set route = '/setup/go-live' where key in ('test.health_check','test.training','test.pilot');
update app.setup_steps set route = '/settings/storage',
       done_means = 'The storage areas exist, and the retention of uploaded import files and Gyan Path recordings is reviewed.'
 where key = 'svc.storage';
update app.setup_steps set route = '/settings/numbering' where key = 'data.numbering';
update app.setup_steps set route = '/settings/email',
       help = 'The built-in Community Connect messages (sign-in code, receipts, invitations, …) are used with your brand and sender. '
              || 'Send yourself a test from Settings › Email. The template editor (customizing each message) comes in a later release.',
       done_means = 'A test message from your sender reached you, and the built-in messages are acceptable until the template editor arrives.'
 where key = 'tpl.messages';
update app.setup_steps set help = 'The owner confirms it in Setup › Go-live after running through the key journeys in the sandbox. '
              || 'A packaged, automatic health check comes in a later release.'
 where key = 'test.health_check';
update app.setup_steps set auto = true
 where key in ('svc.storage','org.security','org.team','org.agreements','svc.vault','svc.payments','svc.email','svc.texting','svc.whatsapp','svc.push',
               'svc.quickbooks','data.payment_methods','data.chart_of_accounts','tpl.statements','tpl.messages',
               'rec.people','rec.memberships','rec.staff','rec.store_items','rec.pathshala','hist.giving','hist.recurring',
               'niva.train','test.health_check','test.training','test.pilot','golive.request');

-- ── Computed statuses ────────────────────────────────────────────────────────
create or replace function app._golive_status(p_status text, p_detail text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('status', p_status, 'detail', p_detail)
$$;

-- Imports of the given entities: 'reconciled' when one was signed off, 'open' when one is
-- unfinished or not yet signed off, else null.
create or replace function app._golive_import_state(p_center uuid, p_entities text[]) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when exists (select 1 from app.import_runs r where r.center_id = p_center and r.entity = any (p_entities)
                  and r.status in ('pending','staged','previewed','committing','committed')) then 'open'
    when exists (select 1 from app.import_runs r where r.center_id = p_center and r.entity = any (p_entities)
                  and r.status = 'reconciled') then 'reconciled' end
$$;

create or replace function app.golive_setup_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  c app.centers; v jsonb := '{}'; ck jsonb; v_n int; v_m int; v_k int; v_state text; v_txt text; a jsonb;
  v_staff int; v_staff_2fa int; v_pending_inv int; v_pending_grants int; g app.golive_requests; pr app.sandbox_promotions;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return v; end if;

  -- 0.1 Staff security: every staff login (a center or operational role) has 2FA.
  select count(distinct gr.user_id), count(distinct gr.user_id) filter (where app.has_verified_totp(gr.user_id))
    into v_staff, v_staff_2fa
    from app.role_grants gr join app.roles r on r.key = gr.role_key and r.tier in ('center','operational')
   where gr.center_id = p_center and gr.status = 'active' and gr.starts_at <= now() and (gr.ends_at is null or gr.ends_at > now());
  v := v || jsonb_build_object('org.security', case
    when v_staff > 0 and v_staff = v_staff_2fa then app._golive_status('done', v_staff || ' of ' || v_staff || ' staff use two-factor sign-in')
    when v_staff > 0 then app._golive_status('in_progress', v_staff_2fa || ' of ' || v_staff || ' staff use two-factor sign-in')
    else app._golive_status('not_started', null) end);

  -- 0.5 Team: an owner and a second administrator with 2FA, and no invitation left waiting.
  select count(*) into v_pending_inv from app.staff_invitations
   where center_id = p_center and accepted_at is null and revoked_at is null and expires_at > now();
  select count(*) into v_pending_grants from app.role_grants where center_id = p_center and status = 'pending';
  ck := app.check_owner_and_second_admin_2fa(p_center);
  v := v || jsonb_build_object('org.team', case
    when (ck->>'ok')::boolean and v_pending_inv = 0 and v_pending_grants = 0 then app._golive_status('done', ck->>'detail')
    when (ck->>'ok')::boolean or v_pending_inv > 0 or v_pending_grants > 0 then app._golive_status('in_progress', concat_ws(' ',
      case when not (ck->>'ok')::boolean then ck->>'detail' end,
      case when v_pending_inv > 0 then v_pending_inv || ' invitation' || case when v_pending_inv = 1 then '' else 's' end || ' not accepted yet.' end,
      case when v_pending_grants > 0 then v_pending_grants || ' role grant' || case when v_pending_grants = 1 then '' else 's' end || ' waiting for a second approver (Settings › Roles).' end))
    else app._golive_status('not_started', ck->>'detail') end);

  -- 0.7 Agreements.
  ck := app.check_agreements_accepted(p_center);
  select count(*) into v_n from app.org_agreements where center_id = p_center and kind <> 'sandbox_terms';
  v := v || jsonb_build_object('org.agreements', case when (ck->>'ok')::boolean then app._golive_status('done', ck->>'detail')
    when v_n > 0 then app._golive_status('in_progress', ck->>'detail') else app._golive_status('not_started', ck->>'detail') end);

  -- 1.1 Vault: the background service that is the only reader of secrets is running.
  ck := app.check_background_service(p_center);
  select count(*) into v_n from app.integration_secrets where center_id = p_center;
  v := v || jsonb_build_object('svc.vault', case when (ck->>'ok')::boolean
    then app._golive_status('done', 'Ready · ' || v_n || ' credential' || case when v_n = 1 then '' else 's' end || ' stored (fingerprints only)')
    else app._golive_status('in_progress', ck->>'detail') end);

  -- 1.9 Storage: the areas exist (Community Connect creates them); the organization's own
  -- choices (retention of import files and recordings) were reviewed and saved.
  v := v || jsonb_build_object('svc.storage', case
    when c.rules #> '{storage,retention_days}' is not null then app._golive_status('done', 'Retention reviewed: import files '
         || coalesce(app.storage_retention_days('imports', p_center)::text, '—') || ' days, recordings '
         || coalesce(app.storage_retention_days('recordings', p_center)::text, '—') || ' days')
    else app._golive_status('not_started', 'The storage areas are ready; review and save the retention in Settings › Storage') end);

  -- 1.3 Email.
  ck := app.check_email_domain_verified(p_center);
  select string_agg(status, ',') into v_txt from app.email_domains where center_id = p_center;
  v := v || jsonb_build_object('svc.email', case when (ck->>'ok')::boolean then app._golive_status('done', ck->>'detail')
    when v_txt is null then app._golive_status('not_started', null)
    when v_txt like '%verified%' then app._golive_status('in_progress', ck->>'detail')
    when v_txt like '%pending%' then app._golive_status('waiting_on_provider', ck->>'detail')
    else app._golive_status('in_progress', ck->>'detail') end);

  -- 2.1 Message templates: the built-in library with a test message delivered from the sender.
  select count(*) into v_n from app.messages
   where center_id = p_center and channel = 'email' and purpose = 'test' and status in ('sent','delivered');
  v := v || jsonb_build_object('tpl.messages', case when v_n > 0
    then app._golive_status('done', 'A test email was delivered; the built-in messages are used until the template editor arrives')
    else app._golive_status('not_started', 'Send a test email from Settings › Email. The template editor comes in a later release.') end);

  -- 1.4 Texting.
  ck := app.check_texting_registered(p_center);
  select status into v_txt from app.texting_registrations where center_id = p_center order by updated_at desc limit 1;
  v := v || jsonb_build_object('svc.texting', case when (ck->>'ok')::boolean then app._golive_status('done', ck->>'detail')
    when v_txt = 'submitted' then app._golive_status('waiting_on_provider', ck->>'detail')
    when v_txt is not null then app._golive_status('in_progress', ck->>'detail')
    else app._golive_status('not_started', ck->>'detail') end);

  -- 1.5 WhatsApp.
  select status into v_txt from app.whatsapp_accounts where center_id = p_center order by updated_at desc limit 1;
  v := v || jsonb_build_object('svc.whatsapp', case v_txt
    when 'approved' then app._golive_status('done', 'WhatsApp number approved by Meta')
    when 'pending_meta' then app._golive_status('waiting_on_provider', 'Waiting for Meta to approve the number and templates')
    when 'rejected' then app._golive_status('in_progress', 'Meta rejected the request; see Settings › WhatsApp')
    else app._golive_status('not_started', null) end);

  -- 1.6 Push: a test push was delivered.
  select count(*) into v_n from app.messages
   where center_id = p_center and channel = 'push' and purpose = 'test' and status in ('sent','delivered');
  v := v || jsonb_build_object('svc.push', case when v_n > 0 then app._golive_status('done', 'A test push reached a phone')
    else app._golive_status('not_started', null) end);

  -- 1.7 QuickBooks: readiness check 7's own words.
  if app.module_enabled(p_center, 'accounting') then
    ck := app.check_quickbooks_ready(p_center);
    select count(*) into v_n from app.integration_connections
     where center_id = p_center and provider in ('quickbooks_online','intuit_sandbox') and status <> 'disconnected';
    v := v || jsonb_build_object('svc.quickbooks', case when (ck->>'ok')::boolean then app._golive_status('done', ck->>'detail')
      when v_n > 0 then app._golive_status('in_progress', ck->>'detail') else app._golive_status('not_started', ck->>'detail') end);
    select count(*) into v_n from app.qbo_accounts where center_id = p_center;
    if v_n > 0 then
      v := v || jsonb_build_object('data.chart_of_accounts', app._golive_status('done', v_n || ' accounts pulled from QuickBooks'));
    end if;
  end if;

  -- 2.2 Statements and receipts (readiness 8).
  a := app.golive_approval_state(p_center, 'statement_templates');
  v := v || jsonb_build_object('tpl.statements', case a->>'state'
    when 'current' then app._golive_status('done', 'Approved by the treasurer, ' || (a->>'approved_by_name'))
    when 'changed' then app._golive_status('in_progress', 'Changed since the treasurer approved it; approve the new version')
    else app._golive_status('not_started', 'The treasurer reviews and approves them in Giving › Receipts & statements') end);

  -- Stage 4 · records, stage 5 · history: imported (signed off) or entered.
  v_state := app._golive_import_state(p_center, array['households','people','household_members']);
  select count(*) into v_n from app.households where center_id = p_center and merged_into_id is null;
  v := v || jsonb_build_object('rec.people', case
    when v_state = 'reconciled' then app._golive_status('done', v_n || ' households; imports reconciled and signed off')
    when v_state = 'open' then app._golive_status('in_progress', 'An import is not finished or not signed off yet')
    when v_n > 1 then app._golive_status('in_progress', v_n || ' households entered; import and reconcile the rest')
    else app._golive_status('not_started', null) end);

  v_state := app._golive_import_state(p_center, array['memberships']);
  select count(*) into v_n from app.memberships where center_id = p_center;
  v := v || jsonb_build_object('rec.memberships', case
    when v_state = 'open' then app._golive_status('in_progress', 'A membership import is not finished or not signed off yet')
    when v_n > 0 then app._golive_status('done', v_n || ' membership' || case when v_n = 1 then '' else 's' end || case when v_state = 'reconciled' then '; import signed off' else '' end)
    else app._golive_status('not_started', null) end);

  select count(distinct gr.user_id) into v_n
    from app.role_grants gr join app.roles r on r.key = gr.role_key and r.tier in ('center','operational')
   where gr.center_id = p_center and gr.status = 'active' and gr.starts_at <= now() and (gr.ends_at is null or gr.ends_at > now());
  v := v || jsonb_build_object('rec.staff', case
    when v_n >= 2 and v_pending_inv = 0 and v_pending_grants = 0 then app._golive_status('done', v_n || ' staff with their roles')
    when v_n >= 2 or v_pending_inv > 0 or v_pending_grants > 0 then app._golive_status('in_progress', v_n || ' staff with active roles; '
         || v_pending_inv || ' invitation(s) and ' || v_pending_grants || ' role grant(s) waiting')
    else app._golive_status('not_started', 'Only the owner has a role so far') end);

  v_state := app._golive_import_state(p_center, array['store_items']);
  select count(*) into v_n from app.store_items where center_id = p_center;
  v := v || jsonb_build_object('rec.store_items', case
    when v_state = 'open' then app._golive_status('in_progress', 'A store-item import is not finished or not signed off yet')
    when v_n > 0 then app._golive_status('done', v_n || ' store item' || case when v_n = 1 then '' else 's' end)
    else app._golive_status('not_started', null) end);

  v_state := app._golive_import_state(p_center, array['pathshala_enrollments','pathshala_teachers']);
  select count(*) into v_n from app.pathshala_classes where center_id = p_center;
  v := v || jsonb_build_object('rec.pathshala', case
    when v_state = 'open' then app._golive_status('in_progress', 'A Pathshala import is not finished or not signed off yet')
    when v_n > 0 then app._golive_status('done', v_n || ' class' || case when v_n = 1 then '' else 'es' end)
    else app._golive_status('not_started', null) end);

  v_state := app._golive_import_state(p_center, array['pledges','payments','payment_allocations']);
  select count(*) into v_n from app.pledges where center_id = p_center;
  select count(*) into v_m from app.payments where center_id = p_center;
  v := v || jsonb_build_object('hist.giving', case
    when v_state = 'reconciled' then app._golive_status('done', v_n || ' pledges, ' || v_m || ' payments; imports reconciled and signed off')
    when v_state = 'open' then app._golive_status('in_progress', 'A giving import is not finished or not signed off yet')
    when v_n + v_m > 0 then app._golive_status('in_progress', v_n || ' pledges, ' || v_m || ' payments; import and reconcile the history')
    else app._golive_status('not_started', null) end);

  select count(*) into v_n from app.recurring_gifts where center_id = p_center and status = 'active';
  v := v || jsonb_build_object('hist.recurring', case when v_n > 0
    then app._golive_status('done', v_n || ' active recurring gift' || case when v_n = 1 then '' else 's' end)
    else app._golive_status('not_started', 'None yet. If the old system has none, mark this step done.') end);

  -- 6 Niva (readiness 12).
  a := app.golive_approval_state(p_center, 'niva_content');
  v := v || jsonb_build_object('niva.train', case a->>'state'
    when 'current' then app._golive_status('done', 'Sources approved by ' || (a->>'approved_by_name') || '; the full evaluation comes in a later release')
    when 'changed' then app._golive_status('in_progress', 'Sources changed since they were approved; approve them again')
    else app._golive_status('not_started', 'An administrator approves Niva''s sources in Content › Niva') end);

  -- 7 The owner's confirmations (readiness 13).
  select count(*) filter (where key = 'health_check_green'), count(*) filter (where key = 'staff_trained'), count(*) filter (where key = 'pilot_done')
    into v_n, v_m, v_k from app.center_attestations where center_id = p_center;
  v := v || jsonb_build_object(
    'test.health_check', case when v_n > 0 then app._golive_status('done', 'Confirmed by the owner') else app._golive_status('not_started', null) end,
    'test.training', case when v_m > 0 then app._golive_status('done', 'Confirmed by the owner') else app._golive_status('not_started', null) end,
    'test.pilot', case when v_k > 0 then app._golive_status('done', 'Confirmed by the owner') else app._golive_status('not_started', null) end);

  -- 8 The go-live request.
  select * into g from app.golive_requests where center_id = p_center order by requested_at desc limit 1;
  select * into pr from app.sandbox_promotions where sandbox_id = p_center order by requested_at desc limit 1;
  v := v || jsonb_build_object('golive.request', case
    when pr.status = 'done' then app._golive_status('done', 'Promoted to production (' || pr.slug || ')')
    when g.status = 'live' then app._golive_status('done', 'Live')
    when g.status = 'approved' then app._golive_status('in_progress', 'Approved by Community Connect; promote the sandbox to production')
    when g.status = 'requested' then app._golive_status('needs_review', 'Requested; waiting for two Community Connect approvals')
    when g.status = 'rejected' then app._golive_status('in_progress', 'Sent back by Community Connect: ' || coalesce(g.note, 'see the note'))
    else app._golive_status('not_started', null) end);
  return v;
end $$;

-- Steps whose computed status is the truth: a status stored earlier (by a person, or by
-- another stream's sync when it was true) never shows "done" once the data says otherwise.
alter table app.setup_steps add column if not exists live boolean not null default false;
comment on column app.setup_steps.live is
  'The computed status wins over a stored one (except "not started"): the database is the authority for this step.';
update app.setup_steps set live = true
 where key in ('org.security','org.team','org.agreements','svc.payments','svc.email','svc.texting','svc.quickbooks',
               'tpl.statements','niva.train','test.health_check','test.training','test.pilot','golive.request');

create or replace function app.setup_checklist(p_center uuid)
returns table (step_key text, stage int, sort int, title text, description text, help text, done_means text, route text,
               owner_role text, module_key text, required boolean, auto boolean, manual boolean,
               status text, computed_status text, stored_status text, detail text,
               owner_person_id uuid, owner_name text, due_on date, notes text, completed_by uuid, completed_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_auto jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s setup (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  v_auto := app.setup_auto_status(p_center);
  return query
  select s.key, s.stage, s.sort, s.title, s.description, s.help, s.done_means, s.route, s.owner_role, s.module_key,
         s.required, s.auto, s.manual,
         case
           when s.module_key is not null and not app.module_enabled(p_center, s.module_key) then 'skipped'
           when v_auto->s.key->>'status' = 'done' then 'done'
           when not s.manual then coalesce(v_auto->s.key->>'status', 'not_started')
           when s.live and coalesce(v_auto->s.key->>'status', 'not_started') <> 'not_started' then v_auto->s.key->>'status'
           when s.live and cs.status = 'done' then coalesce(v_auto->s.key->>'status', 'not_started')
           when cs.status is not null and cs.status <> 'not_started' then cs.status
           else coalesce(v_auto->s.key->>'status', 'not_started') end,
         v_auto->s.key->>'status',
         cs.status,
         case when s.module_key is not null and not app.module_enabled(p_center, s.module_key)
              then 'The ' || m.label || ' module is switched off.'
              else v_auto->s.key->>'detail' end,
         cs.owner_person_id,
         case when pe.id is null then null else coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name end,
         cs.due_on, cs.notes, cs.completed_by, cs.completed_at, cs.updated_at
    from app.setup_steps s
    left join app.center_setup_steps cs on cs.center_id = p_center and cs.step_key = s.key
    left join app.people pe on pe.id = cs.owner_person_id
    left join app.modules m on m.key = s.module_key
   order by s.stage, s.sort;
end $$;

do $$ begin
  if to_regprocedure('app._setup_auto_status_before_0302(uuid,boolean)') is null then
    alter function app.setup_auto_status(uuid, boolean) rename to _setup_auto_status_before_0302;
  end if;
end $$;
-- Later keys win: the payments wrapper's svc.payments / data.payment_methods come from
-- the inner call; this migration's keys are added on top.
create or replace function app.setup_auto_status(p_center uuid, p_with_readiness boolean default true) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select app._setup_auto_status_before_0302(p_center, p_with_readiness) || app.golive_setup_status(p_center)
$$;

-- ── Numbering (Setup step data.numbering) ────────────────────────────────────
-- Prefixes and next numbers for member, household, pledge, order, receipt and event
-- numbers. A number already issued is never issued again: the next number can only go
-- up once a sequence exists. Saving also completes the Setup step.
create or replace function app.numbering_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_short text;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s numbering (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  select upper(coalesce(nullif(short_name, ''), left(regexp_replace(slug, '[^a-zA-Z0-9]', '', 'g'), 6))) into v_short from app.centers where id = p_center;
  return (select jsonb_agg(jsonb_build_object(
            'kind', k.kind, 'label', k.label,
            'prefix', coalesce(s.prefix, v_short || k.suffix),
            'next_value', coalesce(s.next_value, k.start),
            'started', s.center_id is not null) order by k.o)
            from (values ('member', 'Member numbers', '-', 10001, 1), ('household', 'Household numbers', '-H-', 2001, 2),
                         ('pledge', 'Pledge numbers', '-PL-', 20001, 3), ('order', 'Store order numbers', '-S-', 1001, 4),
                         ('receipt', 'Receipt numbers', '-R-', 100001, 5), ('event', 'Event numbers', '-EV-', 901, 6))
                   as k(kind, label, suffix, start, o)
            left join app.number_sequences s on s.center_id = p_center and s.kind = k.kind);
end $$;

create or replace function app.save_numbering(p_center uuid, p_items jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare i jsonb; v_kind text; v_prefix text; v_next bigint; s app.number_sequences; v_reason text := app.audit_clean_reason(p_reason); v_changed int := 0;
begin
  if auth.uid() is null or not app.setup_can_manage(p_center) then
    raise exception 'Changing the numbering needs settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to save.'; end if;
  perform app.set_audit_context(coalesce(v_reason, 'Numbering reviewed in Settings › Numbering'));
  for i in select * from jsonb_array_elements(p_items) loop
    v_kind := i->>'kind';
    v_prefix := upper(btrim(coalesce(i->>'prefix', '')));
    if v_kind not in ('member','household','pledge','order','receipt','event') then raise exception 'Unknown kind of number: %.', v_kind; end if;
    if v_prefix !~ '^[A-Z0-9][A-Z0-9-]{0,15}$' then
      raise exception 'The prefix "%" can use capital letters, digits and dashes (up to 16), e.g. JSH-H-.', v_prefix;
    end if;
    if coalesce(i->>'next_value', '') !~ '^[0-9]{1,12}$' or (i->>'next_value')::bigint < 1 then
      raise exception 'The next number must be a whole number of at least 1.';
    end if;
    v_next := (i->>'next_value')::bigint;
    select * into s from app.number_sequences where center_id = p_center and kind = v_kind for update;
    if s.center_id is not null and v_next < s.next_value then
      raise exception 'Numbers up to % have already been issued for %; the next number cannot go back to %.',
        s.next_value - 1, replace(v_kind, '_', ' '), v_next;
    end if;
    if s.center_id is null then
      insert into app.number_sequences (center_id, kind, prefix, next_value) values (p_center, v_kind, v_prefix, v_next);
      v_changed := v_changed + 1;
    elsif s.prefix is distinct from v_prefix or s.next_value is distinct from v_next then
      update app.number_sequences set prefix = v_prefix, next_value = v_next where center_id = p_center and kind = v_kind;
      v_changed := v_changed + 1;
    end if;
  end loop;
  perform app.complete_setup_step(p_center, 'data.numbering', 'done', 'Numbering reviewed' || coalesce(': ' || v_reason, '.'));
  return jsonb_build_object('changed', v_changed, 'numbering', app.numbering_overview(p_center));
end $$;

-- ── Storage (Setup step svc.storage) ─────────────────────────────────────────
create or replace function app.center_storage_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := '[]'; v_used jsonb := '{}'; v_limit jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s storage settings (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  v_limit := app.entitlement(p_center, 'storage.bytes');
  if to_regclass('storage.buckets') is null then
    return jsonb_build_object('available', false, 'areas', v, 'limit_bytes', v_limit, 'used_bytes', 0);
  end if;
  if to_regclass('storage.objects') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b)), '{}'::jsonb)
        from (select o.bucket_id, count(*) n, coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) b
                from storage.objects o where split_part(o.name, '/', 1) = $1::text group by o.bucket_id) x
    $q$ into v_used using p_center;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'bucket', b.id, 'public', b.public, 'max_file_bytes', b.file_size_limit, 'types', to_jsonb(b.allowed_mime_types),
             'files', coalesce(($1->b.id->>'files')::int, 0), 'bytes', coalesce(($1->b.id->>'bytes')::bigint, 0),
             'retention_days', app.storage_retention_days(b.id, $2),
             'retention_editable', b.id in ('imports','recordings'),
             'module', app.storage_bucket_module(b.id),
             'module_on', app.storage_bucket_module(b.id) is null or app.module_enabled($2, app.storage_bucket_module(b.id)))
             order by array_position(array['branding','content','photos','store','statements','recordings','imports','org-documents','exports'], b.id::text), b.id), '[]'::jsonb)
      from storage.buckets b
     where b.id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
  $q$ into v using v_used, p_center;
  return jsonb_build_object('available', true, 'areas', v, 'limit_bytes', v_limit,
    'used_bytes', coalesce((select sum((e.value->>'bytes')::bigint) from jsonb_each(v_used) e), 0));
end $$;

revoke execute on function app._golive_status(text, text), app._golive_import_state(uuid, text[]), app.golive_setup_status(uuid),
  app.setup_auto_status(uuid, boolean), app._setup_auto_status_before_0302(uuid, boolean) from public, anon, authenticated;
revoke execute on function app.numbering_overview(uuid), app.save_numbering(uuid, jsonb, text), app.center_storage_overview(uuid) from public, anon;
grant execute on function app.numbering_overview(uuid), app.save_numbering(uuid, jsonb, text), app.center_storage_overview(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
