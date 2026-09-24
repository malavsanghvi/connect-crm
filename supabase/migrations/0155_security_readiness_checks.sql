-- 0155 (stream o-security) · go-live readiness checks owned by o-security.
--
-- ONBOARDING_CONTRACT "Readiness checks": the registry
--   app.readiness_checks(key pk, title, sort, check_fn regproc)
-- belongs to o-setup (0180s). It is created here only if it does not exist yet,
-- with exactly the contract's shape, so both branches merge cleanly; o-setup's
-- migration must then use `create table if not exists` (or skip the create).
-- Each check is app.check_<key>(p_center uuid) returns jsonb {ok, detail}.
--
--   owner_admins_2fa     plan §4 Step 8 check 3: an owner and a second admin, both with 2FA
--   agreements_accepted  plan §4 Step 8 check 2: the current version of every required agreement accepted

create table if not exists app.readiness_checks (
  key      text primary key,
  title    text not null,
  sort     int not null default 100,
  check_fn regproc not null
);
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'app.readiness_checks'::regclass and tgname = 'audit_readiness_checks') then
    create trigger audit_readiness_checks after insert or update or delete on app.readiness_checks
      for each row execute function app.audit_row('key');
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'app.readiness_checks'::regclass and polname = 'readiness_checks_read') then
    alter table app.readiness_checks enable row level security;
    create policy readiness_checks_read on app.readiness_checks for select to authenticated using (true);
    revoke insert, update, delete, truncate on app.readiness_checks from anon, authenticated;
    grant select on app.readiness_checks to authenticated;
    grant all on app.readiness_checks to service_role;
  end if;
end $$;
insert into app.module_tables (table_name, module_key) values ('readiness_checks', null) on conflict (table_name) do nothing;

create or replace function app.check_owner_admins_2fa(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_owner uuid; v_owner_2fa boolean; v_admins int; v_admins_2fa int; v_missing text;
begin
  if not (app.is_member_of(p_center) or app.is_platform_admin() or auth.uid() is null) then
    raise exception 'Readiness checks are for this community''s staff.' using errcode = 'insufficient_privilege';
  end if;
  select user_id into v_owner from app.center_owners where center_id = p_center;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'detail', 'No owner is designated yet. The first administrator becomes the owner; a platform admin can designate one.');
  end if;
  v_owner_2fa := app.has_verified_totp(v_owner);
  select count(distinct g.user_id), count(distinct g.user_id) filter (where app.has_verified_totp(g.user_id))
    into v_admins, v_admins_2fa
    from app.role_grants g
   where g.center_id = p_center and g.role_key = 'center_admin' and g.scope_kind = 'center' and g.status = 'active'
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()) and g.user_id <> v_owner;
  if not v_owner_2fa then v_missing := 'the owner has not set up 2FA'; end if;
  if v_admins = 0 then
    v_missing := concat_ws('; ', v_missing, 'there is no second administrator (invite one in Settings › Team; the grant needs a second approver)');
  elsif v_admins_2fa = 0 then
    v_missing := concat_ws('; ', v_missing, 'the second administrator has not set up 2FA');
  end if;
  if v_missing is null then
    return jsonb_build_object('ok', true, 'detail', format('The owner and %s other administrator%s use 2FA.', v_admins_2fa, case when v_admins_2fa = 1 then '' else 's' end));
  end if;
  return jsonb_build_object('ok', false, 'detail', upper(left(v_missing, 1)) || substr(v_missing, 2) || '.');
end $$;

create or replace function app.check_agreements_accepted(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_env text := app.center_environment(p_center); v_missing text; v_unpublished text;
begin
  if not (app.is_member_of(p_center) or app.is_platform_admin() or auth.uid() is null) then
    raise exception 'Readiness checks are for this community''s staff.' using errcode = 'insufficient_privilege';
  end if;
  with kinds(k, label) as (values ('terms', 'terms of service'), ('dpa', 'data processing agreement'),
                                  ('children_addendum', 'children''s data addendum'), ('sandbox_terms', 'sandbox terms'),
                                  ('order_form', 'order form')),
  req as (select k, label from kinds
           where case k when 'sandbox_terms' then v_env = 'sandbox' when 'order_form' then v_env = 'production' else true end),
  cur as (select distinct on (d.kind) d.kind, d.version from app.legal_documents d
           where d.center_id is null and d.published_at is not null order by d.kind, d.published_at desc)
  select string_agg(r.label, ', ') filter (where c.version is not null
                                           and not exists (select 1 from app.org_agreements a
                                                            where a.center_id = p_center and a.kind = r.k and a.version = c.version)),
         string_agg(r.label, ', ') filter (where c.version is null)
    into v_missing, v_unpublished
    from req r left join cur c on c.kind = app.org_agreement_doc_kind(r.k);
  if v_missing is null and v_unpublished is null then
    return jsonb_build_object('ok', true, 'detail', 'The owner has accepted the current version of every required agreement.');
  end if;
  return jsonb_build_object('ok', false, 'detail', concat_ws(' ',
    case when v_missing is not null then 'Not accepted yet: ' || v_missing || '.' end,
    case when v_unpublished is not null then 'Not published by Community Connect yet: ' || v_unpublished || '.' end));
end $$;

insert into app.readiness_checks (key, title, sort, check_fn) values
  ('agreements_accepted', 'Agreements accepted', 20, 'app.check_agreements_accepted'::regproc),
  ('owner_admins_2fa', 'An owner and a second admin, both with 2FA', 30, 'app.check_owner_admins_2fa'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

revoke execute on function app.check_owner_admins_2fa(uuid), app.check_agreements_accepted(uuid) from public, anon;
grant execute on function app.check_owner_admins_2fa(uuid), app.check_agreements_accepted(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
