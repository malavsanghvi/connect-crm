-- Onboarding · o-qbo-match · 2 of 4: deterministic donor-match suggestions.
--
-- app.qbo_suggest_matches(p_center) scores every active QuickBooks customer that
-- has no approved match against the center's households and people:
--
--   crm_id          the QuickBooks customer ID is already on file (external_ids kind accounting)   0.99
--   email           the same email as an adult household member                                     0.95
--   phone           the same phone number                                                            0.90
--   sub_customer    a sub-customer of an approved QuickBooks customer → the parent's household      0.90
--   name_address    first + last name of a member, and the same ZIP or street (city only: 0.70)     0.85
--   household_name  the household's name ≈ the QuickBooks name ("Shah Family", "Mr & Mrs Ketan
--                   Shah"): the same core words 0.75, contained in it 0.65, a member's full name 0.60
--
-- Each extra independent signal for the same household adds 0.02 (at most 0.99).
-- The best three candidates at 0.5 or more are kept as suggestions, with the
-- evidence of both sides side by side. It never approves anything: the treasury
-- does. A pair the treasury rejected is never suggested again.
-- Customers left ambiguous (no candidate at 0.6 or more, or the top two within
-- 0.1) are what the AI job (0243, qbo.match_suggest_ai) looks at.

alter table app.qbo_customers add column if not exists ai_checked_at timestamptz;

