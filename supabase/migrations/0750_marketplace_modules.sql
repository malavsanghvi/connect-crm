-- 0750 · Marketplace packs, part 1 of 4: five products as modules, off for every kind, Niva behind iWeaver, grandfathered by use
-- (docs/MARKETPLACE_PACKS.md sections 1, 2 and 5; docs/WECARE.md section 4; docs/CATCH_THE_MATCH.md slice 1; owner answers of
-- 2026-10-13).
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
-- GRANDFATHERED BY USE (section 5; app._marketplace_grandfather): before anything changes, each community keeps what it uses.
--   ai        where Niva is granted (on, or paused by the community, so resuming it still works), or AI flyer art was made
--             for the community in the last 90 days
--   channels  where a WhatsApp Business account is recorded
--   website   where a website draft exists
--   Each grant is a 0740 grant row with no granted_by and a reason that starts "Grandfathered (0750)".
--
-- SANDBOXES GET AN iWEAVER TRIAL (section 5; owner answer 4):
--   every open sandbox that does not hold iWeaver already gets it as a trial, and so does every sandbox created from now on (a
--   trigger on app.centers). The trial never reaches production: promotion copies a community's grants (0740), and a trial row
--   copied to a production community arrives turned off; a sandbox that goes live in place has its trial turned off. Either way
--   the grant's reason says, in plain words, that iWeaver was a trial and can be requested in Settings › Marketplace, and the
--   community's owner gets an email saying the same when the promotion finishes.
--
-- CHECKED: what is on for every community and module is recorded before anything changes (0740's _module_on_snapshot) and
-- compared at the end: no module that existed before may change for any community, and each new module must be on exactly
-- where it was granted. If anything differs the migration stops with the list and nothing changes.
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

-- ── 3. Grandfathered by use ──────────────────────────────────────────────────
-- Grants iWeaver, CommunityConnect and WeaverSite to every community that uses them, with the reason that says why. Existing
-- rows are left alone. Returns the number of rows added. It reads nothing that depends on Niva's chain (only Niva's own
-- grant), so it gives the same answer before and after section 5.
create or replace function app._marketplace_grandfather() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer := 0; k integer;
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  select c.id, 'ai', true,
         case when app._module_granted(c.id, 'niva')
              then 'Grandfathered (0750): Niva was on for this community, or paused by it, when the Marketplace packs began.'
              else 'Grandfathered (0750): AI flyer art was made for this community in the 90 days before the Marketplace packs began.' end,
         null, now()
    from app.centers c
   where app._module_granted(c.id, 'niva')
      or exists (select 1 from app.jobs j where j.center_id = c.id and j.kind = 'events.generate_flyer' and j.status = 'done'
                    and coalesce(j.finished_at, j.created_at) >= now() - interval '90 days')
      or exists (select 1 from app.events e where e.center_id = c.id and e.flyer_source = 'ai'
                    and e.flyer_generated_at >= now() - interval '90 days')
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  select w.center_id, 'channels', true,
         'Grandfathered (0750): this community had a WhatsApp Business account when the Marketplace packs began.', null, now()
    from app.whatsapp_accounts w
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  select s.center_id, 'website', true,
         'Grandfathered (0750): this community had a website draft when the Marketplace packs began.', null, now()
    from app.sites s
  on conflict (center_id, module_key) do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

do $$ begin perform app._marketplace_grandfather(); end $$;

-- ── 4. The sandbox trial of iWeaver ──────────────────────────────────────────
-- The two reasons are the trial's markers: a trial grant is a row for 'ai' with no granted_by and exactly this reason (a
-- platform admin's own grant always has granted_by).
create or replace function app._ai_trial_reason() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'Sandbox trial (0750): iWeaver is on while this community is a sandbox.'::text
$$;
create or replace function app._ai_trial_ended_reason() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'iWeaver was a trial while this community was a sandbox, and the trial ended when it went live. An administrator can request iWeaver in Settings › Marketplace.'::text
$$;

