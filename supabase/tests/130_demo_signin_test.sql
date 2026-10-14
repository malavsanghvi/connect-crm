-- 0678 + 0679 (B88, part 2): signing in as a demo person ("Try the demo"), and every guardrail around it.
--   A. Off until switched on; who may set it up and switch it   B. The sign-ins are made once   C. Each sign-in is that demo person, in their
--   own demo community only   D. Nothing real can be made a demo sign-in, nor a demo sign-in made real   E. The switch and the public list
--   F. Starting a session (worker only), its audit entry, the stored password   G. The limits   H. Attach, state, leave
--   I. Expiry, the switch and the sweeps end sessions and their refresh   J. A tampered sign-in is repaired   K. A reset takes the links apart
--   and puts them back, and a visitor's changes go   L. Rotating   M. Who may call what   N. The demo administrator cannot unflag or
--   rename the community, nor change the shared sign-in   O. not_after   P. The kill switch reaches every community
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
-- The signed-in person's token claims (p_step_up adds an aal2 session with an authenticator check from a minute ago; since 0787 nothing here needs one).
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false, p_session text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end, 'session_id', p_session,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid default null) returns void language plpgsql as $$
begin
  perform pg_temp.claims(p_user::text, false, p_session::text);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  set local role anon;
end $$;
-- Start a demo session the way the portal does, as the background service. Returns the answer.
create or replace function pg_temp.begin_as_worker(p_persona uuid, p_ip text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_demo_begin(p_persona, p_ip);
  reset role;
  return r;
end $$;
create or replace function pg_temp.attach_as_worker(p_demo uuid, p_auth uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_demo_attach(p_demo, p_auth);
  reset role;
  return r;
end $$;

grant connect_worker to postgres;   -- the tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET
\set admin '''13000000-0000-4000-8000-0000000000a1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set ada '''10000000-0000-4000-8000-000000000011'''
\set sq1 '''13000000-0000-4000-8000-0000000000c1'''
\set sq2 '''13000000-0000-4000-8000-0000000000c2'''
\set sq3 '''13000000-0000-4000-8000-0000000000c3'''
\set sq4 '''13000000-0000-4000-8000-0000000000c4'''

select pg_temp.as_none();
insert into auth.users (id, email) values (:admin, 'admin130@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select slug::text as fslug from app.centers where id = :'fc' \gset
select count(distinct email) as n_people from app.demo_personas \gset
select id as p_admin from app.demo_personas where center_id = :'fc' and role_key = 'center_admin' \gset
select id as p_member from app.demo_personas where center_id = :'fc' and role_key = 'community_member' \gset
select id as p_treasurer from app.demo_personas where center_id = :'fc' and role_key = 'treasurer' \gset
select id as p_taken from app.demo_personas where center_id = :'fc' and role_key = 'teacher' \gset
select email as e_clean from app.demo_personas where center_id = :'fc' and role_key = 'treasurer' \gset
select email as e_taken from app.demo_personas where center_id = :'fc' and role_key = 'teacher' \gset
select id as jsh_person from app.people where center_id = :jsh order by id limit 1 \gset

-- A harmless account on the address of one demo person, a real person (a role in JSH) on the address of another, and a stranger on the
-- demo domain who is not a demo person at all.
select pg_temp.as_none();
insert into auth.users (id, email) values (:sq1, :'e_clean'), (:sq2, :'e_taken'), (:sq3, 'stranger130@demo.weaverams.org'), (:sq4, 'plain130@example.org');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:jsh, :sq2, 'community_member', 'center');
select pg_temp.claims(:admin, true);

-- ══ A. Off until switched on; who may set it up ═════════════════════════════
select pg_temp.assert(not app.demo_signin_enabled(), 'A · demo sign-in is off until a platform admin switches it on');
select pg_temp.assert((select count(*) = 0 from app.demo_auth_users) and (select count(*) = 0 from app.demo_sessions), 'A · no demo sign-in and no session exist yet');
select pg_temp.assert((app.demo_choices() -> 'enabled') = 'false'::jsonb and jsonb_array_length(app.demo_choices() -> 'communities') = 0,
  'A · nobody is offered before it is set up');
select pg_temp.as_user(:ada);
select pg_temp.assert_raises($q$select app.demo_signin_setup('Because')$q$, 'platform admins', 'A · only a platform admin can set up demo sign-in');
select pg_temp.assert_raises($q$select app.set_demo_signin(true, 'Because')$q$, 'platform admins', 'A · or switch it');
select pg_temp.assert_raises($q$select app.demo_signin_status()$q$, 'platform admins', 'A · or look at it');
select pg_temp.as_none();
-- Since 0787 setting up, switching and turning off ask for no fresh 2FA check: this administrator's session has none (aal1) from here on.
select pg_temp.claims(:admin, false);
select pg_temp.assert_raises($q$select app.demo_signin_setup('   ')$q$, 'say why', 'A · and a reason');
select pg_temp.assert_raises($q$select app.set_demo_signin(true, 'Because')$q$, 'set up demo sign-in first', 'A · it cannot be switched on before any demo person has a sign-in');

-- ══ B. The sign-ins are made once ═══════════════════════════════════════════
select app.demo_signin_setup('Set up the demo sign-ins for the test')::text as setup1 \gset
select pg_temp.assert((:'setup1'::jsonb ->> 'created')::int = :n_people - 1 and (:'setup1'::jsonb ->> 'kept')::int = 0
                      and (:'setup1'::jsonb ->> 'linked')::int = 0 and jsonb_array_length(:'setup1'::jsonb -> 'refused') = 1
                      and (:'setup1'::jsonb -> 'refused' -> 0 ->> 'email') = :'e_taken',
  'B · one sign-in per demo person, the address that already belongs to a real person is refused and named');
select pg_temp.assert((select count(*) = :n_people - 1 from app.demo_auth_users) and not exists (select 1 from app.demo_auth_users where email = :'e_taken'),
  'B · so every demo person has a sign-in except that one');
select pg_temp.assert(exists (select 1 from app.demo_auth_users where email = :'e_clean' and user_id = :sq1),
  'B · an address that was nobody''s (never used) is taken over for the demo person');
select pg_temp.assert((select count(*) = :n_people - 1 from app.demo_auth_users a join auth.users u on u.id = a.user_id
                        where u.email = a.email and u.encrypted_password ~ '^\$2a\$10\$' and u.email_confirmed_at is not null and u.banned_until is null
                          and u.raw_app_meta_data ->> 'demo' = 'true'),
  'B · each is a confirmed Auth user on the reserved address with a hashed password, marked as a demo user');
select pg_temp.assert((select count(*) = :n_people - 2 from app.demo_auth_users a join auth.users u on u.id = a.user_id
                        where a.user_id <> :sq1 and u.aud = 'authenticated' and u.role = 'authenticated'
                          and u.confirmation_token = '' and u.recovery_token = '' and u.email_change = '' and u.email_change_token_new = ''),
  'B · the ones made here have every token column filled in (Auth cannot read a row where they are empty)');
select pg_temp.assert((select count(*) = :n_people - 1 from app.demo_auth_users a join auth.identities i on i.user_id = a.user_id and i.provider = 'email'),
  'B · each has its e-mail identity');
select pg_temp.assert((select count(*) = :n_people - 1 and count(distinct s.decrypted_secret) = :n_people - 1
                         from app.demo_auth_users a join vault.decrypted_secrets s on s.id = a.vault_secret_id where s.decrypted_secret ~ '^[0-9a-f]{64}$'),
  'B · each password is its own 64-character random value, kept in the Vault');
select pg_temp.assert((select u.encrypted_password = extensions.crypt(s.decrypted_secret, u.encrypted_password)
                         from app.demo_auth_users a join auth.users u on u.id = a.user_id join vault.decrypted_secrets s on s.id = a.vault_secret_id where a.email = :'e_clean'),
  'B · and it is the password the Auth user has');
select pg_temp.assert(not exists (select 1 from auth.users where email = 'stranger130@demo.weaverams.org' and encrypted_password is not null and encrypted_password <> ''),
  'B · a stranger''s account on the demo domain is not touched');
select app.demo_signin_setup('Run it again')::text as setup2 \gset
select pg_temp.assert((:'setup2'::jsonb ->> 'created')::int = 0 and (:'setup2'::jsonb ->> 'kept')::int = :n_people - 1
                      and jsonb_array_length(:'setup2'::jsonb -> 'refused') = 1 and (select count(*) = :n_people - 1 from app.demo_auth_users),
  'B · running it again changes nothing (they are made once)');

select a.user_id as u_admin from app.demo_auth_users a join app.demo_personas d on d.email = a.email where d.id = :'p_admin' \gset
select a.user_id as u_member from app.demo_auth_users a join app.demo_personas d on d.email = a.email where d.id = :'p_member' \gset
select a.user_id as u_treasurer from app.demo_auth_users a join app.demo_personas d on d.email = a.email where d.id = :'p_treasurer' \gset
select pg_temp.assert(not exists (select 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id)
                      and not exists (select 1 from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id)
                      and not exists (select 1 from app.center_owners o join app.demo_auth_users a on a.user_id = o.user_id),
  'B · while the switch is off the demo sign-ins hold no membership, no role and no ownership anywhere');

-- ══ D. Nothing real becomes a demo sign-in, nor the other way round ═════════
select pg_temp.assert_raises(format('insert into app.center_users (center_id, user_id, person_id) values (%L, %L, %L)', :jsh, :'u_admin', :'jsh_person'),
  'only belong to its demo community', 'D · a demo sign-in cannot join JSH');
select pg_temp.assert_raises(format('insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (%L, %L, %L, %L)', :jsh, :'u_admin', 'center_admin', 'center'),
  'only belong to its demo community', 'D · nor be given a role there');
select pg_temp.assert_raises(format('insert into app.center_owners (center_id, user_id) values (%L, %L) on conflict (center_id) do update set user_id = excluded.user_id', :jsh, :'u_admin'),
  'only belong to its demo community', 'D · nor own it');
select pg_temp.assert_raises(format('insert into app.accounts (user_id, is_platform_admin) values (%L, true) on conflict (user_id) do update set is_platform_admin = true', :'u_admin'),
  'never be a platform admin', 'D · nor be a platform admin');
select pg_temp.assert_raises(format('insert into app.demo_auth_users (email, user_id, vault_secret_id) values (%L, %L, gen_random_uuid())', 'ada130@demo.weaverams.org', :ada),
  'real person', 'D · a real person''s sign-in (Ada, who works in JSH) cannot be registered as a demo one');
select pg_temp.assert_raises(format('insert into app.demo_auth_users (email, user_id, vault_secret_id) values (%L, %L, gen_random_uuid())', 'taken130@demo.weaverams.org', :sq2),
  'real person', 'D · nor can the account of a person who holds a role elsewhere');
select pg_temp.assert_raises(format('insert into app.demo_auth_users (email, user_id, vault_secret_id) values (%L, %L, gen_random_uuid())', 'plain130@example.org', :sq4),
  'check constraint', 'D · only addresses on the demo domain can be demo sign-ins');
select pg_temp.assert_raises(format('insert into app.demo_auth_users (email, user_id, vault_secret_id) values (%L, %L, gen_random_uuid())', 'someone130@demo.weaverams.org', :sq3),
  'own address', 'D · and the sign-in must be on that very address');
select pg_temp.assert(not exists (select 1 from app.demo_auth_users where user_id in (:ada, :sq2, :sq3, :sq4)), 'D · none of them was registered');

-- ══ E. The switch and the public list ═══════════════════════════════════════
select pg_temp.claims(:admin, false);
select pg_temp.assert_raises($q$select app.set_demo_signin(true, '')$q$, 'say why', 'E · and a reason');
select pg_temp.assert_raises($q$select app.set_demo_signin(null, 'Open it')$q$, 'choose on or off', 'E · and a choice');
select pg_temp.assert(not app.demo_signin_enabled(), 'E · still off');
select app.set_demo_signin(true, 'Open the demo for the test')::text as sw1 \gset
select pg_temp.assert(app.demo_signin_enabled() and (:'sw1'::jsonb ->> 'enabled')::boolean, 'E · switched on');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'platform_settings' and record_id = 'demo_signin' and reason = 'Open the demo for the test'),
  'E · the switch and its reason are in the audit log');
-- ══ C. Switched on: each sign-in is that demo person, in their own community only ═
select pg_temp.assert((select count(*) = :n_people - 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id
                        join app.demo_personas d on d.email = a.email and d.person_id = cu.person_id and d.center_id = cu.center_id),
  'C · every demo person with a sign-in is linked to their own person in their own community');
select pg_temp.assert(not exists (select 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id where not app.is_demo_center(cu.center_id))
                      and not exists (select 1 from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id where not app.is_demo_center(g.center_id))
                      and not exists (select 1 from app.center_owners o join app.demo_auth_users a on a.user_id = o.user_id where not app.is_demo_center(o.center_id)),
  'C · and no demo sign-in is a member, role holder or owner of any other community (JSH included)');
select pg_temp.as_user(:'u_admin'::uuid, null);
select count(*) as vis_demo from app.households where center_id = :'fc' \gset
select count(*) as vis_jsh from app.households where center_id = :jsh \gset
select count(*) as vis_other from app.households where center_id = :'nc' \gset
select pg_temp.as_none();
select pg_temp.assert(:vis_demo > 0 and :vis_jsh = 0 and :vis_other = 0,
  'C · signed in as the demo administrator: the faith-based demo''s households are visible, JSH''s and the other demo''s are not');
-- N. The demo administrator (settings.manage) tries to take the community out of the demo, rename it, and loosen its security rule.
select pg_temp.as_user(:'u_admin'::uuid, null);
select pg_temp.assert_raises(format('update app.centers set rules = rules - %L where id = %L', 'demo', :'fc'), 'only be changed by the Community Connect team',
  'N · the demo administrator cannot take the community out of the demo (the flag every guardrail reads)');
select pg_temp.assert_raises(format('update app.centers set rules = rules || jsonb_build_object(%L, %L) where id = %L', 'demo_kind', 'neutral', :'fc'), 'only be changed by the Community Connect team',
  'N · nor change its kind');
select pg_temp.assert_raises(format('update app.centers set rules = rules || jsonb_build_object(%L, %L) where id = %L', 'demo_pack', 'x', :'fc'), 'only be changed by the Community Connect team',
  'N · nor its pack');
select pg_temp.assert_raises(format('update app.centers set name = %L where id = %L', 'Hacked demo', :'fc'), 'only be changed by the Community Connect team',
  'N · nor rename it (the public list shows the name)');
select pg_temp.assert_raises(format('update app.centers set short_name = %L where id = %L', 'Hacked', :'fc'), 'only be changed by the Community Connect team',
  'N · nor its short name');
select pg_temp.assert_raises(format('update app.centers set rules = jsonb_set(rules, %L, %L::jsonb) where id = %L', '{security,require_2fa_for_staff}', 'true', :'fc'),
  'only be changed by the Community Connect team', 'N · nor switch its security rule (which would lock the next visitor out)');
update app.centers set rules = rules || jsonb_build_object('note130', 'x') where id = :'fc';
select pg_temp.as_none();
select pg_temp.assert(app.is_demo_center(:'fc') and (select rules ? 'note130' and name like '%(Demo)' from app.centers where id = :'fc'),
  'N · the flag and the name are still there, and the demo administrator can still change an ordinary setting');
select pg_temp.assert((select count(*) = :n_people - 1 and bool_and(g.status = 'active') from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id
                        join app.demo_personas d on d.email = a.email and d.center_id = g.center_id and d.role_key = g.role_key
                         and d.scope_kind = g.scope_kind and d.scope_id is not distinct from g.scope_id),
  'C · each holds exactly the role and scope of their demo person');
select pg_temp.assert(not exists (select 1 from app.accounts x join app.demo_auth_users a on a.user_id = x.user_id where x.is_platform_admin)
                      and (select count(*) = :n_people - 1 from app.accounts x join app.demo_auth_users a on a.user_id = x.user_id where x.status::text = 'active'),
  'C · every demo sign-in has an account, and none is a platform admin');
select pg_temp.assert_raises(format('update app.accounts set is_platform_admin = true where user_id = %L', :'u_admin'),
  'never be a platform admin', 'C · and an update cannot make one a platform admin either');
select pg_temp.assert_raises(format('update app.role_grants set center_id = %L where user_id = %L', :jsh, :'u_admin'),
  'only belong to its demo community', 'C · nor can its role be moved to JSH');
select pg_temp.assert_raises(format('update app.center_users set center_id = %L where user_id = %L', :jsh, :'u_admin'),
  'only belong to its demo community', 'C · nor its membership');
select pg_temp.assert((select bool_and(coalesce(rules #>> '{security,require_2fa_for_staff}', 'true') = 'false') from app.centers where id in (:'fc', :'nc')),
  'C · a demo community asks no one for an authenticator app (nothing in it is real)');
select pg_temp.assert(not exists (select 1 from app.role_grants g where g.user_id in (:sq2, :sq3) and app.is_demo_center(g.center_id))
                      and not exists (select 1 from app.center_users cu where cu.user_id in (:sq2, :sq3) and app.is_demo_center(cu.center_id))
                      and exists (select 1 from app.role_grants g where g.user_id = :sq2 and g.center_id = :jsh),
  'C · the real person and the stranger are not linked to any demo community by this, and the real person keeps their role in JSH');

select pg_temp.as_anon();
select app.demo_choices()::text as ch \gset
select pg_temp.as_none();
select pg_temp.assert((:'ch'::jsonb ->> 'enabled')::boolean and jsonb_array_length(:'ch'::jsonb -> 'communities') = 2
                      and (select sum(jsonb_array_length(c -> 'people')) = :n_people - 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c),
  'E · anyone can see the two demo communities and the demo people to choose from');
select pg_temp.assert(position('weaverams.org' in :'ch') = 0 and position(:'e_clean' in :'ch') = 0,
  'E · and the list never shows an address');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                    where (select array_agg(k order by k) from jsonb_object_keys(p) k) is distinct from array['id', 'name', 'role', 'story']),
  'E · only an id, the role, the name and the story of each person');
select pg_temp.assert(position(:'p_taken' in :'ch') = 0, 'E · a demo person without a sign-in is not offered');
select pg_temp.claims(:admin, true);
select app.demo_signin_status()::text as stat \gset
select pg_temp.assert((:'stat'::jsonb ->> 'enabled')::boolean and (:'stat'::jsonb ->> 'people_ready')::int = :n_people - 1
                      and (:'stat'::jsonb ->> 'people_total')::int = :n_people and (:'stat'::jsonb ->> 'hours')::int = 2
                      and (:'stat'::jsonb ->> 'reason') = 'Open the demo for the test' and jsonb_array_length(:'stat'::jsonb -> 'communities') = 2,
  'E · the platform panel sees the state: on, who is ready, two hours, the reason');

-- ══ F. Starting a session ═══════════════════════════════════════════════════
select pg_temp.begin_as_worker(:'p_admin', 'hash-one')::text as b1 \gset
select pg_temp.assert((:'b1'::jsonb ->> 'ok')::boolean and (:'b1'::jsonb ->> 'email') = (select email from app.demo_personas where id = :'p_admin')
                      and (:'b1'::jsonb ->> 'email') like '%@demo.weaverams.org' and (:'b1'::jsonb ->> 'password') ~ '^[0-9a-f]{64}$'
                      and (:'b1'::jsonb ->> 'center_slug') = :'fslug',
  'F · a session starts for a demo person, with their sign-in');
select pg_temp.assert((:'b1'::jsonb ->> 'password') = (select s.decrypted_secret from app.demo_auth_users a join vault.decrypted_secrets s on s.id = a.vault_secret_id where a.user_id = :'u_admin'),
  'F · the password is the one in the Vault');
select pg_temp.assert((:'b1'::jsonb ->> 'expires_at')::timestamptz between now() + interval '119 minutes' and now() + interval '121 minutes',
  'F · the session lasts two hours');
select (:'b1'::jsonb ->> 'demo_session_id') as ds1 \gset
select pg_temp.assert((select ip_hash = 'hash-one' and user_id = :'u_admin' and ended_at is null and auth_session_id is null from app.demo_sessions where id = :'ds1'),
  'F · the session records who and a hash of where from, and nothing else about the visitor');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'demo.sign_in' and record_id = :'ds1' and actor_user_id = :'u_admin' and center_id = :'fc'
                                 and after ->> 'ip_hash' = 'hash-one' and after ->> 'persona' = (:'b1'::jsonb ->> 'email') and after ->> 'role' = 'center_admin'),
  'F · the audit log has the sign-in: who (the demo person), their role and the hashed address');
select pg_temp.assert(exists (select 1 from app.secret_access_log where name = 'demo:' || (:'b1'::jsonb ->> 'email') and purpose = 'demo sign-in' and outcome = 'read'),
  'F · and the read of the password is logged');
select pg_temp.assert((select count(*) = 0 from app.audit_log where action = 'demo.sign_in' and client_app is distinct from 'job'),
  'F · sign-ins are the system''s own records (they never make the nightly check think someone changed the community)');
select pg_temp.begin_as_worker(:'p_member', 'hash-two')::text as b2 \gset
select (:'b2'::jsonb ->> 'demo_session_id') as ds2 \gset
select pg_temp.assert_raises(format('select app.worker_demo_begin(%L, %L)', :'p_admin', 'x'), 'background service', 'F · only the background service can start one (not even the database owner)');
select pg_temp.begin_as_worker(gen_random_uuid(), 'hash-x')::text as bx \gset
select pg_temp.assert((:'bx'::jsonb ->> 'code') = 'unknown_persona' and not (:'bx'::jsonb ->> 'ok')::boolean, 'F · a person who is not a demo person is refused');
select pg_temp.begin_as_worker(:'p_taken', 'hash-x')::text as bt \gset
select pg_temp.assert((:'bt'::jsonb ->> 'code') = 'not_ready' and not (:'bt'::jsonb ->> 'ok')::boolean, 'F · a demo person without a sign-in is refused');
update app.centers set rules = rules - 'demo' where id = :'fc';
select pg_temp.begin_as_worker(:'p_member', 'hash-x')::text as bf \gset
update app.centers set rules = rules || jsonb_build_object('demo', true) where id = :'fc';
select pg_temp.assert((:'bf'::jsonb ->> 'code') = 'unknown_persona', 'F · a community that is no longer flagged as a demo is refused');
select pg_temp.assert((select count(*) = 2 from app.demo_sessions), 'F · and the refusals left no session behind');

-- ══ H (part 1). Attach ══════════════════════════════════════════════════════
select gen_random_uuid()::text as sid1 \gset
select gen_random_uuid()::text as sid2 \gset
select gen_random_uuid()::text as sid_ada \gset
insert into auth.sessions (id, user_id) values (:'sid1', :'u_admin'), (:'sid2', :'u_member'), (:'sid_ada', :ada);
select pg_temp.attach_as_worker(:'ds2', :'sid_ada')::text as at_bad \gset
select pg_temp.assert((:'at_bad'::jsonb ->> 'code') = 'mismatch', 'H · a session that is not the demo person''s own is not attached');
select pg_temp.attach_as_worker(:'ds1', :'sid1')::text as at1 \gset
select pg_temp.attach_as_worker(:'ds2', :'sid2')::text as at2 \gset
select pg_temp.assert((:'at1'::jsonb ->> 'ok')::boolean and (:'at2'::jsonb ->> 'ok')::boolean
                      and (select auth_session_id = :'sid1' from app.demo_sessions where id = :'ds1'), 'H · the person''s own sessions are attached');
select pg_temp.assert((select s.not_after = d.expires_at from auth.sessions s join app.demo_sessions d on d.auth_session_id = s.id where d.id = :'ds1'),
  'O · the Auth session gets the demo session''s end as its own not_after, so Auth refuses to refresh it after the two hours');
select pg_temp.attach_as_worker(:'ds1', :'sid2')::text as at_again \gset
select pg_temp.assert((:'at_again'::jsonb ->> 'code') = 'unknown' and (select auth_session_id = :'sid1' from app.demo_sessions where id = :'ds1'),
  'H · and only once');

-- ══ G. The limits ═══════════════════════════════════════════════════════════
-- (The sessions so far moved back half an hour: still in the hour, no longer in the last five minutes.)
update app.demo_sessions set started_at = started_at - interval '30 minutes';
insert into app.demo_sessions (persona_email, user_id, role_key, ip_hash, started_at, expires_at, ended_at, ended_reason)
select (select email from app.demo_personas where id = :'p_member'), :'u_member', 'community_member', 'ip-full', now() - interval '20 minutes', now() + interval '1 hour', now(), 'left'
  from generate_series(1, 24);
select pg_temp.begin_as_worker(:'p_member', 'ip-full')::text as l1 \gset
select pg_temp.assert((:'l1'::jsonb ->> 'code') = 'ip_limit', 'G · one visitor address can start only so many sessions an hour (24)');
select pg_temp.begin_as_worker(:'p_member', 'ip-fresh')::text as l2 \gset
select pg_temp.assert((:'l2'::jsonb ->> 'ok')::boolean, 'G · another address is not affected');
insert into app.demo_sessions (persona_email, user_id, role_key, ip_hash, started_at, expires_at, ended_at, ended_reason)
select (select email from app.demo_personas where id = :'p_member'), :'u_member', 'community_member', 'ip-g' || g, now() - interval '1 minute', now() + interval '1 hour', now(), 'left'
  from generate_series(1, 20) g;
select pg_temp.begin_as_worker(:'p_member', 'ip-new')::text as l3 \gset
select pg_temp.assert((:'l3'::jsonb ->> 'code') = 'busy', 'G · the whole platform starts only so many in five minutes (20)');
delete from app.demo_sessions where ip_hash like 'ip-g%';
update app.demo_sessions set started_at = started_at - interval '30 minutes' where ip_hash = 'ip-fresh';
insert into app.demo_sessions (persona_email, user_id, role_key, ip_hash, started_at, expires_at, ended_at, ended_reason)
select (select email from app.demo_personas where id = :'p_member'), :'u_member', 'community_member', 'ip-h' || g, now() - interval '30 minutes', now() + interval '1 hour', now(), 'left'
  from generate_series(1, 300) g;
select pg_temp.begin_as_worker(:'p_member', 'ip-new')::text as l4 \gset
select pg_temp.assert((:'l4'::jsonb ->> 'code') = 'busy', 'G · and so many in an hour (300)');
delete from app.demo_sessions where ip_hash like 'ip-h%' or ip_hash = 'ip-full';
select pg_temp.begin_as_worker(:'p_member', 'ip-new')::text as l5 \gset
select pg_temp.assert((:'l5'::jsonb ->> 'ok')::boolean, 'G · and starting works again once the numbers fall');
select (:'l5'::jsonb ->> 'demo_session_id') as ds5 \gset
update app.demo_sessions set ended_at = now(), ended_reason = 'left' where id in (:'ds5', (select id from app.demo_sessions where ip_hash = 'ip-fresh'));

-- ══ H (part 2). State, leave ════════════════════════════════════════════════
select pg_temp.as_user(:'u_admin'::uuid, :'sid1'::uuid);
select app.demo_session_state()::text as st1 \gset
select pg_temp.as_none();
select pg_temp.assert((:'st1'::jsonb ->> 'state') = 'ok' and (:'st1'::jsonb ->> 'name') = (select display_name from app.demo_personas where id = :'p_admin')
                      and (:'st1'::jsonb ->> 'role') = (select headline from app.demo_personas where id = :'p_admin')
                      and (:'st1'::jsonb ->> 'seconds_left')::int between 7000 and 7200 and (:'st1'::jsonb ->> 'center_slug') = :'fslug',
  'H · the demo person''s own session is ok, with their role and how long is left (for the banner)');
select pg_temp.as_user(:ada, gen_random_uuid());
select app.demo_session_state()::text as st_ada \gset
select pg_temp.as_user(:sq3, gen_random_uuid());
select app.demo_session_state()::text as st_sq3 \gset
select pg_temp.as_user(:'u_member'::uuid, gen_random_uuid());
select app.demo_session_state()::text as st_unk \gset
select pg_temp.as_user(:'u_member'::uuid, null);
select app.demo_session_state()::text as st_nosid \gset
select pg_temp.as_none();
select pg_temp.assert((:'st_ada'::jsonb ->> 'state') = 'not_demo' and (:'st_sq3'::jsonb ->> 'state') = 'not_demo',
  'H · a real person, and a stranger on the demo domain, are not demo people (the portal lets a demo address through only when it answers ok)');
select pg_temp.assert((:'st_unk'::jsonb ->> 'state') = 'unknown' and (:'st_nosid'::jsonb ->> 'state') = 'unknown',
  'H · a demo person whose session the database does not know is not ok');
select pg_temp.as_user(:'u_member'::uuid, :'sid2'::uuid);
select app.demo_leave();
select pg_temp.as_none();
select pg_temp.assert((select ended_reason = 'left' from app.demo_sessions where id = :'ds2') and not exists (select 1 from auth.sessions where id = :'sid2'),
  'H · leaving ends the session and its Auth session (it cannot be refreshed)');
select pg_temp.as_user(:'u_member'::uuid, :'sid2'::uuid);
select app.demo_session_state()::text as st2 \gset
select pg_temp.as_none();
select pg_temp.assert((:'st2'::jsonb ->> 'state') = 'unknown', 'H · and it is not ok afterwards');

-- ══ I. Expiry, the switch and the sweeps ════════════════════════════════════
update app.demo_sessions set expires_at = now() - interval '1 minute' where id = :'ds1';
select pg_temp.as_user(:'u_admin'::uuid, :'sid1'::uuid);
select app.demo_session_state()::text as st3 \gset
select pg_temp.as_none();
select pg_temp.assert((:'st3'::jsonb ->> 'state') = 'expired' and (select ended_reason = 'expired' from app.demo_sessions where id = :'ds1')
                      and not exists (select 1 from auth.sessions where id = :'sid1'),
  'I · after two hours the next request is told so, the session ends and its Auth session is deleted (no refresh)');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'demo.sign_out' and record_id = :'ds1' and after ->> 'ended' = 'expired' and actor_user_id = :'u_admin'),
  'I · and the audit log has the end');
select pg_temp.begin_as_worker(:'p_treasurer', 'hash-three')::text as b3 \gset
select (:'b3'::jsonb ->> 'demo_session_id') as ds3 \gset
select gen_random_uuid()::text as sid3 \gset
insert into auth.sessions (id, user_id) values (:'sid3', :'u_treasurer');
select pg_temp.attach_as_worker(:'ds3', :'sid3')::text as at3 \gset
select pg_temp.assert((:'at3'::jsonb ->> 'ok')::boolean, 'I · a fresh session for the switch test');
select pg_temp.claims(:admin, false);
-- P. Even if a community had lost its flag, the switch takes the demo people's membership, role and ownership away everywhere.
update app.centers set rules = rules - 'demo' where id = :'fc';
select app.set_demo_signin(false, 'Stop the demo for the test')::text as sw2 \gset
update app.centers set rules = rules || jsonb_build_object('demo', true) where id = :'fc';
select pg_temp.assert(not app.demo_signin_enabled() and (:'sw2'::jsonb ->> 'ended')::int >= 1, 'I · switched off, and it says how many sessions it ended');
select pg_temp.assert((select ended_reason = 'switched_off' from app.demo_sessions where id = :'ds3') and not exists (select 1 from auth.sessions where id = :'sid3')
                      and not exists (select 1 from auth.sessions s join app.demo_auth_users a on a.user_id = s.user_id)
                      and not exists (select 1 from app.demo_sessions where ended_at is null),
  'I · every running demo session ended at once, and none of their Auth sessions is left to refresh');
select pg_temp.assert(not exists (select 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id)
                      and not exists (select 1 from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id)
                      and not exists (select 1 from app.center_owners o join app.demo_auth_users a on a.user_id = o.user_id),
  'I · and the demo people lose their membership, role and ownership at once');
select pg_temp.as_user(:'u_admin'::uuid, null);
select count(*) as vis_off from app.households where center_id = :'fc' \gset
select pg_temp.as_none();
select pg_temp.assert(:vis_off = 0, 'I · so a token kept outside the portal sees nothing of the demo community either');
select pg_temp.begin_as_worker(:'p_admin', 'hash-four')::text as b_off \gset
select pg_temp.assert((:'b_off'::jsonb ->> 'code') = 'off' and not (:'b_off'::jsonb ->> 'ok')::boolean and not (:'b_off'::jsonb ? 'password'), 'I · nobody can start one while it is off, and no password is given');
select pg_temp.as_anon();
select app.demo_choices()::text as ch_off \gset
select pg_temp.as_none();
select pg_temp.assert(not (:'ch_off'::jsonb ->> 'enabled')::boolean, 'I · the public list says it is off');
select pg_temp.claims(:admin, true);
select app.set_demo_signin(true, 'Back on for the test')::text as sw3 \gset
select pg_temp.assert((select count(*) = :n_people - 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id)
                      and (select count(*) = :n_people - 1 from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id),
  'I · and turning it on again gives them back');
-- A switch turned off behind the system''s back (the setting only) still ends a running session on its next request.
select pg_temp.begin_as_worker(:'p_admin', 'hash-five')::text as b4 \gset
select (:'b4'::jsonb ->> 'demo_session_id') as ds4 \gset
select gen_random_uuid()::text as sid4 \gset
insert into auth.sessions (id, user_id) values (:'sid4', :'u_admin');
select pg_temp.attach_as_worker(:'ds4', :'sid4')::text as at4 \gset
update app.platform_settings set value = jsonb_build_object('enabled', false, 'reason', 'x') where key = 'demo_signin';
select pg_temp.as_user(:'u_admin'::uuid, :'sid4'::uuid);
select app.demo_session_state()::text as st4 \gset
select pg_temp.as_none();
select pg_temp.assert((:'st4'::jsonb ->> 'state') = 'off' and (select ended_reason = 'switched_off' from app.demo_sessions where id = :'ds4') and not exists (select 1 from auth.sessions where id = :'sid4'),
  'I · a running session finds out on its next request that the switch is off, and ends');
select pg_temp.claims(:admin, true);
select app.set_demo_signin(true, 'Back on again')::text as sw4 \gset
-- Sweeps: a start the portal never finished, a session nobody asked about, an Auth session the database does not know.
select pg_temp.begin_as_worker(:'p_member', 'hash-six')::text as b6 \gset
select (:'b6'::jsonb ->> 'demo_session_id') as ds6 \gset
update app.demo_sessions set started_at = now() - interval '10 minutes' where id = :'ds6';
select pg_temp.begin_as_worker(:'p_treasurer', 'hash-seven')::text as b7 \gset
select (:'b7'::jsonb ->> 'demo_session_id') as ds7 \gset
select gen_random_uuid()::text as sid7 \gset
select gen_random_uuid()::text as sid_orphan \gset
insert into auth.sessions (id, user_id) values (:'sid7', :'u_treasurer');
insert into auth.sessions (id, user_id, created_at) values (:'sid_orphan', :'u_treasurer', now() - interval '10 minutes');
select pg_temp.attach_as_worker(:'ds7', :'sid7')::text as at7 \gset
update app.demo_sessions set expires_at = now() - interval '1 minute' where id = :'ds7';
set local role connect_worker;
select app.worker_demo_reset_due()::text as due1 \gset
reset role;
select pg_temp.assert((select ended_reason = 'failed' from app.demo_sessions where id = :'ds6') and (select ended_reason = 'expired' from app.demo_sessions where id = :'ds7')
                      and not exists (select 1 from auth.sessions where id in (:'sid7', :'sid_orphan')),
  'I · the hourly job ends what ran out, what never finished and any Auth session of a demo person the database does not know');
select pg_temp.assert((:'due1'::jsonb ->> 'checked')::int = 2 and (:'due1'::jsonb ->> 'failed')::int = 0, 'I · and the community check it runs is unchanged');

-- ══ J. A tampered sign-in is repaired ═══════════════════════════════════════
-- (A change made outside the guard, as a manual edit in the database would be: the guard's own switch is raised for it.)
select set_config('app.demo_auth_ok', 'on', true);
update auth.users set encrypted_password = extensions.crypt('guess', extensions.gen_salt('bf')), banned_until = now() + interval '1 day',
                      phone = '+15550100', email_confirmed_at = null, email_change = 'visitor@example.org', phone_change = '+15550111' where id = :'u_admin';
select set_config('app.demo_auth_ok', 'off', true);
insert into auth.mfa_factors (id, user_id, factor_type, status) values (gen_random_uuid(), :'u_admin', 'totp', 'verified');
select pg_temp.begin_as_worker(:'p_admin', 'hash-eight')::text as b8 \gset
select pg_temp.assert((:'b8'::jsonb ->> 'ok')::boolean
                      and (select u.encrypted_password = extensions.crypt(:'b8'::jsonb ->> 'password', u.encrypted_password) and u.banned_until is null and u.phone is null
                                  and u.email_confirmed_at is not null and u.email = :'b8'::jsonb ->> 'email' from auth.users u where u.id = :'u_admin')
                      and not exists (select 1 from auth.mfa_factors where user_id = :'u_admin'),
  'J · a password, address, phone, ban or authenticator app changed from a browser is put back at the next start');
select pg_temp.assert((select coalesce(email_change, '') = '' and coalesce(phone_change, '') = '' from auth.users where id = :'u_admin'),
  'J · and so is a change waiting to be confirmed at an address of the visitor''s own');

-- ══ J2. What a visitor can do to the shared sign-in from their own browser (Auth's own calls) ═══
select pg_temp.assert_raises(format('update auth.users set encrypted_password = extensions.crypt(%L, extensions.gen_salt(%L, 10)) where id = %L', 'mine', 'bf', :'u_admin'),
  'cannot be changed', 'J2 · a visitor cannot set their own password on the shared sign-in');
select pg_temp.assert_raises(format('update auth.users set email = %L where id = %L', 'visitor@example.org', :'u_admin'),
  'cannot be changed', 'J2 · nor its address');
select pg_temp.assert_raises(format('update auth.users set phone = %L where id = %L', '+15550123', :'u_admin'),
  'cannot be changed', 'J2 · nor its phone');
select pg_temp.assert_raises(format('update auth.users set email_change = %L, email_change_token_new = %L where id = %L', 'visitor@example.org', 'abc', :'u_admin'),
  'cannot be changed', 'J2 · nor ask for a change to be confirmed at an address of their own');
select pg_temp.assert_raises(format('update auth.users set phone_change = %L where id = %L', '+15550123', :'u_admin'),
  'cannot be changed', 'J2 · nor at a phone of their own');
select pg_temp.assert_raises(format('update auth.users set raw_app_meta_data = raw_app_meta_data - %L where id = %L', 'demo', :'u_admin'),
  'cannot be changed', 'J2 · nor take the demo mark off it');
select pg_temp.assert_raises(format('update auth.users set encrypted_password = %L where id = %L', 'not-a-hash', :'u_admin'),
  'cannot be changed', 'J2 · nor put something that is not a hash');
update auth.users set last_sign_in_at = now(), updated_at = now() where id = :'u_admin';
select s.decrypted_secret as pw_admin from app.demo_auth_users a join vault.decrypted_secrets s on s.id = a.vault_secret_id where a.user_id = :'u_admin' \gset
update auth.users set encrypted_password = extensions.crypt(:'pw_admin', extensions.gen_salt('bf', 12)) where id = :'u_admin';
select pg_temp.assert((select u.encrypted_password = extensions.crypt(:'pw_admin', u.encrypted_password) and u.last_sign_in_at is not null from auth.users u where u.id = :'u_admin'),
  'J2 · Auth itself can still note a sign-in and re-hash the very same password');
update auth.users set phone = '+15550124' where id = :ada;
update auth.users set email = 'ada130-new@example.org' where id = :sq3;
select pg_temp.assert((select phone = '+15550124' from auth.users where id = :ada) and (select email = 'ada130-new@example.org' from auth.users where id = :sq3),
  'J2 · and nobody else''s sign-in is touched by the guard');

-- ══ K. A reset takes the links apart and puts them back ═════════════════════
select pg_temp.begin_as_worker(:'p_member', 'hash-nine')::text as b9 \gset
select (:'b9'::jsonb ->> 'demo_session_id') as ds9 \gset
select gen_random_uuid()::text as sid9 \gset
insert into auth.sessions (id, user_id) values (:'sid9', :'u_member');
select pg_temp.attach_as_worker(:'ds9', :'sid9')::text as at9 \gset
select person_id as m_person from app.demo_personas where id = :'p_member' \gset
select first_name as m_first from app.people where id = :'m_person' \gset
select count(*) as cu_before from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id where cu.center_id = :'fc' \gset
select set_config('app.client_app', 'portal', true);
update app.people set first_name = 'Edited by a visitor' where id = :'m_person';
update app.households set display_name = 'Visitor edit' where id = (select id from app.households where center_id = :'fc' order by id limit 1);
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'fc')::text as reset1 \gset
select pg_temp.assert(not exists (select 1 from app.households where center_id = :'fc' and display_name = 'Visitor edit') and (select first_name = :'m_first' from app.people where id = :'m_person'),
  'K · what a visitor changed (even on their own demo person) is gone after a reset');
select pg_temp.assert((select count(*) = :'cu_before' from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id where cu.center_id = :'fc')
                      and (select count(*) = :n_people - 1 from app.center_users cu join app.demo_auth_users a on a.user_id = cu.user_id join app.demo_personas d on d.email = a.email and d.person_id = cu.person_id and d.center_id = cu.center_id),
  'K · every demo sign-in is linked to its demo person again');
select pg_temp.assert((select md5(string_agg(g.user_id::text || g.role_key || coalesce(g.scope_id::text, ''), ',' order by g.role_key, g.user_id))
                         from app.role_grants g join app.demo_auth_users a on a.user_id = g.user_id where g.center_id = :'fc')
                      = (select md5(string_agg(a.user_id::text || d.role_key || coalesce(d.scope_id::text, ''), ',' order by d.role_key, a.user_id))
                           from app.demo_personas d join app.demo_auth_users a on a.email = d.email where d.center_id = :'fc'),
  'K · with the same roles and scopes, once each');
select pg_temp.assert(exists (select 1 from app.demo_sessions where id = :'ds9' and ended_at is null) and exists (select 1 from auth.sessions where id = :'sid9'),
  'K · a running session is not ended by a reset');
select pg_temp.as_user(:'u_member'::uuid, :'sid9'::uuid);
select app.demo_session_state()::text as st9 \gset
select pg_temp.as_none();
select pg_temp.assert((:'st9'::jsonb ->> 'state') = 'ok', 'K · and it is still ok afterwards');
select pg_temp.assert((select bool_and(coalesce(rules #>> '{security,require_2fa_for_staff}', 'true') = 'false') from app.centers where id in (:'fc', :'nc'))
                      and not exists (select 1 from app.accounts x join app.demo_auth_users a on a.user_id = x.user_id where x.is_platform_admin),
  'K · still no authenticator app asked, still no platform admin');

-- ══ L. Rotating ═════════════════════════════════════════════════════════════
select s.decrypted_secret as pw_old from app.demo_auth_users a join vault.decrypted_secrets s on s.id = a.vault_secret_id where a.user_id = :'u_member' \gset
select pg_temp.claims(:admin, true);
select app.demo_signin_setup('Rotate the passwords for the test', true)::text as rot \gset
select pg_temp.assert((:'rot'::jsonb ->> 'rotated')::int = :n_people - 1 and (:'rot'::jsonb ->> 'created')::int = 0, 'L · rotating replaces every password');
select pg_temp.assert((select s.decrypted_secret <> :'pw_old' and u.encrypted_password = extensions.crypt(s.decrypted_secret, u.encrypted_password)
                         from app.demo_auth_users a join vault.decrypted_secrets s on s.id = a.vault_secret_id join auth.users u on u.id = a.user_id where a.user_id = :'u_member'),
  'L · the new password is in the Vault and in Auth, and differs');
select pg_temp.assert((select ended_reason = 'reset' from app.demo_sessions where id = :'ds9') and not exists (select 1 from auth.sessions s join app.demo_auth_users a on a.user_id = s.user_id),
  'L · every running session ends');
select pg_temp.begin_as_worker(:'p_member', 'hash-ten')::text as b10 \gset
select pg_temp.assert((:'b10'::jsonb ->> 'ok')::boolean and (:'b10'::jsonb ->> 'password') <> :'pw_old', 'L · and a new session uses the new password');

-- ══ M. Who may call what ════════════════════════════════════════════════════
select pg_temp.as_user(:ada);
select pg_temp.assert_raises($q$select * from app.demo_auth_users$q$, 'permission denied', 'M · nobody reads the sign-ins through the API');
select pg_temp.assert_raises($q$select * from app.demo_sessions$q$, 'permission denied', 'M · nor the sessions');
select pg_temp.assert_raises(format('select app.worker_demo_begin(%L, %L)', :'p_admin', 'x'), 'permission denied', 'M · a signed-in person cannot start a demo session');
select pg_temp.assert_raises(format('select app.worker_demo_attach(%L, %L)', gen_random_uuid(), gen_random_uuid()), 'permission denied', 'M · or attach one');
select pg_temp.assert_raises($q$select app.demo_end(gen_random_uuid(), 'left')$q$, 'permission denied', 'M · or end one by id');
select pg_temp.assert_raises($q$select app.demo_signin_sweep()$q$, 'permission denied', 'M · or sweep');
select pg_temp.assert_raises($q$select app.demo_assert_auth_user(gen_random_uuid(), 'x@demo.weaverams.org', 'x')$q$, 'permission denied', 'M · or touch a sign-in');
select pg_temp.as_anon();
select pg_temp.assert_raises(format('select app.worker_demo_begin(%L, %L)', :'p_admin', 'x'), 'permission denied', 'M · nor can the public');
select pg_temp.assert_raises($q$select app.demo_session_state()$q$, 'permission denied', 'M · or check a session');
select pg_temp.assert_raises($q$select app.demo_signin_status()$q$, 'permission denied', 'M · or see the platform panel');
select pg_temp.assert((select jsonb_typeof(app.demo_choices()) = 'object'), 'M · the public can see the list of demo people');
select pg_temp.as_none();
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_demo_begin(uuid, text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_demo_attach(uuid, uuid)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_demo_begin(uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_demo_begin(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_demo_begin(uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.demo_session_state()', 'execute')
                      and has_function_privilege('authenticated', 'app.demo_signin_setup(text, boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.demo_signin_setup(text, boolean)', 'execute'),
  'M · the password can be read by the background service connection only');

select pg_temp.assert((select count(*) from app.demo_sessions where ended_at is null) <= 1, 'the test leaves no running sessions behind');
rollback;
