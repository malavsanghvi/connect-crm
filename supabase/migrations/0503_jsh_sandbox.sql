-- Wave F (stream f-sandbox) · 4 of 4: JSH's organization is a sandbox.
-- Owner decisions (2026-09-25, second batch): "JSH's current organization is a sandbox".
--
-- Keyed on slug 'jsh'; does nothing where that organization does not exist. Idempotent.
-- NOTHING IS DELETED: every person, household, payment, setting and connection stays.
--
-- A fresh database's app.centers gets its JSH row from seed.sql, which runs AFTER migrations —
-- so on a from-scratch dev/test database this migration is a real no-op the first time (nothing to
-- switch yet). That is deliberate, not a bug to route around here: seed.sql keeps seeding JSH as a
-- normal production organization on every local/test/e2e database, because that is the baseline
-- fixture the rest of the suite assumes. The switch itself is exposed as app.apply_jsh_sandbox_switch()
-- so DB test 36 and e2e flow f-sandbox can call it directly to exercise the production→sandbox
-- transition where that transition is the point of the test — the same way a real deploy exercises
-- it exactly once, against the one real JSH that already exists.
--
-- What changes for JSH, and why each is sensible for an organization that is in use:
--   environment = 'sandbox'            the watermark "Sandbox · test data" on every screen and every
--                                      outbound email/text; the sandbox entitlement defaults apply:
--     messaging.recipients test_only   email/texts/WhatsApp/push reach only verified test recipients
--                                      (sign-in codes still reach everyone, owner decision #13)
--     payments.mode test               checkouts run in the provider's test mode; nothing real is charged
--     qbo.mode sandbox_or_read_only    nothing posts to the real QuickBooks company; postings wait
--     public_dashboard off             /c/jsh says the dashboard opens once the community goes live
--     niva 300 questions a month       (Niva is switched off for JSH)
--   overrides, set here with the reason below (Platform › Centers › JSH shows and changes them):
--     max_people / max_households / storage.bytes = no limit   JSH's own records must keep fitting
--     expiry_days_inactive = no limit  JSH never gets inactivity warnings and never expires
--     promotion.in_place = on          going live later keeps JSH itself — same web name, every
--                                      record — through the usual request, two approvals and the
--                                      owner's promotion (0500)
--   a real-company QuickBooks connection is marked read-only (postings wait with the reason);
--     payment processors are left as they are (a sandbox always charges in test mode, 0211)
--   the member-app join code: an active one is guaranteed (sandboxes are out of community search,
--     so new members join with the code; the app's default community still opens by its web name)
--   status stays 'active', the staff 2FA rule stays as JSH set it, the audit log records the switch.
set client_min_messages = warning;

create or replace function app.apply_jsh_sandbox_switch() returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_reason text := 'Owner decision 2026-09-25: JSH''s organization is a sandbox (holds its own records)';
begin
  select id into v_center from app.centers where slug = 'jsh';
  if v_center is null then
    raise notice 'No organization with the web name "jsh" here: nothing to switch.';
    return;
  end if;
  -- Once JSH has gone live in place, never turn it back into a sandbox.
  if exists (select 1 from app.sandbox_promotions p where p.sandbox_id = v_center and p.status = 'done') then
    raise notice 'JSH was already promoted to production: left as it is.';
    return;
  end if;
  perform app.set_audit_context(v_reason);

  update app.centers set environment = 'sandbox' where id = v_center and environment = 'production' and sandbox_for is null;

  insert into app.center_entitlements (center_id, key, value, reason) values
    (v_center, 'max_people', 'null', v_reason || ': its own records must keep fitting'),
    (v_center, 'max_households', 'null', v_reason || ': its own records must keep fitting'),
    (v_center, 'storage.bytes', 'null', v_reason || ': its own files must keep fitting'),
    (v_center, 'expiry_days_inactive', 'null', v_reason || ': never expires, no inactivity warnings'),
    (v_center, 'promotion.in_place', 'true', v_reason || ': going live keeps this organization and all its records')
  on conflict (center_id, key) do nothing;

  -- The real company stays connected for reading; nothing posts from a sandbox.
  update app.integration_connections
     set settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object('read_only', true, 'mode', 'test', 'read_only_since', now(),
                                          'read_only_reason', 'The organization became a sandbox; reconnect in live mode after going live.')
   where center_id = v_center and provider = 'quickbooks_online'
     and not coalesce((settings->>'read_only')::boolean, false);

  if not exists (select 1 from app.member_join_codes j where j.center_id = v_center and j.active
                   and (j.expires_at is null or j.expires_at > now())) then
    insert into app.member_join_codes (center_id) values (v_center);
  end if;
end $$;

select app.apply_jsh_sandbox_switch();
