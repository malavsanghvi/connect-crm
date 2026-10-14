-- 0723 · Staff can change what a member gave about themselves (People redesign, the person slide-over's Profile section).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0546 lets a member (and the adults of their household) give three optional details in the app: a wedding anniversary, dietary
--   needs (with a note of their own under "Other") and an emergency contact. Staff could READ them, never change them: there is
--   no staff write policy on app.person_profile_details. The owner decided (2026-10-13) that staff with people.manage may change
--   the three, but only through one function that checks who is asking and writes an audit entry saying who changed it and why,
--   not through a new table policy.
--
--   app.staff_save_profile_details(p_person, p_patch, p_reason)   one function, returns nothing
--
--   p_patch is a JSON object that holds only the details being changed:
--     anniversary                     "2019-06-02", or null to clear
--     dietary                         ["vegetarian", "other"] (keys of the community's dietary list), or null to clear
--     dietary_other                   the member's own words under "Other", or null
--     emergency_contact_name          text or null
--     emergency_contact_relationship  text or null
--     emergency_contact_phone         "+81398765432" (international form), or null
--   A key that is absent is left as it is. JSON null clears it. Any other key is refused (an allowlist). The row is created when
--   the person has none. Every rule about the VALUES (an anniversary only for an adult, not in the future, after the birth date;
--   a contact needs a name and a mobile number together; the mobile in international form; "Other" before a note) is the existing
--   check trigger's (app.person_profile_details_check, 0546) and is not repeated here: its sentences come through as written.
--   What this function adds is only who may ask, the shape of the request (so a mistake has a plain sentence, not a database
--   message), and that a dietary choice is one the community offers.
--
-- WHO MAY CALL IT
--   Only a signed-in person who holds people.manage in the community of the person being changed (the permission every other
--   People write asks for), and only while the People module is on. A person who does not exist and a person in another
--   community are refused with the same sentence, so the function cannot be used to find out who exists. The record of a person
--   who was merged into another is refused (change the surviving record). Nothing is granted to anon, to the service key or to
--   the background worker: they cannot run it. The member's own way in (their own row, 0546's policies) is not touched.
--
-- WHY IT IS SECURITY DEFINER
--   Staff have no write policy on the table, by design; the function writes as its owner after its own checks. It pins the search
--   path with extensions (hosted Supabase keeps pgcrypto there). It never reads or returns anything: it returns nothing.
--
-- AUDIT
--   The table's audit trigger (0546) records the row, who changed it and the reason. The reason is the one given (the portal's
--   Undo says "Undo of ... change"), else the request's own reason, else "Updated by staff". The audit trail masks the dietary
--   fields and the emergency contact's name and number (app.audit_mask, 0546) as it does for the member's own changes.
--
--   Idempotent: create or replace; the activity registration is an upsert.

create or replace function app.staff_save_profile_details(p_person uuid, p_patch jsonb, p_reason text default null)
returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  p        app.people;
  cur      app.person_profile_details;
  k        text;
  v_anniv  date;
  v_diet   text[];
  v_other  text;
  v_name   text;
  v_rel    text;
  v_phone  text;
  v_exists boolean;
