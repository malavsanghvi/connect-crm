-- 0746 · Giving › Statements in the New look (docs/GIVING_REDESIGN.md slice 8): the year-end review and a copy of one receipt.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Two READ functions. Nothing is written, nothing is sent, no table, policy or existing function changes.
--
--   app.year_end_review(center, year, majority)
--     One row per household that gave in the calendar year (January to December, the same year as app.year_end_statement
--     and the member app). The totals are year_end_statement's exactly (latest body 0743): the statuses
--     app.statement_counted_status counts, net of refunds, opening-balance lines left out. Each row also says who the
--     statement would be addressed to: the household's ADULTS only (a statement is addressed to adults; a child is never
--     listed and a child's email never counts), whether each adult has an email or an app account, whether the household
--     asked for paper and whether its postal address is complete. No email address and no postal address is returned.
--     Needs Giving and the Statements add-on, and giving.view or giving.manage (the people who see the household card).
--
--   app.receipt_copy(payment, majority)
--     What a copy of one donation receipt shows: the receipt number, date, method, amount, refunds, the funds or campaigns
--     it was applied to, the household card, the adults, and the name on the receipt. The name on the receipt is left out
--     (receipt_name_hidden) when the payer is under the age of majority or the name contains a child's first name of the
--     household, so the copy is addressed to the adults instead. It also says whether the treasurer's approval of the
--     receipt templates is current (app.check_statement_templates_approved, 0300): the portal prints a copy only then.
--     Receipts stay core (section 11): it needs Giving only, and giving.view or giving.manage. An opening-balance line, a
--     payment that did not go through or was refunded in full, and a payment without a receipt number have no receipt.
--
--   Adults: a member who has not left, is not deceased and not merged, born on or before (today - majority years); with no
--   birth date on file, only the household roles primary, spouse and parent (the same rule as src/lib/commands/child-filter.ts
--   isAdultMember). majority is clamped to 18..25 (src/lib/age-of-majority.ts: 18 is the floor).
set client_min_messages = warning;

create or replace function app._statement_adult(p_dob date, p_role app.person_role_in_household, p_majority int)
returns boolean language sql stable set search_path = app, public, extensions as $$
  select case when p_dob is not null
              then p_dob <= (current_date - make_interval(years => greatest(18, least(coalesce(p_majority, 18), 25))))::date
              else p_role in ('primary', 'spouse', 'parent') end
$$;

create or replace function app.year_end_review(p_center uuid, p_year int, p_majority int default 18)
returns table (household_id uuid, household_name text, household_number text, org_household_id text, city text,
               adults jsonb, gift_count int, given_cents bigint, refunded_cents bigint, refunded_count int,
               opening_balance_count int, opening_balance_cents bigint, mail_opt_in boolean, address_complete boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_statements');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'The year-end review needs giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 1990 or p_year > 2200 then raise exception 'Choose a tax year.'; end if;

  return query
  with pay as (
    select p.household_id as hid,
           count(*) filter (where app.statement_counted_status(p.status) and not p.is_opening_balance) as n,
           coalesce(sum(p.amount_cents - p.refunded_cents)
                      filter (where app.statement_counted_status(p.status) and not p.is_opening_balance), 0)::bigint as given,
           coalesce(sum(p.refunded_cents)
                      filter (where (app.statement_counted_status(p.status) or p.status = 'refunded') and not p.is_opening_balance), 0)::bigint as refunded,
           count(*) filter (where p.status = 'refunded' and not p.is_opening_balance) as refunded_n,
           count(*) filter (where app.statement_counted_status(p.status) and p.is_opening_balance) as ob_n,
           coalesce(sum(p.amount_cents - p.refunded_cents)
                      filter (where app.statement_counted_status(p.status) and p.is_opening_balance), 0)::bigint as ob
      from app.payments p
     where p.center_id = p_center
       and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     group by p.household_id
  )
  select h.id, h.display_name, h.household_number,
         (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
            and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
         h.city,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'name', btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name),
                            'primary', hm.is_primary,
                            'email', coalesce(btrim(pe.email), '') <> '',
                            'app', exists (select 1 from app.center_users cu where cu.center_id = p_center and cu.person_id = pe.id))
                          order by hm.is_primary desc, pe.date_of_birth nulls last, pe.first_name)
                     from app.household_members hm join app.people pe on pe.id = hm.person_id
                    where hm.household_id = h.id and hm.left_at is null and not pe.is_deceased and pe.merged_into_id is null
                      and app._statement_adult(pe.date_of_birth, hm.role, p_majority)), '[]'::jsonb),
         pay.n::int, pay.given, pay.refunded, pay.refunded_n::int, pay.ob_n::int, pay.ob,
         coalesce(h.physical_mail_opt_in, false),
         coalesce(btrim(h.address_line1), '') <> '' and coalesce(btrim(h.city), '') <> '' and coalesce(btrim(h.postal_code), '') <> ''
    from pay join app.households h on h.id = pay.hid and h.center_id = p_center
   where pay.n > 0
   order by h.display_name, h.id;
