-- 0800 · Communications: copy a communication as a new draft, and saved templates (owner request 2026-10-14).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Nothing is sent by this migration, and nothing in it can send anything. A copy and a template are only words.
--
--   A. A draft that is not waiting for anyone. Until now a saved communication was always "Awaiting approval" (status draft): the
--      person who wrote it had pressed "Send for approval". A copy has to be a draft that nobody can approve yet, so it gets its own
--      status, working_draft ("Draft · not sent for approval"). Nothing approves, schedules or cancels-by-approval a working draft:
--      the approval screens, the Home tasks and the approve command all look for draft and pending_approval only. The person who
--      owns it edits it in the composer and, when it is ready, sends it for approval (draft) or, with comms.approve, schedules it.
--
--   B. app.copy_campaign_as_draft(center, campaign, name?): a NEW working draft in the same community with the same kind, name
--      ("Copy of <name>" unless a name is given), subject, message (merge fields such as {{recipient_first_name}} stay as written),
--      translations, channels, audience and saved-segment link. It carries nothing that is a state or a result: no schedule, no
--      sent time, no recipient or open counts, no approvals; the second-approver flag is worked out again from the audience. It
--      never queues a message. Alerts and surveys are not copied here.
--
--   C. app.comms_templates: a community's saved templates (name, channels, subject, message, translations, who and when). Not the
--      audience and not any statistic. They are starting points for the words only: a WhatsApp template saved here is NOT a
--      template approved by WhatsApp (those are submitted in Settings > WhatsApp, app.whatsapp_template_submissions). The automatic
--      and transactional wording (app.message_templates, app.receipt_templates) is a different thing and is not touched.
--      Written only by the functions below; read with comms.send (the permission that writes a communication).
--
--   D. app.save_campaign_as_template(center, campaign, name?), app.create_campaign_from_template(center, template, name?) (a new
--      working draft with NO audience: the person chooses who it goes to), app.rename_comms_template(center, template, name) and
--      app.delete_comms_template(center, template). Each needs comms.send in the community and Communications on. A name is 1-120
--      characters and unique within the community (capitals and spaces at the ends do not count).
--
--   The screen /comms/templates is registered for the activity stream. Test 800.
set client_min_messages = warning;

-- ══ A. The status ═════════════════════════════════════════════════════════════
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'app.comms_campaigns'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%pending_approval%' loop
    execute format('alter table app.comms_campaigns drop constraint %I', c.conname);
  end loop;
end $$;
alter table app.comms_campaigns add constraint comms_campaigns_status_check
  check (status in ('draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'cancelled', 'working_draft'));
comment on column app.comms_campaigns.status is
  'draft = sent for approval (shown as "Awaiting approval"); pending_approval = waiting for a second approver; scheduled / sending / sent; cancelled; working_draft (0800) = being written, not sent for approval, nobody can approve it yet.';

-- ══ C. Saved templates ════════════════════════════════════════════════════════
create table if not exists app.comms_templates (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  name         text not null constraint comms_templates_name_check check (char_length(btrim(name)) between 1 and 120),
  channels     app.channel[] not null constraint comms_templates_channels_check check (cardinality(channels) >= 1),
  title        text not null default '',
  body_md      text not null default '',
  translations jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) default auth.uid(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists comms_templates_name_idx on app.comms_templates (center_id, lower(btrim(name)));
create index if not exists comms_templates_center_idx on app.comms_templates (center_id, updated_at desc);
comment on table app.comms_templates is
  'A community''s saved communication templates (0800): the words only (subject = title, message = body_md, translations, channels), never an audience or a statistic. A WhatsApp template here is a local starting point, not one approved by WhatsApp. Written by app.save_campaign_as_template / rename_comms_template / delete_comms_template only; read with comms.send.';
comment on column app.comms_templates.title is 'The subject line.';

drop trigger if exists stamp_comms_templates on app.comms_templates;
create trigger stamp_comms_templates before insert or update on app.comms_templates
  for each row execute function app.stamp_updated_by();
drop trigger if exists audit_comms_templates on app.comms_templates;
create trigger audit_comms_templates after insert or update or delete on app.comms_templates
  for each row execute function app.audit_row();

insert into app.module_tables (table_name, module_key) values ('comms_templates', 'comms')
on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.comms_templates enable row level security;
drop policy if exists comms_templates_read on app.comms_templates;
create policy comms_templates_read on app.comms_templates for select to authenticated
  using (app.has_permission(center_id, 'comms.send'));
-- No direct writes: every change goes through the functions below, which say in words why they refuse.
revoke all on app.comms_templates from public, anon, authenticated;
grant select on app.comms_templates to authenticated;
grant all on app.comms_templates to service_role;

-- The module switch for the table (the same generated policy as 0103).
do $$
declare v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''comms''))::uuid[]))';
begin
  execute 'drop policy if exists module_switch on app.comms_templates';
  execute format('create policy module_switch on app.comms_templates as restrictive for all to public using (%s) with check (%s)', v_qual, v_qual);
