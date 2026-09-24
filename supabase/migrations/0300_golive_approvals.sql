-- Onboarding Wave D · stream o-golive · 1 of 3: readiness checks 8 and 12, honestly
-- (ONBOARDING_PLAN §4 Step 8; ONBOARDING_WAVE_D "o-golive").
--
-- The full versions of both checks belong to deferred work (Communications ›
-- Templates / statements from a sample, and Niva training). Until then they are
-- implemented against what exists today, with an approval record (who, when, what):
--
--    8 statement_templates_approved   the TREASURER has reviewed and approved the receipt
--                                     template and the year-end statement settings that
--                                     exist today (app.receipt_templates: donation receipt,
--                                     pledge confirmation, year-end statement — signer and
--                                     personal note). Passes with Giving switched off.
--   12 niva_evaluated                 Niva is switched off, OR an administrator (settings.manage)
--                                     has reviewed and approved Niva's knowledge sources.
--
-- An approval records a fingerprint of exactly what was approved. If the templates or
-- the sources change afterwards the check stops passing and says so ("changed since it
-- was approved") until someone approves the new version — never a stale pass.
--
--   app.golive_approvals(center_id, key, approved_by, approved_at, approver_role, note,
--                        evidence jsonb, evidence_hash)          one row per center and key
--   app.statement_templates_evidence(center) / app.niva_content_evidence(center)
--   app.approve_statement_templates(center, note)                treasurer role (active grant)
--   app.approve_niva_content(center, note)                       settings.manage
--   app.golive_approval_status(center)                           both, for the screens
set client_min_messages = warning;

create table if not exists app.golive_approvals (
  center_id      uuid not null references app.centers(id) on delete cascade,
  key            text not null check (key in ('statement_templates','niva_content')),
  approved_by    uuid not null references auth.users(id),
  approved_at    timestamptz not null default now(),
  approver_role  text not null check (char_length(approver_role) between 1 and 80),
  note           text check (note is null or char_length(note) <= 1000),
  evidence       jsonb not null default '{}'::jsonb,
  evidence_hash  text not null,
  primary key (center_id, key)
);
comment on table app.golive_approvals is
  'Go-live approvals behind readiness checks 8 (treasurer approves the receipt/statement templates) and 12 (admin approves Niva''s sources). Re-approving replaces the row; the audit log keeps every version.';

alter table app.golive_approvals enable row level security;
drop policy if exists golive_approvals_read on app.golive_approvals;
create policy golive_approvals_read on app.golive_approvals for select to authenticated
  using (app.setup_can_manage(center_id) or app.has_permission(center_id, 'giving.manage') or app.is_platform_admin());
revoke all on app.golive_approvals from anon;
revoke insert, update, delete, truncate on app.golive_approvals from authenticated;
grant select on app.golive_approvals to authenticated;
grant all on app.golive_approvals to service_role;

insert into app.module_tables (table_name, module_key) values ('golive_approvals', null)
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_golive_approvals on app.golive_approvals;
create trigger audit_golive_approvals after insert or update or delete on app.golive_approvals
  for each row execute function app.audit_row('center_id', 'key');

-- ── What is being approved ───────────────────────────────────────────────────
-- The three receipt kinds with their current wording (null = the standard wording).
create or replace function app.statement_templates_evidence(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('templates', coalesce(jsonb_agg(jsonb_build_object(
           'kind', k.kind, 'customised', t.id is not null, 'signed_by', t.signed_by, 'personal_note', t.personal_note) order by k.o), '[]'::jsonb))
    from unnest(array['donation_receipt','pledge_confirmation','year_end_statement']) with ordinality as k(kind, o)
    left join app.receipt_templates t on t.center_id = p_center and t.kind = k.kind
$$;

-- The Niva knowledge sources members' questions would be answered from: this
-- center's and the shared (Community Connect) ones, with their version and status.
create or replace function app.niva_content_evidence(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('sources', coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'shared', c.center_id is null, 'status', c.status, 'version', c.version,
           'updated_at', c.updated_at) order by c.title, c.id), '[]'::jsonb))
    from app.content_items c
   where c.kind = 'niva_source' and (c.center_id = p_center or c.center_id is null) and c.status <> 'retired'
$$;

