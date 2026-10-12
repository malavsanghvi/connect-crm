-- 0721 · Add a family from People (People redesign slice 6, docs/PEOPLE_REDESIGN.md).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Staff could not add a family from People: a household only came from an import, a QuickBooks match or the public application.
--   This adds the database side of "Add a family": a household with its first adult as the primary member (never a child), in one
--   step that is all or nothing. Before anything is created it looks for families that may already be the same one, by mobile,
--   email, and last name (a first name too, when it matches), and if there are any it creates NOTHING and gives them back, until
--   the caller says "none of these" and asks again.
--
--   app.family_name_key(text)                         a name written the way two spellings of it compare equal: case, accents,
--                                                     spacing (any script)
--   app.household_possible_matches(...)               the families that may already be this one (read only)
--   app.add_household(...)                            the matches, or the new family; its own people.manage check
--
-- WHY THEY ARE SECURITY DEFINER
--   Reading "who else has this mobile" must see every family of the community, which a narrower role could not read through
--   row-level security. So each function checks, first, that the caller is signed in and holds people.manage in THAT community
--   (the same permission the existing add-a-person and move-a-person functions ask for) and that the People module is on, and it
--   only ever looks at the community it was given. It returns household ids, never a name, so a child's name cannot leave it.
--   The audit triggers on households, people and household_members record every row, with the reason "Added a family".
--
--   The household number is issued by the same trigger as for every other new household (0012); the household's name is
--   "Last, First" like the households staff create with make_primary_of_own_household (0030). A membership is NOT created:
--   that is a separate decision. Idempotent: create or replace.

