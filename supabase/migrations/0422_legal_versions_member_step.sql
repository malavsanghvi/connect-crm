-- 0422 (stream e-people-legal) · #19/#20: legal texts are editable drafts published as new
-- versions, and the member app's first sign-in asks for the organization's legal documents.
--
-- Owner decisions 2026-09-25 (19, 20): "Member legal texts and organization agreements are
-- editable and re-publishable later (counsel); member-facing notices/disclaimers are part of
-- the member's first sign-up steps."
--
-- legal_documents (0001, 0153) already versions every text; this adds:
--   * kinds 'children_consent' (photo / children consent) and 'disclaimer' (notices);
--   * member_step: how the member app's legal step asks for a member document —
--       'accept'  must be accepted to continue (privacy, terms, disclaimers),
--       'consent' a yes / no choice that is recorded (photo release, children consent),
--       'none'    not asked at sign-in (waivers are signed before serving);
--     filled from the kind when not given;
--   * a published text is frozen: title, body, version and kind cannot change after publishing,
--     so every acceptance keeps pointing at the exact words accepted. A change is a new version.
--   * app.save_platform_document(...)   platform admins: edit a platform draft, or start a new version
--   * app.member_legal_steps(p_center)  the caller's documents to accept / answer now
--   * app.record_member_legal_answers(p_center, p_answers, p_ip, p_user_agent)
--       records each answer in app.consents (legal_document_id = the exact version) with who,
--       when, IP and browser. A newly published version, or a yearly re-sign that is due, is
--       asked again. Organization agreements (0153) already ask the owner again per version.
set client_min_messages = warning;

alter table app.legal_documents drop constraint if exists legal_documents_kind_check;
alter table app.legal_documents add constraint legal_documents_kind_check
  check (kind in ('privacy','terms','volunteer_waiver','pathshala_waiver','photo_release','other',
                  'children_consent','disclaimer',
                  'org_terms','dpa','children_addendum','sandbox_terms','order_form'));

alter table app.legal_documents add column if not exists member_step text;
alter table app.legal_documents add column if not exists updated_at timestamptz;
alter table app.legal_documents add column if not exists updated_by uuid references auth.users(id);
alter table app.legal_documents add column if not exists published_by uuid references auth.users(id);
update app.legal_documents set member_step = case
    when center_id is null and kind not in ('privacy','terms') then 'none'
    when kind in ('privacy','terms','disclaimer') then 'accept'
    when kind in ('photo_release','children_consent') then 'consent'
    else 'none' end
 where member_step is null;
alter table app.legal_documents drop constraint if exists legal_documents_member_step_check;
alter table app.legal_documents add constraint legal_documents_member_step_check check (member_step in ('none','accept','consent'));
comment on column app.legal_documents.member_step is
  'How the member app''s legal step asks for this document: accept (required to continue), consent (a recorded yes/no), none (not asked at sign-in).';

create or replace function app.legal_documents_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.member_step := coalesce(new.member_step,
      case when new.center_id is null and new.kind not in ('privacy','terms') then 'none'
           when new.kind in ('privacy','terms','disclaimer') then 'accept'
           when new.kind in ('photo_release','children_consent') then 'consent'
           else 'none' end);
    return new;
  end if;
  if old.published_at is not null
     and (new.title is distinct from old.title or new.body_md is distinct from old.body_md
          or new.version is distinct from old.version or new.kind is distinct from old.kind
          or new.center_id is distinct from old.center_id) then
    raise exception 'A published legal text cannot be changed, so every acceptance keeps the exact words accepted. Start a new version instead.'
      using errcode = '22023';
  end if;
  new.member_step := coalesce(new.member_step, old.member_step);
  if new.title is distinct from old.title or new.body_md is distinct from old.body_md or new.version is distinct from old.version then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  if new.published_at is not null and old.published_at is null then
    new.published_by := coalesce(auth.uid(), new.published_by);
  end if;
  return new;
end $$;
drop trigger if exists legal_documents_guard on app.legal_documents;
create trigger legal_documents_guard before insert or update on app.legal_documents
  for each row execute function app.legal_documents_guard();
alter table app.legal_documents alter column member_step set not null;

-- Audit: legal_documents is audited since 0102 (audit_every_table); check and add if missing.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'app.legal_documents'::regclass and tgname = 'audit_legal_documents') then
    execute 'create trigger audit_legal_documents after insert or update or delete on app.legal_documents for each row execute function app.audit_row()';
  end if;
