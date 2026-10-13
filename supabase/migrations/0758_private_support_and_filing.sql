-- 0758 · The organization's own data, part 2: support may open WeCare settings only (W8), the Weaver filing grant
-- (CatchTheMatch C8), private reads logged, and the audit log keeps care and matching entries from Weaver (docs/WECARE.md
-- section 3; docs/CATCH_THE_MATCH.md section 6). Builder PRIV, owner approved 2026-10-13.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   W8, SUPPORT. A support grant (app.support_grants, 0202: the owner gives a Weaver team member time-boxed access) may also
--   name AREAS. The one area today is 'care.settings'. app.care_settings_can(center) is true for a WeCare manager, or for a
--   live support grant whose areas include 'care.settings' (with WeCare on). It opens WeCare SETTINGS only: org_private_can
--   (0757) has no support branch, so touches, notes, signs, owners and lists stay closed with any support grant.
--   The owner sets the areas of a live grant with app.set_support_grant_areas (owner only, a reason, a fresh 2FA check,
--   audited). The Support access screen gets its tick box with the first WeCare settings screen; until then nothing reads it.
--
--   C8, THE WEAVER FILING ROLE. CatchTheMatch is filed by Weaver's team, so the organization gives NAMED Weaver team members
--   a filing grant: app.matching_filing_grants, its own table (like support_grants), NOT a role grant: 0152's
--   enforce_role_grant lets a platform admin write any role grant unchecked, so a role here could be taken rather than given.
--     app.grant_weaver_filing(center, grantee, days, reason)   the owner or a matching.manage holder (0757's check, so
--                                     CatchTheMatch must be on); the grantee must be on Weaver's team; not oneself; 1 to 366
--                                     days; a reason; a fresh 2FA check ('matching.filing_grant'); one live grant per person.
--                                     Audited (the table's audit_row) and the owner is emailed (0757's notice).
--     app.end_weaver_filing(grant, reason)   the owner, a matching.manage holder, or the grantee; at once.
--     Weaver turning CatchTheMatch off for the community (app.set_module_grant) ends every live filing grant at once
--     ("time-limited to the subscription"). A community pausing it suspends the grant, as it suspends everyone's access.
--     app.matching_can(center, level)  'view': matching.view or matching.manage, or a live filing grant; 'file' (the filing
--                                     queue's actions, slice 3): matching.manage or a live filing grant; 'manage':
--                                     matching.manage only. A filing grant never opens WeCare, notes or other giving.
--   Every read of CatchTheMatch data (by the filing team or anyone) is logged with app.log_private_read and shown to the
--   organization. The filing queue and its screen are slice 3 (they need the claims tables).
--
--   READS AND THE AUDIT LOG.
--     app.log_private_read(center, product, what, rows)   for the read functions of the future tables: one audit entry
--                                     (action '<product>.read', module = product, after = {what, rows, as}); who and when,
--                                     never names. Only a caller who may read that product's data can write one.
--     app.audit_private_row(product, id columns…)   the audit trigger for care and matching tables that hold words about
--                                     a person: who, when, which row and which columns changed; text, json and array values
--                                     are written as '***'; module = the product.
--     audit_read (0010) and app.record_history (0102): an entry whose module is 'care' or 'matching' is read only by the
--     community's owner and holders of that product's .manage key. Not by platform admins, not by audit.view alone.
--     Every other entry reads exactly as before.
set client_min_messages = warning;

-- ══ W8 · Support may open WeCare settings ════════════════════════════════════
create or replace function app.support_grant_areas() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['care.settings']::text[]
$$;

alter table app.support_grants add column if not exists areas text[] not null default '{}';
alter table app.support_grants drop constraint if exists support_grants_areas;
alter table app.support_grants add constraint support_grants_areas check (areas <@ app.support_grant_areas());
comment on column app.support_grants.areas is
  'What else the support grant may open (0758). care.settings: WeCare settings only, never care records. Empty: the support of 0202 only.';

create or replace function app.care_settings_can(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.care_can(p_center, 'manage')
      or (auth.uid() is not null and app._org_private_module_on(p_center, 'care')
          and exists (select 1 from app.support_grants g
                       where g.center_id = p_center and g.grantee_user_id = auth.uid()
                         and g.revoked_at is null and g.expires_at > now() and 'care.settings' = any (g.areas)))
$$;

create or replace function app.set_support_grant_areas(p_grant uuid, p_areas text[], p_reason text) returns text[]
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.support_grants; v_areas text[];
begin
  select * into g from app.support_grants where id = p_grant for update;
  if g.id is null then raise exception 'That support grant was not found.'; end if;
  if auth.uid() is null or not app.is_center_owner(g.center_id) then
    raise exception 'Only the owner of this organization can change what support access opens.' using errcode = 'insufficient_privilege';
  end if;
  if g.revoked_at is not null or g.expires_at <= now() then
    raise exception 'This support access has ended. Give a new one instead.';
  end if;
  select coalesce(array_agg(distinct a order by a), '{}') into v_areas from unnest(coalesce(p_areas, '{}'::text[])) a where a is not null;
  if not (v_areas <@ app.support_grant_areas()) then
    raise exception 'Support access can open only: %.', array_to_string(app.support_grant_areas(), ', ') using errcode = '22023';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why. It goes in the audit log.'; end if;
  perform app.assert_step_up('support.grant');
  perform app.set_audit_context(p_reason);
  update app.support_grants set areas = v_areas where id = p_grant;
  return v_areas;
end $$;

-- ══ C8 · The Weaver filing grant ═════════════════════════════════════════════
create table if not exists app.matching_filing_grants (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id),
  granted_by      uuid not null references auth.users(id),
  granted_at      timestamptz not null default now(),
  ends_at         timestamptz not null,
  ended_at        timestamptz,
  ended_by        uuid references auth.users(id),
  end_reason      text check (end_reason is null or (btrim(end_reason) <> '' and length(end_reason) <= 500)),
  reason          text not null check (btrim(reason) <> '' and length(reason) <= 500),
  constraint matching_filing_grants_window check (ends_at > granted_at and ends_at <= granted_at + interval '366 days')
);
create index if not exists matching_filing_grants_center_idx on app.matching_filing_grants (center_id, ends_at desc);
create index if not exists matching_filing_grants_grantee_idx on app.matching_filing_grants (grantee_user_id);
comment on table app.matching_filing_grants is
  'The Weaver filing role (0758, CatchTheMatch C8): the organization gives a named Weaver team member access to CatchTheMatch data only, for a set time; ended at once when Weaver turns CatchTheMatch off. Written only by grant_weaver_filing / end_weaver_filing.';

alter table app.matching_filing_grants enable row level security;
-- The organization (its owner and its CatchTheMatch managers) sees every grant; a grantee sees their own.
drop policy if exists matching_filing_grants_read on app.matching_filing_grants;
create policy matching_filing_grants_read on app.matching_filing_grants for select to authenticated
  using (grantee_user_id = auth.uid() or app.is_center_owner(center_id) or app.org_private_can(center_id, 'matching.manage'));
revoke all on app.matching_filing_grants from public, anon, authenticated;
grant select on app.matching_filing_grants to authenticated;
grant all on app.matching_filing_grants to service_role;
drop trigger if exists audit_matching_filing_grants on app.matching_filing_grants;
create trigger audit_matching_filing_grants after insert or update or delete on app.matching_filing_grants
  for each row execute function app.audit_row();
-- Core platform, like support_grants: the record of who was given access stays readable after CatchTheMatch is off.
insert into app.module_tables (table_name, module_key) values ('matching_filing_grants', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

-- A live filing grant for this caller, with CatchTheMatch on.
create or replace function app._weaver_filing_live(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and app._org_private_module_on(p_center, 'matching')
     and exists (select 1 from app.matching_filing_grants f
                  where f.center_id = p_center and f.grantee_user_id = auth.uid()
                    and f.ended_at is null and f.granted_at <= now() and f.ends_at > now())
$$;

create or replace function app.matching_can(p_center uuid, p_level text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case p_level
           when 'view' then app.org_private_can(p_center, 'matching.view') or app.org_private_can(p_center, 'matching.manage')
                         or app._weaver_filing_live(p_center)
           when 'file' then app.org_private_can(p_center, 'matching.manage') or app._weaver_filing_live(p_center)
           when 'manage' then app.org_private_can(p_center, 'matching.manage')
           else false
         end
$$;

create or replace function app.grant_weaver_filing(p_center uuid, p_grantee uuid, p_days int, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_until timestamptz; v_live app.matching_filing_grants; v_mail jsonb;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if auth.uid() is null or not (app.is_center_owner(p_center) or app._org_holds(p_center, auth.uid(), 'matching.manage')) then
    raise exception 'Only the organization''s owner or someone who manages CatchTheMatch can give Weaver''s team filing access.'
      using errcode = 'insufficient_privilege';
  end if;
  if not app._org_private_module_on(p_center, 'matching') then
    raise exception '% is not on for this community, so there is nothing to file yet.', app._module_label(p_center, 'matching')
      using errcode = 'insufficient_privilege';
  end if;
  if p_grantee is null or not exists (select 1 from app.accounts a where a.user_id = p_grantee and a.is_platform_admin) then
    raise exception 'Filing access can be given only to a member of Weaver''s team.';
  end if;
  if p_grantee = auth.uid() then
    raise exception 'Nobody can give themselves filing access.' using errcode = 'check_violation';
  end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'Choose how long, from 1 day to 366 days.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say what the filing access is for. It goes in the audit log.'; end if;
  select * into v_live from app.matching_filing_grants f
   where f.center_id = p_center and f.grantee_user_id = p_grantee and f.ended_at is null and f.ends_at > now()
   order by f.ends_at desc limit 1;
  if v_live.id is not null then
    raise exception 'This person already has filing access until %. End it first to give a new one.',
      to_char(v_live.ends_at at time zone coalesce((select time_zone from app.centers where id = p_center), 'America/Chicago'), 'FMMonth FMDD, YYYY');
  end if;
  perform app.assert_step_up('matching.filing_grant');
  perform app.set_audit_context(p_reason);
  v_until := now() + make_interval(days => p_days);
  insert into app.matching_filing_grants (center_id, grantee_user_id, granted_by, ends_at, reason)
  values (p_center, p_grantee, auth.uid(), v_until, app.audit_clean_reason(p_reason))
  returning id into v_id;
  v_mail := app._notify_owner_private_access(p_center, 'matching', p_grantee, auth.uid(),
              'Weaver filing access (CatchTheMatch claims, the gifts behind them, and the donors'' names and employers)', v_until);
  perform app.log_private_audit('matching', p_center, 'matching.filing_granted', 'matching_filing_grants', v_id::text,
    jsonb_build_object('grantee', p_grantee, 'ends_at', v_until, 'owner_email', coalesce(v_mail->>'status', 'failed')), p_reason);
  return v_id;
end $$;

create or replace function app.end_weaver_filing(p_grant uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.matching_filing_grants;
begin
  select * into f from app.matching_filing_grants where id = p_grant for update;
  if f.id is null then raise exception 'That filing access was not found.'; end if;
  if auth.uid() is null or not (app.is_center_owner(f.center_id) or app._org_holds(f.center_id, auth.uid(), 'matching.manage')
                                or f.grantee_user_id = auth.uid()) then
    raise exception 'Only the organization''s owner, someone who manages CatchTheMatch, or the person given access can end filing access.'
      using errcode = 'insufficient_privilege';
  end if;
  if f.ended_at is not null or f.ends_at <= now() then return; end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Filing access ended'));
  update app.matching_filing_grants
     set ended_at = now(), ended_by = auth.uid(), end_reason = coalesce(app.audit_clean_reason(p_reason), 'Filing access ended')
   where id = p_grant;
end $$;

-- Weaver turning CatchTheMatch off ends every live filing grant of the community at once.
create or replace function app.matching_grant_off_ends_filing() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.module_key = 'matching' and not new.granted and (tg_op = 'INSERT' or old.granted) then
    update app.matching_filing_grants
       set ended_at = now(), ended_by = auth.uid(), end_reason = 'CatchTheMatch was turned off for this community'
     where center_id = new.center_id and ended_at is null and ends_at > now();
  end if;
  return new;
end $$;
revoke execute on function app.matching_grant_off_ends_filing() from public, anon, authenticated;
drop trigger if exists matching_grant_off_ends_filing on app.center_module_grants;
create trigger matching_grant_off_ends_filing after insert or update of granted on app.center_module_grants
  for each row execute function app.matching_grant_off_ends_filing();

-- ══ Reads are logged; the audit log keeps them in the organization ══════════
create or replace function app.log_private_read(p_center uuid, p_product text, p_what text, p_rows int) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_as text;
begin
  if p_product is null or p_product not in ('care', 'matching') then
    raise exception 'A private read belongs to care or matching (got "%").', p_product using errcode = '22023';
  end if;
  if p_what is null or p_what !~ '^[a-z][a-z0-9_.]{0,59}$' then
    raise exception 'Say what was read as a short key, like list or export (got "%").', p_what using errcode = '22023';
  end if;
  if p_rows is null or p_rows < 0 then raise exception 'The number of rows read is missing.' using errcode = '22023'; end if;
  if p_product = 'care' and not app.care_can(p_center, 'own') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  if p_product = 'matching' and not app.matching_can(p_center, 'view') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  v_as := case when p_product = 'matching' and not app.org_private_can(p_center, 'matching.view')
                    and not app.org_private_can(p_center, 'matching.manage') then 'weaver_filing' else 'organization' end;
  perform app.log_private_audit(p_product, p_center, p_product || '.read', null, null,
    jsonb_build_object('what', p_what, 'rows', p_rows, 'as', v_as), null);
end $$;

-- The audit trigger for care and matching tables: who, when, which row and WHICH columns changed, never what they say.
-- Text, json and array values are written as '***' (ids, dates, numbers and yes/no stay); module = the product (first
-- argument), record id = the remaining arguments' columns (default: id). Use it instead of app.audit_row on a table that
-- holds free text about a person (test 13 lists such tables).
create or replace function app.audit_private_row() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_before jsonb; v_after jsonb; v_row jsonb; v_id text; v_masked text[]; c record; i int; k text;
begin
  v_before := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  if tg_nargs < 1 or tg_argv[0] not in ('care', 'matching') then
    raise exception 'app.audit_private_row needs the product (care or matching) as its first argument.';
  end if;
  v_row := coalesce(v_after, v_before);
  if tg_nargs = 1 then
    v_id := v_row->>'id';
  else
    for i in 1 .. tg_nargs - 1 loop
      v_id := case when i = 1 then '' else v_id || ':' end || coalesce(v_row->>tg_argv[i], '');
    end loop;
  end if;
  select coalesce(array_agg(a.attname::text), '{}') into v_masked
    from pg_attribute a
   where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
     and (a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
          or exists (select 1 from pg_type t where t.oid = a.atttypid and t.typcategory = 'A')
          or a.atttypid = coalesce(to_regtype('extensions.citext'), to_regtype('public.citext'), 'text'::regtype));
  foreach k in array v_masked loop
    if v_before is not null and v_before ? k and jsonb_typeof(v_before->k) <> 'null' then v_before := v_before || jsonb_build_object(k, '***'); end if;
    if v_after is not null and v_after ? k and jsonb_typeof(v_after->k) <> 'null' then v_after := v_after || jsonb_build_object(k, '***'); end if;
  end loop;
  select * into c from app.audit_context();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (coalesce((v_row->>'center_id')::uuid, null), auth.uid(), auth.jwt()->>'role', tg_table_name || '.' || lower(tg_op),
          tg_table_name, v_id, v_before, v_after, c.reason, c.correlation_id, c.ip, c.user_agent, tg_argv[0],
          c.client_app, c.client_screen);
  return coalesce(new, old);
end $$;
revoke execute on function app.audit_private_row() from public, anon, authenticated;

-- 0010's policy, with the private entries kept in the organization. Every other entry reads exactly as before.
drop policy if exists audit_read on app.audit_log;
create policy audit_read on app.audit_log for select to authenticated
  using (case when module in ('care', 'matching')
              then app.is_center_owner(center_id) or app.org_private_can(center_id, module || '.manage')
              else app.has_permission(center_id, 'audit.view') or app.is_platform_admin() end);

-- 0102's history of one record, with the same rule as audit_read.
create or replace function app.record_history(p_table text, p_record text)
returns table (id bigint, occurred_at timestamptz, action text, center_id uuid, actor_user_id uuid, actor_name text,
               actor_role text, module text, client_app text, client_screen text, reason text, correlation_id uuid,
               before jsonb, after jsonb)
language sql stable security definer set search_path = app, public, extensions as $$
  select l.id, l.occurred_at, l.action, l.center_id, l.actor_user_id,
         case when l.actor_user_id is null then 'System'
              else coalesce((select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
                               from app.center_users cu join app.people p on p.id = cu.person_id
                              where cu.user_id = l.actor_user_id and cu.center_id = l.center_id),
                            case when exists (select 1 from app.accounts a where a.user_id = l.actor_user_id and a.is_platform_admin)
                                 then 'Platform team' end,
                            'Unknown user') end,
         l.actor_role, l.module, l.client_app, l.client_screen, l.reason, l.correlation_id, l.before, l.after
    from app.audit_log l
   where l.record_table = p_table and l.record_id = p_record
     and case when l.module in ('care', 'matching')
              then app.is_center_owner(l.center_id) or app.org_private_can(l.center_id, l.module || '.manage')
              else app.has_permission(l.center_id, 'audit.view') or app.is_platform_admin() end
   order by l.id desc
   limit 500
$$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._weaver_filing_live(uuid) from public, anon, authenticated;
-- log_private_read checks that the caller may read the product before it writes; the portal and future functions call it.
revoke execute on function app.log_private_read(uuid, text, text, int) from public, anon;
grant execute on function app.log_private_read(uuid, text, text, int) to authenticated;
revoke execute on function app.care_settings_can(uuid), app.set_support_grant_areas(uuid, text[], text), app.matching_can(uuid, text),
  app.grant_weaver_filing(uuid, uuid, int, text), app.end_weaver_filing(uuid, text), app.support_grant_areas() from public, anon;
grant execute on function app.care_settings_can(uuid), app.set_support_grant_areas(uuid, text[], text), app.matching_can(uuid, text),
  app.grant_weaver_filing(uuid, uuid, int, text), app.end_weaver_filing(uuid, text), app.support_grant_areas() to authenticated;
revoke execute on function app.record_history(text, text) from public, anon;
grant execute on function app.record_history(text, text) to authenticated;
grant execute on all functions in schema app to service_role;
