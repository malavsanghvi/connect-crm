-- 0015_person_and_household_ids.sql
-- Person IDs vs household IDs, and matching that never trusts a name alone.
--
--   * kind 'org_member'    = the org's PERSON id    (must point at a person)
--   * kind 'org_household' = the org's HOUSEHOLD id (must point at a household only)
--   Each has its own width rule: rules.identifiers.org_member_digits /
--   org_household_digits, so "417" finds "0417" in either space.
--   * Names and household names are often near-identical ("Rahul Shah",
--     "Rahul & Mira Shah Household", "Shah family"), so every suggestion carries
--     disambiguators (both org IDs, Connect number, members, zone, city, last
--     gift) and is marked ambiguous — with a lower score — when a name or a
--     learned payer name fits more than one household.

-- ---------------------------------------------------------------------------
-- Integrity: which record each org identifier may point at
-- ---------------------------------------------------------------------------
alter table app.external_ids add constraint external_ids_org_target check (
  (kind <> 'org_member' or person_id is not null) and
  (kind <> 'org_household' or (person_id is null and household_id is not null))
);

-- Canonical form for org person / household ids ("417" -> "0417" at width 4).
create or replace function app.canonical_org_id(p_center uuid, p_kind text, p_value text) returns text
language sql stable security definer set search_path = app, public as $$
  with w as (
    select case p_kind
             when 'org_member' then (rules->'identifiers'->>'org_member_digits')::int
             when 'org_household' then (rules->'identifiers'->>'org_household_digits')::int
           end as digits
    from app.centers where id = p_center
  )
  -- Numeric org IDs: leading zeros never distinguish two IDs ("417" = "0417"),
  -- with or without a configured width; the width only pads the canonical form.
  -- The value is always displayed exactly as the organization issued it.
  select case
    when app.normalize_identifier(p_value) ~ '^[0-9]+$'
    then lpad(coalesce(nullif(ltrim(app.normalize_identifier(p_value), '0'), ''), '0'),
              greatest(coalesce((select digits from w), 1),
                       length(coalesce(nullif(ltrim(app.normalize_identifier(p_value), '0'), ''), '0'))), '0')
    else app.normalize_identifier(p_value)
  end
$$;

create or replace function app.canonical_org_member(p_center uuid, p_value text) returns text
language sql stable security definer set search_path = app, public as $$
  select app.canonical_org_id(p_center, 'org_member', p_value)
$$;

create or replace function app.external_ids_normalize() returns trigger
language plpgsql as $$
begin
  new.normalized := coalesce(case when new.kind in ('org_member', 'org_household')
                                  then app.canonical_org_id(new.center_id, new.kind::text, new.value)
                                  else app.normalize_identifier(new.value) end, '');
  if new.normalized = '' then raise exception 'identifier value is empty'; end if;
  if new.household_id is null and new.person_id is not null then
    select hm.household_id into new.household_id from app.household_members hm
     where hm.person_id = new.person_id and hm.left_at is null order by hm.is_primary desc limit 1;
  end if;
  return new;
end $$;

-- RLS: household IDs follow the same rules as person IDs.
drop policy external_ids_household on app.external_ids;
create policy external_ids_household on app.external_ids for select to authenticated
  using (kind in ('org_member', 'org_household') and household_id is not null and app.in_my_household(center_id, household_id));