-- Every open sandbox (not promoted yet) that holds no iWeaver row gets the trial. Returns the number of rows added.
create or replace function app._marketplace_sandbox_trial() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  select c.id, 'ai', true, app._ai_trial_reason(), null, now()
    from app.centers c
   where c.environment = 'sandbox' and c.sandbox_for is null
  on conflict (center_id, module_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin perform app._marketplace_sandbox_trial(); end $$;

-- A sandbox created from now on (from a request, from the console, a demo community) starts with the trial.
create or replace function app.centers_ai_trial() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  values (new.id, 'ai', true, app._ai_trial_reason(), null, now())
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
  if new.module_key = 'ai' and new.granted and new.granted_by is null and new.reason = app._ai_trial_reason()
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
   where center_id = new.id and module_key = 'ai' and granted and granted_by is null and reason = app._ai_trial_reason();
  return null;
end $$;
drop trigger if exists centers_ai_trial_end on app.centers;
create trigger centers_ai_trial_end after update of environment on app.centers
  for each row when (old.environment = 'sandbox' and new.environment is distinct from 'sandbox')
  execute function app.centers_ai_trial_end();

-- When a promotion finishes (either route) and the production community's trial ended, its owner (and whoever asked for
-- the promotion) gets an email in plain words; whether it was queued is kept on the promotion's result.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('marketplace_trial_ended', 'email', 'iWeaver was a trial while {{center_name}} was a sandbox',
   E'Hello,\n\n{{center_name}} is live. While it was a sandbox, iWeaver (Niva for members and staff, and AI flyer art) was on as a trial. The trial has ended, so those features are off now. Nothing was deleted.\n\nTo keep using iWeaver, an administrator can request it in Settings › Marketplace. The Weaver team checks the request and turns it on.\n\nThe Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

create or replace function app.sandbox_promotions_trial_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text; v_to text; v_mail jsonb; v_sent text[] := '{}';
begin
  if new.production_id is null or not exists (
       select 1 from app.center_module_grants g
        where g.center_id = new.production_id and g.module_key = 'ai' and not g.granted and g.reason = app._ai_trial_ended_reason()) then
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

-- ── 5. Niva behind iWeaver ───────────────────────────────────────────────────
update app.modules set depends_on = '{content,ai}' where key = 'niva';

-- ── 6. The check: nothing anyone sees has changed ──────────────────────────────
do $$
declare v_new constant text[] := array['ai', 'website', 'channels', 'care', 'matching'];
        v_diff text[]; v_bad text[];
begin
  -- Every module that existed before: on and off exactly as before, for every community.
  select coalesce(array_agg(d order by d), '{}') into v_diff
    from unnest(app._module_snapshot_diff(nullif(current_setting('app.m0750_on_before', true), '')::text[])) d
   where split_part(split_part(d, ': ', 2), ' ', 1) <> all (v_new);
  perform set_config('app.m0750_on_before', '', false);
  if cardinality(v_diff) > 0 then
    raise exception 'The Marketplace packs (0750) would change which modules are on: %. Nothing was changed.', array_to_string(v_diff, '; ');
  end if;
  -- Each new module: on exactly where it is granted (and, for CommunityConnect and CatchTheMatch, the module it needs is on).
  select array_agg(c.slug::text || ': ' || k.key || case when app.module_enabled(c.id, k.key) then ' would be on' else ' would be off' end
                   order by c.slug, k.key)
    into v_bad
    from app.centers c
    cross join unnest(v_new) as k(key)
   where app.module_enabled(c.id, k.key) is distinct from (
           exists (select 1 from app.center_module_grants g where g.center_id = c.id and g.module_key = k.key and g.granted)
           and (k.key <> 'channels' or app.module_enabled(c.id, 'comms'))
           and (k.key <> 'matching' or app.module_enabled(c.id, 'giving')));
  if v_bad is not null then
    raise exception 'The Marketplace packs (0750) would put a new module in the wrong state: %. Nothing was changed.', array_to_string(v_bad, '; ');
  end if;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app._marketplace_grandfather(), app._marketplace_sandbox_trial(), app._ai_trial_reason(),
  app._ai_trial_ended_reason(), app.centers_ai_trial(), app.center_module_grants_trial_rule(), app.centers_ai_trial_end(),
  app.sandbox_promotions_trial_notice() from public, anon, authenticated;
grant execute on function app._marketplace_grandfather(), app._marketplace_sandbox_trial(), app._ai_trial_reason(),
  app._ai_trial_ended_reason() to service_role;
