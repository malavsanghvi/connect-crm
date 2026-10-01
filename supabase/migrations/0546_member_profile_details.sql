-- Member profile details: what the community would like to know about a member that is
-- NOT mandatory at bulk upload. Collected when the person signs in for the first time
-- ("A little more about you" in the member app) and editable later from their profile.
--
--   app.person_profile_details   one row per person: wedding anniversary, dietary needs
--                                (+ a free-text "other") and an emergency contact
--   app.dietary_options          the per-community choice list for dietary needs, seeded
--                                with a Jain-community default set, managed in Setup › Lists
--
-- What is deliberately NOT new here (it already exists, and a second copy would drift):
--   * interests            app.people.interests (0018), asked in onboarding step 6 and
--                          editable on the profile already
--   * volunteering areas   app.volunteer_groups (the community's own list, managed on the
--                          Volunteers page) + app.volunteer_interests (who ticked which),
--                          already behind the Welcome guide's "Volunteer" screen
--
-- Privacy. Dietary needs (allergies, diabetes) and a third party's name and mobile number
-- are sensitive:
--   * the person, and the ADULTS of their household, read and write the row
--     (app.can_act_for_person: yourself, or as an adult anyone in your household);
--   * a child's row is written by a parent only (the write needs app.i_am_adult, so a
--     minor's own login reads but never writes);
--   * staff READ with people.view or people.manage; they do not write;
--   * an anniversary is recorded for adults only (enforced here, not just in the apps);
--   * the audit trail records who changed what and when, but masks the values
--     (app.audit_mask): the emergency contact's name and number, both dietary fields.
--
-- People is a core module (it can never be switched off), so these tables are mapped to it
-- in app.module_tables and, as with the other core tables, need no restrictive
-- module_switch policy (0103: "Core tables and the core people module get no policy").
set client_min_messages = warning;

-- ── Dietary options: a per-community list ────────────────────────────────────
-- Person rows store the stable KEY, never the label, so renaming a label never orphans
-- anyone. An option is switched off (active = false) rather than deleted, so a key a
-- member already chose still has a name to show.
create table if not exists app.dietary_options (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  key        text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 60),
  sort       integer not null default 50,
  active     boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, key)
);
comment on table app.dietary_options is
  'Per-community choices for a member''s dietary needs (0546). Seeded with a default set; the key "other" makes the apps show a free-text box. Switched off, never deleted.';

drop trigger if exists touch_dietary_options on app.dietary_options;
create trigger touch_dietary_options before update on app.dietary_options
  for each row execute function app.touch_updated_at();
drop trigger if exists audit_dietary_options on app.dietary_options;
create trigger audit_dietary_options after insert or update or delete on app.dietary_options
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('dietary_options', 'people')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.dietary_options enable row level security;
-- Every member reads the list (the apps offer it); staff who can see people or manage
-- settings read it too (the portal shows the labels); only settings.manage writes.
drop policy if exists dietary_options_member_read on app.dietary_options;
create policy dietary_options_member_read on app.dietary_options for select to authenticated
  using (app.is_member_of(center_id));
drop policy if exists dietary_options_staff_read on app.dietary_options;
create policy dietary_options_staff_read on app.dietary_options for select to authenticated
  using (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage')
         or app.has_permission(center_id, 'settings.manage'));
drop policy if exists dietary_options_staff_write on app.dietary_options;
create policy dietary_options_staff_write on app.dietary_options for all to authenticated
  using (app.has_permission(center_id, 'settings.manage')) with check (app.has_permission(center_id, 'settings.manage'));
revoke all on app.dietary_options from public, anon, authenticated;
grant select, insert, update, delete on app.dietary_options to authenticated;
grant all on app.dietary_options to service_role;

-- A typical Jain-community set on every new community, and on the existing ones.
-- "other" sorts last so the free-text box always sits under the list.
create or replace function app.seed_default_dietary_options() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.dietary_options (center_id, key, label, sort) values
    (new.id, 'vegetarian',  'Vegetarian', 1),
    (new.id, 'vegan',       'Vegan', 2),
    (new.id, 'jain',        'Jain (no root vegetables)', 3),
    (new.id, 'gluten_free', 'Gluten-free', 4),
    (new.id, 'nut_allergy', 'Nut allergy', 5),
    (new.id, 'diabetic',    'Diabetic', 6),
    (new.id, 'other',       'Other', 99)
  on conflict (center_id, key) do nothing;
  return new;
