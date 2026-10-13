-- 0750 · Marketplace packs, part 1 of 4: five products as modules, off for every kind, Niva behind iWeaver, grandfathered by use
-- (docs/MARKETPLACE_PACKS.md sections 1, 2 and 5; docs/WECARE.md section 4; docs/CATCH_THE_MATCH.md slice 1; owner answers of
-- 2026-10-13; review of PR 234).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Five Marketplace products join the module catalog. Each key is neutral and never changes; the label is the product's name
--   and can change at any time (P6: installed member apps ignore keys they do not know, and treat a known key that disappears
--   as on, so a key is never renamed or split):
--
--     ai         iWeaver           depends on nothing   every AI feature except AI used in onboarding (Niva, AI flyer art)
--     website    WeaverSite        People               the organization's website draft (0642); publishing comes later
--     channels   CommunityConnect  Communications       WhatsApp Business messages; Facebook and Instagram come later
--     care       WeCare            People               not built yet ("Member care" for faith kinds, "Donor care" otherwise)
--     matching   CatchTheMatch     Giving               not built yet
--
--   P5: every kind of organization starts each of them OFF (default_off). The 0594 trigger gives a new module default_on for a
--   Jain Center; this file sets default_off for every kind right after, so a new community has none of them until a platform
--   admin grants it (app.set_module_grant, 0740: a reason and a fresh 2FA check, audited).
--
--   Niva sits behind iWeaver: niva.depends_on becomes {content, ai}. 0740's module_enabled walks the chain, so where iWeaver is
--   off Niva reads off everywhere (RLS, RPC guards, my_modules, member_experience) and installed member apps hide it with no
--   release.
--
-- GRANDFATHERED BY ACTUAL USE (section 5; app._marketplace_grandfather). EVERY community keeps what it uses, a sandbox too
-- (use beats sandbox status, so a sandbox that uses a product keeps it through promotion and an in-place go-live):
--   ai        AI was used (app._marketplace_ai_use): a Niva question in the last 90 days (niva_conversations), Niva for admins
--             switched on (centers.rules.assistant.enabled), an explicit choice about Niva by the community itself (a
--             center_modules row for niva, switched on OR paused, so resuming it still works), or AI flyer art in the last 90
--             days (a finished events.generate_flyer job, or an event whose flyer is AI art). The kind's default (Niva starts
--             on for a Jain Center) is NOT use.
--   channels  a WhatsApp Business account is recorded
--   website   a website draft exists
--   Each grant is a 0740 grant row with no granted_by, is_trial false and a reason that starts "Grandfathered (0750)".
--
-- WHO SEES A CHANGE (exactly): Niva turns OFF in every community that had Niva on, used no AI by the rule above, and is not
--   an open sandbox (an open sandbox with no use keeps Niva through the trial). Each such community gets an audit entry 'marketplace.niva_off' (with the reason), and
--   the migration prints their web names. Nothing else that any community sees changes: every other module is on and off
--   exactly as before, open sandboxes keep Niva through the trial below, and the new modules are on only where granted.
--   (WhatsApp Business, the website draft and AI flyer art can no longer be STARTED where the product is not held: 0751 and the
--   AI gate.)
--
-- SANDBOXES WITH NO USE GET AN iWEAVER TRIAL (section 5; owner answer 4):
--   every open sandbox (demo communities included) that did not earn the grandfathered grant above gets iWeaver as a trial
--   (is_trial = true), and so does every sandbox created from now on (a trigger on app.centers). The trial never reaches production: promotion copies a community's grants (0740),
--   and a trial row arriving at a community that is not a sandbox arrives turned off; a sandbox that goes live in place has
--   its trial turned off. The row then says, in plain words, that iWeaver was a trial and can be requested in Settings ›
--   Marketplace, and the community's owner (and whoever promoted it) gets an email saying the same when the promotion finishes.
--   A trial is marked by the column is_trial, never by its reason; a platform admin's own grant (granted_by set) is never one.
--
-- CHECKED, FAIL-CLOSED (app._marketplace_0750_problems): what is on for every community and module is recorded before anything
-- changes and compared at the end with the INTENDED new state: every module that existed before is unchanged, except Niva,
-- which is on exactly where it was on and iWeaver is now held (by use, or as an open sandbox's trial); iWeaver, WeaverSite and
-- CommunityConnect are on exactly where use (or the trial) says; WeCare and CatchTheMatch are off everywhere. If anything
-- differs the migration stops with the list and nothing changes.
set client_min_messages = warning;

-- ── 0. What is on before anything changes (a session setting: the file may run as one transaction or statement by statement)
do $$
begin
  perform set_config('app.m0750_on_before', app._module_on_snapshot()::text, false);
end $$;

-- ── 1. The catalog ───────────────────────────────────────────────────────────
-- Sorts after the 18 contract modules (Governance is 18), in the order the Marketplace lists them.
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('ai', 'iWeaver',
   'Every AI feature except AI used in onboarding: Niva for members and staff, and AI flyer art for events. It runs on Weaver''s own AI keys.',
   false, '{}', 19),
  ('website', 'WeaverSite',
   'The organization''s website built from what Weaver knows: the website draft, its pages and blocks, and the private preview. Reading the current website at Setup stays part of the core platform.',
   false, '{people}', 20),
  ('channels', 'CommunityConnect',
   'WhatsApp Business messages: the account, its templates and sending. WhatsApp group links stay in Communications. Facebook and Instagram posts for events are not built yet.',
   false, '{comms}', 21),
  ('care', 'WeCare',
   'Donor care and member care: a care plan from the mission, relationship owners, touches and a thank-you for every gift. Not built yet.',
   false, '{people}', 22),
  ('matching', 'CatchTheMatch',
   'Employer and grant matching for the gifts the organization receives, filed by Weaver''s team. Not built yet.',
   false, '{giving}', 23)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;

-- ── 2. Off for every kind (P5), and WeCare named by the kind ────────────────────
-- The 0594 trigger has just given every kind a row for each: default_on for a Jain Center, default_off for the others.
update app.category_modules set availability = 'default_off'
 where module_key in ('ai', 'website', 'channels', 'care', 'matching') and availability <> 'default_off';

-- "Member care" for a faith kind, "Donor care" for every other kind (non-profit and civic). An experience added later with
-- app.add_experience copies its parent's row, label included (0600).
update app.category_modules cm
   set label = case when k.faith_based then 'Member care' else 'Donor care' end
  from app.organization_categories k
 where k.key = cm.category_key and cm.module_key = 'care';

-- ── 3. Trials are marked by a column ─────────────────────────────────────────
alter table app.center_module_grants add column if not exists is_trial boolean not null default false;
comment on column app.center_module_grants.is_trial is
  'A sandbox''s iWeaver trial (0750): granted while the community is a sandbox, turned off (and kept as the record) when it is promoted. A grant a platform admin makes (granted_by set) is never a trial.';

-- A person's grant (app.set_module_grant sets granted_by) is never a trial, whatever the row was before.
create or replace function app.center_module_grants_trial_mark() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.granted_by is not null then new.is_trial := false; end if;
  return new;
end $$;
drop trigger if exists center_module_grants_trial_mark on app.center_module_grants;
create trigger center_module_grants_trial_mark before insert or update on app.center_module_grants
  for each row execute function app.center_module_grants_trial_mark();

create or replace function app._ai_trial_reason() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'Sandbox trial (0750): iWeaver is on while this community is a sandbox.'::text
$$;
create or replace function app._ai_trial_ended_reason() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'iWeaver was a trial while this community was a sandbox, and the trial does not carry over when it is promoted. An administrator can request iWeaver in Settings › Marketplace.'::text
$$;

-- ── 4. Use ───────────────────────────────────────────────────────────────────
-- Why a community counts as using AI (the first reason that applies), or null when it does not. Read at the moment of the
-- call, so the migration reads it before anything changes and the check at the end reads the same answer.
create or replace function app._marketplace_ai_use(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when exists (select 1 from app.niva_conversations n where n.center_id = p_center and n.created_at >= now() - interval '90 days')
      then 'Grandfathered (0750): Niva answered questions for this community in the 90 days before the Marketplace packs began.'
    when exists (select 1 from app.centers c where c.id = p_center and (c.rules #>> '{assistant,enabled}') = 'true')
      then 'Grandfathered (0750): Niva for admins was switched on for this community when the Marketplace packs began.'
    when exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = 'niva')
      then 'Grandfathered (0750): this community had switched Niva on or paused it itself when the Marketplace packs began.'
    when exists (select 1 from app.jobs j where j.center_id = p_center and j.kind = 'events.generate_flyer' and j.status = 'done'
                    and coalesce(j.finished_at, j.created_at) >= now() - interval '90 days')
      or exists (select 1 from app.events e where e.center_id = p_center and e.flyer_source = 'ai'
                    and e.flyer_generated_at >= now() - interval '90 days')
      then 'Grandfathered (0750): AI flyer art was made for this community in the 90 days before the Marketplace packs began.'
  end
$$;

-- An open sandbox (not promoted yet): with no use, it holds iWeaver as a trial.
create or replace function app._marketplace_open_sandbox(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c where c.id = p_center and c.environment = 'sandbox' and c.sandbox_for is null)
$$;

-- ── 5. Grandfathered by use ──────────────────────────────────────────────────
-- Grants iWeaver, CommunityConnect and WeaverSite to every community (a sandbox too) where they are used, with the reason that
-- says why. Existing rows are left alone. Returns the number of rows added.
create or replace function app._marketplace_grandfather() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer := 0; k integer;
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at, is_trial)
  select u.id, 'ai', true, u.why, null, now(), false
    from (select c.id, app._marketplace_ai_use(c.id) as why from app.centers c) u
   where u.why is not null
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at, is_trial)
  select w.center_id, 'channels', true,
         'Grandfathered (0750): this community had a WhatsApp Business account when the Marketplace packs began.', null, now(), false
    from app.whatsapp_accounts w
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at, is_trial)
  select s.center_id, 'website', true,
         'Grandfathered (0750): this community had a website draft when the Marketplace packs began.', null, now(), false
    from app.sites s
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Every open sandbox that holds no iWeaver row (no use earned it the grandfathered grant) gets the trial. Returns the number of
-- rows added.
create or replace function app._marketplace_sandbox_trial() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at, is_trial)
  select c.id, 'ai', true, app._ai_trial_reason(), null, now(), true
    from app.centers c
   where c.environment = 'sandbox' and c.sandbox_for is null
  on conflict (center_id, module_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 6. The check, and the record of who loses Niva ───────────────────────────
-- What differs from the intended new state, in words ('<web name>: <module> would be on|off'); empty when nothing does.
-- p_before is 0740's snapshot taken before this migration changed anything.
create or replace function app._marketplace_0750_problems(p_before text[]) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  with before as (select distinct unnest(coalesce(p_before, '{}'::text[])) as k),
       ai_held as (
         select c.id, (app._marketplace_ai_use(c.id) is not null or app._marketplace_open_sandbox(c.id)) as held
           from app.centers c),
       expected as (
         select c.id as center_id, m.key as module_key,
                case
                  when m.key = 'niva' then exists (select 1 from before b where b.k = c.id::text || ':niva') and a.held
                  when m.key = 'ai' then a.held
                  when m.key = 'website' then exists (select 1 from app.sites s where s.center_id = c.id)
                  when m.key = 'channels' then exists (select 1 from app.whatsapp_accounts w where w.center_id = c.id)
                                               and app.module_enabled(c.id, 'comms')
                  when m.key in ('care', 'matching') then false
                  else exists (select 1 from before b where b.k = c.id::text || ':' || m.key)
                end as want
           from app.centers c
           join ai_held a on a.id = c.id
           cross join app.modules m
          where not m.core)
  select coalesce(array_agg(c.slug::text || ': ' || e.module_key || case when e.want then ' would be off' else ' would be on' end
                            order by c.slug, e.module_key), '{}')
    from expected e
    join app.centers c on c.id = e.center_id
   where app.module_enabled(e.center_id, e.module_key) is distinct from e.want
$$;

-- The communities whose Niva goes off because they used no AI and are not open sandboxes (Niva was on before, iWeaver is not
-- held now): one audit entry
-- each, in the community's own log. Returns their web names.
create or replace function app._marketplace_record_niva_off(p_before text[]) returns text[]
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; v_names text[] := '{}';
begin
  for c in
    select x.id, x.slug::text as slug
      from app.centers x
     where (x.id::text || ':niva') = any (coalesce(p_before, '{}'::text[]))
       and not app.module_enabled(x.id, 'niva')
     order by x.slug
  loop
    perform app.log_audit(c.id, 'marketplace.niva_off', 'modules', 'niva', jsonb_build_object('enabled', true),
      jsonb_build_object('enabled', false),
      'Niva needs iWeaver since the Marketplace packs (0750), and this community used no AI in the 90 days before. Weaver can turn iWeaver on.');
    v_names := v_names || c.slug;
  end loop;
  return v_names;
end $$;

-- ── 7. Grant by use, then the trial, before Niva needs iWeaver ──────────────
do $$ begin perform app._marketplace_grandfather(); end $$;
do $$ begin perform app._marketplace_sandbox_trial(); end $$;

-- A sandbox created from now on (from a request, from the console, a demo community) starts with the trial.
create or replace function app.centers_ai_trial() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at, is_trial)
  values (new.id, 'ai', true, app._ai_trial_reason(), null, now(), true)
  on conflict (center_id, module_key) do nothing;
  return null;