end $$;

-- ── Platform texts: edit a draft or start a new version (platform admins) ────────
create or replace function app.save_platform_document(p_document uuid, p_kind text, p_title text, p_body_md text, p_version text, p_reason text)
returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.legal_documents; v_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can edit platform agreements.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason (for example "counsel''s September revision"). It goes in the audit log.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or nullif(btrim(coalesce(p_body_md, '')), '') is null then
    raise exception 'The title and the text are both needed.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_version, '')), '') is null then raise exception 'Give the version a name, for example 2026-10.' using errcode = '22023'; end if;
  perform app.set_audit_context(btrim(p_reason));
  if p_document is not null then
    select * into d from app.legal_documents where id = p_document and center_id is null;
    if d.id is null then raise exception 'That platform document was not found.' using errcode = '22023'; end if;
    if d.published_at is not null then
      raise exception 'Version % is published and cannot be changed. Start a new version instead.', d.version using errcode = '22023';
    end if;
    if exists (select 1 from app.legal_documents x where x.center_id is null and x.kind = d.kind and x.version = btrim(p_version) and x.id <> d.id) then
      raise exception 'Version % of this agreement already exists. Choose another version name.', btrim(p_version) using errcode = '23505';
    end if;
    update app.legal_documents set title = btrim(p_title), body_md = p_body_md, version = btrim(p_version) where id = d.id;
    return d.id;
  end if;
  if p_kind is null or p_kind not in ('org_terms','dpa','children_addendum','sandbox_terms','order_form','privacy','terms') then
    raise exception 'Choose which agreement this is.' using errcode = '22023';
  end if;
  if exists (select 1 from app.legal_documents x where x.center_id is null and x.kind = p_kind and x.published_at is null) then
    raise exception 'There is already a draft of this agreement. Edit that draft, or publish it first.' using errcode = '23505';
  end if;
  if exists (select 1 from app.legal_documents x where x.center_id is null and x.kind = p_kind and x.version = btrim(p_version)) then
    raise exception 'Version % of this agreement already exists. Choose another version name.', btrim(p_version) using errcode = '23505';
  end if;
  insert into app.legal_documents (center_id, kind, version, title, body_md)
  values (null, p_kind, btrim(p_version), btrim(p_title), p_body_md) returning id into v_id;
  return v_id;
end $$;

