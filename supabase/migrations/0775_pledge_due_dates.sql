-- 0775: every pledge has a due date (owner decision 2026-10-13; GV-U slice A). NEEDS OWNER OK: it changes existing rows (the
-- backfill) and makes app.pledges.due_on required.
--
-- What is added or changed, and only this:
--   app.pledge_default_due_on(center, pledged_at)   the community's rule: the day the pledge was made, in the community's own time
--                                                   zone, plus rules.giving.pledge_due_days (a whole number of days from 0 to 3650).
--                                                   Not set (or not a whole number in range) means 30, the rule every screen already
--                                                   counted with for a pledge that had no due date.
--   app.pledges_default_due_on()                    BEFORE INSERT on app.pledges: a pledge that arrives without a due date gets the
--                                                   community's default. The paths that make a pledge without one (the member app's
--                                                   insert, app.close_boli and app.submit_rsvp of 0104, app.qbo_bring_in_customer of
--                                                   0411 when the invoice has no DueDate, the import, app.record_manual_pledge without a
--                                                   date) get one; the paths that set their own keep it (app.commit_labh and
--                                                   app.run_recurring_gift_cycle of 0743, the memberships of 0130 and 0724, the class
--                                                   fees of 0591).
--   the backfill                                    every existing pledge without a due date gets the day it was made + 30 days: the
--                                                   date app.giving_pledges_behind (0656), the Insights read (0749) and the Pledges list
--                                                   already counted from, so no number on those screens changes. The audit entry of
--                                                   each row carries the reason below. updated_at is left as it was: the write-off queue
--                                                   reads "waiting since" from it.
--   app.pledges.due_on not null                     after the backfill.
--   app._record_manual_pledge_core(..., p_pledged_on)
--                                                   the body of app.record_manual_pledge (latest 0745) with two changes: a day it was
--                                                   pledged (an upload of last week's pledge cards, 0776), and a replay that compares
--                                                   the due date only when one was asked for. Without that, the trigger above would make
--                                                   every replay of a pledge recorded without a due date look like a different pledge.
--                                                   It returns due_on and pledged_on as well. Only the functions that call it run it.
--   app.record_manual_pledge(...)                   the same twelve arguments, grants and rules as 0745; it calls the core.
--   app.set_pledge_due_on(center, pledge, due_on, reason)
--                                                   change an open pledge's due date: giving.manage in the pledge's community, Giving
--                                                   on, a reason (it becomes the audit entry's reason, so History shows it), a date
--                                                   within ten years of today and not before the day it was pledged. No money moves; no
--                                                   second person (as recording a pledge, 0745).
--
-- What does NOT change: no policy, no permission, no other function. The reads keep their "no due date" fallback, which no longer
-- happens. The member app needs no change: its insert gets the default.
set client_min_messages = warning;

-- ── The community's rule ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.pledge_default_due_on(p_center uuid, p_pledged_at timestamptz)
returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (coalesce(p_pledged_at, now()) at time zone coalesce(nullif(c.time_zone, ''), 'UTC'))::date
         + case when coalesce(c.rules #>> '{giving,pledge_due_days}', '') ~ '^[0-9]{1,4}$'
                     and (c.rules #>> '{giving,pledge_due_days}')::integer <= 3650
                then (c.rules #>> '{giving,pledge_due_days}')::integer
                else 30 end
    from app.centers c
   where c.id = p_center
$$;
revoke execute on function app.pledge_default_due_on(uuid, timestamptz) from public, anon;
grant execute on function app.pledge_default_due_on(uuid, timestamptz) to authenticated;
comment on function app.pledge_default_due_on(uuid, timestamptz) is
  'The due date a pledge gets when it is made without one: the day it was made in the community''s time zone plus rules.giving.pledge_due_days (default 30) (0775).';

create or replace function app.pledges_default_due_on() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.due_on is null then
    new.due_on := coalesce(app.pledge_default_due_on(new.center_id, coalesce(new.pledged_at, now())),
                           (coalesce(new.pledged_at, now()) at time zone 'UTC')::date + 30);
  end if;
  return new;
end $$;
revoke execute on function app.pledges_default_due_on() from public, anon, authenticated;
drop trigger if exists pledges_default_due_on on app.pledges;
create trigger pledges_default_due_on before insert on app.pledges
  for each row execute function app.pledges_default_due_on();

-- ── The backfill (audited; updated_at kept) ──────────────────────────────────────────────────────────────────────────────────────
select app.set_audit_context('Every pledge has a due date (owner decision 2026-10-13): a pledge that had none is due 30 days after the day it was made, the date every screen already counted from (0775).');
alter table app.pledges disable trigger touch_pledges;
update app.pledges p
   set due_on = (p.pledged_at at time zone coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p.center_id), 'UTC'))::date + 30
 where p.due_on is null;
alter table app.pledges enable trigger touch_pledges;
alter table app.pledges alter column due_on set not null;
comment on column app.pledges.due_on is
  'When the pledge is due. Every pledge has one (0775): given when it is made, or the community''s default (app.pledge_default_due_on).';

-- ── Recording a pledge by hand: the core, and the function the portal calls ──────────────────────────────────────────────────────
create or replace function app._record_manual_pledge_core(
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
  p_dedication text default null,
  p_pledged_on date default null)
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
  v_pledged_at timestamptz;
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
  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
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
    if p_due_on is not null and (p_due_on < v_today - 3653 or p_due_on > v_today + 3653) then
      raise exception 'The due date must be within ten years of today.' using errcode = '22023';
    end if;
    -- The day it was pledged (an upload of pledge cards from last week): today or earlier, within ten years; the due date not before
    -- it. Today, or no day given, is now; an earlier day is noon of that day in the community's own time zone, so the date reads the
    -- same in every time zone.
    if p_pledged_on is not null and (p_pledged_on > v_today or p_pledged_on < v_today - 3653) then
      raise exception 'The day it was pledged must be today or earlier, within the last ten years.' using errcode = '22023';
    end if;
    if p_pledged_on is not null and p_due_on is not null and p_due_on < p_pledged_on then
      raise exception 'The due date cannot be before the day it was pledged.' using errcode = '22023';
    end if;
    v_pledged_at := case when p_pledged_on is null or p_pledged_on = v_today then now()
                         else (p_pledged_on + time '12:00') at time zone coalesce(v_tz, 'UTC') end;

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
                             source, amount_cents, due_on, dedication, created_by, idempotency_key, pledged_at)
      values (v_center, p_household, p_pledged_by_person, v_campaign, p_opportunity, v_option, v_fund,
              'manual', p_amount_cents, p_due_on, v_dedication, auth.uid(), v_key, v_pledged_at)
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

  -- A replay must ask for the same pledge. A campaign or fund left out may have been filled in from the opportunity or campaign; a due
  -- date left out was filled in from the community's rule.
  if v_pl.household_id <> p_household or v_pl.amount_cents <> p_amount_cents
     or v_pl.opportunity_id is distinct from p_opportunity or v_pl.opportunity_option is distinct from v_option
     or v_pl.pledged_by_person_id is distinct from p_pledged_by_person
     or (p_due_on is not null and v_pl.due_on is distinct from p_due_on)
     or (p_pledged_on is not null and (v_pl.pledged_at at time zone coalesce(v_tz, 'UTC'))::date <> p_pledged_on)
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
    'due_on', v_pl.due_on,
    'pledged_on', (v_pl.pledged_at at time zone coalesce(v_tz, 'UTC'))::date,
    'replayed', v_replayed);
end $$;

revoke execute on function app._record_manual_pledge_core(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text, date)
  from public, anon, authenticated;
comment on function app._record_manual_pledge_core(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text, date) is
  'The rules of recording a pledge by hand (0745), with the day it was pledged (0775). Run only by app.record_manual_pledge and the pledge upload.';

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
begin
  return app._record_manual_pledge_core(p_idempotency_key, p_center, p_household, p_amount_cents, p_reason, p_fund, p_campaign,
                                        p_opportunity, p_opportunity_option, p_due_on, p_pledged_by_person, p_dedication, null);
end $$;
revoke execute on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) from public, anon;
grant execute on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) to authenticated;
comment on function app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text) is
  'Records one pledge by hand (source manual) for a household of the caller''s community: giving.manage, Giving on, a reason (written to the audit entry), the pledger an adult of the household. The same key twice returns the same pledge (replayed) and never records a second one (0745). Without a due date it gets the community''s default (0775).';

