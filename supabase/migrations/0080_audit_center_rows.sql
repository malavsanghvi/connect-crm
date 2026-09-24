-- Settings changes are audited, but until now they were invisible in the
-- center's own audit log: app.audit_row() takes center_id from the row's
-- center_id column, and app.centers has none (its key IS the center), so
-- every centers.insert / centers.update entry was written with center_id
-- NULL and only platform admins could read it (audit_read policy).
--
-- Same function as 0011, with one change: for the centers table the entry
-- belongs to the center itself. No policy or permission changes.

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_center uuid; v_id text; v_before jsonb; v_after jsonb;
begin
  v_before := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_table_name = 'centers' then
    v_center := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);
  else
    v_center := coalesce((v_after->>'center_id')::uuid, (v_before->>'center_id')::uuid);
  end if;
  v_id     := coalesce(v_after->>'id', v_before->>'id');
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  -- A deleted center's own entry cannot reference it any more.
  if tg_table_name = 'centers' and tg_op = 'DELETE' then v_center := null; end if;
  insert into app.audit_log (center_id, actor_user_id, action, record_table, record_id, before, after)
  values (v_center, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          app.audit_mask(v_before), app.audit_mask(v_after));
  return coalesce(new, old);
end $$;
