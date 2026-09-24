-- Wave 2 (stream s-core) · 3 of 5: every app table is audited, with context.
--
-- app.audit_row() now also records actor_role (JWT role), the module (from
-- app.module_tables), and the request context from app.audit_context():
-- correlation id, reason, client app and screen, user agent and IP. Tables
-- without center_id resolve it through the parent row where one exists
-- (gyan_levels -> gyan_goals, gyan_steps -> gyan_levels -> gyan_goals).
-- Tables without an `id` column pass their primary-key columns as trigger
-- arguments, so record_id is e.g. '<household_id>:<person_id>'.
--
-- The trigger stays lean for high-volume tables (scan_log, practice_logs,
-- sync_log, webhook_events): no per-row sub-transaction (headers are parsed
-- once per transaction, see 0100), one primary-key probe for the module, and
-- the no-op UPDATE short-circuit first.
--
-- audit_log stays append-only (audit_log_immutable) and hash-chained
-- (audit_log_chain); neither is touched here.

-- Bearer tokens join the masked fields: a change is still visible, the value is not.
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
  end
$$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id text; v_before jsonb; v_after jsonb; v_row jsonb; v_module text;
        v_col text; v_reason text; c record; i int;
begin
  v_before := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  v_row := coalesce(v_after, v_before);

  if tg_table_name = 'centers' then
    -- A center's own entries belong to it (0080); a deleted center's cannot.
    v_center := case when tg_op = 'DELETE' then null else (v_row->>'id')::uuid end;
  elsif tg_table_name = 'gyan_levels' then
    select g.center_id into v_center from app.gyan_goals g where g.id = (v_row->>'goal_id')::uuid;
  elsif tg_table_name = 'gyan_steps' then
    select g.center_id into v_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
     where l.id = (v_row->>'level_id')::uuid;
  else
    v_center := coalesce((v_after->>'center_id')::uuid, (v_before->>'center_id')::uuid);
  end if;

  if tg_nargs = 0 then
    v_id := v_row->>'id';
  else
    for i in 0 .. tg_nargs - 1 loop
      v_id := case when i = 0 then '' else v_id || ':' end || coalesce(v_row->>tg_argv[i], '');
    end loop;
  end if;

  select module_key into v_module from app.module_tables where table_name = tg_table_name;
  select * into c from app.audit_context();

  -- Rows that carry their own reason (write-off, refund, voting override, boli
  -- close, reference decision, role grant, module switch) supply it when the
  -- request did not.
  if c.reason is null and tg_op <> 'DELETE' then
    v_col := case tg_table_name
               when 'pledges' then 'write_off_reason' when 'payments' then 'refund_reason'
               when 'eligibility_snapshots' then 'override_reason' when 'bolis' then 'closed_reason'
               when 'membership_applications' then 'reference_reason'
               when 'role_grants' then 'reason' when 'center_modules' then 'reason' end;
    if v_col is not null and (v_after->>v_col) is distinct from (v_before->>v_col) then
      v_reason := app.audit_clean_reason(v_after->>v_col);
    end if;
  end if;

  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (v_center, auth.uid(), auth.jwt()->>'role', tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          app.audit_mask(v_before), app.audit_mask(v_after),
          coalesce(c.reason, v_reason), c.correlation_id, c.ip, c.user_agent, v_module, c.client_app, c.client_screen);
  return coalesce(new, old);
end $$;

-- Explicit audit entries (boli.close, account.link, ...) carry the same context.
create or replace function app.log_audit(p_center uuid, p_action text, p_table text, p_record text,
                                         p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare c record;
begin
  select * into c from app.audit_context();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (p_center, auth.uid(), auth.jwt()->>'role', p_action, p_table, p_record,
          app.audit_mask(p_before), app.audit_mask(p_after),
          coalesce(app.audit_clean_reason(p_reason), c.reason), c.correlation_id, c.ip, c.user_agent,
          (select module_key from app.module_tables where table_name = p_table), c.client_app, c.client_screen);
end $$;

-- audit_<table> on every app base table except audit_log itself. Existing
-- triggers keep their name and timing; they are recreated so tables without an
-- `id` column pass their primary key.
do $$
declare t record; v_args text;
begin
  for t in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r','p') and not c.relispartition and c.relname <> 'audit_log'
  loop
    v_args := '';
    if not exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'id' and not a.attisdropped) then
      select string_agg(quote_literal(a.attname), ', ' order by k.ord) into v_args
        from pg_constraint con
        cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
       where con.conrelid = t.oid and con.contype = 'p';
      if v_args is null then raise exception 'app.% has neither an id column nor a primary key to audit by', t.relname; end if;
    end if;
    if exists (select 1 from pg_trigger where tgrelid = t.oid and tgname = 'audit_' || t.relname) then
      execute format('drop trigger %I on app.%I', 'audit_' || t.relname, t.relname);
    end if;
    execute format('create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row(%s)',
                   'audit_' || t.relname, t.relname, v_args);
  end loop;
end $$;

-- History of one record, newest first, with who did it. Exactly the rows the
-- audit_read policy would show the caller (audit.view in that center, or a
-- platform admin); security definer only so the actor's name can be shown.
create or replace function app.record_history(p_table text, p_record text)
returns table (id bigint, occurred_at timestamptz, action text, center_id uuid, actor_user_id uuid, actor_name text,
               actor_role text, module text, client_app text, client_screen text, reason text, correlation_id uuid,
               before jsonb, after jsonb)
language sql stable security definer set search_path = app, public, extensions as $$
  select l.id, l.occurred_at, l.action, l.center_id, l.actor_user_id,
         case when l.actor_user_id is null then 'System'
              else coalesce((select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
                               from app.center_users cu join app.people p on p.id = cu.person_id
                              where cu.user_id = l.actor_user_id and cu.center_id = l.center_id),
                            case when exists (select 1 from app.accounts a where a.user_id = l.actor_user_id and a.is_platform_admin)
                                 then 'Platform team' end,
                            'Unknown user') end,
         l.actor_role, l.module, l.client_app, l.client_screen, l.reason, l.correlation_id, l.before, l.after
    from app.audit_log l
   where l.record_table = p_table and l.record_id = p_record
     and (app.has_permission(l.center_id, 'audit.view') or app.is_platform_admin())
   order by l.id desc
   limit 500
$$;

revoke execute on function app.audit_row() from public, anon, authenticated;
revoke execute on function app.log_audit(uuid, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function app.record_history(text, text) from public, anon;
grant execute on function app.record_history(text, text) to authenticated;
grant execute on all functions in schema app to service_role;