end $$;
drop trigger if exists centers_seed_dietary_options on app.centers;
create trigger centers_seed_dietary_options after insert on app.centers
  for each row execute function app.seed_default_dietary_options();
revoke execute on function app.seed_default_dietary_options() from public, anon, authenticated;

insert into app.dietary_options (center_id, key, label, sort)
select c.id, v.key, v.label, v.sort from app.centers c
  cross join (values ('vegetarian','Vegetarian',1), ('vegan','Vegan',2), ('jain','Jain (no root vegetables)',3),
                     ('gluten_free','Gluten-free',4), ('nut_allergy','Nut allergy',5), ('diabetic','Diabetic',6),
                     ('other','Other',99)) as v(key, label, sort)
on conflict (center_id, key) do nothing;

-- ── The details ──────────────────────────────────────────────────────────────
-- Keys the apps store in a text[] (dietary): short, lower-case, few. Immutable so a
-- CHECK may call it.
create or replace function app.profile_keys_ok(p_keys text[], p_max integer) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_keys is not null and cardinality(p_keys) <= p_max
     and not exists (select 1 from unnest(p_keys) k where k is null or k !~ '^[a-z][a-z0-9_]{0,39}$')
$$;

create table if not exists app.person_profile_details (
  person_id                      uuid primary key references app.people(id) on delete cascade,
  center_id                      uuid not null references app.centers(id) on delete cascade,
  anniversary                    date,
  dietary                        text[] not null default '{}',
  dietary_other                  text,
  emergency_contact_name         text,
  emergency_contact_relationship text,
  emergency_contact_phone        text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  updated_by                     uuid references auth.users(id),
  constraint person_profile_details_anniversary_range check (anniversary is null or anniversary >= date '1900-01-01'),
  constraint person_profile_details_dietary_keys check (app.profile_keys_ok(dietary, 20)),
  constraint person_profile_details_dietary_other_len check (dietary_other is null or char_length(dietary_other) between 1 and 200),
  constraint person_profile_details_ec_name_len check (emergency_contact_name is null or char_length(emergency_contact_name) between 1 and 120),
  constraint person_profile_details_ec_relationship_len check (emergency_contact_relationship is null or char_length(emergency_contact_relationship) between 1 and 60),
  constraint person_profile_details_ec_phone_e164 check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- A name without a number (or the reverse) cannot be used in an emergency.
  constraint person_profile_details_ec_pair check ((emergency_contact_name is null) = (emergency_contact_phone is null)),
  constraint person_profile_details_ec_relationship_needs_contact check (emergency_contact_relationship is null or emergency_contact_name is not null)
);
create index if not exists person_profile_details_center_idx on app.person_profile_details (center_id);
comment on table app.person_profile_details is
  'Optional member details (0546): wedding anniversary (adults only), dietary needs (keys of app.dietary_options + free-text other) and an emergency contact. Read by the person and the adults of their household and by staff with people.view; written by the person or a household adult, never by a minor''s own login. Values are masked in the audit trail.';
comment on column app.person_profile_details.dietary is 'Keys of app.dietary_options for the person''s community. A key that was later switched off still reads as its old label.';
comment on column app.person_profile_details.emergency_contact_phone is 'E.164, e.g. +17135550142.';

