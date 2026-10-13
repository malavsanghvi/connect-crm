-- 0753 · Marketplace packs, part 4 of 4: requests, "tell me when it is ready", the Marketplace read, and Weaver's switch
-- (docs/MARKETPLACE_PACKS.md P1 to P3; the accepted prototype of 2026-10-13: Settings › Marketplace and Platform › Communities ›
-- Products).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.marketplace_requests        a community asks Weaver for a product, with a note (one open request per product). Its
--                                   settings managers send and cancel; Weaver sees the open ones; turning the product on marks
--                                   the request done (a trigger on the 0740 grants, so it is done however the grant is made).
--   app.marketplace_interest        "Tell me when it is ready" for a product that is not built yet: one row per community and
--                                   product, so Weaver can count the demand. When a migration marks the product built, every
--                                   community that asked is emailed, and the row records when.
--   app.marketplace_states(center)  the one read for Settings › Marketplace and Platform › Communities › Products: every product
--                                   the community's kind offers, with its card copy and its state:
--                                     included   on, and part of every community that has it (Giving, Events, ...)
--                                     on         on: granted by Weaver (or grandfathered, or a sandbox trial) and not paused
--                                     paused     granted, and paused by the community (nothing hidden is deleted)
--                                     requested  not on; the community asked
--                                     available  not on; it can be requested
--                                     not_built  not built yet ("Tell me when it is ready")
--                                     notified   not built yet, and the community asked to be told
--                                   A product its kind never offers is left out.
--   app.marketplace_request / marketplace_request_cancel / marketplace_notify_me
--                                   the community's settings managers (settings.manage).
--   app.marketplace_open_requests() Weaver: every open request, oldest first.
--   app.marketplace_set_product(center, product, on, reason)
--                                   Weaver: turn a product on or off. A module the product needs must be on first; then it is
--                                   0740's app.set_module_grant (platform admins only, a reason, a fresh 2FA check, audited),
--                                   and the community's owner and whoever asked are emailed what changed.
--   app.marketplace_audit(center)   Weaver: the product changes of one community, newest first, in words.
--
-- NOT CHANGED: who may switch what. Enforcement stays in the module functions (0740): nothing here grants, pauses or reads a
-- module's data except through them. Pause and resume in the Marketplace are app.set_module_enabled, the community's own switch.
set client_min_messages = warning;

