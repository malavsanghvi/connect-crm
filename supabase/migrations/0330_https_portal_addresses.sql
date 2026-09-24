-- 0330 (stream o-https): which web addresses the portal may get an HTTPS
-- certificate for, decided in one place.
--
-- Caddy asks the portal (/api/tenancy/tls-ask) before it requests an on-demand
-- certificate; the portal asks app.tls_host_allowed. Allowed:
--   * the platform portal domain saved in Platform setup
--     (app.platform_settings key 'portal_domain', stream o-platform-setup), and www.<it>;
--   * the wildcard base for organizations' addresses (platform setting
--     'wildcard_domain', else the server's PORTAL_BASE_DOMAIN passed by the portal),
--     www.<base>, and <slug>.<base> of a real community;
--   * an organization's own domain registered in app.center_domains (0161).
-- Never an IP address: the droplet's own address has an explicitly configured
-- certificate, and no one may make the server request certificates for others.
--
-- app.platform_settings belongs to o-platform-setup (0320–0329). This file does
-- not create it; every read is guarded with to_regclass so the portal keeps
-- working (with the environment's base domain only) before that table exists.

-- Host name as a certificate subject: lower case, no scheme/port/path/trailing dot.
create or replace function app.normalize_host(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
           when v ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
            and v !~ '^[0-9.]+$' and length(v) <= 253
           then v end
    from (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))),
                   '^https?://', ''), '/.*$', ''), ':[0-9]+$', ''), '\.$', '') as v) s
$$;

-- A text value from app.platform_settings (o-platform-setup), or null when the
-- table or key does not exist. The value is jsonb: a string, or an object with
-- "domain" / "host" / "value". Internal: not granted to any client role.
create or replace function app.platform_setting_text(p_key text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v jsonb;
begin
  if to_regclass('app.platform_settings') is null then
    return null;
  end if;
  execute 'select value from app.platform_settings where key = $1' into v using p_key;
  if v is null then
    return null;
  elsif jsonb_typeof(v) = 'string' then
    return v #>> '{}';
  elsif jsonb_typeof(v) = 'object' then
    return coalesce(v ->> 'domain', v ->> 'host', v ->> 'value');
  end if;
  return null;
end $$;
revoke all on function app.platform_setting_text(text) from public;

-- The platform's own public addresses (not secrets: they are the addresses
-- people type). Used by the portal for links and by the HTTPS confirmer.
create or replace function app.platform_public_addresses() returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'portal_domain',   app.normalize_host(app.platform_setting_text('portal_domain')),
    'wildcard_domain', app.normalize_host(coalesce(app.platform_setting_text('wildcard_domain'),
                                                   app.platform_setting_text('portal_base_domain'))))
$$;
revoke all on function app.platform_public_addresses() from public;
grant execute on function app.platform_public_addresses() to anon, authenticated;

-- Why a certificate may be issued for p_host ('portal_domain', 'wildcard_base',
-- 'center_subdomain', 'center_domain'), or null when it may not.
-- p_env_base: the portal server's PORTAL_BASE_DOMAIN (SITE_WILDCARD_DOMAIN).
create or replace function app.tls_host_allowed(p_host text, p_env_base text default null) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  h      text := app.normalize_host(p_host);
  portal text := app.normalize_host(app.platform_setting_text('portal_domain'));
  base   text;
  label  text;
begin
  if h is null then
    return null;
  end if;
  if portal is not null and (h = portal or h = 'www.' || portal) then
    return 'portal_domain';
  end if;
  foreach base in array array[
      app.normalize_host(coalesce(app.platform_setting_text('wildcard_domain'), app.platform_setting_text('portal_base_domain'))),
      app.normalize_host(p_env_base)] loop
    continue when base is null;
    if h = base or h = 'www.' || base then
      return 'wildcard_base';
    end if;
    if right(h, length(base) + 1) = '.' || base then
      label := left(h, length(h) - length(base) - 1);
      if label ~ '^[a-z0-9][a-z0-9-]{0,62}$'
         and exists (select 1 from app.centers c where c.slug::text = label and c.status in ('active', 'onboarding')) then
        return 'center_subdomain';
      end if;
    end if;
  end loop;
  if exists (select 1 from app.center_domains d join app.centers c on c.id = d.center_id
              where d.domain = h::citext and c.status in ('active', 'onboarding')) then
    return 'center_domain';
  end if;
  return null;
end $$;
revoke all on function app.tls_host_allowed(text, text) from public;
grant execute on function app.tls_host_allowed(text, text) to anon, authenticated;
-- The background service builds links in messages from the portal's address.
grant execute on function app.platform_public_addresses() to connect_worker;
