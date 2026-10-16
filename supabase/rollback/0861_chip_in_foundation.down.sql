-- ROLLBACK of 0861 (run AFTER the rollback of 0863 and 0862). Not a migration: the deploy never applies it. It removes the Chip In's
-- settings, ledger and functions and puts the demo keep list back as 0785 left it.
--
-- WHAT IT DESTROYS: every Chip In setting and every Chip In ledger row (the limit per account is counted from the ledger). It
-- REFUSES to run while the ledger holds a collected or refunded Chip In, unless app.rollback_force = 'on' for the session. The safe
-- way to stop asking without a rollback is app.platform_set_chip_in(center, limit, suggestions, false, reason).
begin;
set client_min_messages = warning;

do $$ begin
  if coalesce(current_setting('app.rollback_force', true), '') <> 'on'
     and exists (select 1 from app.chip_in_ledger where status in ('collected', 'refunded')) then
    raise exception 'The Chip In ledger holds collected Chip Ins. Back it up first, then set app.rollback_force = ''on'' to drop it anyway.';
  end if;
end $$;

drop function if exists app.worker_release_chip_ins();
drop function if exists app._chip_in_collect(uuid, uuid, bigint);
drop function if exists app._chip_in_release(uuid);
drop function if exists app.chip_in_overview(uuid, integer);
drop function if exists app.chip_in_summary(uuid);
drop function if exists app.platform_set_chip_in(uuid, bigint, bigint[], boolean, text);
drop function if exists app._chip_in_write(uuid, bigint, bigint[], boolean, text);
drop function if exists app.my_chip_in_offer(uuid);
drop function if exists app._chip_in_state(uuid, uuid, text);
drop function if exists app.chip_in_lock(uuid, uuid, integer);
drop function if exists app.chip_in_used_cents(uuid, uuid, integer, text);
drop function if exists app.chip_in_year(uuid, timestamptz);
drop table if exists app.chip_in_ledger;
drop table if exists app.chip_in_settings;
drop function if exists app.chip_in_ledger_guard();
drop function if exists app.chip_in_suggestions_ok(bigint, bigint[]);
delete from app.module_tables where table_name in ('chip_in_settings', 'chip_in_ledger');

create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs',
    -- 0785: what a demo community's reset puts back
    'demo_qbo_links'
  ]::text[]
$$;

commit;
