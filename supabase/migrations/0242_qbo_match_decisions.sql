-- Onboarding · o-qbo-match · 3 of 4: the treasury's decisions.
--
--   app.approve_qbo_matches(p_ids, p_reason)                    approve suggestions (one or many)
--   app.reject_qbo_match(p_id, p_reason)                         reject one suggestion
--   app.map_qbo_customer(p_center, p_qbo, p_household, p_person, p_reason)
--                                                                 map by hand, or remap an approved one
--   app.unmap_qbo_customer(p_center, p_qbo, p_reason)            undo a mapping that brought nothing in
--   app.create_household_from_qbo(p_center, p_qbo, p_reason)     new household + primary person, mapped
--   app.set_qbo_match_settings(p_center, p_level, p_years, p_reason)
--   app.qbo_customer_for(p_household, p_person) → text          CustomerRef for the o-quickbooks poster
--
-- All need accounting.manage and the accounting module (create_household also
-- people.manage), take a reason, and are audited (module accounting, the portal's
-- client app and screen from the request headers). Approving queues the
-- history bring-in (qbo.bring_in_history, 0243).
--
-- Family-level vs person-level: a match without a person is a family-level
-- QuickBooks account; its history is recorded against the household with the
-- household's PRIMARY member as payer. A match with a person is that person's.
--
-- Remapping moves the records already brought in (re-points household and
-- payer). Undoing a mapping whose history was brought in would delete money
-- records: that is an owner decision, so unmap refuses it with a plain message.

