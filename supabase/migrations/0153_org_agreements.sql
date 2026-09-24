-- 0153 (stream o-security) · organization agreements.
--
-- ONBOARDING_CONTRACT "Organization agreements":
--   app.org_agreements(id, center_id, kind ('terms','dpa','children_addendum','sandbox_terms','order_form'),
--                      version, accepted_by, accepted_at, ip, user_agent)
--   The texts are app.legal_documents rows with center_id null (platform documents).
--
-- legal_documents.center_id is already nullable (0001: "null = platform
-- template"); its kind list gains the organization-agreement kinds. The
-- organization terms of service are stored with legal_documents.kind
-- 'org_terms' (org_agreements.kind stays 'terms', as in the contract): the member
-- app falls back to a platform 'terms' document as the MEMBERS' terms of use
-- when a community has not published its own, and must never show the
-- organization contract to members.
-- Platform documents are written by platform admins only (new policy; the
-- community-level legal_manage policy is unchanged).
--
-- The texts seeded here are DRAFTS and are NOT published: Community Connect's
-- counsel supplies the real wording, and a platform admin publishes it
-- (Agreements page). An unpublished agreement cannot be accepted.
--
--   app.accept_org_agreement(p_center, p_document)  owner only; records who, which version, when, IP, browser
--   app.org_agreement_status(p_center)              each required agreement and whether its current version is accepted
--   app.publish_platform_document(p_document)       platform admins

alter table app.legal_documents drop constraint if exists legal_documents_kind_check;
alter table app.legal_documents add constraint legal_documents_kind_check
  check (kind in ('privacy','terms','volunteer_waiver','pathshala_waiver','photo_release','other',
                  'org_terms','dpa','children_addendum','sandbox_terms','order_form'));
-- One version of each platform document (the table's unique key treats null centers as distinct).
create unique index if not exists legal_documents_platform_version_idx on app.legal_documents (kind, version) where center_id is null;

drop policy if exists legal_platform_manage on app.legal_documents;
create policy legal_platform_manage on app.legal_documents for all to authenticated
  using (center_id is null and app.is_platform_admin())
  with check (center_id is null and app.is_platform_admin());

insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values
  (null, 'org_terms', '2026-09-draft', 'Community Connect terms of service',
   E'**Draft — not for signature.** Community Connect''s counsel will replace this text before it is published.\n\nThese terms will cover: the service Community Connect provides to the organization, the organization''s responsibilities for its users and content, acceptable use, fees (see the order form), availability and support, suspension and termination, liability, and changes to the terms.', null),
  (null, 'dpa', '2026-09-draft', 'Data processing agreement',
   E'**Draft — not for signature.** Community Connect''s counsel will replace this text before it is published.\n\nThe organization owns its members'' data and decides how it is used; Community Connect processes it only to provide the service. This agreement will list the categories of data, the sub-processors (Supabase, the payment provider — Stripe or PayPal, the email and texting providers, Intuit, and Anthropic), security measures, breach notification, data return and deletion at the end of the service, and audits.', null),
  (null, 'children_addendum', '2026-09-draft', 'Children''s data addendum',
   E'**Draft — not for signature.** Community Connect''s counsel will replace this text before it is published.\n\nThis addendum will cover children''s records: parental consent, what children can see and do in the member app, who on the organization''s staff can see children''s details, and how those details are kept and deleted.', null),
  (null, 'sandbox_terms', '2026-09-draft', 'Sandbox terms',
   E'**Draft — not for signature.** Community Connect''s counsel will replace this text before it is published.\n\nThe sandbox is for setting up and testing. Use test data or data the organization is allowed to use for testing; payments run in test mode and messages reach only verified test recipients. A sandbox inactive for 90 days may be removed after warnings.', null),
  (null, 'order_form', '2026-09-draft', 'Order form',
   E'**Draft — not for signature.** The plan and price are not decided yet (decision O14). Community Connect will publish the order form with the organization''s plan before go-live.', null)
on conflict do nothing;

create table if not exists app.org_agreements (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  kind              text not null check (kind in ('terms','dpa','children_addendum','sandbox_terms','order_form')),
  version           text not null,
  legal_document_id uuid references app.legal_documents(id),
  accepted_by       uuid not null references auth.users(id),
  accepted_at       timestamptz not null default now(),
  ip                inet,
  user_agent        text,
  unique (center_id, kind, version)
);
alter table app.org_agreements enable row level security;
drop policy if exists org_agreements_read on app.org_agreements;
create policy org_agreements_read on app.org_agreements for select to authenticated
  using (app.is_center_owner(center_id) or app.has_permission(center_id, 'settings.manage'));
revoke insert, update, delete, truncate on app.org_agreements from anon, authenticated;
grant select on app.org_agreements to authenticated;
grant all on app.org_agreements to service_role;
drop trigger if exists audit_org_agreements on app.org_agreements;
create trigger audit_org_agreements after insert or update or delete on app.org_agreements
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('org_agreements', null) on conflict (table_name) do nothing;

-- org_agreements.kind -> legal_documents.kind (see the note at the top).
create or replace function app.org_agreement_doc_kind(p_kind text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_kind when 'terms' then 'org_terms' else p_kind end
$$;

-- 'production' unless o-tenancy's centers.environment says otherwise (read
-- through to_jsonb so this works before and after that column exists).
create or replace function app.center_environment(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select to_jsonb(c)->>'environment' from app.centers c where c.id = p_center), 'production')
$$;

-- The agreements a community needs, the current published version of each, and
-- whether that version is accepted.
create or replace function app.org_agreement_status(p_center uuid)
returns table (kind text, title text, required boolean, document_id uuid, version text, published boolean,
               accepted boolean, accepted_version text, accepted_at timestamptz, accepted_by_name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_env text := app.center_environment(p_center);
begin
  if not (app.is_center_owner(p_center) or app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Seeing the organization''s agreements needs the owner, or settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with kinds(k, sort) as (values ('terms', 1), ('dpa', 2), ('children_addendum', 3), ('sandbox_terms', 4), ('order_form', 5)),
    cur as (
      select distinct on (d.kind) d.kind, d.id, d.version, d.title, d.published_at
        from app.legal_documents d
       where d.center_id is null and d.kind in (select app.org_agreement_doc_kind(k) from kinds)
       order by d.kind, (d.published_at is not null) desc, d.published_at desc nulls last, d.created_at desc)
    select k.k,
           coalesce(cur.title, initcap(replace(k.k, '_', ' '))),
           case k.k when 'sandbox_terms' then v_env = 'sandbox' when 'order_form' then v_env = 'production' else true end,
           cur.id, cur.version, cur.published_at is not null,
           cur.published_at is not null and exists (select 1 from app.org_agreements a
                                                     where a.center_id = p_center and a.kind = k.k and a.version = cur.version),
           la.version, la.accepted_at,
           (select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
              from app.center_users cu join app.people p on p.id = cu.person_id
             where cu.center_id = p_center and cu.user_id = la.accepted_by)
      from kinds k
      left join cur on cur.kind = app.org_agreement_doc_kind(k.k)
      left join lateral (select a.version, a.accepted_at, a.accepted_by from app.org_agreements a
                          where a.center_id = p_center and a.kind = k.k order by a.accepted_at desc limit 1) la on true
     order by k.sort;
end $$;

-- p_ip / p_user_agent: the portal server passes the browser's address and user
-- agent from ITS incoming request (the database otherwise only sees the portal
-- server's). Without them, the request headers are used.
drop function if exists app.accept_org_agreement(uuid, uuid);
create or replace function app.accept_org_agreement(p_center uuid, p_document uuid, p_ip text default null, p_user_agent text default null)
returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.legal_documents; c record; v_id uuid; v_kind text; v_ip inet;
begin
  if auth.uid() is null then raise exception 'Sign in to accept the agreements.' using errcode = 'insufficient_privilege'; end if;
  if not app.is_center_owner(p_center) then
    raise exception 'Only the owner of this organization can accept its agreements.' using errcode = 'insufficient_privilege';
  end if;
  select * into d from app.legal_documents where id = p_document;
  if d.id is null or d.center_id is not null or d.kind not in ('org_terms','dpa','children_addendum','sandbox_terms','order_form') then
    raise exception 'That is not a Community Connect agreement.';
  end if;
  if d.published_at is null then raise exception 'That agreement has not been published yet, so it cannot be accepted.'; end if;
  if exists (select 1 from app.legal_documents n where n.center_id is null and n.kind = d.kind
               and n.published_at is not null and n.published_at > d.published_at) then
    raise exception 'A newer version of this agreement has been published. Reload the page and accept the current version.';
  end if;
  v_kind := case d.kind when 'org_terms' then 'terms' else d.kind end;
  select id into v_id from app.org_agreements where center_id = p_center and kind = v_kind and version = d.version;
  if v_id is not null then return v_id; end if;
  select * into c from app.audit_context();
  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;   -- an unparseable address is not recorded; the header's is used instead
  end;
  perform app.set_audit_context('Accepted ' || d.title || ' (' || d.version || ')');
  insert into app.org_agreements (center_id, kind, version, legal_document_id, accepted_by, ip, user_agent)
  values (p_center, v_kind, d.version, d.id, auth.uid(), coalesce(v_ip, c.ip), left(coalesce(nullif(btrim(p_user_agent), ''), c.user_agent), 500))
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.publish_platform_document(p_document uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can publish platform agreements.' using errcode = 'insufficient_privilege';
  end if;
  update app.legal_documents set published_at = now() where id = p_document and center_id is null and published_at is null;
  if not found then raise exception 'That platform document was not found, or it is already published.'; end if;
end $$;

revoke execute on function app.org_agreement_doc_kind(text) from public, anon;
grant execute on function app.org_agreement_doc_kind(text) to authenticated;
revoke execute on function app.center_environment(uuid), app.org_agreement_status(uuid), app.accept_org_agreement(uuid, uuid, text, text),
  app.publish_platform_document(uuid) from public, anon;
grant execute on function app.center_environment(uuid), app.org_agreement_status(uuid), app.accept_org_agreement(uuid, uuid, text, text),
  app.publish_platform_document(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