-- Lower-case letters and digits, single spaces.
create or replace function app.qbo_norm(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-- The words of a name that identify a family: honorifics and "family", "household", "and" dropped.
create or replace function app.qbo_core_tokens(p text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(array_agg(t order by n), '{}')
    from unnest(string_to_array(nullif(app.qbo_norm(p), ''), ' ')) with ordinality as x(t, n)
   where t not in ('mr','mrs','ms','miss','mx','dr','shri','shree','smt','sri','kum','the','and','family','household',
                   'house','parivar','fam','hh','jr','sr')
$$;

-- "Shah Family", "Mr & Mrs Ketan Shah", "Ketan and Rupa Shah": a family-level account.
create or replace function app.qbo_looks_family(p_display text, p_given text, p_family text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(p_display, '') ~* '(\m(family|household|parivar)\M|&|\mand\M|\mmr\.?\s*(&|and)\s*mrs\M)'
$$;

create or replace function app.qbo_zip5(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select left(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 5)
$$;

-- The default level of new matches (integration_connections.settings.qbo_customer_level).
create or replace function app.qbo_customer_level(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select case when settings->>'qbo_customer_level' in ('family','person','mixed') then settings->>'qbo_customer_level' end
                     from app.integration_connections
                    where center_id = p_center and provider = 'quickbooks_online'), 'mixed')
$$;

-- Ranked candidates for the center's unmatched QuickBooks customers (all, or the ones listed).
create or replace function app.qbo_match_candidates(p_center uuid, p_only text[] default null)
returns table (qbo_customer_id text, household_id uuid, person_id uuid, confidence numeric, method text, evidence jsonb, rank int)
language sql stable security definer set search_path = app, public, extensions as $$
  with cust as (
    select c.qbo_id, c.display_name, c.given_name, c.family_name, c.company_name, c.emails, c.phones, c.address, c.parent_qbo_id,
           k.core,
           coalesce(nullif(app.qbo_norm(c.family_name), ''), k.core[cardinality(k.core)]) as surname,
           coalesce(nullif(app.qbo_norm(c.given_name), ''), case when cardinality(k.core) >= 2 then k.core[1] end) as given,
           app.qbo_zip5(c.address->>'zip') as zip5, app.qbo_norm(c.address->>'line1') as line1, app.qbo_norm(c.address->>'city') as city,
           app.qbo_looks_family(c.display_name, c.given_name, c.family_name) as family_like
      from app.qbo_customers c
      cross join lateral (select app.qbo_core_tokens(coalesce(nullif(c.display_name, ''), c.company_name)) as core) k
     where c.center_id = p_center and c.active and (p_only is null or c.qbo_id = any (p_only))
       and not exists (select 1 from app.qbo_customer_matches m
                        where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'approved')
  ),
  hh as (
    select h.id, h.display_name, h.household_number, h.city, h.postal_code, app.qbo_core_tokens(h.display_name) as core,
           app.qbo_zip5(h.postal_code) as zip5, app.qbo_norm(h.address_line1) as line1, app.qbo_norm(h.city) as ncity
      from app.households h where h.center_id = p_center and h.merged_into_id is null
  ),
  mem as (
    select hm.household_id, p.id as person_id, p.first_name, p.preferred_name, p.last_name,
           p.first_name || ' ' || p.last_name as full_name, lower(p.email::text) as email, p.phone_e164,
           (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years') as adult
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.center_id = p_center and hm.left_at is null and p.merged_into_id is null
  ),
  sig as (
    -- The QuickBooks ID is already on file for the household or one of its members.
    select c.qbo_id, e.household_id, null::uuid as person_id, 0.99::numeric as score, 'crm_id' as method,
           jsonb_build_object('kind', 'crm_id', 'label', 'QuickBooks customer ID already on file', 'qb', c.qbo_id, 'cc', e.value) as ev
      from cust c join app.external_ids e on e.center_id = p_center and e.kind = 'accounting' and e.valid_to is null
                                        and e.household_id is not null and e.normalized = app.normalize_identifier(c.qbo_id)
    union all
    select c.qbo_id, m.household_id, m.person_id, 0.99, 'crm_id',
           jsonb_build_object('kind', 'crm_id', 'label', 'QuickBooks customer ID already on file', 'qb', c.qbo_id, 'cc', e.value || ' · ' || m.full_name)
      from cust c join app.external_ids e on e.center_id = p_center and e.kind = 'accounting' and e.valid_to is null
                                        and e.person_id is not null and e.normalized = app.normalize_identifier(c.qbo_id)
                  join mem m on m.person_id = e.person_id
    union all
    -- The same email as an adult member (their main email or another one on file).
    select c.qbo_id, m.household_id, m.person_id, 0.95, 'email',
           jsonb_build_object('kind', 'email', 'label', 'Same email', 'qb', x.email, 'cc', x.email || ' · ' || m.full_name)
      from cust c cross join lateral unnest(c.emails) as x(email)
      join mem m on m.adult and (m.email = x.email
                   or exists (select 1 from app.person_emails pe where pe.person_id = m.person_id and lower(pe.email::text) = x.email))
    union all
    select c.qbo_id, m.household_id, m.person_id, 0.90, 'phone',
           jsonb_build_object('kind', 'phone', 'label', 'Same phone number', 'qb', x.phone, 'cc', m.phone_e164 || ' · ' || m.full_name)
      from cust c cross join lateral unnest(c.phones) as x(phone)
      join mem m on m.adult and m.phone_e164 = x.phone
    union all
    select c.qbo_id, pm.household_id, null::uuid, 0.90, 'sub_customer',
           jsonb_build_object('kind', 'sub_customer', 'label', 'Sub-customer of an approved QuickBooks customer', 'qb', c.parent_qbo_id,
                              'cc', (select h.display_name from hh h where h.id = pm.household_id))
      from cust c join app.qbo_customer_matches pm on pm.center_id = p_center and pm.qbo_customer_id = c.parent_qbo_id and pm.status = 'approved'
    union all
    -- First and last name of a member, plus where they live.
    select c.qbo_id, m.household_id, m.person_id,
           case when (c.zip5 <> '' and c.zip5 = h.zip5) or (c.line1 <> '' and c.line1 = h.line1) then 0.85 else 0.70 end, 'name_address',
           jsonb_build_object('kind', 'name_address', 'label',
             case when c.line1 <> '' and c.line1 = h.line1 then 'Same name and street'
                  when c.zip5 <> '' and c.zip5 = h.zip5 then 'Same name and ZIP code' else 'Same name and city' end,
             'qb', concat_ws(' · ', nullif(btrim(concat_ws(' ', c.given_name, c.family_name)), ''), c.address->>'line1', c.address->>'city', c.address->>'zip'),
             'cc', concat_ws(' · ', m.full_name, h.city, h.postal_code))
      from cust c
      join mem m on c.surname is not null and c.given is not null
               and app.qbo_norm(m.last_name) = c.surname and c.given in (app.qbo_norm(m.first_name), app.qbo_norm(m.preferred_name))
      join hh h on h.id = m.household_id
     where (c.zip5 <> '' and c.zip5 = h.zip5) or (c.line1 <> '' and c.line1 = h.line1) or (c.city <> '' and c.city = h.ncity)
    union all
    -- The household's name, compared word for word ("Shah Family" ≈ "Shah family").
    select c.qbo_id, h.id, null::uuid, case when h.core = c.core then 0.75 else 0.65 end, 'household_name',
           jsonb_build_object('kind', 'household_name', 'label', case when h.core = c.core then 'Same family name' else 'Family name contained in the household name' end,
                              'qb', c.display_name, 'cc', h.display_name)
      from cust c join hh h on cardinality(c.core) > 0 and c.surname is not null and h.core @> c.core and c.surname = any (h.core)
    union all
    -- A member's full name inside a family-style QuickBooks name ("Mr & Mrs Ketan Shah").
    select c.qbo_id, m.household_id, null::uuid, 0.60, 'household_name',
           jsonb_build_object('kind', 'member_name', 'label', 'A household member has this name', 'qb', c.display_name, 'cc', m.full_name)
      from cust c join mem m on c.family_like and c.given is not null and c.surname is not null and m.adult
               and app.qbo_norm(m.last_name) = c.surname and c.given in (app.qbo_norm(m.first_name), app.qbo_norm(m.preferred_name))
  ),
  agg as (
    select s.qbo_id, s.household_id,
           max(s.score) as top, count(distinct s.method) as nsig,
           (array_agg(s.method order by s.score desc, s.method))[1] as method,
           (array_agg(s.person_id order by (s.person_id is null), s.score desc))[1] as person_id,
           jsonb_agg(distinct s.ev) as signals
      from sig s
     where s.household_id is not null
       and not exists (select 1 from app.qbo_customer_matches r
                        where r.center_id = p_center and r.qbo_customer_id = s.qbo_id and r.household_id = s.household_id and r.status = 'rejected')
     group by s.qbo_id, s.household_id
  ),
  scored as (
    select a.*, least(0.99, a.top + 0.02 * (a.nsig - 1))::numeric(4,3) as conf,
           row_number() over (partition by a.qbo_id order by least(0.99, a.top + 0.02 * (a.nsig - 1)) desc, a.household_id) as rn
      from agg a
  )
  select s.qbo_id, s.household_id,
         case app.qbo_customer_level(p_center)
           when 'family' then null
           when 'person' then s.person_id
           else case when c.family_like then null else s.person_id end end,
         s.conf, s.method,
         jsonb_build_object(
           'signals', s.signals,
           'qb', jsonb_build_object('display_name', c.display_name, 'company', c.company_name, 'emails', to_jsonb(c.emails),
                                    'phones', to_jsonb(c.phones), 'address', c.address, 'family_like', c.family_like),
           'cc', (select jsonb_build_object('household', h.display_name, 'household_number', h.household_number, 'city', h.city,
                                            'zip', h.postal_code,
                                            'members', (select coalesce(jsonb_agg(m.full_name order by m.person_id), '[]'::jsonb) from mem m where m.household_id = h.id),
                                            'primary', (select p.first_name || ' ' || p.last_name from app.household_members hm join app.people p on p.id = hm.person_id
                                                         where hm.household_id = h.id and hm.is_primary and hm.left_at is null limit 1),
                                            'person', (select p.first_name || ' ' || p.last_name from app.people p where p.id = s.person_id))
                    from hh h where h.id = s.household_id)),
         s.rn::int
    from scored s join cust c on c.qbo_id = s.qbo_id
   where s.rn <= 3 and s.conf >= 0.5
$$;

-- Rewrite the machine suggestions for the center (or the customers listed). Returns counts.
create or replace function app.qbo_refresh_suggestions(p_center uuid, p_only text[] default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_new int; v_customers int; v_ambiguous int; v_unmatched int;
begin
  create temp table if not exists qbo_cand_tmp (qbo_customer_id text, household_id uuid, person_id uuid, confidence numeric,
                                                method text, evidence jsonb, rank int) on commit drop;
  truncate qbo_cand_tmp;
  insert into qbo_cand_tmp select * from app.qbo_match_candidates(p_center, p_only);

  -- Deterministic suggestions are rebuilt; an AI suggestion stays until the treasury decides it
  -- (when the AI agreed with a rule, its evidence already carries the rule's signals).
  delete from app.qbo_customer_matches m
   where m.center_id = p_center and m.status = 'suggested'
     and (p_only is null or m.qbo_customer_id = any (p_only))
     and m.method not in ('ai','manual');
  insert into app.qbo_customer_matches (center_id, qbo_customer_id, household_id, person_id, status, confidence, method, evidence)
  select p_center, t.qbo_customer_id, t.household_id, t.person_id, 'suggested', t.confidence, t.method, t.evidence
    from qbo_cand_tmp t
  on conflict do nothing;
  get diagnostics v_new = row_count;

  select count(*) into v_customers from app.qbo_customers c
   where c.center_id = p_center and c.active and (p_only is null or c.qbo_id = any (p_only));
  select count(*) filter (where a.top is null), count(*) filter (where a.top is not null and (a.top < 0.6 or a.top - coalesce(a.second, 0) <= 0.1))
    into v_unmatched, v_ambiguous
    from app.qbo_customers c
    left join lateral (select max(m.confidence) as top,
                              (array_agg(m.confidence order by m.confidence desc))[2] as second
                         from app.qbo_customer_matches m
                        where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'suggested') a on true
   where c.center_id = p_center and c.active and (p_only is null or c.qbo_id = any (p_only))
     and not exists (select 1 from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'approved');
  return jsonb_build_object('customers', v_customers, 'suggestions', v_new, 'ambiguous', v_ambiguous, 'no_candidate', v_unmatched);
end $$;

-- The treasury's "Find matches again" button.
create or replace function app.qbo_suggest_matches(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Finding QuickBooks donor matches needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  return app.qbo_refresh_suggestions(p_center, null);
end $$;

revoke execute on function app.qbo_match_candidates(uuid, text[]), app.qbo_refresh_suggestions(uuid, text[]),
  app.qbo_customer_level(uuid) from public, anon, authenticated;
grant execute on function app.qbo_suggest_matches(uuid), app.qbo_norm(text), app.qbo_core_tokens(text),
  app.qbo_looks_family(text, text, text), app.qbo_zip5(text) to authenticated;
grant execute on all functions in schema app to service_role;
