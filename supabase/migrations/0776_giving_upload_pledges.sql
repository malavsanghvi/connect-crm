-- 0776: upload pledges from a spreadsheet (owner ask 2026-10-13: "giving should allow bulk upload of pledges"; GV-U slice B).
-- NEEDS OWNER OK: a bulk way to write pledges, a new table with a read policy, and cancelling a whole upload.
--
-- What is added, and only this:
--   app.giving_uploads                              one row per upload a person confirmed: pledges (this file) or donations (0777),
--                                                   the file's name and fingerprint, the reason, how many rows and the total, and
--                                                   (pledges only) when and why it was cancelled. Written only by the functions
--                                                   below; read by Giving staff (giving.view, giving.manage) and by whoever made it.
--   app.giving_upload_households(center, values)    read only: for each value in the file's household column, the households it
--                                                   names. Any identifier first (app.resolve_identifier, 0015: Connect household or
--                                                   member number, the community's own household and member IDs, the old CRM,
--                                                   QuickBooks, a bank payer name...), then, only for a value no identifier matched,
--                                                   households whose name or an adult's name contains it ('name', always a pick,
--                                                   never chosen for the person). Merged households are left out. With the household
--                                                   card fields a picker shows; never a member list (no child's name).
--   app.record_pledge_upload(center, key, file, sha256, reason, rows)
--                                                   records every row as ONE pledge through app._record_manual_pledge_core (0775),
--                                                   the rules of recording a pledge by hand (0745): giving.manage, Giving on (and
--                                                   Opportunities for a row that names one), the household in this community, an
--                                                   adult pledger or none, the campaign kinds, the due date (the community's default
--                                                   when the row has none). All or nothing: one row refused refuses the upload, with
--                                                   the row number. Once: the same key returns the upload it recorded (replayed);
--                                                   each pledge's own key is upl:<upload id>:<row>. A row that looks like a pledge
--                                                   already recorded (same household, amount, purpose and day, not cancelled; an
--                                                   earlier row of the same file included) is refused unless the person ticked
--                                                   "Record anyway" for it. At most 500 rows. Source "manual" (no new source).
--   app.cancel_pledge_upload(center, upload, reason)
--                                                   cancels every pledge of a pledge upload, together, while none of them has any
--                                                   money applied or a write-off asked: status cancelled, with the reason in each
--                                                   audit entry. giving.manage; nothing is deleted. A donations upload is never
--                                                   cancelled (a wrong payment is fixed by a refund a second person approves).
--
-- What does NOT change: no other function, policy or permission. The pledges go through the triggers every pledge goes through
-- (numbering, the opportunity guards, the default due date of 0775, the audit). A pledge is not cash: nothing is posted to the books.
set client_min_messages = warning;

-- ── The uploads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app.giving_uploads (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  kind            text not null check (kind in ('pledges', 'payments')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  file_name       text check (file_name is null or char_length(file_name) <= 200),
  file_sha256     text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  reason          text not null check (char_length(reason) between 3 and 500),
  row_count       integer not null check (row_count between 1 and 500),
  total_cents     bigint not null check (total_cents > 0),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  constraint giving_uploads_key_uniq unique (center_id, idempotency_key),
  constraint giving_uploads_cancel_pledges_only check (cancelled_at is null or kind = 'pledges')
);
create index if not exists giving_uploads_center_kind on app.giving_uploads (center_id, kind, created_at desc);
create index if not exists giving_uploads_sha on app.giving_uploads (center_id, file_sha256) where file_sha256 is not null;
comment on table app.giving_uploads is
  'One row per confirmed Giving upload (pledges 0776, donations 0777). Each pledge or payment it recorded carries the key upl:<id>:<row>. Written only by app.record_pledge_upload, app.record_donation_upload and app.cancel_pledge_upload.';

alter table app.giving_uploads enable row level security;
drop policy if exists giving_uploads_read on app.giving_uploads;
create policy giving_uploads_read on app.giving_uploads for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage') or created_by = auth.uid());
revoke insert, update, delete on app.giving_uploads from anon, authenticated;
grant select on app.giving_uploads to authenticated;

-- Giving's own table: hidden while Giving is switched off, like every table of a switchable module (0101, 0741).
insert into app.module_tables (table_name, module_key) values ('giving_uploads', 'giving')
  on conflict (table_name) do update set module_key = excluded.module_key;
drop policy if exists module_switch on app.giving_uploads;
create policy module_switch on app.giving_uploads as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));

drop trigger if exists audit_giving_uploads on app.giving_uploads;
create trigger audit_giving_uploads after insert or update or delete on app.giving_uploads
  for each row execute function app.audit_row();