-- ── Guards and helpers ──────────────────────────────────────────────────────
create or replace function app.qbo_match_assert(p_center uuid, p_doing text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null then raise exception 'That QuickBooks customer was not found.'; end if;
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception '% needs accounting.manage.', p_doing using errcode = 'insufficient_privilege';
  end if;
end $$;

create or replace function app.qbo_match_reason(p_reason text) returns text
language plpgsql set search_path = app, public, extensions as $$
begin
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason; it is kept in the audit log.' using errcode = 'check_violation';
  end if;
  perform app.set_audit_context(p_reason);
  return app.audit_clean_reason(p_reason);
end $$;

-- The household's primary member (current), or null.
create or replace function app.qbo_primary_member(p_household uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select hm.person_id from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = p_household and hm.is_primary and hm.left_at is null and p.merged_into_id is null
   order by hm.joined_at nulls last limit 1
$$;

-- Queue the history bring-in for one QuickBooks customer (when the job queue exists).
create or replace function app.qbo_queue_bring_in(p_center uuid, p_qbo text) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v bigint;
begin
  if to_regprocedure('app.enqueue_job(uuid,text,jsonb,timestamp with time zone,integer)') is null then return null; end if;
  select id into v from app.jobs where center_id = p_center and kind = 'qbo.bring_in_history' and status = 'queued'
     and payload->>'qbo_customer_id' = p_qbo limit 1;
  if v is not null then return v; end if;
  return app.enqueue_job(p_center, 'qbo.bring_in_history', jsonb_build_object('qbo_customer_id', p_qbo), now(), 5);
end $$;

-- Keep the QuickBooks customer ID on the household (family-level) or the person, as an identifier.
create or replace function app.qbo_record_identifier(p_center uuid, p_qbo text, p_household uuid, p_person uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_norm text := app.normalize_identifier(p_qbo);
begin
  -- The ID now belongs elsewhere: close the old one (kept as history, never deleted).
  update app.external_ids set valid_to = current_date
   where center_id = p_center and kind = 'accounting' and system = 'quickbooks' and normalized = v_norm and valid_to is null
     and (household_id is distinct from p_household or person_id is distinct from p_person);
  if not exists (select 1 from app.external_ids where center_id = p_center and kind = 'accounting' and system = 'quickbooks'
                    and normalized = v_norm and valid_to is null) then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, created_by)
    values (p_center, case when p_person is null then p_household end, p_person, 'accounting', 'quickbooks', p_qbo,
            'QuickBooks customer', 'sync', auth.uid());
  end if;
end $$;

-- Move what was already brought in for this customer to its new household / payer.
create or replace function app.qbo_repoint_history(p_center uuid, p_qbo text, p_household uuid, p_payer uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int := 0; k int;
begin
  update app.payments p set household_id = p_household, payer_person_id = p_payer
    from app.qbo_transactions t
   where t.center_id = p_center and t.customer_qbo_id = p_qbo and t.cc_payment_id = p.id
     and (p.household_id is distinct from p_household or p.payer_person_id is distinct from p_payer);
  get diagnostics k = row_count; n := n + k;
  update app.pledges p set household_id = p_household, pledged_by_person_id = p_payer
    from app.qbo_transactions t
   where t.center_id = p_center and t.customer_qbo_id = p_qbo and t.cc_pledge_id = p.id
     and (p.household_id is distinct from p_household or p.pledged_by_person_id is distinct from p_payer);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- ── Approve ─────────────────────────────────────────────────────────────────
create or replace function app.approve_qbo_matches(p_ids uuid[], p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.qbo_customer_matches; v_reason text; n int := 0; v_jobs int := 0; v_job bigint; v_names text[] := '{}';
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Choose at least one suggested match to approve.'; end if;
  if cardinality(p_ids) > 500 then raise exception 'Approve at most 500 matches at a time.'; end if;
  v_reason := app.qbo_match_reason(p_reason);
  for m in select * from app.qbo_customer_matches where id = any (p_ids) order by confidence desc for update loop
    perform app.qbo_match_assert(m.center_id, 'Approving a QuickBooks donor match');
    if m.status <> 'suggested' then
      raise exception 'The match for QuickBooks customer % is already %.', m.qbo_customer_id, m.status;
    end if;
    if exists (select 1 from app.qbo_customer_matches x where x.center_id = m.center_id and x.qbo_customer_id = m.qbo_customer_id
                 and x.status = 'approved') then
      raise exception 'QuickBooks customer % is already mapped. Remap it instead.', m.qbo_customer_id;
    end if;
    if m.person_id is not null and not exists (select 1 from app.household_members where household_id = m.household_id
                                                  and person_id = m.person_id and left_at is null) then
      raise exception 'That person is no longer in the household; pick the match again.';
    end if;
    update app.qbo_customer_matches set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = v_reason
     where id = m.id;
    update app.qbo_customer_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           reason = 'Another match was approved for this QuickBooks customer'
     where center_id = m.center_id and qbo_customer_id = m.qbo_customer_id and status = 'suggested';
    perform app.qbo_record_identifier(m.center_id, m.qbo_customer_id, m.household_id, m.person_id);
    v_job := app.qbo_queue_bring_in(m.center_id, m.qbo_customer_id);
    if v_job is not null then v_jobs := v_jobs + 1; end if;
    n := n + 1;
  end loop;
  if n <> cardinality(p_ids) then raise exception 'Some of those matches were not found.'; end if;
  return jsonb_build_object('approved', n, 'bring_in_queued', v_jobs);
end $$;

-- ── Reject ──────────────────────────────────────────────────────────────────
create or replace function app.reject_qbo_match(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.qbo_customer_matches; v_reason text;
begin
  select * into m from app.qbo_customer_matches where id = p_id for update;
  if m.id is null then raise exception 'That match was not found.'; end if;
  perform app.qbo_match_assert(m.center_id, 'Rejecting a QuickBooks donor match');
  if m.status <> 'suggested' then
    raise exception 'Only a suggested match can be rejected; an approved one is remapped or unmapped.';
  end if;
  v_reason := app.qbo_match_reason(p_reason);
  update app.qbo_customer_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reason = v_reason where id = p_id;
end $$;

-- ── Map by hand, or remap ───────────────────────────────────────────────────
create or replace function app.map_qbo_customer(p_center uuid, p_qbo_customer text, p_household uuid, p_person uuid default null,
                                                p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.qbo_customers; old app.qbo_customer_matches; v_reason text; v_id uuid; v_payer uuid; v_moved int := 0;
        v_hh app.households; v_job bigint;
begin
  perform app.qbo_match_assert(p_center, 'Mapping a QuickBooks customer');
  select * into c from app.qbo_customers where center_id = p_center and qbo_id = p_qbo_customer;
  if c.qbo_id is null then raise exception 'That QuickBooks customer was not found; pull QuickBooks customers again.'; end if;
  select * into v_hh from app.households where id = p_household and center_id = p_center;
  if v_hh.id is null then raise exception 'That household was not found.'; end if;
  if v_hh.merged_into_id is not null then raise exception 'That household was merged into another one; map to that one instead.'; end if;
  if p_person is not null and not exists (select 1 from app.household_members where household_id = p_household
                                             and person_id = p_person and left_at is null) then
    raise exception 'That person is not a current member of the household.';
  end if;
  v_reason := app.qbo_match_reason(p_reason);

  select * into old from app.qbo_customer_matches
   where center_id = p_center and qbo_customer_id = p_qbo_customer and status = 'approved' for update;
  if old.id is not null and old.household_id = p_household and old.person_id is not distinct from p_person then
    raise exception 'QuickBooks customer "%" is already mapped to that household.', c.display_name;
  end if;

  v_payer := coalesce(p_person, app.qbo_primary_member(p_household));
  if old.id is not null then
    -- Remap: move whatever was brought in. A family-level account needs the new household's primary member.
    if v_payer is null and exists (select 1 from app.qbo_transactions where center_id = p_center and customer_qbo_id = p_qbo_customer
                                     and cc_status = 'brought_in') then
      raise exception 'Choose the primary member of % first: its QuickBooks history is recorded against the primary member.', v_hh.display_name;
    end if;
    if exists (select 1 from app.qbo_transactions where center_id = p_center and customer_qbo_id = p_qbo_customer and cc_status = 'brought_in') then
      perform app.assert_module_enabled(p_center, 'giving');
    end if;
    update app.qbo_customer_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           reason = 'Remapped: ' || v_reason
     where id = old.id;
    v_moved := app.qbo_repoint_history(p_center, p_qbo_customer, p_household, v_payer);
  end if;

  -- A suggestion for the same household becomes the approved match (its evidence is kept).
  update app.qbo_customer_matches set status = 'approved', person_id = p_person, decided_by = auth.uid(), decided_at = now(), reason = v_reason
   where center_id = p_center and qbo_customer_id = p_qbo_customer and household_id = p_household and status = 'suggested'
  returning id into v_id;
  if v_id is null then
    insert into app.qbo_customer_matches (center_id, qbo_customer_id, household_id, person_id, status, confidence, method, evidence,
                                          decided_by, decided_at, reason)
    values (p_center, p_qbo_customer, p_household, p_person, 'approved', 1, 'manual',
            jsonb_build_object('signals', jsonb_build_array(jsonb_build_object('kind', 'manual', 'label', 'Chosen by the treasury',
                                 'qb', c.display_name, 'cc', v_hh.display_name)),
                               'qb', jsonb_build_object('display_name', c.display_name, 'company', c.company_name, 'emails', to_jsonb(c.emails),
                                                        'phones', to_jsonb(c.phones), 'address', c.address),
                               'cc', jsonb_build_object('household', v_hh.display_name, 'household_number', v_hh.household_number,
                                                        'city', v_hh.city, 'zip', v_hh.postal_code)),
            auth.uid(), now(), v_reason)
    returning id into v_id;
  end if;
  update app.qbo_customer_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         reason = 'Another match was approved for this QuickBooks customer'
   where center_id = p_center and qbo_customer_id = p_qbo_customer and status = 'suggested';
  perform app.qbo_record_identifier(p_center, p_qbo_customer, p_household, p_person);
  v_job := app.qbo_queue_bring_in(p_center, p_qbo_customer);
  return jsonb_build_object('match_id', v_id, 'remapped', old.id is not null, 'records_moved', v_moved, 'bring_in_job', v_job);
end $$;

-- ── Unmap ───────────────────────────────────────────────────────────────────
create or replace function app.unmap_qbo_customer(p_center uuid, p_qbo_customer text, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.qbo_customer_matches; v_reason text; n int;
begin
  perform app.qbo_match_assert(p_center, 'Undoing a QuickBooks donor match');
  select * into m from app.qbo_customer_matches where center_id = p_center and qbo_customer_id = p_qbo_customer and status = 'approved' for update;
  if m.id is null then raise exception 'That QuickBooks customer is not mapped.'; end if;
  select count(*) into n from app.qbo_transactions where center_id = p_center and customer_qbo_id = p_qbo_customer and cc_status = 'brought_in';
  if n > 0 then
    raise exception 'Its QuickBooks history (% records) is already on the household. Undoing the mapping would delete those records, which needs an owner decision. Remap it to the right household instead.', n
      using errcode = 'check_violation';
  end if;
  v_reason := app.qbo_match_reason(p_reason);
  update app.qbo_customer_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reason = 'Unmapped: ' || v_reason
   where id = m.id;
  update app.external_ids set valid_to = current_date
   where center_id = p_center and kind = 'accounting' and system = 'quickbooks'
     and normalized = app.normalize_identifier(p_qbo_customer) and valid_to is null;
  update app.qbo_transactions set cc_status = 'pending', cc_detail = null
   where center_id = p_center and customer_qbo_id = p_qbo_customer and cc_status = 'needs_review';
end $$;

-- ── New household from a QuickBooks customer ────────────────────────────────
create or replace function app.create_household_from_qbo(p_center uuid, p_qbo_customer text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.qbo_customers; v_core text[]; v_first text; v_last text; v_hh uuid; v_person uuid; v_name text;
begin
  perform app.qbo_match_assert(p_center, 'Creating a household from QuickBooks');
  if not app.has_permission(p_center, 'people.manage') then
    raise exception 'Creating a household needs people.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.qbo_customers where center_id = p_center and qbo_id = p_qbo_customer;
  if c.qbo_id is null then raise exception 'That QuickBooks customer was not found; pull QuickBooks customers again.'; end if;
  if exists (select 1 from app.qbo_customer_matches where center_id = p_center and qbo_customer_id = p_qbo_customer and status = 'approved') then
    raise exception 'QuickBooks customer "%" is already mapped.', c.display_name;
  end if;
  perform app.qbo_match_reason(p_reason);
  -- Sandbox household / people limits are enforced by the insert triggers (0160).
  v_core := app.qbo_core_tokens(c.display_name);
  -- A person's name comes from QuickBooks' first / last name, else from a family-style display name;
  -- never from a company's name.
  v_first := coalesce(nullif(btrim(c.given_name), ''), case when c.company_name is null and cardinality(v_core) >= 2 then initcap(v_core[1]) end);
  v_last := coalesce(nullif(btrim(c.family_name), ''), case when c.company_name is null and cardinality(v_core) >= 1 then initcap(v_core[cardinality(v_core)]) end);
  if v_first is null or v_last is null then
    raise exception 'QuickBooks customer "%" has no first and last name, so a person cannot be created from it. Create the household by hand and map it.', c.display_name;
  end if;
  v_name := case when app.qbo_looks_family(c.display_name, c.given_name, c.family_name) then c.display_name else v_last || ' family' end;
  insert into app.households (center_id, display_name, address_line1, address_line2, city, state_region, postal_code)
  values (p_center, v_name, nullif(c.address->>'line1', ''), nullif(c.address->>'line2', ''), nullif(c.address->>'city', ''),
          nullif(c.address->>'state', ''), nullif(c.address->>'zip', ''))
  returning id into v_hh;
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
  values (p_center, v_first, v_last, c.emails[1], c.phones[1])
  returning id into v_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary)
  values (v_hh, v_person, p_center, 'primary', true);
  perform app.map_qbo_customer(p_center, p_qbo_customer, v_hh, null, p_reason);
  return v_hh;
end $$;

-- ── Settings ────────────────────────────────────────────────────────────────
create or replace function app.set_qbo_match_settings(p_center uuid, p_level text, p_history_years int, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  perform app.qbo_match_assert(p_center, 'Changing the QuickBooks matching settings');
  if p_level is not null and p_level not in ('family','person','mixed') then
    raise exception 'The customer level is family, person or mixed.';
  end if;
  if p_history_years is not null and (p_history_years < 1 or p_history_years > 25) then
    raise exception 'History is 1 to 25 years.';
  end if;
  perform app.qbo_match_reason(p_reason);
  select id into v_id from app.integration_connections where center_id = p_center and provider = 'quickbooks_online';
  if v_id is null then raise exception 'Connect QuickBooks first.'; end if;
  update app.integration_connections
     set settings = settings
                    || case when p_level is null then '{}'::jsonb else jsonb_build_object('qbo_customer_level', p_level) end
                    || case when p_history_years is null then '{}'::jsonb else jsonb_build_object('history_years', p_history_years) end
   where id = v_id;
end $$;

-- ── The CustomerRef for a new posting (read by the o-quickbooks poster) ─────
-- The person's own QuickBooks customer, else the household's family-level one, else null.
create or replace function app.qbo_customer_for(p_household uuid, p_person uuid default null) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select m.qbo_customer_id
    from app.qbo_customer_matches m
   where m.household_id = p_household and m.status = 'approved'
     and (m.person_id is null or m.person_id = p_person)
     and (app.has_permission(m.center_id, 'giving.view') or app.has_permission(m.center_id, 'accounting.manage')
          or coalesce(nullif(current_setting('role', true), 'none'), session_user::text) in ('connect_worker', 'service_role', 'postgres'))
   order by (m.person_id is not null) desc, m.decided_at desc
   limit 1
$$;

revoke execute on function app.qbo_match_assert(uuid, text), app.qbo_match_reason(text), app.qbo_primary_member(uuid),
  app.qbo_queue_bring_in(uuid, text), app.qbo_record_identifier(uuid, text, uuid, uuid),
  app.qbo_repoint_history(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function app.approve_qbo_matches(uuid[], text), app.reject_qbo_match(uuid, text),
  app.map_qbo_customer(uuid, text, uuid, uuid, text), app.unmap_qbo_customer(uuid, text, text),
  app.create_household_from_qbo(uuid, text, text), app.set_qbo_match_settings(uuid, text, int, text),
  app.qbo_customer_for(uuid, uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'connect_worker') then
    grant execute on function app.qbo_customer_for(uuid, uuid) to connect_worker;
  end if;
end $$;
grant execute on all functions in schema app to service_role;