drop policy external_ids_people_staff_read on app.external_ids;
create policy external_ids_people_staff_read on app.external_ids for select to authenticated
  using (kind in ('org_member','org_household','crm','other') and (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage')));
drop policy external_ids_people_staff_write on app.external_ids;
create policy external_ids_people_staff_write on app.external_ids for all to authenticated
  using (kind in ('org_member','org_household','crm','other') and app.has_permission(center_id, 'people.manage'))
  with check (kind in ('org_member','org_household','crm','other') and app.has_permission(center_id, 'people.manage'));

-- ---------------------------------------------------------------------------
-- Disambiguation card for a household (used by every picker and suggestion)
-- ---------------------------------------------------------------------------
create or replace function app.household_card(p_household uuid)
returns table (household_id uuid, household_name text, household_number text, org_household_id text,
               members text, primary_member text, primary_org_member_id text, zone text, city text,
               last_gift_on date, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public as $$
  select h.id, h.display_name, h.household_number,
         (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
            and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
         (select string_agg(coalesce(p.preferred_name, p.first_name), ', ' order by hm.is_primary desc, p.date_of_birth nulls last)
            from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.left_at is null),
         (select p.first_name || ' ' || p.last_name from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null limit 1),
         (select e.value from app.household_members hm join app.external_ids e on e.person_id = hm.person_id and e.kind = 'org_member'
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null and e.valid_to is null limit 1),
         z.name, h.city,
         (select max(pay.received_on) from app.payments pay where pay.household_id = h.id),
         (select coalesce(sum(pl.amount_cents - pl.paid_cents), 0) from app.pledges pl
           where pl.household_id = h.id and pl.status in ('open','partially_paid'))
  from app.households h left join app.zones z on z.id = h.zone_id
  where h.id = p_household
    and (app.has_permission(h.center_id, 'people.view') or app.has_permission(h.center_id, 'giving.view')
         or app.has_permission(h.center_id, 'giving.record_offline') or app.in_my_household(h.center_id, h.id))
$$;

-- ---------------------------------------------------------------------------
-- resolve_identifier: person and household ID spaces searched separately;
-- a bare "417" can legitimately return person 0417 AND household 0417.
-- ---------------------------------------------------------------------------
drop function app.suggest_bank_matches(uuid);
drop function app.resolve_identifier(uuid, text);

create function app.resolve_identifier(p_center uuid, p_value text)
returns table (kind text, system text, value text, person_id uuid, household_id uuid, display_name text,
               household_name text, household_number text, org_household_id text, members text)
language sql stable security definer set search_path = app, public as $$
  with q as (select app.normalize_identifier(p_value) as n,
                    app.canonical_org_id(p_center, 'org_member', p_value) as person_n,
                    app.canonical_org_id(p_center, 'org_household', p_value) as household_n
             where app.has_permission(p_center, 'people.view') or app.has_permission(p_center, 'giving.view')
                or app.has_permission(p_center, 'giving.record_offline')),
  hits as (
    select 'connect_member'::text as kind, 'connect'::text as system, p.member_number as value, p.id as person_id,
           (select hm.household_id from app.household_members hm where hm.person_id = p.id and hm.left_at is null
             order by hm.is_primary desc limit 1) as household_id,
           p.first_name || ' ' || p.last_name as display_name
      from app.people p, q where p.center_id = p_center and app.normalize_identifier(p.member_number) = q.n
    union all
    select 'connect_household', 'connect', h.household_number, null, h.id, h.display_name
      from app.households h, q where h.center_id = p_center and app.normalize_identifier(h.household_number) = q.n
    union all
    select e.kind::text, e.system, e.value, e.person_id, e.household_id,
           coalesce((select p.first_name || ' ' || p.last_name from app.people p where p.id = e.person_id),
                    (select h.display_name from app.households h where h.id = e.household_id))
      from app.external_ids e, q
     where e.center_id = p_center and (e.valid_to is null or e.valid_to >= current_date)
       and case e.kind when 'org_member' then e.normalized = q.person_n
                       when 'org_household' then e.normalized = q.household_n
                       else e.normalized = q.n end
  )
  select h.kind, h.system, h.value, h.person_id, h.household_id, h.display_name,
         c.household_name, c.household_number, c.org_household_id, c.members
    from hits h left join lateral app.household_card(h.household_id) c on true
$$;

-- ---------------------------------------------------------------------------
-- Bank suggestions with ambiguity handling
-- ---------------------------------------------------------------------------
create function app.suggest_bank_matches(p_txn uuid)
returns table (household_id uuid, household_name text, household_number text, org_household_id text,
               members text, primary_member text, zone text, city text, last_gift_on date,
               score numeric, reason text, ambiguous boolean, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public as $$
  with t as (select * from app.bank_transactions where id = p_txn
             and not is_batch_deposit and status <> 'payout'
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  -- learned payer names; shared by several households => ambiguous
  payer as (
    select e.household_id, e.value, count(*) over () as n
      from app.external_ids e, t
     where e.center_id = t.center_id and e.kind = 'bank_payer' and e.normalized = t.payer_normalized
  ),
  -- member names equal to the payer name; several households => ambiguous
  byname as (
    select distinct hm.household_id, p.first_name || ' ' || p.last_name as who
      from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null, t
     where p.center_id = t.center_id and t.payer_normalized is not null and p.merged_into_id is null
       and (app.normalize_identifier(p.first_name || ' ' || p.last_name) = t.payer_normalized
         or app.normalize_identifier(p.last_name || ' ' || p.first_name) = t.payer_normalized
         or regexp_replace(t.payer_normalized, ' [A-Z] ', ' ') = app.normalize_identifier(p.first_name || ' ' || p.last_name))
  ),
  byname_n as (select count(distinct household_id) as n from byname),
  cands as (
    select household_id,
           case when n = 1 then 0.95 else 0.60 end::numeric as score,
           'Known bank payer name "' || value || '"' || case when n > 1 then ' — also used by ' || (n - 1) || ' other household(s)' else '' end as reason,
           n > 1 as ambiguous
      from payer
    union all
    select b.household_id,
           case when (select n from byname_n) = 1 then 0.70 else 0.45 end,
           'Payer name matches member ' || b.who ||
             case when (select n from byname_n) > 1 then ' — ' || (select n from byname_n) || ' households have a member with this name' else '' end,
           (select n from byname_n) > 1
      from byname b
    union all
    -- Connect numbers in the memo (JSH-10421, JSH-H-2041)
    select r.household_id, 0.90, 'Statement mentions ' || r.value, false
      from t, lateral regexp_matches(t.description, '([A-Z]{2,6}-(?:H-)?\d{4,6})', 'g') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind in ('connect_member', 'connect_household')
    union all
    -- "member 417" / "mem id 0417" -> org person id
    select r.household_id, 0.90, 'Statement mentions member ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:member|mem|mbr)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_member'
    union all
    -- "household 212" / "hh# 0212" / "family id 212" -> org household id
    select r.household_id, 0.90, 'Statement mentions household ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:household|hh|family|fam)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_household'
  ),
  ranked as (
    select c.household_id, max(c.score) as score, string_agg(distinct c.reason, '; ') as reason,
           bool_and(c.ambiguous) as ambiguous
      from cands c where c.household_id is not null group by c.household_id
  )
  select r.household_id, c.household_name, c.household_number, c.org_household_id, c.members, c.primary_member,
         c.zone, c.city, c.last_gift_on,
         least(1, r.score + case when exists (select 1 from app.pledges pl, t where pl.household_id = r.household_id
                                  and pl.status in ('open','partially_paid') and pl.amount_cents - pl.paid_cents = t.amount_cents)
                            then 0.04 else 0 end),
         r.reason || coalesce((select case t.originator_kind when 'daf' then ' · via donor-advised fund'
                                                             when 'matching_gift' then ' · via matching-gift platform' end from t), ''),
         r.ambiguous,
         c.open_pledge_cents
    from ranked r cross join lateral app.household_card(r.household_id) c
   order by 10 desc, c.household_name
$$;

-- When a learned payer name is shared, confirm_bank_match still learns it for the
-- chosen household (the unique index is per household), so ambiguity stays visible.

grant execute on function app.canonical_org_id(uuid, text, text), app.household_card(uuid),
  app.resolve_identifier(uuid, text), app.suggest_bank_matches(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
