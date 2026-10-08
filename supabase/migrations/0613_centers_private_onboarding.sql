-- 0613: private onboarding details (the owner's e-mail, the creating admin's login id, contact names and phone
-- numbers) are no longer kept in app.centers.rules, where a visitor who is not signed in can read them.
--
-- Why: app.centers is readable by anyone. The policy centers_public_read (0010) admits every community whose
-- status is 'active' or 'onboarding', and the table is granted to anon (0010): the shipped member app reads the
-- community row, `rules` included, before anyone signs in, so the column cannot be taken away from guests without
-- breaking installed apps. Creating a sandbox wrote the owner's e-mail (platform_create_sandbox, 0502/0594) and the
-- creating platform admin's user id into rules.onboarding, so for every sandbox in 'onboarding' status they were
-- public. The platform does not need them there: the owner is known through app.center_owners and
-- app.staff_invitations (the onboarding pipeline reads them from there, 0202).
--
-- What this does:
--   1. app.is_private_onboarding_key(key): which keys of rules.onboarding are private (any key naming an e-mail or
--      a phone number, owner_name, contact_name, created_by). Settings the portal uses (production_slug, source,
--      org_type, wizard_step, fields, contact_coverage_target, request_id, modules_interested ...) are kept.
--   2. A BEFORE INSERT / UPDATE OF rules trigger removes those keys, whichever function or screen writes the row,
--      so nothing written later (including by functions still in review) can put them back.
--   3. A one-time clean-up of the rows that already hold them.
-- Nothing else about who can read a community changes: the row is as public as before, minus these keys.

create or replace function app.is_private_onboarding_key(p_key text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_key ~* '(e-?mail|phone)' or p_key in ('owner_name', 'contact_name', 'created_by')
$$;

create or replace function app.centers_strip_private_onboarding() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare k text;
begin
  if jsonb_typeof(new.rules -> 'onboarding') = 'object' then
    for k in select ok.key from jsonb_object_keys(new.rules -> 'onboarding') as ok(key)
              where app.is_private_onboarding_key(ok.key)
    loop
      new.rules := new.rules #- array['onboarding', k];
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists centers_strip_private_onboarding on app.centers;
create trigger centers_strip_private_onboarding before insert or update of rules on app.centers
  for each row execute function app.centers_strip_private_onboarding();

-- The one-time clean-up (also called by the database test). Returns how many communities were cleaned.
create or replace function app.centers_scrub_private_onboarding() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  -- Writing `rules` back unchanged fires the trigger above, which removes the private keys.
  update app.centers c set rules = c.rules
   where jsonb_typeof(c.rules -> 'onboarding') = 'object'
     and exists (select 1 from jsonb_object_keys(c.rules -> 'onboarding') as ok(key)
                  where app.is_private_onboarding_key(ok.key));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.centers_scrub_private_onboarding() from public, anon, authenticated;

select app.centers_scrub_private_onboarding();