-- Organizations (owners) that accepted the current version of each platform agreement.
create or replace function app.platform_agreement_acceptance(p_document uuid) returns table (accepted int, organizations int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare d app.legal_documents;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team sees acceptance across organizations.' using errcode = 'insufficient_privilege';
  end if;
  select * into d from app.legal_documents where id = p_document and center_id is null;
  return query
    select (select count(distinct a.center_id)::int from app.org_agreements a
             where a.kind = case d.kind when 'org_terms' then 'terms' else d.kind end and a.version = d.version),
           (select count(*)::int from app.centers c where coalesce(to_jsonb(c)->>'status', 'active') <> 'archived');
end $$;

-- ── The member app's legal step ─────────────────────────────────────────────────
-- The caller's current documents: the community's published member documents (and
-- Community Connect's published privacy/terms where the community has none of its own).
-- children_consent is asked only of a member whose household has someone under 18.
create or replace function app.member_legal_steps(p_center uuid)
returns table (document_id uuid, kind text, title text, version text, body_md text, mode text, published_at timestamptz,
               requires_yearly_resign boolean, answered boolean, granted boolean, answered_version text, answered_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_person uuid := app.my_person_id(p_center); v_minor boolean; v_today date;
begin
  if auth.uid() is null or v_person is null then
    raise exception 'Sign in to your community first.' using errcode = 'insufficient_privilege';
  end if;
  v_today := (now() at time zone coalesce((select time_zone from app.centers where id = p_center), 'America/Chicago'))::date;
  select exists (select 1 from app.household_members me join app.household_members o on o.household_id = me.household_id and o.left_at is null
                   join app.people op on op.id = o.person_id
                  where me.person_id = v_person and me.left_at is null and not op.is_deceased
                    and op.date_of_birth is not null and op.date_of_birth > (v_today - interval '18 years')::date)
    into v_minor;
  return query
    with own as (
      select distinct on (d.kind) d.* from app.legal_documents d
       where d.center_id = p_center and d.published_at is not null and d.member_step <> 'none'
       order by d.kind, d.published_at desc),
    platform as (
      select distinct on (d.kind) d.* from app.legal_documents d
       where d.center_id is null and d.published_at is not null and d.kind in ('privacy','terms') and d.member_step <> 'none'
         and not exists (select 1 from own where own.kind = d.kind)
       order by d.kind, d.published_at desc),
    cur as (select * from own union all select * from platform)
    select c.id, c.kind, c.title, c.version, c.body_md, c.member_step, c.published_at, c.requires_yearly_resign,
           la.id is not null and (c.member_step = 'consent' or la.granted)
             and (not c.requires_yearly_resign or la.recorded_at > now() - interval '1 year'),
           la.granted, pv.version, pv.recorded_at
      from cur c
      left join lateral (select x.id, x.granted, x.recorded_at from app.consents x
                          where x.person_id = v_person and x.legal_document_id = c.id
                          order by x.recorded_at desc limit 1) la on true
      left join lateral (select d2.version, x.recorded_at from app.consents x join app.legal_documents d2 on d2.id = x.legal_document_id
                          where x.person_id = v_person and d2.kind = c.kind and (d2.center_id = p_center or d2.center_id is null)
                          order by x.recorded_at desc limit 1) pv on true
     where c.kind <> 'children_consent' or v_minor
     order by case c.kind when 'terms' then 1 when 'privacy' then 2 when 'disclaimer' then 3 when 'photo_release' then 4
                          when 'children_consent' then 5 else 6 end, c.title;
end $$;

create or replace function app.record_member_legal_answers(p_center uuid, p_answers jsonb, p_ip text default null, p_user_agent text default null)
returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid := app.my_person_id(p_center); a jsonb; s record; v_n int := 0; c record; v_ip inet; v_granted boolean;
begin
  if auth.uid() is null or v_person is null then
    raise exception 'Sign in to your community first.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception 'There were no answers to record.' using errcode = '22023';
  end if;
  select * into c from app.audit_context();
  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;   -- an unparseable address is not recorded; the request header's is used instead
  end;
  perform app.set_audit_context('Accepted the community''s documents in the member app');
  for a in select * from jsonb_array_elements(p_answers) loop
    select * into s from app.member_legal_steps(p_center) x where x.document_id = nullif(a->>'document_id', '')::uuid;
    if s.document_id is null then
      raise exception 'That document is no longer the current version. Reload and read the current one.' using errcode = '22023';
    end if;
    v_granted := coalesce((a->>'granted')::boolean, false);
    if s.mode = 'accept' and not v_granted then
      raise exception 'To use the app, accept "%".', s.title using errcode = '22023';
    end if;
    insert into app.consents (center_id, person_id, given_by_user, kind, legal_document_id, granted, source, ip, user_agent)
    values (p_center, v_person, auth.uid(), s.kind, s.document_id, v_granted, 'app', coalesce(v_ip, c.ip),
            left(coalesce(nullif(btrim(p_user_agent), ''), c.user_agent), 500));
    if s.kind = 'photo_release' then
      update app.people set photo_opt_in = v_granted where id = v_person and photo_opt_in is distinct from v_granted;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- How many people answered the current version of each member document (staff: privacy.manage
-- or settings.manage) — counts only, never who.
create or replace function app.member_legal_acceptance_counts(p_center uuid)
returns table (document_id uuid, accepted int, declined int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not (app.has_permission(p_center, 'settings.manage') or app.has_permission(p_center, 'privacy.manage')) then
    raise exception 'Seeing acceptance counts needs settings.manage or privacy.manage.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.id,
           (select count(distinct x.person_id)::int from app.consents x where x.legal_document_id = d.id and x.granted),
           (select count(distinct x.person_id)::int from app.consents x where x.legal_document_id = d.id and not x.granted)
      from app.legal_documents d
     where d.center_id = p_center and d.published_at is not null;
end $$;

revoke execute on function app.save_platform_document(uuid, text, text, text, text, text), app.platform_agreement_acceptance(uuid),
  app.member_legal_steps(uuid), app.record_member_legal_answers(uuid, jsonb, text, text), app.member_legal_acceptance_counts(uuid)
  from public, anon;
grant execute on function app.save_platform_document(uuid, text, text, text, text, text), app.platform_agreement_acceptance(uuid),
  app.member_legal_steps(uuid), app.record_member_legal_answers(uuid, jsonb, text, text), app.member_legal_acceptance_counts(uuid)
  to authenticated;
revoke execute on function app.legal_documents_guard() from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