end $$;
drop trigger if exists centers_ai_trial on app.centers;
create trigger centers_ai_trial after insert on app.centers
  for each row when (new.environment = 'sandbox') execute function app.centers_ai_trial();

-- Promotion copies the grants (0740, promotion_config_tables): a trial row arriving at a community that is not a sandbox
-- arrives turned off, with the reason that says so.
create or replace function app.center_module_grants_trial_rule() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.is_trial and new.granted
     and not exists (select 1 from app.centers c where c.id = new.center_id and c.environment = 'sandbox') then
    new.granted := false;
    new.reason := app._ai_trial_ended_reason();
    new.granted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists center_module_grants_trial_rule on app.center_module_grants;
create trigger center_module_grants_trial_rule before insert on app.center_module_grants
  for each row execute function app.center_module_grants_trial_rule();

-- A sandbox that goes live in place (0500) keeps its own rows: its trial is turned off when it leaves the sandbox.
create or replace function app.centers_ai_trial_end() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.center_module_grants
     set granted = false, reason = app._ai_trial_ended_reason(), granted_at = now()
   where center_id = new.id and module_key = 'ai' and is_trial and granted;
  return null;
end $$;
drop trigger if exists centers_ai_trial_end on app.centers;
create trigger centers_ai_trial_end after update of environment on app.centers
  for each row when (old.environment = 'sandbox' and new.environment is distinct from 'sandbox')
  execute function app.centers_ai_trial_end();

