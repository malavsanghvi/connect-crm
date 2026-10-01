-- 0561: address suggestions for the member app's address forms (onboarding "Your home address", and anywhere the
-- app edits a household address): type-ahead ZIP and city lists that come from the community itself.
--
--   app.address_suggestions(p_center) → postal_code, city, state_region, households, from_zone
--
-- * From the community's households: each (ZIP, city, state) once normalized — ZIP cut to its first 5 digits
--   (ZIP+4 allowed; anything else is not a ZIP), city trimmed with single spaces and in title case, state trimmed
--   and upper case — and ONLY the combinations at least two households share, so the list never singles out one
--   household. A household counts only with all three filled in; a household merged into another is left out
--   (the duplicate would count one family twice).
-- * Plus the ZIP codes of the community's zones (zones.zip_codes): city and state empty, households 0,
--   from_zone true. They come first.
-- Members of the community only. Core (People is never switched off), so there is no module check. Reads only.
set client_min_messages = warning;

create or replace function app.address_suggestions(p_center uuid)
returns table (postal_code text, city text, state_region text, households int, from_zone boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not app.is_member_of(p_center) then
    raise exception 'Only members of this community can see its address suggestions.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with h as (
    select case when btrim(hh.postal_code) ~ '^[0-9]{5}([- ]?[0-9]{4})?$' then left(btrim(hh.postal_code), 5) end as zip,
           nullif(initcap(regexp_replace(btrim(hh.city), '[[:space:]]+', ' ', 'g')), '') as city_n,
           nullif(upper(btrim(hh.state_region)), '') as state_n
      from app.households hh
     where hh.center_id = p_center and hh.merged_into_id is null
  ), combos as (
    select h.zip, h.city_n, h.state_n, count(*)::int as n
      from h
     where h.zip is not null and h.city_n is not null and h.state_n is not null
     group by h.zip, h.city_n, h.state_n
    having count(*) >= 2
  ), zone_zips as (
    select distinct case when btrim(z.code) ~ '^[0-9]{5}([- ]?[0-9]{4})?$' then left(btrim(z.code), 5) end as zip
      from app.zones zo
     cross join lateral unnest(zo.zip_codes) as z(code)
     where zo.center_id = p_center
  )
  select s.zip, s.city_n, s.state_n, s.n, s.is_zone
    from (select c.zip, c.city_n, c.state_n, c.n, false as is_zone from combos c
          union all
          select zz.zip, null::text, null::text, 0, true from zone_zips zz where zz.zip is not null) s
   order by s.is_zone desc, s.zip, s.n desc, s.city_n;
end $$;

comment on function app.address_suggestions(uuid) is
  'ZIP / city / state suggestions for address forms (0561): normalized combinations used by at least two of the community''s households (never one household alone), plus the zones'' ZIP codes (from_zone, city and state empty, first). Members only; core, no module check.';

revoke execute on function app.address_suggestions(uuid) from public, anon;
grant execute on function app.address_suggestions(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
