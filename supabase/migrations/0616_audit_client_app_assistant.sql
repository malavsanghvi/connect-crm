-- 0616: 'assistant' is a client app in the audit log (Niva for admins, step A1; docs/ADMIN_REDESIGN.md "Rules Niva always
-- follows": every action is audited as "by Niva, for <person>").
--
-- app.audit_clean_app (0100, widened for 'import' in 0192) decides which values of the x-client-app request header, or of
-- the app.client_app setting, reach audit_log.client_app; anything else is dropped. The portal's Niva route sends
-- x-client-app: assistant on every call it makes for a signed-in person, so the changes that person's own commands make
-- are recorded as "Niva assistant" next to their name. Nothing else changes: the same five values as 0192 are still
-- accepted, anything else is still dropped, and no policy, permission or money rule is touched.
--
-- Like the other values this is what the caller says it is (a header), so it is a label for reading the log, not proof.
-- The proof that a person approved a Niva action is app.assistant_proposals (0617).
--
-- Nothing else lists the allowed values in the database: 0100 defines the function and 0192 is its last definition;
-- audit_log.client_app has no check constraint. The portal's own list of apps for the audit filter is src/lib/audit-filters.ts.
--
-- Anyone who changes app.audit_clean_app again must start from THIS definition (0616).
set client_min_messages = warning;

create or replace function app.audit_clean_app(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when lower(btrim(p)) in ('portal','member','kiosk','job','import','assistant') then lower(btrim(p)) end
$$;