create or replace function app.golive_evidence_hash(p jsonb) returns text
language sql immutable set search_path = app, public, extensions as $$
  select encode(extensions.digest(coalesce(p, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

-- The approval of one key, compared with what exists now:
--   {state: 'none' | 'current' | 'changed', approved_by_name, approved_at, approver_role, note}
create or replace function app.golive_approval_state(p_center uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare a app.golive_approvals; v_now jsonb; v_who text;
begin
  select * into a from app.golive_approvals where center_id = p_center and key = p_key;
  if a.center_id is null then return jsonb_build_object('state', 'none'); end if;
  v_now := case p_key when 'statement_templates' then app.statement_templates_evidence(p_center) else app.niva_content_evidence(p_center) end;
  select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name into v_who
    from app.center_users cu join app.people pe on pe.id = cu.person_id
   where cu.center_id = p_center and cu.user_id = a.approved_by limit 1;
  if v_who is null then select email into v_who from auth.users where id = a.approved_by; end if;
  return jsonb_build_object(
    'state', case when app.golive_evidence_hash(v_now) = a.evidence_hash then 'current' else 'changed' end,
    'approved_by', a.approved_by, 'approved_by_name', coalesce(v_who, 'someone'), 'approved_at', a.approved_at,
    'approver_role', a.approver_role, 'note', a.note);
end $$;

-- ── Approving ────────────────────────────────────────────────────────────────
-- Check 8 is the treasurer's: an ACTIVE treasurer role grant in this center (a
-- platform admin's blanket permissions do not count — Community Connect never
-- approves an organization's receipts for it).
create or replace function app.is_active_treasurer(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and exists (
    select 1 from app.role_grants g
     where g.center_id = p_center and g.user_id = auth.uid() and g.role_key = 'treasurer' and g.status = 'active'
       and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

create or replace function app.approve_statement_templates(p_center uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ev jsonb; v_note text := app.audit_clean_reason(p_note);
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.is_active_treasurer(p_center) then
    raise exception 'Only the treasurer approves the receipt and statement templates. Ask the person with the Treasurer role to approve them.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_note is not null and char_length(btrim(p_note)) > 1000 then raise exception 'Keep the note under 1,000 characters.'; end if;
  v_ev := app.statement_templates_evidence(p_center);
  perform app.set_audit_context(coalesce(v_note, 'Treasurer approved the receipt and statement templates'));
  insert into app.golive_approvals (center_id, key, approved_by, approver_role, note, evidence, evidence_hash)
  values (p_center, 'statement_templates', auth.uid(), 'Treasurer', v_note, v_ev, app.golive_evidence_hash(v_ev))
  on conflict (center_id, key) do update
     set approved_by = excluded.approved_by, approved_at = now(), approver_role = excluded.approver_role,
         note = excluded.note, evidence = excluded.evidence, evidence_hash = excluded.evidence_hash;
  perform app.complete_setup_step(p_center, 'tpl.statements', 'done', 'Approved by the treasurer' || coalesce(': ' || v_note, '.'));
  return app.golive_approval_state(p_center, 'statement_templates');
end $$;

create or replace function app.approve_niva_content(p_center uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ev jsonb; v_note text := app.audit_clean_reason(p_note); v_n int;
begin
  perform app.assert_module_enabled(p_center, 'niva');
  if auth.uid() is null or not app.setup_can_manage(p_center) then
    raise exception 'Approving Niva''s content needs an administrator (settings.manage) of this community.' using errcode = 'insufficient_privilege';
  end if;
  if v_note is not null and char_length(btrim(p_note)) > 1000 then raise exception 'Keep the note under 1,000 characters.'; end if;
  v_ev := app.niva_content_evidence(p_center);
  select count(*) into v_n from jsonb_array_elements(v_ev->'sources') s where s->>'status' in ('approved','published');
  if v_n = 0 then
    raise exception 'Niva has no approved knowledge source to review yet. Add a source and approve it in the Content approval queue, or switch Niva off in Settings › Modules.';
  end if;
  perform app.set_audit_context(coalesce(v_note, 'Administrator approved Niva''s knowledge sources'));
  insert into app.golive_approvals (center_id, key, approved_by, approver_role, note, evidence, evidence_hash)
  values (p_center, 'niva_content', auth.uid(), 'Administrator', v_note, v_ev, app.golive_evidence_hash(v_ev))
  on conflict (center_id, key) do update
     set approved_by = excluded.approved_by, approved_at = now(), approver_role = excluded.approver_role,
         note = excluded.note, evidence = excluded.evidence, evidence_hash = excluded.evidence_hash;
  perform app.complete_setup_step(p_center, 'niva.train', 'done', 'Niva''s sources approved' || coalesce(': ' || v_note, '.'));
  return app.golive_approval_state(p_center, 'niva_content');
end $$;

-- Both approvals for the screens (Receipts & statements, Niva, Setup).
create or replace function app.golive_approval_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not (app.setup_can_manage(p_center) or app.has_permission(p_center, 'giving.manage') or app.has_permission(p_center, 'content.manage')
          or app.is_platform_admin()) then
    raise exception 'You don''t have access to this community''s go-live approvals.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'statement_templates', app.golive_approval_state(p_center, 'statement_templates'),
    'niva_content', app.golive_approval_state(p_center, 'niva_content'),
    'is_treasurer', app.is_active_treasurer(p_center),
    'can_approve_niva', app.setup_can_manage(p_center));
end $$;

-- ── The checks ───────────────────────────────────────────────────────────────
create or replace function app.check_statement_templates_approved(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare s jsonb;
begin
  if not app.module_enabled(p_center, 'giving') then
    return jsonb_build_object('ok', true, 'detail', 'Giving is switched off, so no receipts or statements are issued.');
  end if;
  s := app.golive_approval_state(p_center, 'statement_templates');
  if s->>'state' = 'none' then
    return jsonb_build_object('ok', false, 'detail',
      'The treasurer has not approved the receipt and year-end statement templates yet (Giving › Receipts & statements). '
      || 'Today''s templates are the standard wording with the signer and a personal note; building templates from an uploaded sample comes in a later release.');
  elsif s->>'state' = 'changed' then
    return jsonb_build_object('ok', false, 'detail',
      'The templates changed after ' || (s->>'approved_by_name') || ' approved them on '
      || to_char((s->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY') || '. The treasurer approves the new version (Giving › Receipts & statements).');
  end if;
  return jsonb_build_object('ok', true, 'detail',
    'Approved by the treasurer, ' || (s->>'approved_by_name') || ', on ' || to_char((s->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || ' (receipt, pledge confirmation and year-end statement as they are today). Statements built from an uploaded sample come in a later release.');
end $$;

create or replace function app.check_niva_evaluated(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare s jsonb;
begin
  if not app.module_enabled(p_center, 'niva') then
    return jsonb_build_object('ok', true, 'detail', 'Niva is switched off, so there is nothing to evaluate.');
  end if;
  s := app.golive_approval_state(p_center, 'niva_content');
  if s->>'state' = 'none' then
    return jsonb_build_object('ok', false, 'detail',
      'Niva is on and an administrator has not approved its knowledge sources yet (Content › Niva), or switch Niva off in Settings › Modules. '
      || 'The full evaluation (question bank, pass mark) comes in a later release.');
  elsif s->>'state' = 'changed' then
    return jsonb_build_object('ok', false, 'detail',
      'Niva''s sources changed after ' || (s->>'approved_by_name') || ' approved them on '
      || to_char((s->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY') || '. An administrator approves them again (Content › Niva).');
  end if;
  return jsonb_build_object('ok', true, 'detail',
    'Niva''s knowledge sources were approved by ' || (s->>'approved_by_name') || ' on '
    || to_char((s->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || '. The full evaluation (question bank, pass mark) comes in a later release.');
end $$;

insert into app.readiness_checks (key, title, sort, check_fn) values
  ('statement_templates_approved', 'Statement and receipt templates approved', 8, 'app.check_statement_templates_approved'::regproc),
  ('niva_evaluated', 'Niva content approved, or Niva switched off', 12, 'app.check_niva_evaluated'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.statement_templates_evidence(uuid), app.niva_content_evidence(uuid), app.golive_evidence_hash(jsonb),
  app.golive_approval_state(uuid, text), app.check_statement_templates_approved(uuid), app.check_niva_evaluated(uuid)
  from public, anon, authenticated;
revoke execute on function app.is_active_treasurer(uuid), app.approve_statement_templates(uuid, text), app.approve_niva_content(uuid, text),
  app.golive_approval_status(uuid) from public, anon;
grant execute on function app.is_active_treasurer(uuid), app.approve_statement_templates(uuid, text), app.approve_niva_content(uuid, text),
  app.golive_approval_status(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
