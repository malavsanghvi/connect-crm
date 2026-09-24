-- Onboarding (stream o-messaging) · 1 of 5: the tables behind email, texting,
-- WhatsApp and push (docs/ONBOARDING_PLAN.md §4 Step 1.3–1.6;
-- /home/user/wt/ONBOARDING_WAVE_B.md "Messaging (o-messaging)").
--
--   app.messaging_settings            per center: the email service (resend|postmark) and the
--                                     email footer (postal address + note; unsubscribe is added
--                                     by the sender on every non-transactional email)
--   app.email_domains                 sending domains with the DNS records the provider asks for
--   app.email_senders                 From / Reply-To per purpose (office, receipts, newsletters, auth)
--   app.message_suppressions          bounce / complaint / STOP / manual; lifted, never deleted
--   app.texting_registrations         US 10DLC brand + campaign, or toll-free verification: a record
--                                     with its status (the carrier's decision is relayed by Community
--                                     Connect; nothing here pretends to be approved)
--   app.whatsapp_accounts             the WhatsApp Business account and number (pending Meta)
--   app.whatsapp_template_submissions message templates submitted for Meta's approval
--   app.recipient_verifications       one-time codes that verify a sandbox test recipient (hash only)
--
-- Also: app.messages gains purpose / sandbox / provider / segments / job_id and may
-- be platform-level (center_id NULL: Community Connect's own emails, such as the
-- sandbox code); app.push_devices gains invalid_at (Expo said the token is dead —
-- the row is kept, never deleted); the built-in message templates are seeded.
--
-- Every table: RLS that only restricts (reads for the center's messaging staff,
-- writes only through the RPCs in 0221–0223), an audit_<table> trigger and a
-- module_tables row. Email and texting are core (sign-in needs them even when
-- Communications is off); the WhatsApp tables belong to `comms`.
set client_min_messages = warning;

