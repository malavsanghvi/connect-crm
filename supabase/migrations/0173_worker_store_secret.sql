-- Onboarding (stream o-vault): the background service stores what a provider
-- hands back (OAuth access and refresh tokens, refreshed tokens) straight into
-- the vault. connect_worker only; audited as a job with the purpose as the
-- reason; the value is never logged or returned, only its fingerprint.
-- (People change secrets through app.set_integration_secret, with step-up.)

create or replace function app.worker_store_secret(p_connection uuid, p_name text, p_value text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_provider text; s app.integration_secrets; v_vault uuid; v_name text := lower(btrim(p_name));
begin
  perform app.assert_worker();
  select center_id, provider into v_center, v_provider from app.integration_connections where id = p_connection;
  if v_center is null then raise exception 'That connection was not found.'; end if;
  if v_name is null or v_name !~ '^[a-z][a-z0-9_.-]{0,62}$' then raise exception 'Bad secret name "%".', p_name; end if;
  if p_value is null or char_length(p_value) < 8 or char_length(p_value) > 65536 then
    raise exception 'The value for "%" is empty, too short or too long to be a secret.', v_name;
  end if;
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: ' || coalesce(nullif(btrim(p_purpose), ''), 'stored a provider credential'));
  select * into s from app.integration_secrets where connection_id = p_connection and name = v_name for update;
  if found then
    perform vault.update_secret(s.vault_secret_id, p_value);
    update app.integration_secrets set fingerprint = right(p_value, 4), set_by = null, set_at = now(), rotated_at = now()
     where id = s.id;
  else
    v_vault := vault.create_secret(p_value, 'connect/' || p_connection || '/' || v_name,
                                   'Community Connect ' || v_provider || ' secret "' || v_name || '"');
    insert into app.integration_secrets (center_id, connection_id, name, vault_secret_id, fingerprint, set_by)
    values (v_center, p_connection, v_name, v_vault, right(p_value, 4), null);
  end if;
  return jsonb_build_object('name', v_name, 'fingerprint', right(p_value, 4));
end $$;

revoke execute on function app.worker_store_secret(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function app.worker_store_secret(uuid, text, text, text) to connect_worker;
