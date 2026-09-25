-- Wave E (stream e-access) · 3: the import engine and staff-only custom values (0401).
--
-- 0401 keeps staff-only custom values in app.custom_staff_values instead of the record's own
-- `custom` column. The import engine compares, records and undoes a record's custom values as one
-- object, so it now reads and writes them as one object again:
--   app.import_current   a record's `custom` includes its staff-only values (what staff see)
--   app.import_set       setting `custom` sets the whole object: a staff-only value that is not in
--                        it is removed (as it was when every value lived on the row)
--   app.import_undo      restores custom values from the import's own before-values (which include
--                        the staff-only ones), not from the row's audit entry (which never had them)
-- Nothing else about importing or undoing changes.

create or replace function app.import_current(p_table text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb; v_staff jsonb;
begin
  if p_table = 'household_members' then
    select to_jsonb(hm) into v from app.household_members hm
     where household_id::text = split_part(p_id, ':', 1) and person_id::text = split_part(p_id, ':', 2);
  else
    execute format('select to_jsonb(t) from app.%I t where t.id::text = $1', p_table) into v using p_id;
  end if;
  if v ? 'custom' then
    select s.custom into v_staff from app.custom_staff_values s
     where s.entity = p_table and s.record_key = app.custom_record_key(p_table, v);
    if v_staff is not null then v := jsonb_set(v, '{custom}', coalesce(v -> 'custom', '{}'::jsonb) || v_staff); end if;
  end if;
  return v;
end $$;

create or replace function app.import_set(p_table text, p_id text, p_changes jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_cols text; v_staff jsonb; v_drop jsonb;
begin
  if p_changes = '{}'::jsonb then return; end if;
  if jsonb_typeof(p_changes -> 'custom') = 'object' then
    select s.custom into v_staff from app.custom_staff_values s where s.entity = p_table and s.record_key = p_id;
    select jsonb_object_agg(k, 'null'::jsonb) into v_drop
      from jsonb_object_keys(coalesce(v_staff, '{}'::jsonb)) k where not (p_changes -> 'custom') ? k;
    if v_drop is not null then p_changes := jsonb_set(p_changes, '{custom}', (p_changes -> 'custom') || v_drop); end if;
  end if;
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_changes) k;
  if p_table = 'household_members' then
    execute format('update app.household_members t set (%s) = (select %s from jsonb_populate_record(null::app.household_members, $1))
                     where t.household_id::text = split_part($2, '':'', 1) and t.person_id::text = split_part($2, '':'', 2)',
                   v_cols, v_cols) using p_changes, p_id;
  else
    execute format('update app.%I t set (%s) = (select %s from jsonb_populate_record(null::app.%I, $1)) where t.id::text = $2',
                   p_table, v_cols, v_cols, p_table) using p_changes, p_id;
  end if;
end $$;

create or replace function app.import_undo(p_run uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; ch app.import_changes; v_before jsonb; v_cur jsonb; v_restore jsonb; k text; v_val jsonb;
        v_removed int := 0; v_restored int := 0; v_kept jsonb := '[]'::jsonb; v_later text; v_balances app.import_changes[] := '{}';
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('committed','reconciled') then raise exception 'Import #% is %; only a finished import can be undone.', r.run_number, r.status; end if;
  if r.committed_at < now() - interval '30 days' then
    raise exception 'Import #% finished more than 30 days ago, so it can no longer be undone.', r.run_number;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why this import is being undone. It goes in the audit log.'; end if;
  perform app.import_step_up('import.undo');
  perform app.set_audit_context(format('Undo import #%s · %s — %s', r.run_number, coalesce(r.file_name, r.entity), btrim(p_reason)), r.request_id);
  perform set_config('app.client_app', 'import', true);
  begin
    for ch in select * from app.import_changes where run_id = r.id and undone_at is null order by id desc loop
      -- A pledge balance moved by an allocation goes back after the allocations are gone.
      if ch.op = 'update' and ch.table_name = 'pledges' and ch.before ? 'paid_cents' and ch.after ? 'paid_cents' and not ch.after ? 'amount_cents' then
        v_balances := v_balances || ch;
        continue;
      end if;
      if ch.op = 'insert' then
        if app.import_delete(ch.table_name, ch.record_id) then v_removed := v_removed + 1; end if;
      else
        v_cur := app.import_current(ch.table_name, ch.record_id);
        if v_cur is null then continue; end if;
        select a.before into v_before from app.audit_log a
         where a.correlation_id = r.request_id and a.record_table = ch.table_name and a.record_id = ch.record_id
           and a.action = ch.table_name || '.update' and a.occurred_at >= ch.created_at - interval '1 minute'
         order by a.id limit 1;
        v_restore := '{}'::jsonb;
        for k in select jsonb_object_keys(coalesce(ch.before, '{}'::jsonb)) loop
          if (v_cur -> k) is distinct from (ch.after -> k) then
            v_kept := v_kept || jsonb_build_array(jsonb_build_object('table', ch.table_name, 'id', ch.record_id, 'column', k));
            continue;
          end if;
          -- The audit log's before-value, unless the log masks that field (birth dates, processor references).
          -- Custom values: the import's own record (0402), which includes the staff-only values kept apart
          -- from the row (0401); the row's audit entry never saw those.
          v_val := case when k <> 'custom' and v_before ? k and v_before ->> k is distinct from '***' then v_before -> k else ch.before -> k end;
          v_restore := v_restore || jsonb_build_object(k, v_val);
        end loop;
        if v_restore <> '{}'::jsonb then
          perform app.import_set(ch.table_name, ch.record_id, v_restore);
          v_restored := v_restored + 1;
        end if;
      end if;
      update app.import_changes set undone_at = now() where id = ch.id;
    end loop;
    foreach ch in array v_balances loop   -- newest first, so the oldest "before" is applied last
      if exists (select 1 from app.pledges where id = ch.record_id::uuid) then
        perform app.import_set('pledges', ch.record_id, ch.before);
        v_restored := v_restored + 1;
      end if;
      update app.import_changes set undone_at = now() where id = ch.id;
    end loop;
  exception when foreign_key_violation then
    select string_agg('#' || run_number, ', ' order by run_number) into v_later from app.import_runs
     where center_id = r.center_id and run_number > r.run_number and status in ('committed','reconciled','committing');
    raise exception 'Import #% cannot be undone: records it added are now used by other records%. Nothing was changed.', r.run_number,
      case when v_later is not null then ' (undo the later imports first: ' || v_later || ')' else ' (payments, pledges or memberships added since)' end;
  end;
  delete from app.import_keys k2 where k2.center_id = r.center_id and k2.run_id = r.id
     and not exists (select 1 from app.import_rows x where x.run_id = r.id and x.target_id = k2.record_id and x.status in ('updated','unchanged'));
  update app.import_rows set status = 'undone' where run_id = r.id and status = 'created';
  update app.import_runs set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = btrim(p_reason) where id = r.id;
  return jsonb_build_object('removed', v_removed, 'restored', v_restored, 'kept', v_kept);
end $$;


revoke execute on function app.import_set(text, text, jsonb), app.import_current(text, text) from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
