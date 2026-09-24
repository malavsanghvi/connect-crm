-- Onboarding (stream o-tenancy) · 2 of 3: finding a community, test
-- recipients, portal domains and the organization switcher
-- (docs/ONBOARDING_PLAN.md §3 and §7; ONBOARDING_CONTRACT.md).
--
--   app.member_join_codes          lets the member app find a community by code
--                                  (sandboxes are reachable ONLY this way)
--   app.find_community(q)          production communities by name / city / state
--   app.community_by_join_code(c)  any environment, by an active code
--   app.sandbox_test_recipients    up to 10 verified test addresses per center
--   app.recipient_allowed(...)     for the future sender (o-messaging)
--   app.center_domains             an organization's own portal web address
--   app.center_slug_for_domain(d)  the portal resolves its organization from the host
--   app.my_centers()               the organizations the signed-in user works with
set client_min_messages = warning;

-- ── Join codes ───────────────────────────────────────────────────────────────
-- No look-alike characters (no I, L, O, 0, 1), as the sandbox codes.
create or replace function app.new_join_code() returns text
language plpgsql volatile set search_path = app, public, extensions as $$
declare a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v text; b bytea;
begin
  loop
    b := gen_random_bytes(8); v := '';
    for i in 0..7 loop v := v || substr(a, 1 + (get_byte(b, i) % length(a)), 1); end loop;
    exit when not exists (select 1 from app.member_join_codes where code = v);
  end loop;
  return v;
end $$;