-- Checks that need the person's row, plain-English errors (the apps show them as written),
-- and the stamps. SECURITY DEFINER so a parent saving a child's row can read the child's birth date.
create or replace function app.person_profile_details_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.people;
begin
  select * into p from app.people where id = new.person_id;
  if p.id is null then raise exception 'That person was not found.' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    raise exception 'These details belong to one person and cannot be moved to another.' using errcode = '23514';
  end if;
  -- The row always belongs to the person's own community, whatever the caller sent.
  new.center_id := p.center_id;

  new.dietary_other := nullif(btrim(new.dietary_other), '');
  new.emergency_contact_name := nullif(btrim(new.emergency_contact_name), '');
  new.emergency_contact_relationship := nullif(btrim(new.emergency_contact_relationship), '');
  new.emergency_contact_phone := nullif(btrim(new.emergency_contact_phone), '');
  -- Each dietary choice once, in the order given.
  new.dietary := coalesce((select array_agg(k order by first_pos)
                             from (select k, min(pos) as first_pos from unnest(new.dietary) with ordinality as t(k, pos) group by k) s),
                          '{}'::text[]);

  if new.anniversary is not null then
    if p.date_of_birth is not null and p.date_of_birth > current_date - interval '18 years' then
      raise exception 'A wedding anniversary can only be recorded for an adult.' using errcode = '23514';
    end if;
    if new.anniversary > current_date then
      raise exception 'The wedding anniversary cannot be in the future.' using errcode = '23514';
    end if;
    if p.date_of_birth is not null and new.anniversary <= p.date_of_birth then
      raise exception 'The wedding anniversary has to be after the birth date. Check the year.' using errcode = '23514';
    end if;
  end if;
  if new.dietary_other is not null and not ('other' = any (new.dietary)) then
    raise exception 'Choose "Other" under dietary needs to add a note of your own.' using errcode = '23514';
  end if;
  if (new.emergency_contact_name is null) <> (new.emergency_contact_phone is null)
     or (new.emergency_contact_relationship is not null and new.emergency_contact_name is null) then
    raise exception 'An emergency contact needs both a name and a mobile number. Fill in both, or leave the emergency contact blank.' using errcode = '23514';
  end if;
  if new.emergency_contact_phone is not null and new.emergency_contact_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'The emergency contact''s mobile number must include the country code, for example +17135550142.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then new.created_at := now(); end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function app.person_profile_details_check() from public, anon, authenticated;
drop trigger if exists person_profile_details_check on app.person_profile_details;
create trigger person_profile_details_check before insert or update on app.person_profile_details
  for each row execute function app.person_profile_details_check();

drop trigger if exists audit_person_profile_details on app.person_profile_details;
create trigger audit_person_profile_details after insert or update or delete on app.person_profile_details
  for each row execute function app.audit_row('person_id');
insert into app.module_tables (table_name, module_key) values ('person_profile_details', 'people')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.person_profile_details enable row level security;
-- The person, and the adults of their household (app.can_act_for_person).
drop policy if exists person_profile_details_own_read on app.person_profile_details;
create policy person_profile_details_own_read on app.person_profile_details for select to authenticated
  using (app.can_act_for_person(center_id, person_id));
-- Writing needs an adult: a child's row is written by a parent, never by the child's own login.
drop policy if exists person_profile_details_own_insert on app.person_profile_details;
create policy person_profile_details_own_insert on app.person_profile_details for insert to authenticated
  with check (app.i_am_adult(center_id) and app.can_act_for_person(center_id, person_id));
drop policy if exists person_profile_details_own_update on app.person_profile_details;
create policy person_profile_details_own_update on app.person_profile_details for update to authenticated
  using (app.i_am_adult(center_id) and app.can_act_for_person(center_id, person_id))
  with check (app.i_am_adult(center_id) and app.can_act_for_person(center_id, person_id));
-- Staff read. No staff write policy: the details are the member's own to give.
drop policy if exists person_profile_details_staff_read on app.person_profile_details;
create policy person_profile_details_staff_read on app.person_profile_details for select to authenticated
  using (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage'));
-- No delete: a member clears a field by saving it empty, and a person's removal cascades.
revoke all on app.person_profile_details from public, anon, authenticated;
grant select, insert, update on app.person_profile_details to authenticated;
grant all on app.person_profile_details to service_role;

-- ── Audit: who changed it is recorded, the sensitive values are not ──────────
-- 0102's mask, plus the emergency contact's name and number and both dietary fields.
-- A blank stays blank so "added" and "cleared" still read as changes.
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
  end
$$;

-- ── A sandbox reset keeps the dietary choices ────────────────────────────────
-- A reset (o-demo, 0310) clears every center table that is not on its keep list. The dietary
-- choices are something the organization set up (seeded with the community, then edited in
-- Setup › Lists), not demo content, so they are kept through a reset like templates and
-- agreements are (0390). Member rows (person_profile_details) are people data and are cleared
-- with the people. Same list as 0390, plus dietary_options.
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs'
  ]::text[]
$$;
