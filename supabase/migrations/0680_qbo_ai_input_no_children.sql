-- B85 · Nothing about a child reaches an AI provider (owner decision D2, 2026-10-09).
--
-- app.qbo_worker_ai_input (0243) built `member_first_names` for every candidate household from household_members
-- joined to people with no age filter, and the job qbo.match_suggest_ai sends that JSON to the model. So children's
-- first names, and the domains of their email addresses, left the database. This replaces the function with the same
-- signature, the same grants and the same output shape; the only change is WHO is listed:
--
--   * a member with a date of birth is listed when they are 18 or older (the rule every other function uses:
--     date_of_birth <= current_date - interval '18 years', so someone turning 18 today is listed, someone turning 18
--     tomorrow is not);
--   * a member with NO date of birth is left out (unknown age is treated as possibly a child) unless a household
--     records them as its primary member or as a spouse. That is the household-role rule app.person_is_minor (0587)
--     already uses, and a primary member cannot be under 18 (0030, 0420). Every other role without a date of birth
--     (child, parent, sibling, other) stays out: a sibling or an "other" may be a child, and a name alone proves nothing.
--
-- The same adults-only list feeds `email_domains`: a child's email address is information about a child too.
-- Nothing else changes: the model still sees the customer's own names, the household name, city and ZIP.
-- Prompt wording and model settings are untouched (worker/src/handlers/qbo.match_suggest_ai.ts).

create or replace function app.qbo_worker_ai_input(p_center uuid, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  perform app.assert_worker();
  with amb as (
    select c.* from app.qbo_customers c
      left join lateral (select max(m.confidence) as top, (array_agg(m.confidence order by m.confidence desc))[2] as second
                           from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'suggested') a on true
     where c.center_id = p_center and c.active and c.ai_checked_at is null
       and not exists (select 1 from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'approved')
       and (a.top is null or a.top < 0.6 or a.top - coalesce(a.second, 0) <= 0.1)
     order by c.qbo_id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ),
  cand as (
    select a.qbo_id, h.id as household_id
      from amb a
      cross join lateral (
        select m.household_id as id from app.qbo_customer_matches m
         where m.center_id = p_center and m.qbo_customer_id = a.qbo_id and m.status = 'suggested'
        union
        select hm.household_id from app.household_members hm join app.people p on p.id = hm.person_id
         where hm.center_id = p_center and hm.left_at is null and p.merged_into_id is null
           and app.qbo_norm(p.last_name) = coalesce(nullif(app.qbo_norm(a.family_name), ''),
                                                    (app.qbo_core_tokens(a.display_name))[cardinality(app.qbo_core_tokens(a.display_name))])
        limit 8) h
     where not exists (select 1 from app.qbo_customer_matches r where r.center_id = p_center and r.qbo_customer_id = a.qbo_id
                         and r.household_id = h.id and r.status = 'rejected')
  ),
  -- The only household members the model may hear about (D2): known adults, or no date of birth on file and the
  -- primary member or a spouse of a household. Everyone else, children and unknown ages, is left out here, once, for
  -- both lists below.
  adults as (
    select hm.household_id, hm.is_primary, p.first_name, coalesce(nullif(p.preferred_name, ''), p.first_name) as shown_name, p.email
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.household_id in (select household_id from cand) and hm.left_at is null
       and (p.date_of_birth <= current_date - interval '18 years'
            or (p.date_of_birth is null
                and exists (select 1 from app.household_members r
                             where r.person_id = p.id and r.left_at is null and r.role in ('primary', 'spouse'))))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'qbo_id', a.qbo_id, 'display_name', a.display_name, 'given_name', a.given_name, 'family_name', a.family_name,
           'company_name', a.company_name, 'city', a.address->>'city', 'zip', app.qbo_zip5(a.address->>'zip'),
           'email_domains', (select coalesce(jsonb_agg(distinct split_part(e, '@', 2)), '[]'::jsonb) from unnest(a.emails) e where e like '%@%'),
           'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
                             'household_id', h.id, 'name', h.display_name, 'city', h.city, 'zip', app.qbo_zip5(h.postal_code),
                             'member_first_names', (select coalesce(jsonb_agg(m.shown_name order by m.is_primary desc, m.first_name), '[]'::jsonb)
                                                      from adults m where m.household_id = h.id),
                             'email_domains', (select coalesce(jsonb_agg(distinct split_part(m.email::text, '@', 2)), '[]'::jsonb)
                                                 from adults m where m.household_id = h.id and m.email is not null)
                           )), '[]'::jsonb)
                            from cand x join app.households h on h.id = x.household_id where x.qbo_id = a.qbo_id))), '[]'::jsonb)
    into v
    from amb a;
  return v;
end $$;

comment on function app.qbo_worker_ai_input(uuid, int) is
  'The QuickBooks customers the AI is asked about, with candidate households. Household members are listed only when they are known adults (18 or older) or have no date of birth and are a primary member or spouse; children and unknown ages never appear, in first names or in email domains (D2, B85).';

-- Same grants as 0243 (create or replace keeps them; stated again so this file shows who may call it).
revoke execute on function app.qbo_worker_ai_input(uuid, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'connect_worker') then
    grant execute on function app.qbo_worker_ai_input(uuid, int) to connect_worker;
  end if;
end $$;