end $$;

-- ══ Who may write ═════════════════════════════════════════════════════════════
-- comms.send in this community, Communications on. p_doing finishes "You do not have permission to ...".
create or replace function app._comms_require_writer(p_center uuid, p_doing text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  if p_center is null then
    raise exception 'Choose the community first.' using errcode = '22023';
  end if;
  if not app.has_permission(p_center, 'comms.send') then
    raise exception 'You do not have permission to % (it needs comms.send).', p_doing using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'comms');
end $$;
revoke execute on function app._comms_require_writer(uuid, text) from public, anon, authenticated;

-- A template name: trimmed, 1-120 characters, one per community (case and end spaces do not count).
create or replace function app._comms_template_name(p_center uuid, p_name text, p_except uuid default null) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v text := left(btrim(coalesce(p_name, '')), 120);
begin
  if char_length(v) < 1 then
    raise exception 'Give the template a name.' using errcode = '22023';
  end if;
  if exists (select 1 from app.comms_templates t
              where t.center_id = p_center and lower(btrim(t.name)) = lower(v) and (p_except is null or t.id <> p_except)) then
    raise exception 'a saved template called "%" already exists. Choose a different name.', v using errcode = '23505';
  end if;
  return v;
end $$;
revoke execute on function app._comms_template_name(uuid, text, uuid) from public, anon, authenticated;

