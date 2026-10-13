-- 0747 · Giving: export a list for the treasurer, and pair a card payout with its bank line (docs/GIVING_REDESIGN.md slice 9;
-- section 2 "Export giving" and "Handle a payout difference", section 10 decision 5). Owner decisions 2026-10-13: data.export
-- is switched on for treasurers; a fresh 2FA code for every export (strict); pairing and unpairing need giving.manage; no second
-- approver for a difference.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   data.export          The one data-export permission (src/lib/entitlements.ts listed it as planned). The Treasurer role holds it
--                        from now on. Nothing else changes for any role. People's own export keeps people.manage.
--   Giving exports       app.giving_export_check(center, list) and app.record_giving_export(center, list, detail). Lists: payments,
--                        pledges, bank_lines (needs Bank reconciliation) and year_end_totals (needs Statements). Each needs
--                        data.export AND the list's own read permission, Giving on, an authenticator app, a 2FA code from the last
--                        5 minutes AND a code that no earlier Giving export used: one code, one file. The check writes nothing; the
--                        record writes one audit entry export.giving_<list> with what the portal passes (row count, chips, year,
--                        whether a search was used) plus the code's time. Never the file, never a search's text.
--   Card payouts         payouts gains the reason for a difference (difference_code, difference_note) and who paired it and when.
--                        A paired payout with a difference always has its reason (check constraint), and a bank line holds at most
--                        one payout (unique index).
--     explain_payout     Pairs a payout (provider side) with the bank's card-payout line. Same community; Giving, Bank
--                        reconciliation and Accounting on; giving.manage. When the amounts differ, a typed reason and a sentence
--                        are required. Sets payouts.matched and variance_cents (bank minus net) and bank_transactions.payout_id;
--                        the bank line keeps its status 'payout'. Asking again for the same pair changes nothing. Refused in a
--                        locked month. No money moves and no ledger posting is made (nothing in the code posts payouts;
--                        payouts.ledger_posting_id stays as it is).
--     unpair_payout      The undo, with a reason, until the month is locked.
--     payouts_close_state  What the month-end close reads for "Payment payouts matched to bank deposits": payouts that arrived in
--                        the month, how many are paired, explained differences, and the bank's card-payout lines still unpaired.
--                        proven = nothing left unpaired on either side (null when Bank reconciliation is off: then the item stays a
--                        person's check).
--   The worker's payout sync (worker_upsert_payout, 0212) already leaves a matched payout untouched: it is not redefined.
--   Nothing here is redefined; every function is new. Row changes are audited by the existing audit_<table> triggers with the
--   reason set by app.set_audit_context.

-- ── The data-export permission, for treasurers ─────────────────────────────────────────────────────────────────────────
update app.roles
   set permissions = permissions || '["data.export"]'::jsonb
 where key = 'treasurer' and jsonb_typeof(permissions) = 'array' and not (permissions ? 'data.export');

-- The latest 2FA code's time in this session's token (amr totp timestamp), or null.
create or replace function app.step_up_stamp() returns numeric
language sql stable set search_path = app, public, extensions as $$
  select max((a->>'timestamp')::numeric)
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end) a
   where jsonb_typeof(a) = 'object' and a->>'method' = 'totp' and coalesce(a->>'timestamp', '') ~ '^[0-9]+(\.[0-9]+)?$'
$$;

-- A person's recent exports, found fast (the reused-code check reads the last few minutes only).
create index if not exists audit_log_export_actor_idx on app.audit_log (actor_user_id, occurred_at desc) where action like 'export.%';

