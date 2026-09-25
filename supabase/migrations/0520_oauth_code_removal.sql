-- Wave F · stream f-money · 1 of 3: used OAuth authorization codes leave the
-- vault (owner decision 2026-09-25, second batch, #12).
--
-- oauth.exchange (every provider: Stripe, PayPal, Intuit) reads the code the
-- callback stored on the connection ("oauth.code", or the job's code_secret)
-- and swaps it for tokens. A code works once, so after the swap it is only a
-- liability. The background service now removes it:
--   * after a successful exchange, always;
--   * after a failed exchange, unless a retry of the same job could still use
--     it (a temporary failure with attempts left).
--
-- app.worker_remove_oauth_code(connection, name, outcome) is the vault's delete
-- path for this one case: connect_worker only, and only for a secret whose
-- name says it is an authorization code (oauth.code, or a name ending in
-- "code"), so it can never remove a token or an API key. The row delete takes
-- the vault entry with it (trigger integration_secrets_drop_vault, 0170) and
-- is audited as the background service's work with the reason
-- "used authorization code removed after exchange". The value is never read,
-- logged or returned.
set client_min_messages = warning;

create or replace function app.worker_remove_oauth_code(p_connection uuid, p_name text, p_outcome text)
returns boolean language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text := lower(btrim(coalesce(p_name, ''))); v_id uuid;
begin
  perform app.assert_worker();
  if v_name !~ '^[a-z][a-z0-9_.-]{0,62}$' or v_name !~ '(^|[._-])code$' then
    raise exception 'Only an authorization code can be removed this way ("%" is not one).', p_name;
  end if;
  if p_outcome is null or p_outcome not in ('exchanged','unusable') then
    raise exception 'Say why the authorization code is removed (exchanged or unusable).';
  end if;
  select id into v_id from app.integration_secrets where connection_id = p_connection and name = v_name for update;
  if v_id is null then return false; end if;
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context(case p_outcome
    when 'exchanged' then 'Background service: used authorization code removed after exchange'
    else 'Background service: authorization code removed after a failed exchange (a retry could not use it)' end);
  delete from app.integration_secrets where id = v_id;
  return true;
end $$;

revoke execute on function app.worker_remove_oauth_code(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function app.worker_remove_oauth_code(uuid, text, text) to connect_worker;
