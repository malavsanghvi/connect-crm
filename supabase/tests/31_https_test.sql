-- 0330 (stream o-https): which names the portal may get an HTTPS certificate for
-- (Caddy on-demand TLS asks /api/tenancy/tls-ask, which asks app.tls_host_allowed).
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

insert into app.centers (id, slug, name, short_name, state_region, status) values
  ('31000000-0000-4000-8000-0000000000c1', 'jcox', 'Jain Center of Oxford', 'JCOX', 'TX', 'active'),
  ('31000000-0000-4000-8000-0000000000c2', 'jgone', 'Jain Group (left)', 'JGONE', 'TX', 'exited');
insert into app.center_domains (domain, center_id) values
  ('Portal.JCOX.org', '31000000-0000-4000-8000-0000000000c1'),
  ('portal.jgone.org', '31000000-0000-4000-8000-0000000000c2');

-- ── Before Platform setup has saved anything (app.platform_settings may not even exist) ──
select pg_temp.assert(app.normalize_host('HTTPS://Portal.Example.org:443/login') = 'portal.example.org', 'host names are normalized');
select pg_temp.assert(app.normalize_host('134.122.25.56') is null and app.normalize_host('a b.org') is null
                      and app.normalize_host('localhost') is null, 'IPs, junk and single labels are not certificate names');
select pg_temp.assert(app.tls_host_allowed('portal.jcox.org') = 'center_domain', 'an organization''s registered own domain is allowed');
select pg_temp.assert(app.tls_host_allowed('portal.jgone.org') is null, 'not for an organization that has left');
select pg_temp.assert(app.tls_host_allowed('jcox.cc.test', 'cc.test') = 'center_subdomain', '<slug>.<PORTAL_BASE_DOMAIN> of a real community');
select pg_temp.assert(app.tls_host_allowed('nobody.cc.test', 'cc.test') is null, 'not for an unknown slug');
select pg_temp.assert(app.tls_host_allowed('a.jcox.cc.test', 'cc.test') is null, 'not for deeper names');
select pg_temp.assert(app.tls_host_allowed('jgone.cc.test', 'cc.test') is null, 'not for an exited community''s subdomain');
select pg_temp.assert(app.tls_host_allowed('cc.test', 'cc.test') = 'wildcard_base'
                      and app.tls_host_allowed('www.cc.test', 'https://CC.test/') = 'wildcard_base', 'the base domain itself');
select pg_temp.assert(app.tls_host_allowed('134.122.25.56', 'cc.test') is null, 'never an IP address on demand');
select pg_temp.assert(app.tls_host_allowed('evil.example.com', 'cc.test') is null
                      and app.tls_host_allowed(null) is null and app.tls_host_allowed('') is null, 'anything else is refused');

-- ── After Platform setup saved the portal domain and the organizations' base ──
-- (o-platform-setup owns app.platform_settings; created here only if this branch runs alone.)
select to_regclass('app.platform_settings') is null as https_test_made_settings \gset
create table if not exists app.platform_settings (key text primary key, value jsonb, set_by uuid, set_at timestamptz default now());
insert into app.platform_settings (key, value) values ('portal_domain', '"Crm.CommunityConnect.test"'), ('wildcard_domain', '{"domain": "orgs.test"}')
  on conflict (key) do update set value = excluded.value;
select pg_temp.assert(app.tls_host_allowed('crm.communityconnect.test') = 'portal_domain', 'the portal domain saved in Platform setup');
select pg_temp.assert(app.tls_host_allowed('www.crm.communityconnect.test') = 'portal_domain', 'and www.<portal domain>');
select pg_temp.assert(app.tls_host_allowed('jcox.orgs.test') = 'center_subdomain', 'the wildcard base saved in Platform setup, with no server variable');
select pg_temp.assert(app.tls_host_allowed('jcox.cc.test', 'cc.test') = 'center_subdomain', 'the server''s PORTAL_BASE_DOMAIN keeps working too');
select pg_temp.assert(app.tls_host_allowed('other.communityconnect.test') is null, 'not for a sibling of the portal domain');
select pg_temp.assert(app.platform_public_addresses() = '{"portal_domain": "crm.communityconnect.test", "wildcard_domain": "orgs.test"}'::jsonb,
  'the platform''s public addresses');

-- ── Who may ask ──
begin;
set local role anon;
select pg_temp.assert(app.tls_host_allowed('crm.communityconnect.test') = 'portal_domain', 'the portal asks with the public (anon) key');
select pg_temp.assert((app.platform_public_addresses() ->> 'portal_domain') = 'crm.communityconnect.test', 'anon reads the public addresses');
rollback;
select pg_temp.assert(not has_function_privilege('anon', 'app.platform_setting_text(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.platform_setting_text(text)', 'execute'),
  'raw platform settings are not readable by clients');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.platform_public_addresses()', 'execute'),
  'the background service reads the public addresses');

-- Leave the shared test database as it was for later files.
delete from app.platform_settings where key in ('portal_domain', 'wildcard_domain');
\if :https_test_made_settings
drop table app.platform_settings;
\endif