-- ── Changing a pledge's due date ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.set_pledge_due_on(p_center uuid, p_pledge uuid, p_due_on date, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_pl app.pledges;
  v_reason text := app.audit_clean_reason(p_reason);
  v_tz text;
  v_today date;
  v_pledged_on date;
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
    raise exception 'You do not have permission to change a pledge''s due date (it needs giving.manage).' using errcode = '42501';
  end if;
  select * into v_pl from app.pledges p where p.id = p_pledge for update;
  if v_pl.status not in ('open', 'partially_paid') then
    raise exception 'Only an open pledge''s due date can change; % is %.', coalesce(v_pl.pledge_number, 'this pledge'), replace(v_pl.status::text, '_', ' ')
      using errcode = '22023';
  end if;
  if p_due_on is null then
    raise exception 'Choose the new due date.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why the due date changes (for example "Asked for more time"). It shows in the family''s History.' using errcode = '22023';
  end if;
  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  v_pledged_on := (v_pl.pledged_at at time zone coalesce(v_tz, 'UTC'))::date;
  if p_due_on < v_today - 3653 or p_due_on > v_today + 3653 then
    raise exception 'The due date must be within ten years of today.' using errcode = '22023';
  end if;
  if p_due_on < v_pledged_on then
    raise exception 'The due date cannot be before the day it was pledged (%).', to_char(v_pledged_on, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  if v_pl.due_on = p_due_on then
    return jsonb_build_object('pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id,
                              'due_on', v_pl.due_on, 'was', v_pl.due_on, 'changed', false);
  end if;
  perform app.set_audit_context(v_reason);
  update app.pledges set due_on = p_due_on where id = v_pl.id;
  return jsonb_build_object('pledge_id', v_pl.id, 'pledge_number', v_pl.pledge_number, 'household_id', v_pl.household_id,
                            'due_on', p_due_on, 'was', v_pl.due_on, 'changed', true);
end $$;
revoke execute on function app.set_pledge_due_on(uuid, uuid, date, text) from public, anon;
grant execute on function app.set_pledge_due_on(uuid, uuid, date, text) to authenticated;
comment on function app.set_pledge_due_on(uuid, uuid, date, text) is
  'Changes an open pledge''s due date: giving.manage in its community, Giving on, a reason (the audit entry''s), within ten years of today and not before the day it was pledged. No money moves (0775).';

-- ── The portal's action, in the activity allowlist ───────────────────────────────────────────────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.change_due_date', 'Change a pledge''s due date', 'pledge')
  ) as v(k, l, e);