-- ══ B. Copy as a new draft ════════════════════════════════════════════════════
create or replace function app.copy_campaign_as_draft(p_center uuid, p_campaign uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.comms_campaigns;
  v_name text;
  v_id uuid;
begin
  perform app._comms_require_writer(p_center, 'copy a communication');
  select * into c from app.comms_campaigns x where x.id = p_campaign and x.center_id = p_center;
  if c.id is null then
    raise exception 'that communication was not found in this community.' using errcode = 'P0002';
  end if;
  if c.kind in ('alert', 'survey') then
    raise exception 'alerts and surveys cannot be copied here.' using errcode = '22023';
  end if;
  v_name := coalesce(nullif(left(btrim(coalesce(p_name, '')), 200), ''),
                     left('Copy of ' || coalesce(nullif(btrim(c.name), ''), c.title), 200));
  insert into app.comms_campaigns
    (center_id, kind, name, title, body_md, translations, channels, audience, saved_segment_id, status, requires_second_approver, created_by)
  values
    (c.center_id, c.kind, v_name, c.title, c.body_md, c.translations, c.channels, c.audience, c.saved_segment_id, 'working_draft',
     coalesce((c.audience->>'all_members')::boolean, false), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.copy_campaign_as_draft(uuid, uuid, text) from public, anon;
grant execute on function app.copy_campaign_as_draft(uuid, uuid, text) to authenticated;
comment on function app.copy_campaign_as_draft(uuid, uuid, text) is
  'A new working draft with the same kind, subject, message, translations, channels and audience as a communication, named "Copy of <name>"; no schedule, sent time, counts or approvals. comms.send, Communications on (0800).';

-- ══ D. Save, start from, rename, delete ═══════════════════════════════════════
create or replace function app.save_campaign_as_template(p_center uuid, p_campaign uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.comms_campaigns;
  v_name text;
  v_id uuid;
begin
  perform app._comms_require_writer(p_center, 'save a template');
  select * into c from app.comms_campaigns x where x.id = p_campaign and x.center_id = p_center;
  if c.id is null then
    raise exception 'that communication was not found in this community.' using errcode = 'P0002';
  end if;
  if c.kind in ('alert', 'survey') then
    raise exception 'alerts and surveys cannot be saved as templates.' using errcode = '22023';
  end if;
  v_name := app._comms_template_name(p_center, coalesce(nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(c.name), ''), c.title));
  insert into app.comms_templates (center_id, name, channels, title, body_md, translations)
  values (c.center_id, v_name, c.channels, c.title, coalesce(c.body_md, ''), c.translations)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.save_campaign_as_template(uuid, uuid, text) from public, anon;
grant execute on function app.save_campaign_as_template(uuid, uuid, text) to authenticated;
comment on function app.save_campaign_as_template(uuid, uuid, text) is
  'Saves a communication''s words (subject, message, translations, channels) as a community template; never its audience or statistics. comms.send, Communications on (0800).';

create or replace function app.create_campaign_from_template(p_center uuid, p_template uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  t app.comms_templates;
  v_id uuid;
begin
  perform app._comms_require_writer(p_center, 'start from a template');
  select * into t from app.comms_templates x where x.id = p_template and x.center_id = p_center;
  if t.id is null then
    raise exception 'that template was not found in this community.' using errcode = 'P0002';
  end if;
  -- No audience: the person chooses who it goes to. It is a working draft, so nobody can approve it before they do.
  insert into app.comms_campaigns (center_id, kind, name, title, body_md, translations, channels, audience, status, requires_second_approver, created_by)
  values (t.center_id, 'newsletter', coalesce(nullif(left(btrim(coalesce(p_name, '')), 200), ''), left(t.name, 200)), t.title, t.body_md, t.translations,
          t.channels, '{}'::jsonb, 'working_draft', false, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_campaign_from_template(uuid, uuid, text) from public, anon;
grant execute on function app.create_campaign_from_template(uuid, uuid, text) to authenticated;
comment on function app.create_campaign_from_template(uuid, uuid, text) is
  'A new working draft from a saved template: its subject, message, translations and channels, and no audience. comms.send, Communications on (0800).';

create or replace function app.rename_comms_template(p_center uuid, p_template uuid, p_name text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text;
begin
  perform app._comms_require_writer(p_center, 'rename a template');
  if not exists (select 1 from app.comms_templates x where x.id = p_template and x.center_id = p_center) then
    raise exception 'that template was not found in this community.' using errcode = 'P0002';
  end if;
  v_name := app._comms_template_name(p_center, p_name, p_template);
  update app.comms_templates set name = v_name where id = p_template and center_id = p_center;
end $$;
revoke execute on function app.rename_comms_template(uuid, uuid, text) from public, anon;
grant execute on function app.rename_comms_template(uuid, uuid, text) to authenticated;
comment on function app.rename_comms_template(uuid, uuid, text) is
  'Renames a saved template; the name is unique within the community. comms.send, Communications on (0800).';

create or replace function app.delete_comms_template(p_center uuid, p_template uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app._comms_require_writer(p_center, 'delete a template');
  delete from app.comms_templates where id = p_template and center_id = p_center;
  if not found then
    raise exception 'that template was not found in this community. It may already be deleted.' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function app.delete_comms_template(uuid, uuid) from public, anon;
grant execute on function app.delete_comms_template(uuid, uuid) to authenticated;
comment on function app.delete_comms_template(uuid, uuid) is
  'Deletes a saved template. Communications already made from it are not touched. comms.send, Communications on (0800).';

-- ══ The screen, in the activity allowlist ═════════════════════════════════════
select app.activity_register('screen:/comms/templates', 'screen', 'portal', 'Saved templates', null);