-- ── app.giving_export_check (new) ─────────────────────────────────────────────────────────────────────────────────────
create or replace function app.giving_export_check(p_center uuid, p_list text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_list text := lower(btrim(coalesce(p_list, ''))); v_stamp numeric;
begin
  if v_user is null then raise exception 'Sign in to export.' using errcode = 'insufficient_privilege'; end if;
  if v_list not in ('payments', 'pledges', 'bank_lines', 'year_end_totals') then
    raise exception 'Unknown Giving export "%".', p_list using errcode = '22023';
  end if;
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if v_list = 'bank_lines' then perform app.assert_module_enabled(p_center, 'giving_bank'); end if;
  if v_list = 'year_end_totals' then perform app.assert_module_enabled(p_center, 'giving_statements'); end if;
  if not app.has_permission(p_center, 'data.export') then
    raise exception 'Exporting needs the data-export permission (data.export).' using errcode = '42501';
  end if;
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')
          or (v_list = 'bank_lines' and app.has_permission(p_center, 'giving.record_offline'))) then
    raise exception 'Exporting this list needs permission to see it.' using errcode = '42501';
  end if;
  -- One 2FA code, one file: an authenticator is required, the code is from the last 5 minutes and no earlier Giving export used it.
  if not app.has_verified_totp(v_user) then
    raise exception using errcode = 'CCSTP', message = 'This needs a fresh 2FA check.', detail = 'export.giving_' || v_list,
      hint = 'Set up an authenticator app in Account › Security, then try again.';
  end if;
  if not app.has_recent_step_up(5) then
    raise exception using errcode = 'CCSTP', message = 'This needs a fresh 2FA check.', detail = 'export.giving_' || v_list,
      hint = 'Enter the 6-digit code from your authenticator app, then try again.';
  end if;
  v_stamp := app.step_up_stamp();
  if exists (select 1 from app.audit_log l
              where l.actor_user_id = v_user and l.action like 'export.%' and l.action like 'export.giving\_%'
                and l.occurred_at > now() - interval '15 minutes'
                and l.after->>'step_up_at' = v_stamp::text) then
    raise exception using errcode = 'CCSTP', message = 'This needs a fresh 2FA check.', detail = 'export.giving_' || v_list,
      hint = 'Each export needs a new code: enter the 6-digit code from your authenticator app, then try again.';
  end if;
end $$;

comment on function app.giving_export_check(uuid, text) is
  'Can the caller export this Giving list now (data.export + the list''s read permission, modules, a 2FA code no earlier Giving export used)? Writes nothing (0747).';