end $$;

create or replace function app.receipt_copy(p_payment uuid, p_majority int default 18)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.payments; v_payer_adult boolean; v_minors text[]; v_name text; v_hidden boolean := false;
begin
  select * into v from app.payments where id = p_payment;
  if v.id is null then raise exception 'That payment was not found.'; end if;
  perform app.assert_module_enabled(v.center_id, 'giving');
  if not (app.has_permission(v.center_id, 'giving.view') or app.has_permission(v.center_id, 'giving.manage')) then
    raise exception 'A copy of a receipt needs giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if v.is_opening_balance then
    raise exception 'An opening-balance line never gets a receipt: it records what was paid before the imported payment history begins.';
  end if;
  if v.status = 'refunded' then raise exception 'This payment was refunded in full, so there is no receipt to copy.'; end if;
  if not app.statement_counted_status(v.status) then
    raise exception 'This payment did not go through, so there is no receipt to copy.';
  end if;
  if coalesce(btrim(v.receipt_number), '') = '' then
    raise exception 'This payment has no receipt number yet, so there is no receipt to copy.';
  end if;

  if v.payer_person_id is not null then
    select app._statement_adult(pe.date_of_birth,
             (select hm.role from app.household_members hm
               where hm.person_id = pe.id and hm.household_id = v.household_id and hm.left_at is null limit 1), p_majority)
      into v_payer_adult
      from app.people pe where pe.id = v.payer_person_id;
  end if;

  select coalesce(array_agg(distinct lower(btrim(n))) filter (where length(btrim(n)) >= 2), '{}'::text[]) into v_minors
    from app.household_members hm join app.people pe on pe.id = hm.person_id
         cross join lateral unnest(array[pe.first_name, pe.preferred_name]) n
   where hm.household_id = v.household_id and hm.left_at is null
     and not app._statement_adult(pe.date_of_birth, hm.role, p_majority);

  v_name := nullif(btrim(v.receipt_name), '');
  if v_name is not null and ((v.payer_person_id is not null and v_payer_adult is not true)
       or exists (select 1 from unnest(v_minors) m where position(m in lower(v_name)) > 0)) then
    v_name := null;
    v_hidden := true;
  end if;

  return jsonb_build_object(
    'payment_id', v.id, 'center_id', v.center_id, 'household_id', v.household_id,
    'household', (select jsonb_build_object('name', h.display_name, 'number', h.household_number, 'city', h.city,
                     'org_id', (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
                                  and e.valid_to is null order by e.is_primary desc, e.created_at limit 1))
                    from app.households h where h.id = v.household_id),
    'receipt_number', v.receipt_number, 'received_on', v.received_on, 'method', v.method, 'status', v.status,
    'amount_cents', v.amount_cents, 'refunded_cents', v.refunded_cents,
    'receipt_name', v_name, 'receipt_name_hidden', v_hidden, 'joint_receipt', v.joint_receipt,
    'payer_is_adult', v_payer_adult,
    'adults', coalesce((select jsonb_agg(btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name)
                                         order by hm.is_primary desc, pe.date_of_birth nulls last, pe.first_name)
                          from app.household_members hm join app.people pe on pe.id = hm.person_id
                         where hm.household_id = v.household_id and hm.left_at is null and not pe.is_deceased
                           and pe.merged_into_id is null and app._statement_adult(pe.date_of_birth, hm.role, p_majority)), '[]'::jsonb),
    'applied_to', coalesce((select jsonb_agg(distinct coalesce(f.name, c.name))
                              from app.payment_allocations a join app.pledges pl on pl.id = a.pledge_id
                              left join app.funds f on f.id = pl.fund_id
                              left join app.campaigns c on c.id = pl.campaign_id
                             where a.payment_id = v.id and coalesce(f.name, c.name) is not null), '[]'::jsonb),
    'templates', app.check_statement_templates_approved(v.center_id));
end $$;

revoke execute on function app._statement_adult(date, app.person_role_in_household, int) from public, anon, authenticated;
revoke execute on function app.year_end_review(uuid, int, int), app.receipt_copy(uuid, int) from public, anon;
grant execute on function app.year_end_review(uuid, int, int), app.receipt_copy(uuid, int) to authenticated;
