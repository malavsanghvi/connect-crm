-- 0179_wave_a_integration.sql — joins the onboarding Wave A streams.
--
-- 1. The sender (connect_worker, 0170) may ask whether a sandbox recipient is
--    allowed (app.recipient_allowed, 0161). 0161 granted it only if the role
--    already existed, and 0170 creates the role later.
-- 2. Security fix: app.create_event_from_template was executable by anon
--    (PUBLIC grant) and skipped its permission check whenever auth.uid() is
--    null, so a signed-out caller with a template id could create an event.
--    Only signed-in staff (checked inside) and the service role may call it.

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'connect_worker') then
    grant execute on function app.recipient_allowed(uuid, text, text) to connect_worker;
  end if;
end $$;

revoke execute on function app.create_event_from_template(uuid, text, timestamptz, text) from public, anon;
grant execute on function app.create_event_from_template(uuid, text, timestamptz, text) to authenticated, service_role;
