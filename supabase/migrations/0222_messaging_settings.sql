-- Onboarding (stream o-messaging) · 3 of 5: Settings › Email, Texting and WhatsApp.
--
--   app.set_email_provider(center, provider, reason)            Resend (default) or Postmark
--   app.add_email_domain(center, domain, reason) → uuid         queues messaging.domain_verify (create)
--   app.recheck_email_domain(domain_id) → job id                queues messaging.domain_verify (verify)
--   app.save_email_sender(center, purpose, name, from, reply_to, reason)
--   app.save_email_footer(center, postal_address, note, reason)
--   app.save_texting_registration(center, kind, detail, submit, reason)
--   app.save_whatsapp_account(center, waba_id, phone_number_id, display_name, phone, reason)
--   app.submit_whatsapp_template(center, name, language, category, body, reason)
--   app.set_messaging_review_status(kind, id, status, note, refs)   Community Connect relays the
--        carrier's (10DLC / toll-free) or Meta's decision; platform admins only.
--
-- Every write needs settings.manage or integrations.manage (or the owner) and a
-- reason, and is audited with it. Nothing here claims a provider approved
-- something it did not: registration and Meta submissions start "submitted" /
-- "pending_meta" and only a recorded decision moves them on.
set client_min_messages = warning;

create or replace function app._messaging_require(p_center uuid, p_reason text, p_what text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.messaging_can_manage(p_center) then
    raise exception '% needs settings.manage or integrations.manage.', p_what using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason. It goes in the audit log.' using errcode = '22023';
  end if;
end $$;

-- The Setup checklist step moves with the provider: never backwards from done.
create or replace function app._messaging_setup_step(p_center uuid, p_step text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not exists (select 1 from app.setup_steps where key = p_step) then return; end if;
  insert into app.center_setup_steps (center_id, step_key, status, notes)
  values (p_center, p_step, p_status, left(p_note, 2000))
  on conflict (center_id, step_key) do update
    set status = excluded.status, notes = coalesce(excluded.notes, app.center_setup_steps.notes)
    where app.center_setup_steps.status <> 'done' or excluded.status = 'done';
end $$;

-- ── Email service ────────────────────────────────────────────────────────────
create or replace function app.set_email_provider(p_center uuid, p_provider text, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_mode text; v_dom record;
begin
  perform app._messaging_require(p_center, p_reason, 'Choosing the email service');
  if p_provider not in ('resend','postmark') then raise exception 'Choose Resend or Postmark.' using errcode = '22023'; end if;
  v_mode := case when (select environment from app.centers where id = p_center) = 'sandbox' then 'test' else 'live' end;
  perform app.set_audit_context(p_reason);
  insert into app.messaging_settings (center_id, email_provider, updated_by) values (p_center, p_provider, auth.uid())
  on conflict (center_id) do update set email_provider = excluded.email_provider, updated_by = excluded.updated_by, updated_at = now();
  insert into app.integration_connections (center_id, provider, status, display_name, settings, connected_by, connected_at)
  values (p_center, p_provider, 'connected', initcap(p_provider) || ' · Community Connect account',
          jsonb_build_object('mode', v_mode, 'account', 'platform'), auth.uid(), now())
  on conflict (center_id, provider) do update set status = 'connected',
    settings = app.integration_connections.settings || jsonb_build_object('mode', v_mode), last_error = null;
  update app.integration_connections set status = 'disconnected'
   where center_id = p_center and provider in ('resend','postmark') and provider <> p_provider and status <> 'disconnected';
  -- Domains belong to one service: move them over and add them there again.
  for v_dom in select id from app.email_domains where center_id = p_center and provider <> p_provider loop
    update app.email_domains set provider = p_provider, provider_domain_id = null, dns_records = '[]', status = 'pending',
                                 verified_at = null, last_error = null where id = v_dom.id;
    perform app.enqueue_job(p_center, 'messaging.domain_verify', jsonb_build_object('domain_id', v_dom.id, 'action', 'create'), now(), 5);
  end loop;
  update app.email_senders s set verified = false where s.center_id = p_center
     and not exists (select 1 from app.email_domains ed where ed.center_id = p_center and ed.status = 'verified'
                      and ed.domain = split_part(s.from_address, '@', 2));
end $$;

create or replace function app.add_email_domain(p_center uuid, p_domain text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_domain text := lower(trim(trailing '.' from btrim(coalesce(p_domain, '')))); v_provider text; v_id uuid;
begin
  perform app._messaging_require(p_center, p_reason, 'Adding a sending domain');
  v_domain := regexp_replace(v_domain, '^https?://', '');
  if v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception '"%" is not a domain name. Enter something like mail.example.org.', p_domain using errcode = '22023';
  end if;
  if exists (select 1 from app.email_domains where domain = v_domain and center_id <> p_center) then
    raise exception '% is already used by another community on Community Connect.', v_domain using errcode = '23505';
  end if;
  if exists (select 1 from app.email_domains where domain = v_domain and center_id = p_center) then
    raise exception '% is already added. Use "Check again" to re-verify it.', v_domain using errcode = '23505';
  end if;
  select email_provider into v_provider from app.messaging_settings where center_id = p_center;
  if v_provider is null then
    perform app.set_email_provider(p_center, 'resend', p_reason);
    v_provider := 'resend';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.email_domains (center_id, domain, provider, created_by) values (p_center, v_domain, v_provider, auth.uid())
  returning id into v_id;
  perform app.enqueue_job(p_center, 'messaging.domain_verify', jsonb_build_object('domain_id', v_id, 'action', 'create'), now(), 5);
  perform app._messaging_setup_step(p_center, 'svc.email', 'in_progress', 'Domain ' || v_domain || ' added; waiting for its DNS records.');
  return v_id;
end $$;

create or replace function app.recheck_email_domain(p_domain uuid) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.email_domains;
begin
  select * into d from app.email_domains where id = p_domain;
  if not found or not app.messaging_can_manage(d.center_id) then
    raise exception 'That domain was not found, or checking it needs settings.manage or integrations.manage.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from app.jobs where kind = 'messaging.domain_verify' and status in ('queued','running')
               and payload->>'domain_id' = p_domain::text) then
    raise exception 'A check of % is already queued. It runs within a minute.', d.domain using errcode = '22023';
  end if;
  perform app.set_audit_context('Check the DNS records of ' || d.domain);
  return app.enqueue_job(d.center_id, 'messaging.domain_verify',
                         jsonb_build_object('domain_id', p_domain, 'action', case when d.provider_domain_id is null then 'create' else 'verify' end),
                         now(), 5);
end $$;

create or replace function app.save_email_sender(p_center uuid, p_purpose text, p_from_name text, p_from_address text,
                                                 p_reply_to text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_from text := lower(btrim(coalesce(p_from_address, ''))); v_reply text := nullif(lower(btrim(coalesce(p_reply_to, ''))), '');
        v_id uuid; v_verified boolean;
begin
  perform app._messaging_require(p_center, p_reason, 'Changing the email senders');
  if p_purpose not in ('office','receipts','newsletters','auth') then raise exception 'Unknown sender "%".', p_purpose using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_from_name, '')), '') is null then raise exception 'Enter the name people see the email come from.' using errcode = '22023'; end if;
  if v_from !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '"%" is not an email address.', p_from_address using errcode = '22023'; end if;
  if v_reply is not null and v_reply !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '"%" is not an email address.', p_reply_to using errcode = '22023'; end if;
  if not exists (select 1 from app.email_domains where center_id = p_center and domain = split_part(v_from, '@', 2)) then
    raise exception 'Send from an address on one of your sending domains (add % first, or use one you added).', split_part(v_from, '@', 2)
      using errcode = '22023';
  end if;
  v_verified := exists (select 1 from app.email_domains where center_id = p_center and status = 'verified' and domain = split_part(v_from, '@', 2));
  perform app.set_audit_context(p_reason);
  insert into app.email_senders (center_id, purpose, from_name, from_address, reply_to, verified, updated_by)
  values (p_center, p_purpose, btrim(p_from_name), v_from, v_reply, v_verified, auth.uid())
  on conflict (center_id, purpose) do update set from_name = excluded.from_name, from_address = excluded.from_address,
    reply_to = excluded.reply_to, verified = excluded.verified, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.save_email_footer(p_center uuid, p_postal_address text, p_note text, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app._messaging_require(p_center, p_reason, 'Changing the email footer');
  if nullif(btrim(coalesce(p_postal_address, '')), '') is null then
    raise exception 'Enter the postal address. US law (CAN-SPAM) requires it on every newsletter.' using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.messaging_settings (center_id, footer_postal_address, footer_note, updated_by)
  values (p_center, btrim(p_postal_address), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (center_id) do update set footer_postal_address = excluded.footer_postal_address, footer_note = excluded.footer_note,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ── Texting ──────────────────────────────────────────────────────────────────
-- detail: legal_name, ein, website, use_case, samples[] (2+), opt_in (how people agree),
-- volume (messages a month), contact_email, from_number (when one is already held).
create or replace function app.save_texting_registration(p_center uuid, p_kind text, p_detail jsonb, p_submit boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.texting_registrations; v_detail jsonb := coalesce(p_detail, '{}'::jsonb); v_missing text[] := '{}'; v_id uuid;
begin
  perform app._messaging_require(p_center, p_reason, 'Changing the texting registration');
  if p_kind not in ('10dlc','toll_free') then raise exception 'Choose 10DLC or toll-free.' using errcode = '22023'; end if;
  if jsonb_typeof(v_detail) <> 'object' then raise exception 'The registration details must be an object.' using errcode = '22023'; end if;
  select * into r from app.texting_registrations where center_id = p_center and kind = p_kind;
  if r.status in ('submitted','in_review','approved') then
    raise exception 'This registration is % and cannot be changed here. Ask Community Connect to change it.', replace(r.status, '_', ' ')
      using errcode = '22023';
  end if;
  if coalesce(p_submit, false) then
    if nullif(btrim(v_detail->>'legal_name'), '') is null then v_missing := v_missing || 'the legal name'::text; end if;
    if regexp_replace(coalesce(v_detail->>'ein', ''), '\D', '', 'g') !~ '^\d{9}$' then v_missing := v_missing || 'a 9-digit EIN'::text; end if;
    if nullif(btrim(v_detail->>'use_case'), '') is null then v_missing := v_missing || 'the use case'::text; end if;
    if jsonb_typeof(v_detail->'samples') <> 'array' or jsonb_array_length(v_detail->'samples') < 2 then
      v_missing := v_missing || 'two sample messages'::text;
    end if;
    if nullif(btrim(v_detail->>'opt_in'), '') is null then v_missing := v_missing || 'how people opt in'::text; end if;
    if cardinality(v_missing) > 0 then
      raise exception 'Before submitting, add %.', array_to_string(v_missing, ', ') using errcode = '22023';
    end if;
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.texting_registrations (center_id, kind, status, detail, submitted_at, submitted_by, updated_by)
  values (p_center, p_kind, case when p_submit then 'submitted' else 'draft' end, v_detail,
          case when p_submit then now() end, case when p_submit then auth.uid() end, auth.uid())
  on conflict (center_id, kind) do update set status = excluded.status, detail = excluded.detail,
    submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into app.integration_connections (center_id, provider, status, display_name, settings)
  values (p_center, 'twilio', 'disconnected', 'Twilio · Community Connect account',
          jsonb_build_object('mode', case when (select environment from app.centers where id = p_center) = 'sandbox' then 'test' else 'live' end))
  on conflict (center_id, provider) do nothing;
  if p_submit then
    perform app._messaging_setup_step(p_center, 'svc.texting', 'waiting_on_provider',
      case p_kind when '10dlc' then '10DLC brand and campaign submitted' else 'Toll-free verification submitted' end
      || '; carriers take days to weeks.');
  end if;
  return v_id;
end $$;

-- ── WhatsApp ─────────────────────────────────────────────────────────────────
create or replace function app.save_whatsapp_account(p_center uuid, p_waba_id text, p_phone_number_id text, p_display_name text,
                                                     p_phone text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_phone text := app.normalize_recipient('whatsapp', p_phone); v_id uuid; a app.whatsapp_accounts;
begin
  perform app.assert_module_enabled(p_center, 'comms');
  perform app._messaging_require(p_center, p_reason, 'Changing the WhatsApp Business account');
  if nullif(btrim(coalesce(p_display_name, '')), '') is null then raise exception 'Enter the display name Meta should approve.' using errcode = '22023'; end if;
  if v_phone is null or v_phone !~ '^\+\d{8,15}$' then
    raise exception 'Enter the WhatsApp number in the international form, for example +1 713 555 0100.' using errcode = '22023';
  end if;
  select * into a from app.whatsapp_accounts where center_id = p_center;
  if a.status = 'approved' and (a.detail->>'phone_e164' is distinct from v_phone or a.display_name is distinct from btrim(p_display_name)) then
    raise exception 'The approved number and display name cannot be changed here; Meta must review a change. Ask Community Connect.' using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.whatsapp_accounts (center_id, waba_id, phone_number_id, display_name, status, detail, updated_by)
  values (p_center, nullif(btrim(coalesce(p_waba_id, '')), ''), nullif(btrim(coalesce(p_phone_number_id, '')), ''), btrim(p_display_name),
          'pending_meta', jsonb_build_object('phone_e164', v_phone, 'submitted_at', now()), auth.uid())
  on conflict (center_id) do update set waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id,
    display_name = excluded.display_name,
    status = case when app.whatsapp_accounts.status = 'approved' then 'approved' else 'pending_meta' end,
    detail = app.whatsapp_accounts.detail || excluded.detail, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into app.integration_connections (center_id, provider, status, display_name, settings)
  values (p_center, 'whatsapp', 'disconnected', 'WhatsApp Business · ' || btrim(p_display_name),
          jsonb_build_object('mode', case when (select environment from app.centers where id = p_center) = 'sandbox' then 'test' else 'live' end))
  on conflict (center_id, provider) do update set display_name = excluded.display_name;
  perform app._messaging_setup_step(p_center, 'svc.whatsapp', 'waiting_on_provider', 'Waiting for Meta to approve the number and display name.');
  return v_id;
end $$;

create or replace function app.submit_whatsapp_template(p_center uuid, p_name text, p_language text, p_category text,
                                                        p_body text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text := lower(regexp_replace(btrim(coalesce(p_name, '')), '[^A-Za-z0-9]+', '_', 'g')); v_id uuid;
begin
  perform app.assert_module_enabled(p_center, 'comms');
  perform app._messaging_require(p_center, p_reason, 'Submitting a WhatsApp template');
  if v_name = '' then raise exception 'Name the template (letters, digits and underscores).' using errcode = '22023'; end if;
  if p_category not in ('utility','marketing','authentication') then raise exception 'Choose utility, marketing or authentication.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Write the template text.' using errcode = '22023'; end if;
  if not exists (select 1 from app.whatsapp_accounts where center_id = p_center) then
    raise exception 'Add the WhatsApp Business account first.' using errcode = '22023';
  end if;
  if exists (select 1 from app.whatsapp_template_submissions where center_id = p_center and name = v_name
               and language = coalesce(nullif(btrim(p_language), ''), 'en') and status <> 'rejected') then
    raise exception 'A template called % is already submitted in that language.', v_name using errcode = '23505';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.whatsapp_template_submissions (center_id, name, language, category, body, status, submitted_by)
  values (p_center, v_name, coalesce(nullif(btrim(p_language), ''), 'en'), p_category, btrim(p_body), 'pending_meta', auth.uid())
  on conflict (center_id, name, language) do update set category = excluded.category, body = excluded.body, status = 'pending_meta',
    rejection_reason = null, decided_at = null, submitted_by = excluded.submitted_by, submitted_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- ── Decisions relayed by Community Connect ───────────────────────────────────
-- p_kind: 'texting' | 'whatsapp_account' | 'whatsapp_template'. p_refs (optional):
-- brand_id, campaign_id, from_number, messaging_service_sid, waba_id, phone_number_id, meta_template_id.
create or replace function app.set_messaging_review_status(p_kind text, p_id uuid, p_status text, p_note text, p_refs jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_refs jsonb := coalesce(p_refs, '{}'::jsonb); v_from text;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team records a carrier''s or Meta''s decision.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give a reason. It goes in the audit log.' using errcode = '22023'; end if;
  perform app.set_audit_context(p_note);
  if p_kind = 'texting' then
    if p_status not in ('in_review','approved','rejected') then raise exception 'A registration is in_review, approved or rejected.' using errcode = '22023'; end if;
    v_from := app.normalize_recipient('sms', v_refs->>'from_number');
    if p_status = 'approved' and v_from is null and not exists (select 1 from app.texting_registrations where id = p_id and detail ? 'from_number') then
      raise exception 'An approved registration needs the number texts come from (from_number).' using errcode = '22023';
    end if;
    update app.texting_registrations
       set status = p_status, approved_at = case when p_status = 'approved' then now() end,
           brand_id = coalesce(v_refs->>'brand_id', brand_id), campaign_id = coalesce(v_refs->>'campaign_id', campaign_id),
           detail = detail || jsonb_strip_nulls(jsonb_build_object('from_number', v_from, 'messaging_service_sid', v_refs->>'messaging_service_sid',
                                                                   'reviewer_note', btrim(p_note))),
           updated_by = auth.uid(), updated_at = now()
     where id = p_id returning center_id into v_center;
    if v_center is null then raise exception 'That registration was not found.'; end if;
    if p_status = 'approved' then
      update app.integration_connections c
         set status = 'connected', connected_at = now(), connected_by = auth.uid(), last_error = null,
             external_account_id = coalesce(r.detail->>'messaging_service_sid', c.external_account_id),
             settings = c.settings || jsonb_strip_nulls(jsonb_build_object('from_number', r.detail->>'from_number',
                                                                           'messaging_service_sid', r.detail->>'messaging_service_sid'))
        from app.texting_registrations r
       where r.id = p_id and c.center_id = r.center_id and c.provider = 'twilio';
      perform app._messaging_setup_step(v_center, 'svc.texting', 'done', 'Texting registration approved.');
    elsif p_status = 'rejected' then
      update app.integration_connections set status = 'error', last_error = 'Texting registration rejected: ' || btrim(p_note)
       where center_id = v_center and provider = 'twilio';
      perform app._messaging_setup_step(v_center, 'svc.texting', 'in_progress', 'Rejected: ' || btrim(p_note));
    end if;
  elsif p_kind = 'whatsapp_account' then
    if p_status not in ('approved','rejected') then raise exception 'Meta approves or rejects.' using errcode = '22023'; end if;
    update app.whatsapp_accounts
       set status = p_status, waba_id = coalesce(v_refs->>'waba_id', waba_id), phone_number_id = coalesce(v_refs->>'phone_number_id', phone_number_id),
           detail = detail || jsonb_build_object('reviewer_note', btrim(p_note), 'decided_at', now()), updated_by = auth.uid(), updated_at = now()
     where id = p_id returning center_id into v_center;
    if v_center is null then raise exception 'That WhatsApp account was not found.'; end if;
    update app.integration_connections c
       set status = case when p_status = 'approved' then 'connected' else 'error' end,
           connected_at = case when p_status = 'approved' then now() else c.connected_at end,
           last_error = case when p_status = 'rejected' then 'Meta rejected the account: ' || btrim(p_note) end,
           external_account_id = a.waba_id,
           settings = c.settings || jsonb_strip_nulls(jsonb_build_object('phone_number_id', a.phone_number_id, 'from_number', a.detail->>'phone_e164'))
      from app.whatsapp_accounts a where a.id = p_id and c.center_id = a.center_id and c.provider = 'whatsapp';
    perform app._messaging_setup_step(v_center, 'svc.whatsapp', case when p_status = 'approved' then 'done' else 'in_progress' end,
      case when p_status = 'approved' then 'Meta approved the number.' else 'Meta rejected: ' || btrim(p_note) end);
  elsif p_kind = 'whatsapp_template' then
    if p_status not in ('approved','rejected') then raise exception 'Meta approves or rejects.' using errcode = '22023'; end if;
    update app.whatsapp_template_submissions
       set status = p_status, decided_at = now(), meta_template_id = coalesce(v_refs->>'meta_template_id', meta_template_id),
           rejection_reason = case when p_status = 'rejected' then btrim(p_note) end
     where id = p_id returning center_id into v_center;
    if v_center is null then raise exception 'That template was not found.'; end if;
  else
    raise exception 'Unknown review kind "%".', p_kind using errcode = '22023';
  end if;
end $$;

revoke execute on function app._messaging_require(uuid, text, text), app._messaging_setup_step(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function app.set_email_provider(uuid, text, text), app.add_email_domain(uuid, text, text), app.recheck_email_domain(uuid),
  app.save_email_sender(uuid, text, text, text, text, text), app.save_email_footer(uuid, text, text, text),
  app.save_texting_registration(uuid, text, jsonb, boolean, text), app.save_whatsapp_account(uuid, text, text, text, text, text),
  app.submit_whatsapp_template(uuid, text, text, text, text, text), app.set_messaging_review_status(text, uuid, text, text, jsonb)
  from public, anon;
grant execute on function app.set_email_provider(uuid, text, text), app.add_email_domain(uuid, text, text), app.recheck_email_domain(uuid),
  app.save_email_sender(uuid, text, text, text, text, text), app.save_email_footer(uuid, text, text, text),
  app.save_texting_registration(uuid, text, jsonb, boolean, text), app.save_whatsapp_account(uuid, text, text, text, text, text),
  app.submit_whatsapp_template(uuid, text, text, text, text, text), app.set_messaging_review_status(text, uuid, text, text, jsonb)
  to authenticated;
grant execute on all functions in schema app to service_role;