-- When a promotion finishes (either route) and the production community's trial ended, its owner (and whoever asked for
-- the promotion) gets an email in plain words; whether it was queued is kept on the promotion's result. The copy route leaves
-- the production community onboarding and the in-place route makes it live, so the words say what happened, not "live".
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('marketplace_trial_ended', 'email', 'iWeaver was a trial while {{center_name}} was a sandbox',
   E'Hello,\n\n{{center_name}} has moved from its sandbox to production. While it was a sandbox, iWeaver (Niva for members and staff, and AI flyer art) was on as a trial. The trial does not carry over, so those features are off now. Nothing was deleted.\n\nTo keep using iWeaver, an administrator can request it in Settings › Marketplace. The Weaver team checks the request and turns it on.\n\nThe Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

create or replace function app.sandbox_promotions_trial_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text; v_to text; v_mail jsonb; v_sent text[] := '{}';
begin
  if new.production_id is null or not exists (
       select 1 from app.center_module_grants g
        where g.center_id = new.production_id and g.module_key = 'ai' and g.is_trial and not g.granted) then
    return null;
  end if;
  select c.name into v_name from app.centers c where c.id = new.production_id;
  for v_to in
    select distinct lower(u.email)
      from auth.users u
     where u.email is not null
       and (u.id = new.requested_by or u.id in (select o.user_id from app.center_owners o where o.center_id = new.production_id))
  loop
    v_mail := app.platform_send_message(v_to, 'marketplace_trial_ended', jsonb_build_object('center_name', v_name), 'notification');
    v_sent := v_sent || app.message_status_text(v_mail);
  end loop;
  update app.sandbox_promotions
     set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('ai_trial_notice',
                    case when cardinality(v_sent) = 0 then 'no owner email to send to' else array_to_string(v_sent, ', ') end)
   where id = new.id;
  return null;
end $$;
drop trigger if exists sandbox_promotions_trial_notice on app.sandbox_promotions;
create trigger sandbox_promotions_trial_notice after update of status on app.sandbox_promotions
  for each row when (new.status = 'done' and old.status is distinct from 'done')
  execute function app.sandbox_promotions_trial_notice();

-- ── 8. Niva behind iWeaver ───────────────────────────────────────────────────
update app.modules set depends_on = '{content,ai}' where key = 'niva';

-- ── 9. The check, and the record ─────────────────────────────────────────────
do $$
declare v_before text[] := nullif(current_setting('app.m0750_on_before', true), '')::text[];
        v_problems text[]; v_off text[];
begin
  perform set_config('app.m0750_on_before', '', false);
  v_problems := app._marketplace_0750_problems(v_before);
  if cardinality(v_problems) > 0 then
    raise exception 'The Marketplace packs (0750) would not leave every community as intended: %. Nothing was changed.',
      array_to_string(v_problems, '; ');
  end if;
  v_off := app._marketplace_record_niva_off(v_before);
  raise warning 'Marketplace packs (0750): Niva is now off in % communities that used no AI in the last 90 days%',
    cardinality(v_off), case when cardinality(v_off) > 0 then ': ' || array_to_string(v_off, ', ') else '' end;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app._marketplace_grandfather(), app._marketplace_sandbox_trial(), app._ai_trial_reason(),
  app._ai_trial_ended_reason(), app._marketplace_ai_use(uuid), app._marketplace_open_sandbox(uuid),
  app._marketplace_0750_problems(text[]), app._marketplace_record_niva_off(text[]), app.centers_ai_trial(),
  app.center_module_grants_trial_rule(), app.center_module_grants_trial_mark(), app.centers_ai_trial_end(),
  app.sandbox_promotions_trial_notice() from public, anon, authenticated;
grant execute on function app._marketplace_grandfather(), app._marketplace_sandbox_trial(), app._ai_trial_reason(),
  app._ai_trial_ended_reason(), app._marketplace_ai_use(uuid), app._marketplace_open_sandbox(uuid),
  app._marketplace_0750_problems(text[]), app._marketplace_record_niva_off(text[]) to service_role;
