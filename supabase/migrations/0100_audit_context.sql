-- Wave 2 (stream s-core) · 1 of 5: who / from where / why on every audit entry.
--
-- audit_log gains module, client_app and client_screen (the existing columns
-- stay). The request context -- x-request-id, x-audit-reason, x-client-app,
-- x-client-screen, user-agent, x-forwarded-for -- is read from PostgREST's
-- request.headers, and RPCs / jobs can set it with app.set_audit_context()
-- (or set_config('app.audit_reason' | 'app.correlation_id' | 'app.client_app', ..., true)).
--
-- Nothing here changes a policy, a permission check or a money rule. The hash
-- chain computes exactly the same hash from exactly the same prior row; its
-- lookup is only split so each branch can use an index (see audit_chain below).

alter table app.audit_log add column if not exists module        text;
alter table app.audit_log add column if not exists client_app    text;
alter table app.audit_log add column if not exists client_screen text;

-- The chain looks up the newest entry of the same center on every insert, and
-- record history reads one record newest first.
create index if not exists audit_log_center_id_id_idx on app.audit_log (center_id, id desc);
create index if not exists audit_log_record_idx on app.audit_log (record_table, record_id, id desc);
create index if not exists audit_log_center_module_idx on app.audit_log (center_id, module, id desc);

-- Same chain, same hash input. "is not distinct from" cannot use an index, so
-- with more tables audited a center with few entries (or the NULL-center
-- chain) would scan the whole log backwards on every insert; the two
-- branches below return the identical row through audit_log_center_id_id_idx.
create or replace function app.audit_chain() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare last_hash text;
begin
  if new.center_id is null then
    select hash into last_hash from app.audit_log where center_id is null order by id desc limit 1;
  else
    select hash into last_hash from app.audit_log where center_id = new.center_id order by id desc limit 1;
  end if;
  new.prev_hash := last_hash;
  new.hash := encode(digest(coalesce(last_hash,'') || new.action || coalesce(new.record_table,'')
                || coalesce(new.record_id,'') || coalesce(new.before::text,'') || coalesce(new.after::text,'')
                || new.occurred_at::text, 'sha256'), 'hex');
  return new;
end $$;

-- decodeURIComponent: %XX escapes are UTF-8 bytes. Raises on malformed UTF-8;
-- callers catch that and keep the raw text.
create or replace function app.url_decode(p text) returns text
language sql immutable strict set search_path = app, public, extensions as $$
  select coalesce(convert_from(string_agg(
           case when m[1] ~ '^%[0-9A-Fa-f]{2}$' then decode(substr(m[1], 2), 'hex') else convert_to(m[1], 'UTF8') end,
           ''::bytea order by n), 'UTF8'), '')
    from regexp_matches(p, '%[0-9A-Fa-f]{2}|[^%]+|%', 'g') with ordinality as r(m, n)
$$;

-- One audit reason, cleaned the same way everywhere: trimmed, at most 500 chars, empty = none.
create or replace function app.audit_clean_reason(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select left(nullif(btrim(p), ''), 500)
$$;

create or replace function app.audit_clean_app(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when lower(btrim(p)) in ('portal','member','kiosk','job') then lower(btrim(p)) end
$$;

-- Parses request.headers into the app.audit_h_* settings. Called only when the
-- header string differs from the one parsed last in this transaction, so a
-- statement touching thousands of rows parses (and opens the exception
-- sub-transactions below) once, not once per row. Every field is tolerant:
-- a missing or malformed value becomes NULL and never fails the write.
create or replace function app.audit_parse_headers(p_raw text) returns void
language plpgsql set search_path = app, public, extensions as $$
declare h jsonb; v text; v_reason text; v_ip text;
begin
  begin
    h := nullif(p_raw, '')::jsonb;
    if jsonb_typeof(h) <> 'object' then h := null; end if;
  exception when others then h := null;
  end;
  v := btrim(h->>'x-request-id');
  perform set_config('app.audit_h_req',
    case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(v) else '' end, true);
  v_reason := h->>'x-audit-reason';
  if v_reason is not null then
    begin
      v_reason := app.url_decode(v_reason);
    exception when others then null;   -- malformed escapes: keep the header as sent
    end;
  end if;
  perform set_config('app.audit_h_reason', coalesce(app.audit_clean_reason(v_reason), ''), true);
  perform set_config('app.audit_h_app', coalesce(app.audit_clean_app(h->>'x-client-app'), ''), true);
  perform set_config('app.audit_h_screen', coalesce(left(nullif(btrim(h->>'x-client-screen'), ''), 200), ''), true);
  perform set_config('app.audit_h_ua', coalesce(left(nullif(btrim(h->>'user-agent'), ''), 500), ''), true);
  v_ip := nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '');
  if v_ip is not null then
    begin
      v_ip := host(v_ip::inet);
    exception when others then v_ip := null;
    end;
  end if;
  perform set_config('app.audit_h_ip', coalesce(v_ip, ''), true);
  perform set_config('app.audit_h_raw', coalesce(p_raw, ''), true);
end $$;

-- The context for one audit entry. The explicit settings (set_audit_context,
-- or set_config by a job) win over the request headers.
create or replace function app.audit_context(
  out reason text, out correlation_id uuid, out client_app text, out client_screen text,
  out user_agent text, out ip inet)
language plpgsql set search_path = app, public, extensions as $$
declare v_raw text := coalesce(current_setting('request.headers', true), '');
        v text;
begin
  if v_raw is distinct from coalesce(current_setting('app.audit_h_raw', true), '') then
    perform app.audit_parse_headers(v_raw);
  end if;
  reason := coalesce(app.audit_clean_reason(current_setting('app.audit_reason', true)),
                     nullif(current_setting('app.audit_h_reason', true), ''));
  v := btrim(current_setting('app.correlation_id', true));
  correlation_id := coalesce(
    case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end,
    nullif(current_setting('app.audit_h_req', true), '')::uuid);
  client_app := coalesce(app.audit_clean_app(current_setting('app.client_app', true)),
                         nullif(current_setting('app.audit_h_app', true), ''));
  client_screen := nullif(current_setting('app.audit_h_screen', true), '');
  user_agent := nullif(current_setting('app.audit_h_ua', true), '');
  ip := nullif(current_setting('app.audit_h_ip', true), '')::inet;
end $$;

-- For RPCs and jobs: every row change for the rest of this transaction
-- carries this reason (and correlation id). A blank reason leaves any reason
-- already set in place.
create or replace function app.set_audit_context(p_reason text, p_correlation uuid default null) returns void
language plpgsql set search_path = app, public, extensions as $$
begin
  if app.audit_clean_reason(p_reason) is not null then
    perform set_config('app.audit_reason', app.audit_clean_reason(p_reason), true);
  end if;
  if p_correlation is not null then
    perform set_config('app.correlation_id', p_correlation::text, true);
  end if;
end $$;

revoke execute on function app.audit_parse_headers(text), app.audit_context() from public, anon, authenticated;
grant execute on function app.set_audit_context(text, uuid), app.url_decode(text),
  app.audit_clean_reason(text), app.audit_clean_app(text) to authenticated;
grant execute on all functions in schema app to service_role;