-- ── app.record_giving_export (new) ────────────────────────────────────────────────────────────────────────────────────
create or replace function app.record_giving_export(p_center uuid, p_list text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_list text := lower(btrim(coalesce(p_list, ''))); v_detail jsonb;
begin
  perform app.giving_export_check(p_center, v_list);
  v_detail := case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end;
  -- Counts and filter words only (the portal never passes data); the code's time makes the next export ask for a new one.
  v_detail := v_detail - 'step_up_at' - 'list'
              || jsonb_build_object('list', v_list, 'step_up_at', app.step_up_stamp()::text);
  perform app.log_audit(p_center, 'export.giving_' || v_list, null, null, null, v_detail, null);
end $$;

comment on function app.record_giving_export(uuid, text, jsonb) is
  'Records one Giving export (audit export.giving_<list>: rows, chips, year, searched; never the contents) after app.giving_export_check (0747).';

-- ── Card payouts: the reason for a difference ─────────────────────────────────────────────────────────────────────────
alter table app.payouts
  add column if not exists difference_code text,
  add column if not exists difference_note text,
  add column if not exists matched_by uuid references auth.users(id),
  add column if not exists matched_at timestamptz;

alter table app.payouts drop constraint if exists payouts_difference_code_check;
alter table app.payouts add constraint payouts_difference_code_check
  check (difference_code is null or difference_code in ('provider_fees', 'refund_or_dispute', 'bank_fee', 'rounding', 'other'));
alter table app.payouts drop constraint if exists payouts_difference_explained;
alter table app.payouts add constraint payouts_difference_explained
  check (not matched or variance_cents = 0 or (difference_code is not null and nullif(btrim(coalesce(difference_note, '')), '') is not null));

comment on column app.payouts.difference_code is
  'Why the bank line differs from the payout''s net (provider_fees, refund_or_dispute, bank_fee, rounding, other); set by app.explain_payout (0747).';
comment on column app.payouts.difference_note is 'The treasurer''s sentence about the difference (0747).';

create unique index if not exists bank_transactions_payout_once on app.bank_transactions (payout_id) where payout_id is not null;

-- The month a payout or bank line belongs to is locked (accounting_periods.status closed).
create or replace function app._payout_month_locked(p_center uuid, p_days date[]) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select min(ap.period_month) from app.accounting_periods ap
   where ap.center_id = p_center and ap.status = 'closed'
     and ap.period_month in (select date_trunc('month', d)::date from unnest(p_days) d where d is not null)
$$;
revoke execute on function app._payout_month_locked(uuid, date[]) from public, anon, authenticated;

-- ── app.explain_payout (new) ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.explain_payout(p_payout uuid, p_bank_line uuid, p_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare po app.payouts; b app.bank_transactions; v_diff bigint; v_code text := nullif(lower(btrim(coalesce(p_code, ''))), '');
        v_locked date; v_other date;
begin
  if auth.uid() is null then raise exception 'Sign in to pair a card payout.' using errcode = 'insufficient_privilege'; end if;
  select * into po from app.payouts where id = p_payout for update;
  if po.id is null then raise exception 'That card payout was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(po.center_id, 'giving');
  perform app.assert_module_enabled(po.center_id, 'giving_bank');
  perform app.assert_module_enabled(po.center_id, 'accounting');
  if not app.has_permission(po.center_id, 'giving.manage') then
    raise exception 'Pairing a card payout with the bank needs giving.manage.' using errcode = '42501';
  end if;
  select * into b from app.bank_transactions where id = p_bank_line for update;
  if b.id is null or b.center_id <> po.center_id then
    raise exception 'That bank line is not one of this community''s.' using errcode = '22023';
  end if;
  -- The same pair again: nothing changes.
  if po.matched and b.payout_id = po.id then
    return jsonb_build_object('already', true, 'payout_id', po.id, 'bank_transaction_id', b.id, 'difference_cents', po.variance_cents);
  end if;
  if po.matched then
    select posted_on into v_other from app.bank_transactions where payout_id = po.id;
    raise exception 'This payout is already paired with the bank line of %. Undo that pairing first.',
      coalesce(to_char(v_other, 'FMMonth FMDD, YYYY'), 'another day') using errcode = '22023';
  end if;
  if b.payout_id is not null then
    raise exception 'That bank line is already paired with another payout.' using errcode = '22023';
  end if;
  if b.status <> 'payout' then
    raise exception 'That bank line is not a card payout line.' using errcode = '22023';
  end if;
  if b.amount_cents = 0 or po.net_cents = 0 or sign(b.amount_cents) <> sign(po.net_cents) then
    raise exception 'The bank line and the payout do not move money the same way, so they cannot be the same payout.' using errcode = '22023';
  end if;
  v_locked := app._payout_month_locked(po.center_id, array[b.posted_on, po.arrives_on]);
  if v_locked is not null then
    raise exception '% is locked, so its card payouts cannot be paired.', to_char(v_locked, 'FMMonth YYYY') using errcode = '22023';
  end if;
  v_diff := b.amount_cents - po.net_cents;
  if v_diff <> 0 then
    if v_code is null or v_code not in ('provider_fees', 'refund_or_dispute', 'bank_fee', 'rounding', 'other') then
      raise exception 'Choose why the bank line and the payout differ.' using errcode = '22023';
    end if;
    perform app.payments_require_reason(p_note, 'accept this difference');
  else
    v_code := null;
    perform app.set_audit_context(coalesce(app.audit_clean_reason(p_note), 'Card payout paired with its bank line; the amounts agree'));
  end if;
  update app.payouts
     set matched = true, variance_cents = v_diff, difference_code = v_code,
         difference_note = case when v_diff <> 0 then app.audit_clean_reason(p_note) end,
         matched_by = auth.uid(), matched_at = now()
   where id = po.id;
  update app.bank_transactions set payout_id = po.id, matched_by = auth.uid(), matched_at = now() where id = b.id;
  return jsonb_build_object('already', false, 'payout_id', po.id, 'bank_transaction_id', b.id, 'difference_cents', v_diff);
end $$;

comment on function app.explain_payout(uuid, uuid, text, text) is
  'Pairs a card payout with the bank''s card-payout line; a difference needs a typed reason and a sentence (giving.manage; Giving, Bank reconciliation, Accounting). Moves no money (0747).';

-- ── app.unpair_payout (new) ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.unpair_payout(p_payout uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare po app.payouts; v_posted date; v_locked date;
begin
  if auth.uid() is null then raise exception 'Sign in to undo a pairing.' using errcode = 'insufficient_privilege'; end if;
  select * into po from app.payouts where id = p_payout for update;
  if po.id is null then raise exception 'That card payout was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(po.center_id, 'giving');
  perform app.assert_module_enabled(po.center_id, 'giving_bank');
  perform app.assert_module_enabled(po.center_id, 'accounting');
  if not app.has_permission(po.center_id, 'giving.manage') then
    raise exception 'Undoing a card payout pairing needs giving.manage.' using errcode = '42501';
  end if;
  perform app.payments_require_reason(p_reason, 'undo this pairing');
  if not po.matched then
    return jsonb_build_object('already', true, 'payout_id', po.id);
  end if;
  select posted_on into v_posted from app.bank_transactions where payout_id = po.id;
  v_locked := app._payout_month_locked(po.center_id, array[v_posted, po.arrives_on]);
  if v_locked is not null then
    raise exception '% is locked, so its card payouts cannot be unpaired.', to_char(v_locked, 'FMMonth YYYY') using errcode = '22023';
  end if;
  update app.bank_transactions set payout_id = null, matched_by = null, matched_at = null where payout_id = po.id;
  update app.payouts
     set matched = false, variance_cents = 0, difference_code = null, difference_note = null, matched_by = null, matched_at = null
   where id = po.id;
  return jsonb_build_object('already', false, 'payout_id', po.id);
end $$;

comment on function app.unpair_payout(uuid, text) is
  'Undoes a card payout pairing, with a reason, until the month is locked (giving.manage) (0747).';

-- ── app.payouts_close_state (new) ─────────────────────────────────────────────────────────────────────────────────────
create or replace function app.payouts_close_state(p_center uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_from date := date_trunc('month', p_month)::date; v_to date; v_bank boolean; r record; bl record;
begin
  if p_center is null or p_month is null then raise exception 'Say which community and month.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'accounting');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')
          or app.has_permission(p_center, 'accounting.close') or app.has_permission(p_center, 'accounting.manage')) then
    raise exception 'The month-end close needs giving.view, giving.manage or accounting.close.' using errcode = '42501';
  end if;
  v_to := (v_from + interval '1 month')::date;
  v_bank := app.module_enabled(p_center, 'giving_bank');
  select count(*)::int as arrived, count(*) filter (where po.matched)::int as paired,
         count(*) filter (where po.matched and po.variance_cents <> 0)::int as explained,
         coalesce(sum(po.net_cents), 0)::bigint as net_cents,
         coalesce(sum(po.variance_cents) filter (where po.matched), 0)::bigint as difference_cents
    into r
    from app.payouts po
   where po.center_id = p_center and po.arrives_on >= v_from and po.arrives_on < v_to and po.net_cents <> 0;
  select count(*)::int as lines, count(*) filter (where b.payout_id is null)::int as unpaired, coalesce(sum(b.amount_cents), 0)::bigint as cents
    into bl
    from app.bank_transactions b
   where v_bank and b.center_id = p_center and b.status = 'payout' and b.posted_on >= v_from and b.posted_on < v_to;
  return jsonb_build_object(
    'month', v_from,
    'payouts', r.arrived, 'paired', r.paired, 'unpaired', r.arrived - r.paired, 'explained', r.explained,
    'net_cents', r.net_cents, 'difference_cents', r.difference_cents,
    'bank_on', v_bank,
    'bank_lines', case when v_bank then bl.lines end,
    'bank_lines_unpaired', case when v_bank then bl.unpaired end,
    'bank_cents', case when v_bank then bl.cents end,
    'proven', case when not v_bank then null else (r.arrived - r.paired = 0 and bl.unpaired = 0) end);
end $$;

comment on function app.payouts_close_state(uuid, date) is
  'Month-end close: card payouts that arrived in the month, paired, explained, and the bank''s card-payout lines still unpaired; proven when nothing is left unpaired (null when Bank reconciliation is off) (0747).';

revoke execute on function app.step_up_stamp(), app.giving_export_check(uuid, text), app.record_giving_export(uuid, text, jsonb),
  app.explain_payout(uuid, uuid, text, text), app.unpair_payout(uuid, text), app.payouts_close_state(uuid, date) from public, anon;
grant execute on function app.step_up_stamp(), app.giving_export_check(uuid, text), app.record_giving_export(uuid, text, jsonb),
  app.explain_payout(uuid, uuid, text, text), app.unpair_payout(uuid, text), app.payouts_close_state(uuid, date) to authenticated;

-- ── The portal's actions, in the activity allowlist ───────────────────────────────────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.export_list',    'Export a Giving list',                       null::text),
    ('giving.explain_payout', 'Pair a card payout with its bank line',      null::text),
    ('giving.unpair_payout',  'Undo a card payout pairing',                 null::text)
  ) as v(k, l, e);
