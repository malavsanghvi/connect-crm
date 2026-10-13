-- 0745: record a pledge from the portal (docs/GIVING_REDESIGN.md slice 7; section 10 decision 3). NEEDS OWNER OK: a new way to
-- write a pledge. Owner decision 2026-10-12: anyone with giving.manage; no second approver (a pledge moves no money); it shows in
-- the family's History with the reason given; its source is "manual".
--
-- What is added, and only this:
--   app.pledge_source 'manual'                 a pledge a staff member recorded by hand in the portal (a promise made in person, by
--                                              phone or on a pledge card). Every other source keeps its own flow.
--   app.pledges.idempotency_key                a text key, unique per community when present, set only by the function below (a
--                                              check allows it only on a manual pledge). Every pledge before this migration has none.
--   app.record_manual_pledge(...)              records ONE pledge for a household. The same key twice returns the pledge already
--                                              recorded (replayed = true) instead of recording a second one; the same key for a
--                                              DIFFERENT pledge is refused (as app.record_offline_payment_once does, 0658).
--
-- The enum value: Postgres refuses to USE a new enum value in the transaction that added it, and migrate.sh runs this file as one
-- transaction. So nothing in this file compares with the new value as an enum: the check below compares source::text with
-- 'manual' (text against text), and the only other use is inside the plpgsql body, which is not analysed until it first runs.
--
-- The rules, enforced here whoever calls (the portal's sheet, the giving.record_pledge command):
--   * where: the household must belong to the community the caller says they are working in (p_center), a platform admin
--     included; a fund, campaign or opportunity must be that community's own
--   * who: giving.manage in that community; the Giving module must be on (Opportunities too when an opportunity is named)
--   * what: an amount above zero in whole cents; a reason (it becomes the audit entry's reason, so History shows it); a due date,
--     when given, within ten years of today in the community's own time zone; a dedication of at most 200 characters
--   * the person who pledged, when named, is a current ADULT of that household: a birth date at least 18 years ago, or with no
--     birth date a head, spouse or parent of it (the rule of 0653 and 0660). A child is never named on a pledge. The portal also
--     applies the community's own age of majority where it is higher.
--   * a campaign that is archived, or whose pledges come from their own flow (auctions, the store, class fees, memberships), is
--     refused; a campaign's own fund is used when no fund is given, and a different fund is refused
--   * once: the key is looked up right after the permission check, so a late retry gives back the pledge it recorded even if a
--     campaign was archived or an opportunity taken in between; a replay must ask for the same household, amount, opportunity and
--     option, pledger, due date, dedication, campaign and fund (a campaign or fund left out may come from the opportunity or campaign)
--
-- What does NOT change: no policy, no permission, no other function. The pledge goes through the triggers every pledge goes through:
-- numbering (app.assign_numbers, 0121), the opportunity guards (app.check_opportunity_available, latest body 0743;
-- app.check_opportunity_option, 0022; pledges_opportunity_taken, 0018) and the audit (app.audit_row, 0102). A pledge is not cash:
-- nothing is posted to the books when it is made (no posting is queued on a pledge insert; a later write-off follows 0412 as for
-- any pledge, and is skipped on cash basis). Staff with giving.manage could already insert pledges through pledges_staff_write
-- (0010); this is the checked, audited, record-once way the portal uses.
set client_min_messages = warning;

alter type app.pledge_source add value if not exists 'manual';

alter table app.pledges add column if not exists idempotency_key text;
alter table app.pledges drop constraint if exists pledges_idempotency_key_len;
alter table app.pledges add constraint pledges_idempotency_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 120);
-- Text against text: the new enum value cannot be used as an enum in this transaction (see the top of this file).
alter table app.pledges drop constraint if exists pledges_idempotency_key_manual;
alter table app.pledges add constraint pledges_idempotency_key_manual
  check (idempotency_key is null or source::text = 'manual');
create unique index if not exists pledges_idempotency_key_uniq on app.pledges (center_id, idempotency_key)
  where idempotency_key is not null;
comment on column app.pledges.idempotency_key is
  'Set only by app.record_manual_pledge (0745): the confirmation that recorded this pledge. A second call with the same key returns this pledge instead of recording another.';

create or replace function app.record_manual_pledge(
  p_idempotency_key text,
  p_center uuid,
  p_household uuid,
  p_amount_cents bigint,
  p_reason text,
  p_fund uuid default null,
  p_campaign uuid default null,
  p_opportunity uuid default null,
  p_opportunity_option text default null,
  p_due_on date default null,
  p_pledged_by_person uuid default null,
  p_dedication text default null)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_reason text := app.audit_clean_reason(p_reason);
  v_dedication text := nullif(btrim(p_dedication), '');
  v_option text := nullif(btrim(p_opportunity_option), '');
  v_tz text;
  v_today date;
  v_camp app.campaigns;
  v_opp app.opportunities;
  v_campaign uuid := p_campaign;
  v_fund uuid := p_fund;
  v_pl app.pledges;
  v_replayed boolean := false;
begin
  select h.center_id into v_center from app.households h where h.id = p_household and h.merged_into_id is null;
  if v_center is null then
    raise exception 'That household was not found.' using errcode = 'P0002';
  end if;
  -- The community the person is working in must be the household's own. A platform admin is held to the same rule.
  if p_center is null or p_center <> v_center then
    raise exception 'That household belongs to a different community than the one you are working in. Nothing was recorded.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not app.has_permission(v_center, 'giving.manage') then
    raise exception 'You do not have permission to record pledges (it needs giving.manage).' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'A pledge needs a confirmation key of 8 to 120 characters, so that recording it twice cannot count it twice.' using errcode = '22023';
  end if;
  -- The same confirmation again (a retry after a lost answer, even a late one) gives back the pledge it recorded, checked against
  -- what is asked now, before anything that may have changed since (a campaign archived, an opportunity taken, a fund retired).
  select * into v_pl from app.pledges p where p.center_id = v_center and p.idempotency_key = v_key;
  if found then
    v_replayed := true;
  else
    if p_amount_cents is null or p_amount_cents <= 0 then
      raise exception 'Enter a pledge amount greater than zero.' using errcode = '22023';
    end if;
    if v_reason is null or char_length(v_reason) < 3 then
      raise exception 'Say why this pledge is recorded here (for example "Pledged in person"). It shows in the family''s History.' using errcode = '22023';
    end if;
    if v_dedication is not null and char_length(v_dedication) > 200 then
      raise exception 'Keep the dedication to 200 characters or fewer.' using errcode = '22023';
    end if;
    select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
    v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
    if p_due_on is not null and (p_due_on < v_today - 3653 or p_due_on > v_today + 3653) then
      raise exception 'The due date must be within ten years of today.' using errcode = '22023';
    end if;

    -- What the pledge is for: an opportunity (its campaign comes with it), a campaign (its fund comes with it), a fund, or nothing
    -- (a general pledge).
    if p_opportunity is not null then
      perform app.assert_module_enabled(v_center, 'giving_opportunities');
      select * into v_opp from app.opportunities o where o.id = p_opportunity and o.center_id = v_center;
      if not found then
        raise exception 'That opportunity was not found in this community.' using errcode = 'P0002';
      end if;
      if v_campaign is null then
        v_campaign := v_opp.campaign_id;
      elsif v_campaign <> v_opp.campaign_id then
        raise exception 'That opportunity belongs to a different campaign. Choose the opportunity or the campaign, not both.' using errcode = '22023';
      end if;
    elsif v_option is not null then
      raise exception 'An opportunity option needs an opportunity.' using errcode = '22023';
    end if;
    if v_campaign is not null then
      select * into v_camp from app.campaigns c where c.id = v_campaign and c.center_id = v_center;
      if not found then
        raise exception 'That campaign was not found in this community.' using errcode = 'P0002';
      end if;
      if v_camp.status = 'archived' then
        raise exception 'That campaign is archived. Choose another campaign or a fund.' using errcode = '22023';
      end if;
      if v_camp.kind in ('boli', 'store', 'pathshala', 'membership') then
        raise exception 'That campaign takes its pledges from its own screen (auctions, the store, class fees or memberships), so it cannot be chosen here.'
          using errcode = '22023';
      end if;
      if v_camp.fund_id is not null then
        if v_fund is null then
          v_fund := v_camp.fund_id;
        elsif v_fund <> v_camp.fund_id then
          raise exception 'That campaign''s pledges go to its own fund. Leave the fund empty, or choose the campaign''s fund.' using errcode = '22023';
        end if;
      end if;
    end if;
    if p_fund is not null and not exists (select 1 from app.funds f where f.id = p_fund and f.center_id = v_center and f.active) then
      raise exception 'That fund was not found in this community, or it is no longer in use.' using errcode = 'P0002';
    end if;

    -- Who pledged: an adult of this household, never a child (D2). Nobody named is allowed: the pledge is the household's.
    if p_pledged_by_person is not null and not exists (
         select 1 from app.household_members hm join app.people p on p.id = hm.person_id
          where hm.household_id = p_household and hm.person_id = p_pledged_by_person and hm.left_at is null
            and p.merged_into_id is null and not p.is_deceased
            and ((p.date_of_birth is not null and p.date_of_birth <= (v_today - interval '18 years')::date)
                 or (p.date_of_birth is null and hm.role in ('primary', 'spouse', 'parent')))) then
      raise exception 'The person who pledged must be an adult of this household. Choose an adult, or record the pledge for the household.'
        using errcode = '22023';
    end if;

    if p_opportunity is not null and (v_opp.status in ('taken', 'closed', 'draft')
         or (v_opp.quantity_available is not null and v_opp.quantity_taken >= v_opp.quantity_available)) then
      raise exception 'That opportunity is already taken or not open. Nothing was recorded.' using errcode = '23514';
    end if;
    -- The reason becomes the audit entry's reason for this pledge (History shows it).
    perform app.set_audit_context(v_reason);
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, opportunity_id, opportunity_option, fund_id,
                             source, amount_cents, due_on, dedication, created_by, idempotency_key)
      values (v_center, p_household, p_pledged_by_person, v_campaign, p_opportunity, v_option, v_fund,
              'manual', p_amount_cents, p_due_on, v_dedication, auth.uid(), v_key)
      on conflict (center_id, idempotency_key) where idempotency_key is not null do nothing
      returning * into v_pl;
    if not found then
      -- Two confirmations of the same key arrived together and the other one won: this one is a repeat. Nothing was inserted.
      select * into v_pl from app.pledges p where p.center_id = v_center and p.idempotency_key = v_key;
      if not found then
        raise exception 'That pledge could not be recorded just now. Nothing was recorded; try again.' using errcode = '40001';
      end if;
      v_replayed := true;
    end if;
  end if;

  -- A replay must ask for the same pledge. A campaign or fund left out may have been filled in from the opportunity or campaign.
  if v_pl.household_id <> p_household or v_pl.amount_cents <> p_amount_cents
     or v_pl.opportunity_id is distinct from p_opportunity or v_pl.opportunity_option is distinct from v_option
     or v_pl.pledged_by_person_id is distinct from p_pledged_by_person or v_pl.due_on is distinct from p_due_on
     or v_pl.dedication is distinct from v_dedication
     or (p_campaign is not null and v_pl.campaign_id is distinct from p_campaign)
     or (p_campaign is null and p_opportunity is null and v_pl.campaign_id is not null)
     or (p_fund is not null and v_pl.fund_id is distinct from p_fund)
     or (p_fund is null and p_campaign is null and p_opportunity is null and v_pl.fund_id is not null) then
    raise exception 'This confirmation was already used for a different pledge (%). Nothing was recorded.', coalesce(v_pl.pledge_number, 'not numbered yet')
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'pledge_id', v_pl.id,
    'pledge_number', v_pl.pledge_number,
    'household_id', v_pl.household_id,
    'amount_cents', v_pl.amount_cents,
    'replayed', v_replayed);
end $$;

revoke execute on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) from public, anon;
grant execute on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) to authenticated;
comment on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) is
  'Records one pledge by hand (source manual) for a household of the caller''s community: giving.manage, Giving on, a reason (written to the audit entry), the pledger an adult of the household. The same key twice returns the same pledge (replayed) and never records a second one (0745).';

-- Activity: the command is recorded under its key; the screen's own button already is (giving.record_pledge, 0620).
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.giving_record_pledge', 'Record a pledge', 'giving.record_pledge')
  ) as v(k, l, c);