-- ── 1. Requests and interest ─────────────────────────────────────────────────
create table if not exists app.marketplace_requests (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  product_key  text not null references app.marketplace_products(key),
  note         text not null check (char_length(btrim(note)) between 1 and 500),
  status       text not null default 'open' check (status in ('open', 'cancelled', 'done')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  closed_by    uuid references auth.users(id) on delete set null,
  closed_at    timestamptz,
  close_note   text check (close_note is null or char_length(close_note) <= 500),
  check ((status = 'open') = (closed_at is null))
);
create unique index if not exists marketplace_requests_open_idx on app.marketplace_requests (center_id, product_key) where status = 'open';
create index if not exists marketplace_requests_center_idx on app.marketplace_requests (center_id, requested_at desc);
comment on table app.marketplace_requests is
  'A community''s request for a Marketplace product (0753), with its note. Written only by the marketplace functions; done when Weaver turns the product on.';

create table if not exists app.marketplace_interest (
  center_id    uuid not null references app.centers(id) on delete cascade,
  product_key  text not null references app.marketplace_products(key),
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- When the product became ready and the community was told, and whether the emails were queued.
  told_at      timestamptz,
  told_status  text check (told_status is null or char_length(told_status) <= 500),
  primary key (center_id, product_key)
);
comment on table app.marketplace_interest is
  '"Tell me when it is ready" for a product that is not built yet (0753): one row per community and product. Written only by app.marketplace_notify_me, and by the trigger that tells the community when the product is ready.';

do $$
declare t text;
begin
  foreach t in array array['marketplace_requests', 'marketplace_interest'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists %I on app.%I', t || '_read', t);
    execute format('create policy %I on app.%I for select to authenticated using (app.is_platform_admin() or app.has_permission(center_id, ''settings.manage''))', t || '_read', t);
    execute format('revoke all on app.%I from public, anon, authenticated', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;
drop trigger if exists audit_marketplace_requests on app.marketplace_requests;
create trigger audit_marketplace_requests after insert or update or delete on app.marketplace_requests
  for each row execute function app.audit_row();
drop trigger if exists audit_marketplace_interest on app.marketplace_interest;
create trigger audit_marketplace_interest after insert or update or delete on app.marketplace_interest
  for each row execute function app.audit_row('center_id', 'product_key');
insert into app.module_tables (table_name, module_key) values ('marketplace_requests', null), ('marketplace_interest', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- A sandbox reset keeps them, as it keeps Weaver's grants (0740's body; the two tables join the list it leaves alone). A
-- promotion does not copy them: a request is a conversation with Weaver about the sandbox, not the community's configuration.
create or replace function app.demo_clear_tables() returns text[]
language sql stable set search_path = app, public, extensions as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
          or c.relname in ('gyan_levels','gyan_steps'))
     and c.relname <> all (app.demo_keep_tables())
     and c.relname <> all (array['access_levels', 'center_feature_access', 'center_module_grants',
                                 'marketplace_requests', 'marketplace_interest']::text[])
$$;

-- Turning a product on (however the grant is made) marks its open request done.
create or replace function app.center_module_grants_close_requests() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.granted and (tg_op = 'INSERT' or old.granted is distinct from true) then
    update app.marketplace_requests r
       set status = 'done', closed_by = new.granted_by, closed_at = now(), close_note = 'Turned on by Weaver.'
     where r.center_id = new.center_id and r.status = 'open'
       and r.product_key in (select p.key from app.marketplace_products p where p.module_key = new.module_key);
  end if;
  return null;
end $$;
drop trigger if exists center_module_grants_close_requests on app.center_module_grants;
create trigger center_module_grants_close_requests after insert or update on app.center_module_grants
  for each row execute function app.center_module_grants_close_requests();

-- "We will tell your admins when it is ready" is kept: when a migration marks a product built (not_built -> available), every
-- community that asked is emailed (whoever asked, and the owner), and the interest row records when and whether it was queued.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('marketplace_product_ready', 'email', '{{product}} is ready',
   E'Hello,

You asked to be told when {{product}} is ready. It is ready now: an administrator of {{center_name}} can request it in Settings › Marketplace, and the Weaver team checks the request and turns it on.

The Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

create or replace function app.marketplace_products_ready_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare i record; v_to text; v_mail jsonb; v_sent text[];
begin
  for i in
    select x.center_id, x.requested_by, c.name as center_name
      from app.marketplace_interest x join app.centers c on c.id = x.center_id
     where x.product_key = new.key and x.told_at is null
  loop
    v_sent := '{}';
    for v_to in
      select distinct lower(u.email)
        from auth.users u
       where u.email is not null
         and (u.id = i.requested_by or u.id in (select o.user_id from app.center_owners o where o.center_id = i.center_id))
    loop
      v_mail := app.platform_send_message(v_to, 'marketplace_product_ready',
                  jsonb_build_object('product', new.name, 'center_name', i.center_name), 'notification');
      v_sent := v_sent || app.message_status_text(v_mail);
    end loop;
    update app.marketplace_interest
       set told_at = now(), told_status = case when cardinality(v_sent) = 0 then 'no one to email' else array_to_string(v_sent, ', ') end
     where center_id = i.center_id and product_key = new.key;
  end loop;
  return null;
end $$;
drop trigger if exists marketplace_products_ready_notice on app.marketplace_products;
create trigger marketplace_products_ready_notice after update of status on app.marketplace_products
  for each row when (old.status = 'not_built' and new.status = 'available')
  execute function app.marketplace_products_ready_notice();

-- ── 2. Private helpers ───────────────────────────────────────────────────────
-- How a person is named on these screens: their name in the community ("Sam K."). Someone from Weaver is "Weaver" to the
-- community; the Weaver team sees the email of a colleague who is not a person in the community.
create or replace function app._marketplace_person(p_center uuid, p_user uuid, p_platform boolean) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when p_user is null then null else coalesce(
    (select coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name)
            || coalesce(' ' || left(nullif(btrim(pe.last_name), ''), 1) || '.', '')
       from app.center_users cu join app.people pe on pe.id = cu.person_id
      where cu.center_id = p_center and cu.user_id = p_user limit 1),
    case when exists (select 1 from app.accounts a where a.user_id = p_user and a.is_platform_admin) and not coalesce(p_platform, false)
         then 'Weaver' end,
    case when coalesce(p_platform, false) then (select u.email::text from auth.users u where u.id = p_user) end,
    'Someone on your team') end
$$;

-- Where a grant came from, in one word: kind_default (no row; the kind starts it on), weaver (a platform admin), grandfathered
-- (a migration kept what was in use), trial (a sandbox's iWeaver), trial_ended, or none (not granted, no row).
create or replace function app._marketplace_grant_source(p_center uuid, p_module text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when g.center_id is null then case when app._module_granted(p_center, p_module) then 'kind_default' else 'none' end
    when g.granted_by is not null then 'weaver'
    when g.reason = app._ai_trial_reason() then 'trial'
    when g.reason = app._ai_trial_ended_reason() then 'trial_ended'
    else 'grandfathered' end
  from (select 1) one
  left join app.center_module_grants g on g.center_id = p_center and g.module_key = p_module
$$;

-- ── 3. The Marketplace read ──────────────────────────────────────────────────
create or replace function app.marketplace_states(p_center uuid)
returns table (key text, module_key text, name text, module_label text, mark text, line text, gets text[], needs jsonb,
               members_line text, data_line text, price_text text, price_short text, included boolean, catalog_status text,
               target_quarter text, on_note text, off_note text, sort int,
               state text, enabled boolean, granted boolean, paused boolean, waiting_for text[], source text,
               granted_at timestamptz, granted_by_name text, grant_reason text,
               paused_at timestamptz, paused_by_name text, pause_reason text,
               request_id uuid, request_note text, requested_at timestamptz, requested_by_name text,
               notified_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_platform boolean := app.is_platform_admin();
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (v_platform or app.has_permission(p_center, 'settings.manage')) then
    raise exception 'You don''t have access to this community''s Marketplace (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  return query
  with p as (
    select pr.*,
           pr.module_key is not null and app._module_granted(p_center, pr.module_key) as is_granted,
           coalesce(x.enabled is false, false) as is_paused,
           x.changed_at as x_at, x.changed_by as x_by, x.reason as x_reason,
           g.granted_at as g_at, g.granted_by as g_by, g.reason as g_reason,
           r.id as r_id, r.note as r_note, r.requested_at as r_at, r.requested_by as r_by,
           i.created_at as i_at
      from app.marketplace_products pr
      left join app.center_modules x on x.center_id = p_center and x.module_key = pr.module_key
      left join app.center_module_grants g on g.center_id = p_center and g.module_key = pr.module_key
      left join app.marketplace_requests r on r.center_id = p_center and r.product_key = pr.key and r.status = 'open'
      left join app.marketplace_interest i on i.center_id = p_center and i.product_key = pr.key
     where pr.module_key is null or app.module_availability(p_center, pr.module_key) <> 'not_available'
  )
  select p.key, p.module_key, p.name,
         case when p.module_key is not null then app._module_label(p_center, p.module_key) end,
         p.mark, p.line, p.gets,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'module', e->>'module',
                     'label', app._module_label(p_center, e->>'module') || coalesce(' (' || (e->>'note') || ')', ''),
                     'on', coalesce((select m.core from app.modules m where m.key = e->>'module'), false)
                           or app.module_enabled(p_center, e->>'module'),
                     'required', p.module_key is not null and (e->>'module') = any (app._module_chain(p.module_key)))
                     order by o)
                     from jsonb_array_elements(p.needs) with ordinality as n(e, o)), '[]'::jsonb),
         p.members_line, p.data_line, p.price_text, coalesce(p.price_short, p.price_text), p.included, p.status,
         p.target_quarter, p.on_note, p.off_note, p.sort,
         case when p.is_granted and p.is_paused then 'paused'
              when p.is_granted and p.included then 'included'
              when p.is_granted then 'on'
              when p.status = 'not_built' and p.i_at is not null then 'notified'
              when p.status = 'not_built' then 'not_built'
              when p.r_id is not null then 'requested'
              else 'available' end,
         p.module_key is not null and app.module_enabled(p_center, p.module_key),
         p.is_granted,
         p.is_granted and p.is_paused,
         case when p.module_key is null then '{}'::text[] else
           coalesce((select array_agg(app._module_label(p_center, ch.k) order by ch.n)
                       from unnest(app._module_chain(p.module_key)) with ordinality as ch(k, n)
                      where ch.k <> p.module_key and not app._module_self_on(p_center, ch.k, app.module_availability(p_center, ch.k))),
                    '{}'::text[]) end,
         case when p.module_key is null then 'none' else app._marketplace_grant_source(p_center, p.module_key) end,
         p.g_at, app._marketplace_person(p_center, p.g_by, v_platform), p.g_reason,
         case when p.is_paused then p.x_at end, case when p.is_paused then app._marketplace_person(p_center, p.x_by, v_platform) end,
         case when p.is_paused then p.x_reason end,
         p.r_id, p.r_note, p.r_at, app._marketplace_person(p_center, p.r_by, v_platform),
         p.i_at
    from p
   order by p.sort, p.key;
end $$;

-- ── 4. The community: request, cancel, tell me ───────────────────────────────
create or replace function app._marketplace_settings_manager(p_center uuid, p_doing text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not app.has_permission(p_center, 'settings.manage') then
    raise exception '% needs the settings.manage permission.', p_doing using errcode = 'insufficient_privilege';
  end if;
end $$;

create or replace function app.marketplace_request(p_center uuid, p_product text, p_note text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.marketplace_products; v_note text := btrim(coalesce(p_note, '')); v_id uuid; v_at timestamptz;
begin
  perform app._marketplace_settings_manager(p_center, 'Requesting a product');
  select * into p from app.marketplace_products where key = p_product;
  if p.key is null then raise exception 'There is no product called "%".', p_product; end if;
  if p.status = 'not_built' then
    raise exception '% is not built yet, so it cannot be requested. Choose "Tell me when it is ready" instead.', p.name;
  end if;
  if app.module_availability(p_center, p.module_key) = 'not_available' then
    raise exception '% is not part of a % organization.', p.name,
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this');
  end if;
  if app._module_granted(p_center, p.module_key) then
    if exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = p.module_key and not x.enabled) then
      raise exception '% is on for your community and paused. Resume it instead of requesting it.', p.name;
    end if;
    raise exception '% is already on for your community.', p.name;
  end if;
  if v_note = '' then raise exception 'Say what your community will use % for. A sentence is enough.', p.name; end if;
  if char_length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app.marketplace_requests:' || p_center::text || ':' || p.key, 0));
  if exists (select 1 from app.marketplace_requests r where r.center_id = p_center and r.product_key = p.key and r.status = 'open') then
    raise exception '% is already requested. Weaver checks the request and turns it on.', p.name;
  end if;
  perform app.set_audit_context('Requested ' || p.name || ': ' || v_note);
  insert into app.marketplace_requests (center_id, product_key, note, requested_by)
  values (p_center, p.key, v_note, auth.uid())
  returning id, requested_at into v_id, v_at;
  return jsonb_build_object('id', v_id, 'product', p.key, 'name', p.name, 'status', 'open', 'requested_at', v_at);
end $$;

create or replace function app.marketplace_request_cancel(p_center uuid, p_product text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.marketplace_products; v_id uuid;
begin
  perform app._marketplace_settings_manager(p_center, 'Cancelling a product request');
  select * into p from app.marketplace_products where key = p_product;
  if p.key is null then raise exception 'There is no product called "%".', p_product; end if;
  perform app.set_audit_context('Request for ' || p.name || ' cancelled');
  update app.marketplace_requests r
     set status = 'cancelled', closed_by = auth.uid(), closed_at = now(), close_note = 'Cancelled by the community.'
   where r.center_id = p_center and r.product_key = p.key and r.status = 'open'
  returning r.id into v_id;
  if v_id is null then raise exception 'There is no open request for % to cancel.', p.name; end if;
  return jsonb_build_object('id', v_id, 'product', p.key, 'name', p.name, 'status', 'cancelled');
end $$;

create or replace function app.marketplace_notify_me(p_center uuid, p_product text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.marketplace_products; v_at timestamptz;
begin
  perform app._marketplace_settings_manager(p_center, 'Asking to be told when a product is ready');
  select * into p from app.marketplace_products where key = p_product;
  if p.key is null then raise exception 'There is no product called "%".', p_product; end if;
  if p.status <> 'not_built' then raise exception '% is ready now. Request it instead.', p.name; end if;
  if p.module_key is not null and app.module_availability(p_center, p.module_key) = 'not_available' then
    raise exception '% is not part of a % organization.', p.name,
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this');
  end if;
  perform app.set_audit_context('Asked to be told when ' || p.name || ' is ready');
  insert into app.marketplace_interest (center_id, product_key, requested_by) values (p_center, p.key, auth.uid())
  on conflict (center_id, product_key) do nothing;
  select i.created_at into v_at from app.marketplace_interest i where i.center_id = p_center and i.product_key = p.key;
  return jsonb_build_object('product', p.key, 'name', p.name, 'notified_at', v_at);
end $$;

-- ── 5. Weaver: open requests, the switch, the audit log ──────────────────────
create or replace function app.marketplace_open_requests()
returns table (id uuid, center_id uuid, center_name text, center_slug text, product_key text, product_name text, note text,
               requested_at timestamptz, requested_by_name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can see every community''s product requests.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.id, r.center_id, c.name::text, c.slug::text, r.product_key, p.name, r.note, r.requested_at,
         app._marketplace_person(r.center_id, r.requested_by, true)
    from app.marketplace_requests r
    join app.centers c on c.id = r.center_id
    join app.marketplace_products p on p.key = r.product_key
   where r.status = 'open'
   order by r.requested_at, r.id;
end $$;

insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('marketplace_product_on', 'email', '{{product}} is on for {{center_name}}',
   E'Hello,\n\nThe Weaver team turned on {{product}} for {{center_name}}.\n\nReason: {{reason}}\n\nYour administrators can pause and resume it in Settings › Marketplace. Pausing never deletes anything.\n\nThe Weaver team'),
  ('marketplace_product_off', 'email', '{{product}} is off for {{center_name}}',
   E'Hello,\n\nThe Weaver team turned off {{product}} for {{center_name}}.\n\nReason: {{reason}}\n\nNothing was deleted: turning it on again brings everything back. An administrator can request it again in Settings › Marketplace.\n\nThe Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- Turn a product on or off for a community. Returns 0740's answer {module, label, granted, paused, enabled} plus the product,
-- whether an open request was marked done, and whether the emails were queued.
create or replace function app.marketplace_set_product(p_center uuid, p_product text, p_on boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.marketplace_products; v_reason text := app.audit_clean_reason(p_reason); v_dep text; v_result jsonb;
        v_requester uuid; v_had_request boolean; v_center app.centers; v_to text; v_mail jsonb; v_sent text[] := '{}';
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can turn a product on or off for a community.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_center from app.centers where id = p_center;
  if v_center.id is null then raise exception 'That community was not found.'; end if;
  select * into p from app.marketplace_products where key = p_product;
  if p.key is null then raise exception 'There is no product called "%".', p_product; end if;
  if p.module_key is null then raise exception '% is not built yet, so it cannot be turned on or off.', p.name; end if;
  if p_on is null then raise exception 'Choose whether to turn % on or off.', p.name; end if;
  if v_reason is null then
    raise exception 'Give a reason for turning % %. It goes in the audit log.', p.name, case when p_on then 'on' else 'off' end;
  end if;
  if p_on then
    select app._module_label(p_center, ch.k) into v_dep
      from unnest(app._module_chain(p.module_key)) with ordinality as ch(k, n)
     where ch.k <> p.module_key and not app.module_enabled(p_center, ch.k)
     order by ch.n limit 1;
    if v_dep is not null then raise exception '% is off for this community. Turn it on first.', v_dep; end if;
  end if;
  select r.requested_by, true into v_requester, v_had_request
    from app.marketplace_requests r where r.center_id = p_center and r.product_key = p.key and r.status = 'open';

  -- 0740: platform admins only, a reason, a fresh 2FA check ('platform.module_grant'), audited.
  v_result := app.set_module_grant(p_center, p.module_key, p_on, v_reason);

  for v_to in
    select distinct lower(u.email)
      from auth.users u
     where u.email is not null
       and (u.id = v_requester or u.id in (select o.user_id from app.center_owners o where o.center_id = p_center))
  loop
    v_mail := app.platform_send_message(v_to, case when p_on then 'marketplace_product_on' else 'marketplace_product_off' end,
                jsonb_build_object('product', p.name, 'center_name', v_center.name, 'reason', v_reason), 'notification');
    v_sent := v_sent || app.message_status_text(v_mail);
  end loop;

  return v_result || jsonb_build_object(
    'product', p.key, 'name', p.name,
    'request_done', p_on and coalesce(v_had_request, false),
    'email_status', case when cardinality(v_sent) = 0 then 'no_recipient' else array_to_string(v_sent, ', ') end,
    'emailed', cardinality(v_sent) > 0 and not exists (select 1 from unnest(v_sent) s where s <> 'queued'));
end $$;

-- The product changes of one community, newest first, in words: who, what, why.
create or replace function app.marketplace_audit(p_center uuid, p_limit int default 50)
returns table (at timestamptz, actor text, what text, why text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can read a community''s product history.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with a as (
    select l.id, l.occurred_at, l.actor_user_id, l.action, l.record_table, l.reason, coalesce(l.after, l.before) as row_now,
           l.before, l.after
      from app.audit_log l
     where l.center_id = p_center
       and l.record_table in ('center_module_grants', 'center_modules', 'marketplace_requests', 'marketplace_interest')
  ), named as (
    select a.*, pr.name as product,
           coalesce(app._marketplace_person(p_center, a.actor_user_id, true), 'Weaver') as who
      from a
      join app.marketplace_products pr
        on (a.record_table in ('marketplace_requests', 'marketplace_interest') and pr.key = a.row_now->>'product_key')
        or (a.record_table in ('center_module_grants', 'center_modules') and pr.module_key = a.row_now->>'module_key')
  )
  select n.occurred_at, n.who,
         case n.record_table
           when 'center_module_grants' then
             case when n.actor_user_id is null and (n.row_now->>'reason') = app._ai_trial_reason() then n.product || ' trial started (sandbox)'
                  when n.actor_user_id is null and (n.row_now->>'reason') = app._ai_trial_ended_reason() then n.product || ' trial ended (went live)'
                  when n.actor_user_id is null then n.product || ' included by a migration'
                  when (n.row_now->>'granted')::boolean then n.who || ' turned on ' || n.product
                  else n.who || ' turned off ' || n.product end
           when 'center_modules' then
             n.who || case when (n.row_now->>'enabled')::boolean then ' resumed ' else ' paused ' end || n.product
           when 'marketplace_requests' then
             case when n.action like '%.insert' then n.who || ' requested ' || n.product
                  when (n.row_now->>'status') = 'cancelled' then n.who || ' cancelled the request for ' || n.product
                  when (n.row_now->>'status') = 'done' then 'The request for ' || n.product || ' was marked done'
                  else n.who || ' changed the request for ' || n.product end
           else n.who || ' asked to be told when ' || n.product || ' is ready' end,
         case when n.record_table = 'marketplace_requests' and n.action like '%.insert' then 'Note: ' || coalesce(n.row_now->>'note', '')
              when n.record_table = 'center_module_grants' then 'Reason: ' || coalesce(n.row_now->>'reason', n.reason, 'none given')
              when n.reason is not null then 'Reason: ' || n.reason
              else '' end
    from named n
   order by n.occurred_at desc, n.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

-- ── 6. Grants ────────────────────────────────────────────────────────────────
revoke execute on function app.center_module_grants_close_requests(), app.marketplace_products_ready_notice(), app._marketplace_person(uuid, uuid, boolean),
  app._marketplace_grant_source(uuid, text), app._marketplace_settings_manager(uuid, text) from public, anon, authenticated;
grant execute on function app._marketplace_person(uuid, uuid, boolean), app._marketplace_grant_source(uuid, text) to service_role;
revoke execute on function app.marketplace_states(uuid), app.marketplace_request(uuid, text, text),
  app.marketplace_request_cancel(uuid, text), app.marketplace_notify_me(uuid, text), app.marketplace_open_requests(),
  app.marketplace_set_product(uuid, text, boolean, text), app.marketplace_audit(uuid, int) from public, anon;
grant execute on function app.marketplace_states(uuid), app.marketplace_request(uuid, text, text),
  app.marketplace_request_cancel(uuid, text), app.marketplace_notify_me(uuid, text), app.marketplace_open_requests(),
  app.marketplace_set_product(uuid, text, boolean, text), app.marketplace_audit(uuid, int) to authenticated, service_role;