-- ── Which households a file's values name ───────────────────────────────────────────────────────────────────────────────────────
create or replace function app.giving_upload_households(p_center uuid, p_values text[])
returns table (input text, match_kind text, household_id uuid, person_id uuid, household_name text, household_number text,
               org_household_id text, primary_member text, city text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if not (app.has_permission(p_center, 'giving.manage') or app.has_permission(p_center, 'giving.record_offline')) then
    raise exception 'You do not have permission to upload to Giving.' using errcode = '42501';
  end if;
  return query
  with v as (
    select distinct left(btrim(x), 200) as input
      from unnest(coalesce(p_values, '{}'::text[])) x
     where btrim(coalesce(x, '')) <> ''
     limit 1000
  ),
  -- A person's own ID (a member number, the community's member ID, a contact ID of the old CRM) names the household the person is in
  -- now: an ID recorded before the person joined a household carries none of its own.
  hits as (
    select x.input, x.match_kind, x.household_id, x.person_id
      from (select v.input, r.kind as match_kind, r.person_id,
                   coalesce(r.household_id,
                            (select hm.household_id from app.household_members hm
                              where hm.person_id = r.person_id and hm.left_at is null
                              order by hm.is_primary desc limit 1)) as household_id
              from v
              cross join lateral app.resolve_identifier(p_center, v.input) r) x
     where x.household_id is not null
  ),
  names as (
    select v.input, 'name'::text as match_kind, h.id as household_id, null::uuid as person_id,
           row_number() over (partition by v.input order by h.display_name, h.id) as n
      from v
      join app.households h on h.center_id = p_center and h.merged_into_id is null
     where char_length(v.input) >= 2
       and not exists (select 1 from hits where hits.input = v.input)
       and (h.display_name ilike '%' || replace(replace(replace(v.input, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            -- An adult's name only (the rule of 0653 and 0745): a child's name never finds a household here, nor does someone who has died.
            or exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                        where hm.household_id = h.id and hm.left_at is null and p.merged_into_id is null and not p.is_deceased
                          and ((p.date_of_birth is not null and p.date_of_birth <= (current_date - interval '18 years')::date)
                               or (p.date_of_birth is null and hm.role in ('primary', 'spouse', 'parent')))
                          and (p.first_name || ' ' || p.last_name) ilike '%' || replace(replace(replace(v.input, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
  ),
  found as (
    select input, match_kind, household_id, person_id from hits
    union all
    select input, match_kind, household_id, person_id from names where n <= 10
  )
  select distinct on (f.input, f.household_id, f.person_id)
         f.input, f.match_kind, f.household_id, f.person_id,
         c.household_name, c.household_number, c.org_household_id, c.primary_member, c.city
    from found f
    join app.households h on h.id = f.household_id and h.center_id = p_center and h.merged_into_id is null
    left join lateral app.household_card(f.household_id) c on true
   order by f.input, f.household_id, f.person_id, f.match_kind;
end $$;
revoke execute on function app.giving_upload_households(uuid, text[]) from public, anon;
grant execute on function app.giving_upload_households(uuid, text[]) to authenticated;
comment on function app.giving_upload_households(uuid, text[]) is
  'For a Giving upload: the households each value names, by any identifier (app.resolve_identifier) and, only where none matched, by name (match_kind name: always a pick). Household card fields, never the members. giving.manage or giving.record_offline (0776).';

-- ── Recording a pledge upload ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.record_pledge_upload(
  p_center uuid,
  p_idempotency_key text,
  p_file_name text,
  p_file_sha256 text,
  p_reason text,
  p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_reason text := app.audit_clean_reason(p_reason);
  v_file text := nullif(left(btrim(coalesce(p_file_name, '')), 200), '');
  v_sha text := nullif(lower(btrim(coalesce(p_file_sha256, ''))), '');
  v_up app.giving_uploads;
  v_count integer;
  v_total bigint;
  v_tz text;
  v_today date;
  x record;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_on date;
  v_same app.pledges;
  v_row_reason text;
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.has_permission(p_center, 'giving.manage') then
    raise exception 'You do not have permission to upload pledges (it needs giving.manage).' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'An upload needs a confirmation key of 8 to 120 characters, so that recording it twice cannot count it twice.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There are no rows to record.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'An upload holds at most 500 rows; this one has %. Split the file and upload each part.', jsonb_array_length(p_rows) using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why these pledges are recorded (for example "Pledge cards from the annual dinner"). It shows in each family''s History.'
      using errcode = '22023';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    v_sha := null;
  end if;
  select count(*)::integer, coalesce(sum((e->>'amount_cents')::bigint), 0) into v_count, v_total from jsonb_array_elements(p_rows) e;
  if v_total <= 0 then
    raise exception 'The rows add up to nothing; there is nothing to record.' using errcode = '22023';
  end if;
  -- Each row once: a row number twice would give two rows one key (the second a replay of the first) and skew the count and total.
  if (select count(distinct e->>'row') from jsonb_array_elements(p_rows) e) <> v_count then
    raise exception 'The same row number appears twice. Nothing was recorded; check the file again.' using errcode = '22023';
  end if;

  -- Once: the same confirmation returns the upload it recorded (a retry after a lost answer, or two clicks that arrived together).
  perform app.set_audit_context(format('Upload: %s', v_reason));
  insert into app.giving_uploads (center_id, kind, idempotency_key, file_name, file_sha256, reason, row_count, total_cents, created_by)
    values (p_center, 'pledges', v_key, v_file, v_sha, v_reason, v_count, v_total, auth.uid())
    on conflict (center_id, idempotency_key) do nothing
    returning * into v_up;
  if not found then
    select * into v_up from app.giving_uploads u where u.center_id = p_center and u.idempotency_key = v_key;
    if v_up.kind <> 'pledges' or v_up.row_count <> v_count or v_up.total_cents <> v_total or v_up.file_sha256 is distinct from v_sha then
      raise exception 'This confirmation was already used for a different upload. Nothing was recorded.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'upload_id', v_up.id, 'replayed', true, 'count', v_up.row_count, 'total_cents', v_up.total_cents,
      'pledges', coalesce((select jsonb_agg(jsonb_build_object('row', split_part(p.idempotency_key, ':', 3)::integer, 'pledge_id', p.id,
                                                                'pledge_number', p.pledge_number, 'household_id', p.household_id,
                                                                'amount_cents', p.amount_cents, 'due_on', p.due_on)
                                            order by split_part(p.idempotency_key, ':', 3)::integer)
                             from app.pledges p
                            where p.center_id = p_center and p.idempotency_key like 'upl:' || v_up.id::text || ':%'), '[]'::jsonb));
  end if;

  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = p_center;
  v_today := (now() at time zone v_tz)::date;

  for x in
    select (e->>'row')::integer as row_no,
           (e->>'household_id')::uuid as household_id,
           (e->>'amount_cents')::bigint as amount_cents,
           nullif(e->>'fund_id', '')::uuid as fund_id,
           nullif(e->>'campaign_id', '')::uuid as campaign_id,
           nullif(e->>'opportunity_id', '')::uuid as opportunity_id,
           nullif(e->>'pledged_on', '')::date as pledged_on,
           nullif(e->>'due_on', '')::date as due_on,
           nullif(e->>'pledged_by_person_id', '')::uuid as pledged_by,
           nullif(btrim(e->>'dedication'), '') as dedication,
           nullif(btrim(e->>'note'), '') as note,
           coalesce((e->>'repeat_ok')::boolean, false) as repeat_ok
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
     order by t.ord
  loop
    if x.row_no is null or x.row_no < 1 then
      raise exception 'Every row needs its row number from the file. Nothing was recorded.' using errcode = '22023';
    end if;
    -- A repeat: the same household, amount, purpose and day as a pledge already recorded (any source; an earlier row of this upload
    -- is recorded by now, so it counts too), unless the person ticked "Record anyway" for this row.
    v_on := coalesce(x.pledged_on, v_today);
    if not x.repeat_ok then
      select * into v_same from app.pledges p
       where p.center_id = p_center and p.household_id = x.household_id and p.amount_cents = x.amount_cents
         and p.status <> 'cancelled'
         and (p.pledged_at at time zone v_tz)::date = v_on
         and case when x.opportunity_id is not null then p.opportunity_id = x.opportunity_id
                  when x.campaign_id is not null then p.campaign_id = x.campaign_id
                  when x.fund_id is not null then p.fund_id = x.fund_id and p.campaign_id is null
                  else p.fund_id is null and p.campaign_id is null and p.opportunity_id is null end
       order by p.pledged_at
       limit 1;
      if found then
        raise exception 'Row %: this looks like a repeat of % (the same family, amount, purpose and day). Nothing was recorded. Tick "Record anyway" on that row if it is a second pledge.',
          x.row_no, coalesce(v_same.pledge_number, 'a pledge already recorded') using errcode = '23505';
      end if;
    end if;
    v_row_reason := left(v_reason || coalesce(' · ' || x.note, ''), 500);
    begin
      v_r := app._record_manual_pledge_core('upl:' || v_up.id::text || ':' || x.row_no::text, p_center, x.household_id, x.amount_cents,
                                            v_row_reason, x.fund_id, x.campaign_id, x.opportunity_id, null, x.due_on, x.pledged_by,
                                            x.dedication, x.pledged_on);
    exception when others then
      -- The row number leads the sentence. A row that names another community's household is a problem of the file, not of the
      -- person's permissions, so it is said as such (the portal shows the sentence itself).
      raise exception 'Row %: %', x.row_no, sqlerrm using errcode = case when sqlstate = '42501' then '22023' else sqlstate end;
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_object('row', x.row_no, 'pledge_id', v_r->>'pledge_id', 'pledge_number', v_r->>'pledge_number',
                                                           'household_id', v_r->>'household_id', 'amount_cents', (v_r->>'amount_cents')::bigint,
                                                           'due_on', v_r->>'due_on'));
  end loop;

  return jsonb_build_object('upload_id', v_up.id, 'replayed', false, 'count', v_count, 'total_cents', v_total, 'pledges', v_out);
end $$;
revoke execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) to authenticated;
comment on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) is
  'Records an uploaded file of pledges, all or nothing, each row through the rules of recording a pledge by hand (0745/0775). The same key returns the same upload. A repeat of a recorded pledge is refused unless its row says repeat_ok. At most 500 rows (0776).';

-- ── Cancelling a pledge upload ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.cancel_pledge_upload(p_center uuid, p_upload uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_up app.giving_uploads;
  v_reason text := app.audit_clean_reason(p_reason);
  v_bad app.pledges;
  v_n integer;
begin
  select * into v_up from app.giving_uploads u where u.id = p_upload;
  if not found then
    raise exception 'That upload was not found.' using errcode = 'P0002';
  end if;
  if p_center is null or p_center <> v_up.center_id then
    raise exception 'That upload belongs to a different community than the one you are working in. Nothing was cancelled.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_up.center_id, 'giving');
  if not app.has_permission(v_up.center_id, 'giving.manage') then
    raise exception 'You do not have permission to cancel an upload (it needs giving.manage).' using errcode = '42501';
  end if;
  if v_up.kind <> 'pledges' then
    raise exception 'A donations upload cannot be cancelled. A payment recorded by mistake is fixed with a refund that a second person approves.'
      using errcode = '22023';
  end if;
  -- The upload row first, then its pledges: two cancellations at once wait for each other, and the second finds it cancelled.
  select * into v_up from app.giving_uploads u where u.id = p_upload for update;
  if v_up.cancelled_at is not null then
    return jsonb_build_object('upload_id', v_up.id, 'cancelled', 0, 'already', true);
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why this upload is cancelled. It shows in each family''s History.' using errcode = '22023';
  end if;
  perform 1 from app.pledges p where p.center_id = v_up.center_id and p.idempotency_key like 'upl:' || v_up.id::text || ':%' order by p.id for update;
  select * into v_bad from app.pledges p
   where p.center_id = v_up.center_id and p.idempotency_key like 'upl:' || v_up.id::text || ':%'
     and (p.paid_cents <> 0 or p.status <> 'open' or p.written_off_by is not null
          or exists (select 1 from app.payment_allocations a where a.pledge_id = p.id))
   order by p.pledge_number
   limit 1;
  if found then
    raise exception 'Nothing was cancelled: % already has money applied, a write-off asked or a status of its own. Once a pledge of an upload has moved, each pledge is handled on its own.',
      coalesce(v_bad.pledge_number, 'a pledge of this upload') using errcode = '23514';
  end if;
  perform app.set_audit_context(format('Upload cancelled: %s', v_reason));
  update app.pledges p set status = 'cancelled', closed_at = now()
   where p.center_id = v_up.center_id and p.idempotency_key like 'upl:' || v_up.id::text || ':%';
  get diagnostics v_n = row_count;
  update app.giving_uploads set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason where id = v_up.id;
  return jsonb_build_object('upload_id', v_up.id, 'cancelled', v_n, 'already', false);
end $$;
revoke execute on function app.cancel_pledge_upload(uuid, uuid, text) from public, anon;
grant execute on function app.cancel_pledge_upload(uuid, uuid, text) to authenticated;
comment on function app.cancel_pledge_upload(uuid, uuid, text) is
  'Cancels every pledge of a pledge upload together while none has money applied, a write-off asked or another status: giving.manage, a reason (each audit entry''s). Nothing is deleted (0776).';

-- ── The portal's actions, in the activity allowlist ──────────────────────────────────────────────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.upload_pledges',       'Upload pledges from a spreadsheet', null::text),
    ('giving.cancel_pledge_upload', 'Cancel a pledge upload',            null::text)
  ) as v(k, l, e);