create or replace function app.family_name_key(p_text text) returns text
language sql immutable parallel safe set search_path = app, public, extensions as $$
  select nullif(btrim(regexp_replace(regexp_replace(normalize(lower(coalesce(p_text, '')), nfd), '[̀-ͯ]', '', 'g'), '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- Families that may already be this one. Read only.
--   {"total": 3, "matches": [{"household_id": "...", "reasons": ["mobile", "name"], "strength": 7}, ...]}
-- reasons: mobile (the same mobile number), email (the same email, also an extra email), name (the same first and last name),
-- last_name (the same last name only). At most 8 are returned, the strongest first; total counts them all.
-- ---------------------------------------------------------------------------
create or replace function app.household_possible_matches(
  p_center uuid, p_first text, p_last text, p_phone text default null, p_email text default null
) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_first text := app.family_name_key(p_first);
  v_last  text := app.family_name_key(p_last);
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_out jsonb;
begin
  if auth.uid() is null or p_center is null or not app.has_permission(p_center, 'people.manage') then
    raise exception 'Adding a family needs the people.manage permission' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'people');
  if v_last is null and v_phone is null and v_email is null then
    return jsonb_build_object('total', 0, 'matches', '[]'::jsonb);
  end if;

  with raw as (
    select p.id as person_id, 'mobile'::text as why
      from app.people p
     where v_phone is not null and p.center_id = p_center and p.merged_into_id is null and p.phone_e164 = v_phone
    union all
    select p.id, 'email'
      from app.people p
     where v_email is not null and p.center_id = p_center and p.merged_into_id is null and p.email = v_email::citext
    union all
    select pe.person_id, 'email'
      from app.person_emails pe join app.people p on p.id = pe.person_id
     where v_email is not null and pe.center_id = p_center and p.center_id = p_center and p.merged_into_id is null and pe.email = v_email::citext
    union all
    select p.id, case when v_first is not null and app.family_name_key(p.first_name) = v_first then 'name' else 'last_name' end
      from app.people p
     where v_last is not null and p.center_id = p_center and p.merged_into_id is null and app.family_name_key(p.last_name) = v_last
  ), linked as (
    select hm.household_id as hid, r.why
      from raw r
      join app.household_members hm on hm.person_id = r.person_id and hm.left_at is null
      join app.households h on h.id = hm.household_id and h.merged_into_id is null and h.center_id = p_center
  ), agg as (
    select l.hid,
           array_remove(array[
             case when bool_or(l.why = 'mobile') then 'mobile' end,
             case when bool_or(l.why = 'email') then 'email' end,
             case when bool_or(l.why = 'name') then 'name' end,
             case when bool_or(l.why = 'last_name') and not bool_or(l.why = 'name') then 'last_name' end
           ], null) as reasons,
           (case when bool_or(l.why = 'mobile') then 4 else 0 end
            + case when bool_or(l.why = 'email') then 4 else 0 end
            + case when bool_or(l.why = 'name') then 3 else 0 end
            + case when bool_or(l.why = 'last_name') then 1 else 0 end) as strength
      from linked l group by l.hid
  ), ranked as (
    select a.hid, a.reasons, a.strength, h.household_number, (count(*) over ())::int as total
      from agg a join app.households h on h.id = a.hid
  ), best as (
    select * from ranked order by strength desc, household_number nulls last, hid limit 8
  )
  select jsonb_build_object(
           'total', coalesce(max(t.total), 0),
           'matches', coalesce(jsonb_agg(jsonb_build_object('household_id', t.hid, 'reasons', to_jsonb(t.reasons), 'strength', t.strength)
                                         order by t.strength desc, t.household_number nulls last, t.hid), '[]'::jsonb))
    into v_out
    from best t;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Add a family: a household with its first adult as the primary member.
--   No match found, or p_none_of_these: {"created": true, "household_id": ..., "person_id": ..., "household_number": ...}
--   Matches found and not confirmed:    {"created": false, "total": n, "matches": [...]}   (nothing was created)
-- p_phone is a mobile number in international form (+15125550101); the portal normalises what a person types before it gets here.
-- ---------------------------------------------------------------------------
create or replace function app.add_household(
  p_center uuid, p_first text, p_last text,
  p_phone text default null, p_email text default null, p_street text default null,
  p_none_of_these boolean default false
) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_first  text := btrim(coalesce(p_first, ''));
  v_last   text := btrim(coalesce(p_last, ''));
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_found  jsonb;
  v_hh uuid; v_person uuid; v_number text;
begin
  if auth.uid() is null or p_center is null or not app.has_permission(p_center, 'people.manage') then
    raise exception 'Adding a family needs the people.manage permission' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'people');
  if v_first = '' or v_last = '' then raise exception 'A first and last name are required' using errcode = '22023'; end if;
  if char_length(v_first) > 200 or char_length(v_last) > 200 then raise exception 'The name is too long' using errcode = '22023'; end if;
  if v_street is not null and char_length(v_street) > 300 then raise exception 'The street address is too long' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+[0-9]{8,15}$' then
    raise exception 'The mobile number needs its country code, for example +15125550101' using errcode = '22023';
  end if;
  if v_email is not null and (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) > 200) then
    raise exception 'That email address does not look right' using errcode = '22023';
  end if;

  if not coalesce(p_none_of_these, false) then
    v_found := app.household_possible_matches(p_center, v_first, v_last, v_phone, v_email);
    if jsonb_array_length(v_found->'matches') > 0 then
      return jsonb_build_object('created', false, 'total', v_found->'total', 'matches', v_found->'matches');
    end if;
  end if;

  perform app.set_audit_context('Added a family');
  insert into app.households (center_id, display_name, address_line1)
    values (p_center, v_last || ', ' || v_first, v_street)
    returning id, household_number into v_hh, v_number;
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
    values (p_center, v_first, v_last, v_email, v_phone)
    returning id into v_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
    values (v_hh, v_person, p_center, 'primary', true, current_date);
  return jsonb_build_object('created', true, 'household_id', v_hh, 'person_id', v_person, 'household_number', v_number);
end $$;

revoke execute on function app.family_name_key(text), app.household_possible_matches(uuid, text, text, text, text),
  app.add_household(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function app.family_name_key(text), app.household_possible_matches(uuid, text, text, text, text),
  app.add_household(uuid, text, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity: the command and the screen's own button are recorded under their keys (like 0651 and 0720).
-- ---------------------------------------------------------------------------
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.people_add_household', 'Add a new family', 'people.add_household')
  ) as v(k, l, c);
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('people.add_household', 'Add a new family', 'household')
  ) as v(k, l, e);