begin
  -- Who is asking. A person who does not exist and one in another community get the same answer.
  if auth.uid() is null then
    raise exception 'Sign in to change a member''s details.' using errcode = 'insufficient_privilege';
  end if;
  select * into p from app.people where id = p_person;
  if p.id is null or not app.has_permission(p.center_id, 'people.manage') then
    raise exception 'Changing a member''s details needs the people.manage permission' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p.center_id, 'people');
  if p.merged_into_id is not null then
    raise exception 'This record was merged into another person. Change the other record instead.' using errcode = '22023';
  end if;

  -- The shape of the request: an object of known keys.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'There is nothing to change.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('anniversary', 'dietary', 'dietary_other', 'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone') then
      raise exception 'That detail cannot be changed here (%).', left(k, 60) using errcode = '22023';
    end if;
    if k not in ('anniversary', 'dietary') and jsonb_typeof(p_patch -> k) not in ('string', 'null') then
      raise exception 'Every detail except the dietary list has to be text.' using errcode = '22023';
    end if;
  end loop;

  -- Start from what is there; the keys in the patch replace it.
  select * into cur from app.person_profile_details where person_id = p_person for update;
  v_exists := found;
  v_anniv := cur.anniversary;
  v_diet  := coalesce(cur.dietary, '{}'::text[]);
  v_other := cur.dietary_other;
  v_name  := cur.emergency_contact_name;
  v_rel   := cur.emergency_contact_relationship;
  v_phone := cur.emergency_contact_phone;

  if p_patch ? 'anniversary' then
    if jsonb_typeof(p_patch -> 'anniversary') = 'null' then
      v_anniv := null;
    elsif jsonb_typeof(p_patch -> 'anniversary') = 'string' and (p_patch ->> 'anniversary') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_anniv := (p_patch ->> 'anniversary')::date;
      exception when others then
        raise exception 'The wedding anniversary has to be a real date, for example 2019-06-02.' using errcode = '22023';
      end;
    else
      raise exception 'The wedding anniversary has to be a date written like 2019-06-02, or null to clear it.' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'dietary' then
    if jsonb_typeof(p_patch -> 'dietary') = 'null' then
      v_diet := '{}'::text[];
    elsif jsonb_typeof(p_patch -> 'dietary') = 'array'
          and not exists (select 1 from jsonb_array_elements(p_patch -> 'dietary') e where jsonb_typeof(e) <> 'string') then
      v_diet := array(select e #>> '{}' from jsonb_array_elements(p_patch -> 'dietary') with ordinality as t(e, n) order by n);
      -- A choice has to be one this community offers (switched off ones stay if the person already has them).
      if exists (
        select 1 from unnest(v_diet) as d(key)
         where d.key !~ '^[a-z][a-z0-9_]{0,39}$'
            or (not (d.key = any (coalesce(cur.dietary, '{}'::text[])))
                and not exists (select 1 from app.dietary_options o where o.center_id = p.center_id and o.key = d.key and o.active))
      ) then
        raise exception 'One of the dietary choices is not on this community''s list. Choose from the list.' using errcode = '22023';
      end if;
    else
      raise exception 'Dietary needs have to be a list of choices from the community''s list.' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'dietary_other' then v_other := p_patch ->> 'dietary_other'; end if;
  if p_patch ? 'emergency_contact_name' then v_name := p_patch ->> 'emergency_contact_name'; end if;
  if p_patch ? 'emergency_contact_relationship' then v_rel := p_patch ->> 'emergency_contact_relationship'; end if;
  if p_patch ? 'emergency_contact_phone' then v_phone := p_patch ->> 'emergency_contact_phone'; end if;

  -- The table's own length limits, said in words (the trigger trims, so they are counted after trimming).
  if char_length(btrim(coalesce(v_other, ''))) > 200 then
    raise exception 'The dietary note can be at most 200 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(v_name, ''))) > 120 then
    raise exception 'The emergency contact''s name can be at most 120 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(v_rel, ''))) > 60 then
    raise exception 'How the emergency contact is related can be at most 60 characters.' using errcode = '22023';
  end if;

  -- Nothing different from what is there: nothing to write, and no audit entry for it.
  if v_exists and v_anniv is not distinct from cur.anniversary and v_diet is not distinct from cur.dietary
     and v_other is not distinct from cur.dietary_other and v_name is not distinct from cur.emergency_contact_name
     and v_rel is not distinct from cur.emergency_contact_relationship and v_phone is not distinct from cur.emergency_contact_phone then
    return;
  end if;

  -- The reason the audit entry carries: the one given, else the request's own, else a plain default.
  if app.audit_clean_reason(p_reason) is not null then
    perform app.set_audit_context(p_reason);
  else
    perform app.set_audit_default_reason('Updated by staff');
  end if;

  -- One row per person: created when none, else changed. The check trigger (0546) validates the whole row either way and
  -- puts the person's own community on it.
  insert into app.person_profile_details (person_id, center_id, anniversary, dietary, dietary_other,
                                          emergency_contact_name, emergency_contact_relationship, emergency_contact_phone)
  values (p_person, p.center_id, v_anniv, v_diet, v_other, v_name, v_rel, v_phone)
  on conflict (person_id) do update
    set anniversary = excluded.anniversary,
        dietary = excluded.dietary,
        dietary_other = excluded.dietary_other,
        emergency_contact_name = excluded.emergency_contact_name,
        emergency_contact_relationship = excluded.emergency_contact_relationship,
        emergency_contact_phone = excluded.emergency_contact_phone;
end $$;

comment on function app.staff_save_profile_details(uuid, jsonb, text) is
  'Staff with people.manage change a member''s wedding anniversary, dietary needs or emergency contact (0723). The patch holds only the keys being changed; absent = left alone, null = cleared, any other key is refused. The 0546 check trigger validates the values; the audit entry carries the reason.';

revoke execute on function app.staff_save_profile_details(uuid, jsonb, text) from public, anon, service_role;
grant execute on function app.staff_save_profile_details(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity: the screen's own button is recorded under its key (like people.add_household in 0721). No command is registered:
-- these details are private and are not offered to the palette or to Niva.
-- ---------------------------------------------------------------------------
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('people.save_profile_details', 'Change the details a member gave about themselves', 'person')
  ) as v(k, l, e);