-- ── Providers (the contract's list; o-payments owns 0210, which sets the same list) ──
do $$
begin
  alter table app.integration_connections drop constraint if exists integration_connections_provider_check;
  alter table app.integration_connections add constraint integration_connections_provider_check
    check (provider in ('quickbooks_online','stripe','neon_crm','whatsapp','twilio','sendgrid','resend','google_calendar','other',
                        'paypal','postmark','expo_push','intuit_sandbox'));
end $$;

-- ── Who may see and change messaging settings ────────────────────────────────
-- Existing keys only: settings.manage or integrations.manage (or the owner) change
-- them; comms.view / comms.send / integrations.view may look.
create or replace function app.messaging_can_manage(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and (app.has_permission(p_center, 'settings.manage') or app.has_permission(p_center, 'integrations.manage')
         or app.is_center_owner(p_center))
$$;
create or replace function app.messaging_can_view(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and (app.messaging_can_manage(p_center) or app.has_permission(p_center, 'comms.view')
         or app.has_permission(p_center, 'comms.send') or app.has_permission(p_center, 'integrations.view'))
$$;

-- ── messages: purpose, sandbox, platform-level rows ──────────────────────────
alter table app.messages alter column center_id drop not null;
alter table app.messages add column if not exists purpose text;
alter table app.messages add column if not exists sandbox boolean not null default false;
alter table app.messages add column if not exists provider text;
alter table app.messages add column if not exists segments int;
alter table app.messages add column if not exists job_id bigint;
alter table app.messages add column if not exists created_by uuid references auth.users(id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_purpose_check') then
    alter table app.messages add constraint messages_purpose_check
      check (purpose is null or purpose in ('auth_code','sandbox_code','verification_code','receipt','notification','campaign','test'));
  end if;
  alter table app.messages drop constraint if exists messages_status_check;
  alter table app.messages add constraint messages_status_check
    check (status in ('queued','sent','delivered','failed','suppressed','cancelled','bounced','complained'));
end $$;
create index if not exists messages_provider_ref_idx on app.messages (provider, provider_ref) where provider_ref is not null;
create index if not exists messages_platform_idx on app.messages (created_at desc) where center_id is null;
comment on column app.messages.purpose is
  'Why it was sent: auth_code, sandbox_code, verification_code, receipt, notification, campaign, test (app.enqueue_message).';
comment on column app.messages.sandbox is 'Sent by a sandbox: carries the "Sandbox · test data" banner / prefix.';

-- Platform-level messages (center_id NULL) are Community Connect's own; its team reads them.
drop policy if exists messages_platform_read on app.messages;
create policy messages_platform_read on app.messages for select to authenticated
  using (center_id is null and app.is_platform_admin());

-- ── push_devices: a dead token is marked, not deleted ────────────────────────
alter table app.push_devices add column if not exists invalid_at timestamptz;
alter table app.push_devices add column if not exists invalid_reason text;

-- ── messaging_settings ───────────────────────────────────────────────────────
create table if not exists app.messaging_settings (
  center_id             uuid primary key references app.centers(id) on delete cascade,
  email_provider        text not null default 'resend' check (email_provider in ('resend','postmark')),
  footer_postal_address text check (footer_postal_address is null or char_length(footer_postal_address) <= 300),
  footer_note           text check (footer_note is null or char_length(footer_note) <= 300),
  last_test_at          timestamptz,
  last_test_channel     text,
  last_test_status      text,
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now()
);
comment on table app.messaging_settings is
  'Per center: which email service sends (Resend or Postmark, O7) and the footer on every email (postal address; the unsubscribe line is added by the sender).';

-- ── email_domains ────────────────────────────────────────────────────────────
create table if not exists app.email_domains (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  domain             text not null check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  provider           text not null check (provider in ('resend','postmark')),
  provider_domain_id text,
  dns_records        jsonb not null default '[]'::jsonb,   -- [{type, name, value, purpose, status}]
  status             text not null default 'pending' check (status in ('pending','verified','failed')),
  last_checked_at    timestamptz,
  verified_at        timestamptz,
  last_error         text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (center_id, domain)
);
create index if not exists email_domains_due_idx on app.email_domains (status, last_checked_at);

-- ── email_senders ────────────────────────────────────────────────────────────
create table if not exists app.email_senders (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  purpose      text not null check (purpose in ('office','receipts','newsletters','auth')),
  from_name    text not null check (char_length(btrim(from_name)) between 1 and 100),
  from_address text not null check (from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  reply_to     text check (reply_to is null or reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  verified     boolean not null default false,             -- its domain is a verified email_domains row
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  unique (center_id, purpose)
);

-- ── message_suppressions ─────────────────────────────────────────────────────
create table if not exists app.message_suppressions (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,   -- NULL: Community Connect's own sender
  channel     text not null check (channel in ('email','sms','whatsapp','push')),
  address     text not null,
  reason      text not null check (reason in ('bounce','complaint','stop','manual')),
  detail      text,
  message_id  uuid references app.messages(id) on delete set null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   uuid references auth.users(id),
  lift_reason text
);
create unique index if not exists message_suppressions_active_idx
  on app.message_suppressions (coalesce(center_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, address)
  where lifted_at is null;
comment on table app.message_suppressions is
  'Addresses that must not be messaged: bounces and complaints (provider webhooks), STOP (texting), or added by staff. Lifting sets lifted_at; nothing is deleted.';

-- ── texting_registrations ────────────────────────────────────────────────────
create table if not exists app.texting_registrations (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  kind          text not null check (kind in ('10dlc','toll_free')),
  brand_id      text,
  campaign_id   text,
  status        text not null default 'draft' check (status in ('draft','submitted','in_review','approved','rejected')),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  detail        jsonb not null default '{}'::jsonb,   -- legal_name, ein, use_case, samples[], opt_in, from_number, messaging_service_sid, reviewer_note
  submitted_by  uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  unique (center_id, kind)
);

-- ── WhatsApp ─────────────────────────────────────────────────────────────────
create table if not exists app.whatsapp_accounts (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null unique references app.centers(id) on delete cascade,
  waba_id          text,
  phone_number_id  text,
  display_name     text,
  status           text not null default 'not_started'
                     check (status in ('not_started','pending_meta','approved','rejected')),
  detail           jsonb not null default '{}'::jsonb,   -- phone_e164, business_verification, reviewer_note
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

create table if not exists app.whatsapp_template_submissions (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  name             text not null check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512),
  language         text not null default 'en',
  category         text not null check (category in ('utility','marketing','authentication')),
  body             text not null check (char_length(body) between 1 and 1024),
  status           text not null default 'pending_meta' check (status in ('pending_meta','approved','rejected')),
  meta_template_id text,
  rejection_reason text,
  submitted_by     uuid references auth.users(id),
  submitted_at     timestamptz not null default now(),
  decided_at       timestamptz,
  unique (center_id, name, language)
);

-- ── Sandbox test-recipient verification codes (the hash only) ────────────────
create table if not exists app.recipient_verifications (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  recipient_id  uuid not null references app.sandbox_test_recipients(id) on delete cascade,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  message_id    uuid references app.messages(id) on delete set null,
  sent_by       uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users(id)
);
create index if not exists recipient_verifications_recipient_idx on app.recipient_verifications (recipient_id, created_at desc);

-- ── RLS, audit, modules ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['messaging_settings','email_domains','email_senders','texting_registrations',
                           'whatsapp_accounts','whatsapp_template_submissions','recipient_verifications'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists %I on app.%I', t || '_read', t);
    execute format('create policy %I on app.%I for select to authenticated using (app.messaging_can_view(center_id))', t || '_read', t);
    execute format('revoke all on app.%I from anon, authenticated', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
    execute format('drop trigger if exists %I on app.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()', 'audit_' || t, t);
  end loop;
end $$;
-- Recipient verification codes: only the hash is stored, and only settings managers read the rows.
drop policy if exists recipient_verifications_read on app.recipient_verifications;
create policy recipient_verifications_read on app.recipient_verifications for select to authenticated
  using (app.messaging_can_manage(center_id));

alter table app.message_suppressions enable row level security;
drop policy if exists message_suppressions_read on app.message_suppressions;
create policy message_suppressions_read on app.message_suppressions for select to authenticated
  using ((center_id is not null and app.messaging_can_view(center_id)) or (center_id is null and app.is_platform_admin()));
revoke all on app.message_suppressions from anon, authenticated;
grant select on app.message_suppressions to authenticated;
grant all on app.message_suppressions to service_role;
drop trigger if exists audit_message_suppressions on app.message_suppressions;
create trigger audit_message_suppressions after insert or update or delete on app.message_suppressions
  for each row execute function app.audit_row();

insert into app.module_tables (table_name, module_key) values
  ('messaging_settings', null), ('email_domains', null), ('email_senders', null), ('message_suppressions', null),
  ('texting_registrations', null), ('recipient_verifications', null),
  ('whatsapp_accounts', 'comms'), ('whatsapp_template_submissions', 'comms')
on conflict (table_name) do update set module_key = excluded.module_key;

-- The module switch for the two WhatsApp tables (same generated policy as 0103).
do $$
declare t text; v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''comms''))::uuid[]))';
begin
  foreach t in array array['whatsapp_accounts','whatsapp_template_submissions'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;

-- ── Built-in templates (platform defaults, center_id NULL; Wave C makes them editable) ──
-- {{name}} placeholders; app.render_message_text fills them. center_name / center_short_name
-- are always available. A value called code / token / otp is never stored in the message
-- body (0221 keeps it in the vault until it is sent).
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('sandbox_code', 'email', 'Your Community Connect sandbox code',
   E'Hello {{name}},\n\nYour Community Connect sandbox code is {{code}}.\n\nIt works once, only for {{email}}, until {{expires_on}}. Start here: {{link}}\n\nThe Community Connect team'),
  ('request_declined', 'email', 'Your Community Connect request',
   E'Hello {{name}},\n\nThank you for your interest in Community Connect for {{org_name}}. We are not able to open a sandbox for it right now.\n\n{{reason}}\n\nThe Community Connect team'),
  ('request_more_info', 'email', 'A question about your Community Connect request',
   E'Hello {{name}},\n\nThank you for asking about Community Connect for {{org_name}}. Before we can open a sandbox we need a little more information:\n\n{{question}}\n\nReply to this email with the answer.\n\nThe Community Connect team'),
  ('paypal_email_code', 'email', 'Confirm the PayPal email for {{center_name}}',
   E'Someone at {{center_name}} entered this address as its PayPal Business email.\n\nThe confirmation code is {{code}}. It expires in {{minutes}} minutes.\n\nIf this was not you, ignore this email.'),
  ('staff_invitation', 'email', '{{inviter}} invited you to {{center_name}}',
   E'Hello,\n\n{{inviter}} invited you to help run {{center_name}} on Community Connect ({{roles}}).\n\nAccept the invitation: {{link}}\n\nThe link expires on {{expires_on}}.'),
  ('sign_in_code', 'email', 'Your {{center_short_name}} sign-in code',
   E'Your {{center_short_name}} sign-in code is {{code}}.\n\nIt expires in {{minutes}} minutes. If you did not ask for it, ignore this email.'),
  ('sign_in_code', 'sms', null,
   E'{{center_short_name}}: your sign-in code is {{code}}. It expires in {{minutes}} minutes.'),
  ('receipt', 'email', 'Receipt {{receipt_number}} from {{center_name}}',
   E'Dear {{name}},\n\nThank you. {{center_name}} received {{amount}} for {{fund}} on {{date}}.\n\nReceipt number {{receipt_number}}. {{tax_note}}'),
  ('test_message', 'email', 'Test email from {{center_name}}',
   E'This is a test email from {{center_name}}, sent from Settings on Community Connect.\n\nIf you can read this, email sending works.'),
  ('test_message', 'sms', null, E'{{center_short_name}}: this is a test text from Community Connect. Texting works.'),
  ('test_message', 'push', 'Test notification', E'This is a test notification from {{center_short_name}}.'),
  ('test_message', 'whatsapp', null, E'This is a test WhatsApp message from {{center_name}}.'),
  ('recipient_verification', 'email', 'Confirm you are a test recipient for {{center_name}}',
   E'{{center_name}} added this address as a test recipient for its Community Connect sandbox.\n\nThe code is {{code}}. It expires in {{minutes}} minutes.'),
  ('recipient_verification', 'sms', null, E'{{center_short_name}} sandbox test recipient code: {{code}}'),
  ('recipient_verification', 'whatsapp', null, E'{{center_short_name}} sandbox test recipient code: {{code}}'),
  ('recipient_verification', 'push', 'Test recipient code', E'{{center_short_name}} sandbox test recipient code: {{code}}'),
  ('keyword_reply', 'sms', null, E'{{text}}')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');
