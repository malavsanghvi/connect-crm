-- Wave D integration.
--
-- A sandbox reset (o-demo, 0310) clears every center table not on its keep list.
-- o-golive's approval records (statement/receipt templates, Niva content) are
-- decisions the organization made, like agreements: keep them through a reset.
set client_min_messages = warning;

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
    'center_payment_processors','payment_processor_tests','paypal_email_verifications',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2) and saved import mappings
    'legal_documents','message_templates','receipt_templates','import_mappings',
    -- history that is never deleted
    'audit_log','jobs'
  ]::text[]
$$;
