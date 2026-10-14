-- Edit and delete a pledge (owner request 2026-10-13: "edit buttons there to be able to edit each of them for the right roles",
-- "pledge can be deleted as well as with right role/authorization; if the pledge was sent to QuickBooks, it has to be deleted/cancelled
-- at both places"; NEEDS OWNER OK: it changes what a pledge amount and a pledge's life are allowed to do).
--
--   app._pledge_locks(pledge)             what may change and, when it may not, the plain sentence why (one place; every function below
--                                         and the screens read it)
--   app.pledge_edit_state(center, pledge) the pledge as the Edit sheet needs it, with those locks (giving.manage)
--   app.edit_pledge(center, pledge, changes, reason)
--                                         amount, due date, what it is for (campaign / fund), dedication, recognition name, anonymous,
--                                         the adult who pledged. giving.manage, Giving on, a reason (the audit entry's: the family's
--                                         History shows it with the before and after). One update, one History entry.
--   app.delete_pledge(center, pledge, reason)
--                                         "Delete": the pledge is Cancelled (status 'cancelled', closed now). It stays in the family's
--                                         History with the reason, stops counting as owed and frees an opportunity it held. Nothing is
--                                         erased, because the History, the numbering and the books point at it.
--
-- Who: giving.manage, the same people who record a pledge by hand (0745) and change a due date (0775). A pledge is a promise, not
-- money: nothing moves, so there is no second person (owner decision 2026-10-13: "giving.manage, up or down"). The amount can never
-- go below what is already paid. A full write-off of an open balance is still the two-person flow.
--
-- Never in one place only (owner rule): a pledge that came from a QuickBooks invoice, or has an entry matched to it or posted for it,
-- keeps its amount, what it is for and its life here until the books are changed first; the database says so in plain words. This
-- migration does not call QuickBooks: deleting in both places needs a poster job that voids the document (a separate, owner-approved step).
-- The same holds for pledges that belong to something else (an event registration, a boli, a membership, a class fee, a store order, a
-- recurring gift): their amount and life follow that screen.
--
-- Closed pledges (paid, written off, cancelled) keep their money and dates as history; only the dedication, the recognition name and
-- who pledged can still be corrected on a paid or written-off pledge, and nothing on a cancelled one.
set client_min_messages = warning;

-- ── What may change ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Returns {details, due, amount, for, delete} where each is null (allowed) or the sentence why not; plus {qbo, own}.
create or replace function app._pledge_locks(p app.pledges) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_ref text := coalesce(p.pledge_number, 'This pledge');
  v_open boolean := p.status in ('open', 'partially_paid');
  v_pending boolean := p.written_off_by is not null;
  v_own boolean := p.source::text in ('manual', 'general', 'other', 'sponsorship', 'pujan', 'construction');
  v_from text := case p.source::text
                   when 'rsvp_commitment' then 'an event registration'
                   when 'boli' then 'a boli'
                   when 'labh' then 'a labh'
                   when 'membership_fee' then 'a membership'
                   when 'pathshala_fee' then 'a Pathshala registration'
                   when 'store' then 'a store order'
                   when 'recurring' then 'a recurring gift'
                   else 'another screen' end;
  v_qbo text;
  v_closed text;
  v_details text; v_due text; v_amount text; v_for text; v_delete text;
begin
  if p.crm_external_id like 'qbo:%' then
    v_qbo := 'QuickBooks ' || replace(substr(p.crm_external_id, 5), ':', ' #');
  elsif exists (select 1 from app.qbo_transactions t where t.center_id = p.center_id and t.cc_pledge_id = p.id) then
    v_qbo := 'a QuickBooks entry matched to it';
  elsif exists (select 1 from app.ledger_postings l
                 where l.center_id = p.center_id and l.source_table = 'pledges' and l.source_id = p.id and l.status in ('queued', 'posting', 'posted')) then
    v_qbo := 'an entry sent to QuickBooks';
  end if;
  v_closed := case p.status::text
                when 'paid' then v_ref || ' is paid, so it stays as it is.'
                when 'written_off' then v_ref || ' is written off, so it stays as it is.'
                when 'cancelled' then v_ref || ' was deleted (cancelled), so it cannot change.'
                else null end;

  if p.status = 'cancelled' then
    v_details := v_closed;
  end if;
  if not v_open then
    v_due := coalesce(v_closed, 'Only an open pledge can change.');
    v_amount := v_due;
    v_for := v_due;
    v_delete := case p.status::text
                  when 'paid' then v_ref || ' is paid, so it stays on record. A refund is asked for from the payment.'
                  when 'written_off' then v_ref || ' is written off, so it stays on record.'
                  else v_closed end;
  elsif v_pending then
    v_due := 'A write-off of ' || v_ref || ' is waiting for approval, so it does not change now. Withdraw the request first if the family is paying after all.';
    v_amount := v_due;
    v_for := v_due;
    v_delete := v_due;
  end if;

  if v_open and not v_pending then
    if not v_own then
      v_amount := v_ref || ' comes from ' || v_from || '. Change its amount there so the two agree.';
      v_for := v_amount;
      v_delete := v_ref || ' comes from ' || v_from || '. Cancel it there so the two agree.';
    end if;
    if v_qbo is not null then
      v_amount := coalesce(v_amount, v_ref || ' is in QuickBooks (' || v_qbo || '). Change it in QuickBooks first, so the books and Community Connect agree.');
      v_for := coalesce(v_for, v_ref || ' is in QuickBooks (' || v_qbo || '). Change it in QuickBooks first, so the books and Community Connect agree.');
      v_delete := coalesce(v_delete, v_ref || ' is in QuickBooks (' || v_qbo || '). It has to be deleted there as well; until that is done here it stays, so the two never disagree.');
    end if;
    if p.opportunity_id is not null then
      v_for := coalesce(v_for, v_ref || ' is part of an opportunity, so what it is for does not change here.');
    end if;
    if p.paid_cents > 0 or exists (select 1 from app.payment_allocations a where a.pledge_id = p.id) then
      v_for := coalesce(v_for, 'Payments are already applied to ' || v_ref || ', so what it is for does not change.');
      v_delete := coalesce(v_delete, 'Payments are already applied to ' || v_ref || '. Undo them first, or write off what is still open.');
    end if;
  end if;
  return jsonb_build_object('details', v_details, 'due', v_due, 'amount', v_amount, 'for', v_for, 'delete', v_delete,
                            'qbo', v_qbo, 'own', v_own);
end $$;
revoke execute on function app._pledge_locks(app.pledges) from public, anon, authenticated;

-- ── The pledge as the Edit sheet needs it ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.pledge_edit_state(p_center uuid, p_pledge uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_pl app.pledges;
  v_tz text;
begin
  select * into v_pl from app.pledges p where p.id = p_pledge;
  if v_pl.id is null then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  if p_center is null or p_center <> v_pl.center_id then
    raise exception 'That pledge belongs to a different community than the one you are working in. Nothing was changed.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_pl.center_id, 'giving');
  if not app.has_permission(v_pl.center_id, 'giving.manage') then
    raise exception 'You do not have permission to change a pledge (it needs giving.manage).' using errcode = '42501';
  end if;
  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_pl.center_id;
  return jsonb_build_object(
    'pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id, 'status', v_pl.status,
    'source', v_pl.source, 'amount_cents', v_pl.amount_cents, 'paid_cents', v_pl.paid_cents, 'due_on', v_pl.due_on,
    'pledged_on', (v_pl.pledged_at at time zone v_tz)::date,
    'campaign_id', v_pl.campaign_id, 'fund_id', v_pl.fund_id, 'opportunity_id', v_pl.opportunity_id,
    'dedication', v_pl.dedication, 'recognition_name', v_pl.recognition_name, 'anonymous', v_pl.anonymous,
    'pledged_by_person_id', v_pl.pledged_by_person_id,
    'locks', app._pledge_locks(v_pl));
end $$;
revoke execute on function app.pledge_edit_state(uuid, uuid) from public, anon;
grant execute on function app.pledge_edit_state(uuid, uuid) to authenticated;
comment on function app.pledge_edit_state(uuid, uuid) is
  'A pledge as the Edit sheet shows it, with what may change and, where it may not, the sentence why: giving.manage in its community, Giving on (0782).';

-- ── Edit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_changes holds only the keys that change (a key with null clears it where that is allowed): amount_cents, due_on, campaign_id,
-- fund_id, dedication, recognition_name, anonymous, pledged_by_person_id. A key whose value is what the pledge already has is ignored.
create or replace function app.edit_pledge(p_center uuid, p_pledge uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_pl app.pledges;
  v_locks jsonb;
  v_reason text := app.audit_clean_reason(p_reason);
  v_tz text;
  v_today date;
  v_pledged_on date;
  v_key text;
  v_raw text;
  v_amount bigint;
  v_due date;
  v_campaign uuid;
  v_fund uuid;
  v_camp app.campaigns;
  v_ded text;
  v_rec text;
  v_anon boolean;
  v_by uuid;
  v_for_touched boolean;
  v_fields text[] := '{}';
  v_status app.pledge_status;
  v_closed timestamptz;
begin
  select p.center_id into v_center from app.pledges p where p.id = p_pledge;
  if v_center is null then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  if p_center is null or p_center <> v_center then
    raise exception 'That pledge belongs to a different community than the one you are working in. Nothing was changed.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not app.has_permission(v_center, 'giving.manage') then
    raise exception 'You do not have permission to change a pledge (it needs giving.manage).' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Change at least one thing, or close the sheet.' using errcode = '22023';
  end if;
  for v_key in select k from jsonb_object_keys(p_changes) k loop
    if v_key not in ('amount_cents', 'due_on', 'campaign_id', 'fund_id', 'dedication', 'recognition_name', 'anonymous', 'pledged_by_person_id') then
      raise exception 'That change was not understood (%). Close the sheet and open it again.', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_pl from app.pledges p where p.id = p_pledge for update;
  v_locks := app._pledge_locks(v_pl);
  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone v_tz)::date;
  v_pledged_on := (v_pl.pledged_at at time zone v_tz)::date;

  v_amount := v_pl.amount_cents; v_due := v_pl.due_on; v_campaign := v_pl.campaign_id; v_fund := v_pl.fund_id;
  v_ded := v_pl.dedication; v_rec := v_pl.recognition_name; v_anon := v_pl.anonymous; v_by := v_pl.pledged_by_person_id;
  v_for_touched := jsonb_exists(p_changes, 'campaign_id') or jsonb_exists(p_changes, 'fund_id');

  -- Amount
  if jsonb_exists(p_changes, 'amount_cents') then
    v_raw := p_changes->>'amount_cents';
    if v_raw is null or v_raw !~ '^[0-9]{1,12}$' then
      raise exception 'Enter a pledge amount greater than zero.' using errcode = '22023';
    end if;
    if v_raw::bigint <= 0 then
      raise exception 'Enter a pledge amount greater than zero.' using errcode = '22023';
    end if;
    if v_raw::bigint > 100000000000 then
      raise exception 'That amount is too large. Check it and try again.' using errcode = '22023';
    end if;
    if v_raw::bigint <> v_pl.amount_cents then
      if v_locks->>'amount' is not null then
        raise exception '%', v_locks->>'amount' using errcode = '22023';
      end if;
      if v_raw::bigint < v_pl.paid_cents then
        raise exception 'The amount cannot be less than what is already paid (% cents). To close the pledge early, write off what is still open.', v_pl.paid_cents
          using errcode = '22023';
      end if;
      v_amount := v_raw::bigint;
      v_fields := array_append(v_fields, 'amount');
    end if;
  end if;

  -- Due date
  if jsonb_exists(p_changes, 'due_on') then
    v_raw := p_changes->>'due_on';
    if v_raw is null or v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Choose the due date.' using errcode = '22023';
    end if;
    begin
      v_due := v_raw::date;
    exception when others then
      raise exception 'Enter the due date as a date, like 2026-12-31.' using errcode = '22023';
    end;
    if v_due is distinct from v_pl.due_on then
      if v_locks->>'due' is not null then
        raise exception '%', v_locks->>'due' using errcode = '22023';
      end if;
      if v_due < v_today - 3653 or v_due > v_today + 3653 then
        raise exception 'The due date must be within ten years of today.' using errcode = '22023';
      end if;
      if v_due < v_pledged_on then
        raise exception 'The due date cannot be before the day it was pledged (%).', to_char(v_pledged_on, 'YYYY-MM-DD') using errcode = '22023';
      end if;
      v_fields := array_append(v_fields, 'due date');
    else
      v_due := v_pl.due_on;
    end if;
  end if;

  -- What it is for: a campaign (its fund comes with it), a fund, or nothing (a general pledge). Same rules as recording one (0745).
  if v_for_touched then
    if jsonb_exists(p_changes, 'campaign_id') then
      v_raw := p_changes->>'campaign_id';
      if v_raw is null then v_campaign := null;
      elsif v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Choose what the pledge is for again: that choice was not understood.' using errcode = '22023';
      else v_campaign := v_raw::uuid; end if;
    end if;
    if jsonb_exists(p_changes, 'fund_id') then
      v_raw := p_changes->>'fund_id';
      if v_raw is null then v_fund := null;
      elsif v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Choose what the pledge is for again: that choice was not understood.' using errcode = '22023';
      else v_fund := v_raw::uuid; end if;
    end if;
    if v_campaign is not null then
      select * into v_camp from app.campaigns c where c.id = v_campaign and c.center_id = v_center;
      if not found then
        raise exception 'That campaign was not found in this community.' using errcode = 'P0002';
      end if;
      if v_camp.id is distinct from v_pl.campaign_id then
        if v_camp.status = 'archived' then
          raise exception 'That campaign is archived. Choose another campaign or a fund.' using errcode = '22023';
        end if;
        if v_camp.kind in ('boli', 'store', 'pathshala', 'membership') then
          raise exception 'That campaign takes its pledges from its own screen (auctions, the store, class fees or memberships), so it cannot be chosen here.'
            using errcode = '22023';
        end if;
      end if;
      if v_camp.fund_id is not null then
        if v_fund is null or not jsonb_exists(p_changes, 'fund_id') then
          v_fund := v_camp.fund_id;
        elsif v_fund <> v_camp.fund_id then
          raise exception 'That campaign''s pledges go to its own fund. Leave the fund empty, or choose the campaign''s fund.' using errcode = '22023';
        end if;
      end if;
    end if;
    if v_fund is not null and v_fund is distinct from v_pl.fund_id
       and not exists (select 1 from app.funds f where f.id = v_fund and f.center_id = v_center and f.active) then
      raise exception 'That fund was not found in this community, or it is no longer in use.' using errcode = 'P0002';
    end if;
    if v_campaign is distinct from v_pl.campaign_id or v_fund is distinct from v_pl.fund_id then
      if v_locks->>'for' is not null then
        raise exception '%', v_locks->>'for' using errcode = '22023';
      end if;
      v_fields := array_append(v_fields, 'what it is for');
    end if;
  end if;

  -- Dedication, recognition name, anonymous, who pledged: details, allowed unless the pledge was deleted.
  if jsonb_exists(p_changes, 'dedication') then
    v_ded := nullif(btrim(p_changes->>'dedication'), '');
    if v_ded is not null and char_length(v_ded) > 200 then
      raise exception 'Keep the dedication to 200 characters or fewer.' using errcode = '22023';
    end if;
    if v_ded is distinct from v_pl.dedication then v_fields := array_append(v_fields, 'dedication'); end if;
  end if;
  if jsonb_exists(p_changes, 'recognition_name') then
    v_rec := nullif(btrim(p_changes->>'recognition_name'), '');
    if v_rec is not null and char_length(v_rec) > 120 then
      raise exception 'Keep the recognition name to 120 characters or fewer.' using errcode = '22023';
    end if;
    if v_rec is distinct from v_pl.recognition_name then v_fields := array_append(v_fields, 'recognition name'); end if;
  end if;
  if jsonb_exists(p_changes, 'anonymous') then
    if jsonb_typeof(p_changes->'anonymous') <> 'boolean' then
      raise exception 'Anonymous is yes or no.' using errcode = '22023';
    end if;
    v_anon := (p_changes->>'anonymous')::boolean;
    if v_anon is distinct from v_pl.anonymous then v_fields := array_append(v_fields, 'anonymous'); end if;
  end if;
  if jsonb_exists(p_changes, 'pledged_by_person_id') then
    v_raw := p_changes->>'pledged_by_person_id';
    if v_raw is null then v_by := null;
    elsif v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Choose the adult who pledged again: that choice was not understood.' using errcode = '22023';
    else v_by := v_raw::uuid; end if;
    if v_by is distinct from v_pl.pledged_by_person_id then
      -- An adult of this household, never a child (D2); nobody named means the household.
      if v_by is not null and not exists (
           select 1 from app.household_members hm join app.people p on p.id = hm.person_id
            where hm.household_id = v_pl.household_id and hm.person_id = v_by and hm.left_at is null
              and p.merged_into_id is null and not p.is_deceased
              and ((p.date_of_birth is not null and p.date_of_birth <= (v_today - interval '18 years')::date)
                   or (p.date_of_birth is null and hm.role in ('primary', 'spouse', 'parent')))) then
        raise exception 'The person who pledged must be an adult of this household. Choose an adult, or leave it as the household.'
          using errcode = '22023';
      end if;
      v_fields := array_append(v_fields, 'who pledged');
    end if;
  end if;
  if cardinality(v_fields) > 0 and v_locks->>'details' is not null then
    raise exception '%', v_locks->>'details' using errcode = '22023';
  end if;

  if cardinality(v_fields) = 0 then
    return jsonb_build_object('pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id,
                              'changed', false, 'fields', '[]'::jsonb, 'amount_cents', v_pl.amount_cents, 'was_amount_cents', v_pl.amount_cents,
                              'due_on', v_pl.due_on, 'status', v_pl.status);
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why the pledge changes (for example "Family asked to pledge more"). It shows in the family''s History.' using errcode = '22023';
  end if;

  -- A new amount decides whether the pledge is still open, part paid or now paid up (what app.recompute_pledge_status would say).
  v_status := v_pl.status;
  v_closed := v_pl.closed_at;
  if v_amount <> v_pl.amount_cents then
    v_status := (case when v_pl.paid_cents >= v_amount then 'paid' when v_pl.paid_cents > 0 then 'partially_paid' else 'open' end)::app.pledge_status;
    v_closed := case when v_pl.paid_cents >= v_amount then coalesce(v_pl.closed_at, now()) else null end;
  end if;
  perform app.set_audit_context(v_reason);
  update app.pledges
     set amount_cents = v_amount, due_on = v_due, campaign_id = v_campaign, fund_id = v_fund, dedication = v_ded, recognition_name = v_rec,
         anonymous = v_anon, pledged_by_person_id = v_by, status = v_status, closed_at = v_closed
   where id = v_pl.id;
  return jsonb_build_object('pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id,
                            'changed', true, 'fields', to_jsonb(v_fields), 'amount_cents', v_amount, 'was_amount_cents', v_pl.amount_cents,
                            'due_on', v_due, 'status', v_status);
end $$;
revoke execute on function app.edit_pledge(uuid, uuid, jsonb, text) from public, anon;
grant execute on function app.edit_pledge(uuid, uuid, jsonb, text) to authenticated;
comment on function app.edit_pledge(uuid, uuid, jsonb, text) is
  'Changes a pledge: amount (never below what is paid), due date, what it is for, dedication, recognition name, anonymous, who pledged. giving.manage in its community, Giving on, a reason (the audit entry''s). A pledge in QuickBooks, from another screen, or with a write-off waiting keeps what the lock says (0782).';

-- ── Delete (cancel) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.delete_pledge(p_center uuid, p_pledge uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_pl app.pledges;
  v_locks jsonb;
  v_reason text := app.audit_clean_reason(p_reason);
begin
  select p.center_id into v_center from app.pledges p where p.id = p_pledge;
  if v_center is null then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  if p_center is null or p_center <> v_center then
    raise exception 'That pledge belongs to a different community than the one you are working in. Nothing was changed.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not app.has_permission(v_center, 'giving.manage') then
    raise exception 'You do not have permission to delete a pledge (it needs giving.manage).' using errcode = '42501';
  end if;
  select * into v_pl from app.pledges p where p.id = p_pledge for update;
  v_locks := app._pledge_locks(v_pl);
  if v_locks->>'delete' is not null then
    raise exception '%', v_locks->>'delete' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why the pledge is deleted (for example "Recorded twice by mistake"). It shows in the family''s History.' using errcode = '22023';
  end if;
  perform app.set_audit_context(v_reason);
  update app.pledges set status = 'cancelled', closed_at = now() where id = v_pl.id;
  return jsonb_build_object('pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id,
                            'amount_cents', v_pl.amount_cents, 'status', 'cancelled');
end $$;
revoke execute on function app.delete_pledge(uuid, uuid, text) from public, anon;
grant execute on function app.delete_pledge(uuid, uuid, text) to authenticated;
comment on function app.delete_pledge(uuid, uuid, text) is
  'Deletes an open pledge: it is Cancelled and stays in the family''s History with the reason. giving.manage in its community, Giving on, no payment applied, not in QuickBooks, not from another screen, no write-off waiting (0782).';

-- ── The portal's actions, in the activity allowlist ───────────────────────────────────────────────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.edit_pledge', 'Edit a pledge', 'pledge'),
    ('giving.delete_pledge', 'Delete a pledge', 'pledge')
  ) as v(k, l, e);