-- Accepts "7K4M-Q2PD", "7k4m q2pd", "communityconnect://join/7K4M-Q2PD" or an https …/join/<code> link.
create or replace function app.normalize_join_code(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select nullif(regexp_replace(upper(regexp_replace(coalesce(p, ''), '^.*/join/', '', 'i')), '[^A-Z0-9]', '', 'g'), '')
$$;

create table if not exists app.member_join_codes (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{6,16}$'),
  active     boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists member_join_codes_center_idx on app.member_join_codes (center_id) where active;
comment on table app.member_join_codes is
  'Codes (and the QR communityconnect://join/<code>) that open a community in the member app. Sandboxes are found only this way.';
alter table app.member_join_codes alter column code set default app.new_join_code();

create or replace function app.member_join_codes_normalize() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  new.code := coalesce(app.normalize_join_code(new.code), app.new_join_code());
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists member_join_codes_normalize on app.member_join_codes;
create trigger member_join_codes_normalize before insert or update of code on app.member_join_codes
  for each row execute function app.member_join_codes_normalize();

alter table app.member_join_codes enable row level security;
drop policy if exists member_join_codes_staff_read on app.member_join_codes;
create policy member_join_codes_staff_read on app.member_join_codes for select to authenticated
  using (app.has_permission(center_id, 'settings.manage') or app.has_permission(center_id, 'people.manage'));
drop policy if exists member_join_codes_staff_write on app.member_join_codes;
create policy member_join_codes_staff_write on app.member_join_codes for all to authenticated
  using (app.has_permission(center_id, 'settings.manage')) with check (app.has_permission(center_id, 'settings.manage'));
grant select, insert, update, delete on app.member_join_codes to authenticated;
grant all on app.member_join_codes to service_role;
drop trigger if exists audit_member_join_codes on app.member_join_codes;
create trigger audit_member_join_codes after insert or update or delete on app.member_join_codes
  for each row execute function app.audit_row();

-- Every community gets one code when it is created; existing ones get theirs now.
create or replace function app.centers_first_join_code() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.member_join_codes (center_id, created_by) values (new.id, auth.uid());
  return null;
end $$;
drop trigger if exists centers_first_join_code on app.centers;
create trigger centers_first_join_code after insert on app.centers
  for each row execute function app.centers_first_join_code();
insert into app.member_join_codes (center_id)
select c.id from app.centers c where not exists (select 1 from app.member_join_codes j where j.center_id = c.id);

-- Replace the active code(s) with a new one (a code on a poster leaked, or a
-- pilot ended). Old codes stop working at once.
create or replace function app.rotate_member_join_code(p_center uuid, p_expires_at timestamptz default null, p_reason text default null)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare v text;
begin
  if not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Making a new join code needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Choose an expiry date in the future, or none.';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'New member-app join code'));
  update app.member_join_codes set active = false where center_id = p_center and active;
  insert into app.member_join_codes (center_id, expires_at) values (p_center, p_expires_at) returning code into v;
  return v;
end $$;

-- ── Finding a community (member app, no sign-in needed) ─────────────────────
-- The city comes from the organization profile (o-setup, app.org_profiles)
-- when that table exists; until then only the name, short name and state match.
create or replace function app.find_community(p_query text)
returns table (slug text, name text, short_name text, city text, state_region text, environment text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare q text := lower(btrim(coalesce(p_query, ''))); v_profiles boolean := to_regclass('app.org_profiles') is not null;
begin
  if length(q) < 2 then return; end if;
  q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_profiles then
    return query execute $q$
      select c.slug::text, c.name, c.short_name, p.registered_address->>'city', c.state_region, c.environment
        from app.centers c left join app.org_profiles p on p.center_id = c.id
       where c.environment = 'production' and c.status = 'active'
         and (lower(c.name) like $1 or lower(coalesce(c.short_name, '')) like $1 or lower(c.slug::text) like $1
              or lower(coalesce(c.state_region, '')) like $1 or lower(coalesce(p.registered_address->>'city', '')) like $1
              or lower(coalesce(p.dba, '')) like $1)
       order by (lower(c.name) like substr($1, 2)) desc, c.name
       limit 20 $q$ using q;
  else
    return query
      select c.slug::text, c.name, c.short_name, null::text, c.state_region, c.environment
        from app.centers c
       where c.environment = 'production' and c.status = 'active'
         and (lower(c.name) like q or lower(coalesce(c.short_name, '')) like q or lower(c.slug::text) like q
              or lower(coalesce(c.state_region, '')) like q)
       order by (lower(c.name) like substr(q, 2)) desc, c.name
       limit 20;
  end if;
end $$;

create or replace function app.community_by_join_code(p_code text)
returns table (slug text, name text, short_name text, state_region text, environment text)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.slug::text, c.name, c.short_name, c.state_region, c.environment
    from app.member_join_codes j join app.centers c on c.id = j.center_id
   where j.code = app.normalize_join_code(p_code) and j.active
     and (j.expires_at is null or j.expires_at > now())
     and c.status in ('active', 'onboarding')
   limit 1
$$;

-- ── Test recipients (sandbox messaging allow-list) ──────────────────────────
create or replace function app.normalize_recipient(p_channel text, p_address text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_channel = 'email' then nullif(lower(btrim(coalesce(p_address, ''))), '')
    -- E.164: "+44 20 …" keeps its country code; a bare 10-digit US number gets +1.
    when p_channel in ('sms', 'whatsapp') then
      (select case when d = '' then null
                   when btrim(coalesce(p_address, '')) like '+%' then '+' || d
                   when length(d) = 10 then '+1' || d
                   else '+' || d end
         from (select regexp_replace(coalesce(p_address, ''), '\D', '', 'g') as d) x)
    else nullif(btrim(coalesce(p_address, '')), '')
  end
$$;

create table if not exists app.sandbox_test_recipients (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  channel     text not null check (channel in ('email','sms','whatsapp','push')),
  address     text not null,
  verified_at timestamptz,
  added_by    uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (center_id, channel, address)
);
comment on table app.sandbox_test_recipients is
  'Who a sandbox may message (up to 10 per center). verified_at is set by the sender service once the address confirms, or by a platform admin.';

create or replace function app.sandbox_test_recipients_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.address := app.normalize_recipient(new.channel, new.address);
  if new.address is null then raise exception 'Enter the % address of the test recipient.', new.channel; end if;
  if new.channel = 'email' and new.address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" is not an email address.', new.address;
  end if;
  if new.channel in ('sms','whatsapp') and new.address !~ '^\+\d{8,15}$' then
    raise exception '"%" is not a mobile number. Use the international form, for example +1 713 555 0100.', new.address;
  end if;
  -- Staff add addresses; only the sender (no signed-in user) or a platform admin marks them verified.
  if auth.uid() is not null and not app.is_platform_admin() then
    new.verified_at := case when tg_op = 'UPDATE' and new.address = old.address and new.channel = old.channel
                            then old.verified_at end;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := coalesce(new.added_by, auth.uid());
    perform pg_advisory_xact_lock(hashtextextended('app.sandbox_test_recipients:' || new.center_id::text, 0));
    if (select count(*) from app.sandbox_test_recipients where center_id = new.center_id) >= 10 then
      raise exception using errcode = 'CCENT',
        message = 'A community can have up to 10 test recipients. Remove one before adding another.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sandbox_test_recipients_guard on app.sandbox_test_recipients;
create trigger sandbox_test_recipients_guard before insert or update on app.sandbox_test_recipients
  for each row execute function app.sandbox_test_recipients_guard();

alter table app.sandbox_test_recipients enable row level security;
drop policy if exists sandbox_test_recipients_staff on app.sandbox_test_recipients;
create policy sandbox_test_recipients_staff on app.sandbox_test_recipients for all to authenticated
  using (app.has_permission(center_id, 'settings.manage')) with check (app.has_permission(center_id, 'settings.manage'));
grant select, insert, update, delete on app.sandbox_test_recipients to authenticated;
grant all on app.sandbox_test_recipients to service_role;
drop trigger if exists audit_sandbox_test_recipients on app.sandbox_test_recipients;
create trigger audit_sandbox_test_recipients after insert or update or delete on app.sandbox_test_recipients
  for each row execute function app.audit_row();

-- For the sender: may this center message this address on this channel?
-- "all" (production) → yes; "test_only" (sandbox) → only a verified test recipient.
create or replace function app.recipient_allowed(p_center uuid, p_channel text, p_address text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case coalesce(app.entitlement(p_center, 'messaging.recipients') #>> '{}', 'all')
    when 'all' then true
    else exists (select 1 from app.sandbox_test_recipients r
                  where r.center_id = p_center and r.channel = p_channel
                    and r.address = app.normalize_recipient(p_channel, p_address) and r.verified_at is not null)
  end
$$;

-- ── Portal web addresses ─────────────────────────────────────────────────────
-- <slug>.<PORTAL_BASE_DOMAIN> needs no row; an organization's own domain
-- (portal.jsh.org) does. Only platform admins add them, so one organization
-- cannot claim another's address.
create table if not exists app.center_domains (
  domain     citext primary key check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  center_id  uuid not null references app.centers(id) on delete cascade,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists center_domains_center_idx on app.center_domains (center_id);
create or replace function app.center_domains_normalize() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  new.domain := lower(btrim(new.domain::text));
  return new;
end $$;
drop trigger if exists center_domains_normalize on app.center_domains;
create trigger center_domains_normalize before insert or update on app.center_domains
  for each row execute function app.center_domains_normalize();
alter table app.center_domains enable row level security;
drop policy if exists center_domains_read on app.center_domains;
create policy center_domains_read on app.center_domains for select to authenticated
  using (app.has_permission(center_id, 'settings.manage'));
drop policy if exists center_domains_platform on app.center_domains;
create policy center_domains_platform on app.center_domains for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
grant select, insert, update, delete on app.center_domains to authenticated;
grant all on app.center_domains to service_role;
drop trigger if exists audit_center_domains on app.center_domains;
create trigger audit_center_domains after insert or update or delete on app.center_domains
  for each row execute function app.audit_row('domain');

create or replace function app.center_slug_for_domain(p_domain text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select c.slug::text from app.center_domains d join app.centers c on c.id = d.center_id
   where d.domain = lower(btrim(p_domain))::citext and c.status in ('active', 'onboarding')
$$;

insert into app.module_tables (table_name, module_key) values
  ('member_join_codes', null), ('sandbox_test_recipients', null), ('center_domains', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Organization switcher ────────────────────────────────────────────────────
-- Centers where the user holds an active role or is a linked member; platform
-- admins see every center that is not exited.
create or replace function app.my_centers()
returns table (id uuid, slug text, name text, short_name text, environment text, status text, portal_domain text,
               has_role boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.id, c.slug::text, c.name, c.short_name, c.environment, c.status,
         (select min(d.domain::text) from app.center_domains d where d.center_id = c.id),
         exists (select 1 from app.role_grants g where g.center_id = c.id and g.user_id = auth.uid()
                   and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
    from app.centers c
   where auth.uid() is not null
     and ((app.is_platform_admin() and c.status <> 'exited')
          or exists (select 1 from app.role_grants g where g.center_id = c.id and g.user_id = auth.uid()
                       and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
          or exists (select 1 from app.center_users cu where cu.center_id = c.id and cu.user_id = auth.uid()))
   order by c.environment = 'sandbox', c.name
$$;

revoke execute on function app.centers_first_join_code(), app.sandbox_test_recipients_guard(), app.center_domains_normalize(),
  app.member_join_codes_normalize() from public, anon, authenticated;
revoke execute on function app.recipient_allowed(uuid, text, text) from public, anon, authenticated;
revoke execute on function app.rotate_member_join_code(uuid, timestamptz, text), app.my_centers() from public, anon;
grant execute on function app.find_community(text), app.community_by_join_code(text), app.normalize_join_code(text),
  app.center_slug_for_domain(text) to anon, authenticated;
grant execute on function app.rotate_member_join_code(uuid, timestamptz, text), app.my_centers(),
  app.normalize_recipient(text, text) to authenticated;
-- The background worker (o-vault, 0170+) sends messages as connect_worker.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'connect_worker') then
    execute 'grant execute on function app.recipient_allowed(uuid, text, text) to connect_worker';
  end if;
end $$;
grant execute on all functions in schema app to service_role;
