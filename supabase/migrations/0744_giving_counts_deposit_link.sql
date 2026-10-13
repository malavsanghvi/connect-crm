-- 0744 · Offering counts: a count matched to its bank deposit line (docs/GIVING_REDESIGN.md slice 5, backlog B93;
-- owner decisions 2026-10-13).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A counting session (0003) is the cash and checks from the offering box, counted by two adults from different households
--   (0016's trigger, unchanged). Until now its bank deposit was a free-text slip reference. With Bank reconciliation on, the
--   counter now PICKS the deposit line from the bank statement instead:
--     * counting_sessions.bank_transaction_id   the bank line this count was deposited as (one count per line)
--     * counting_sessions.bank_line_marked      true when the match itself marked that line "matched" (so an undo only
--                                               reopens a line the match closed)
--     * app.link_count_to_bank_deposit(p_session, p_txn)
--         Giving, Offering counts and Bank reconciliation on; giving.record_offline or giving.manage (the rule of
--         match_deposit, latest body 0742); the count and the line in the same community; the count has its total and is not
--         matched yet; the line is money in, not matched to payments, a payout or another count, not ignored; and the AMOUNTS
--         ARE EXACTLY EQUAL (owner: a deposit that holds more than one count, or a count plus checks, uses Mark deposited);
--         a count already posted as a payment (0003's payment_id) is not matched again.
--         It links the count and marks the line matched. It posts nothing to QuickBooks (owner: no posting for counts).
--         A closed month does not stop it, as it does not stop match_deposit or confirm_bank_match today (0742: a closed
--         month is posted as an adjustment); only the undo is refused there.
--     * app.unlink_count_from_bank_deposit(p_session, p_reason)
--         The undo (owner, 2026-10-13): giving.manage only, a reason that is required and lands in the audit trail, refused
--         once the month of the deposit or of the count is locked (accounting_periods.status 'closed', as month-end close
--         and 0657 read it). It clears the link, and sets the line back to unmatched only when this link had marked it and
--         nothing else has been matched to it since.
--     * a guard trigger: the link is written only by these two functions. A direct write through row-level security (the
--       portal's insert and update of counts) cannot set or clear it, and a matched count's total, deposit reference and
--       date cannot change, nor can it be deleted, until the match is undone.
--     * a guard on the bank line: while a count is matched to it, a direct write (bank_txn_update, 0012, giving.manage)
--       cannot change its status, amount, date or community, so the line cannot be reopened past the undo's reason and
--       month lock and matched a second time.
--   Nothing else changes: the counting_sessions policies (0010, 0741's module_switch), counters_distinct_households (0016),
--   match_deposit and confirm_bank_match (0742) are untouched. Money rules are unchanged: no payment, allocation or ledger
--   row is written.

alter table app.counting_sessions
  add column bank_transaction_id uuid references app.bank_transactions(id) on delete set null,
  add column bank_line_marked boolean not null default false;
create unique index counting_sessions_bank_line_uniq on app.counting_sessions (bank_transaction_id) where bank_transaction_id is not null;
comment on column app.counting_sessions.bank_transaction_id is
  'The bank deposit line this count was deposited as (0744). Set and cleared only by link_count_to_bank_deposit / unlink_count_from_bank_deposit.';
comment on column app.counting_sessions.bank_line_marked is
  'True when link_count_to_bank_deposit marked the bank line matched; the undo reopens the line only then (0744).';

-- ── The guard: the link is the functions' to write ─────────────────────────────────────────────
create or replace function app.counting_deposit_link_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  -- The two functions below run as their owner; the worker runs as service_role. Only a signed-in person writing the row
  -- directly (row-level security) is held to this.
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.bank_transaction_id is not null or new.bank_line_marked then
      raise exception 'A count is matched to its bank deposit with "Match its deposit", not written directly.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.bank_transaction_id is not null then
      raise exception 'This count is matched to its bank deposit. A treasurer undoes the match before the count can be removed.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.bank_transaction_id is distinct from old.bank_transaction_id or new.bank_line_marked is distinct from old.bank_line_marked then
    raise exception 'A count is matched to its bank deposit with "Match its deposit", not written directly.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.bank_transaction_id is not null
     and (new.total_cents is distinct from old.total_cents or new.deposit_ref is distinct from old.deposit_ref
          or new.counted_on is distinct from old.counted_on or new.center_id is distinct from old.center_id) then
    raise exception 'This count is matched to its bank deposit, so its total, date and deposit reference cannot change. A treasurer undoes the match first.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger counting_deposit_link_guard before insert or update or delete on app.counting_sessions
  for each row execute function app.counting_deposit_link_guard();
revoke execute on function app.counting_deposit_link_guard() from public, anon, authenticated;

-- ── The guard on the bank line: a line a count is matched to changes only through the undo ────
-- Whether a count references the line, read past row-level security (a paused Offering counts module hides the counts from
-- the person, but the line is still theirs to keep).
create or replace function app._bank_line_has_count(p_txn uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.counting_sessions c where c.bank_transaction_id = p_txn)
$$;
revoke execute on function app._bank_line_has_count(uuid) from public, anon;
grant execute on function app._bank_line_has_count(uuid) to authenticated;

create or replace function app.bank_line_count_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  -- The functions run as their owner and the worker as service_role: only a signed-in person's direct write is held.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if (new.status is distinct from old.status or new.amount_cents is distinct from old.amount_cents
      or new.posted_on is distinct from old.posted_on or new.center_id is distinct from old.center_id)
     and app._bank_line_has_count(old.id) then
    raise exception 'This bank line is matched to a count. A treasurer undoes the count''s match, with a reason, before the line can change.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bank_line_count_guard before update on app.bank_transactions
  for each row execute function app.bank_line_count_guard();
revoke execute on function app.bank_line_count_guard() from public, anon, authenticated;

-- ── Match a count to its bank deposit line ──────────────────────────────────────────────────────
create or replace function app.link_count_to_bank_deposit(p_session uuid, p_txn uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.counting_sessions; t app.bank_transactions;
begin
  select * into s from app.counting_sessions where id = p_session for update;
  if s.id is null then raise exception 'The count was not found.' using errcode = 'no_data_found'; end if;
  perform app.assert_module_enabled(s.center_id, 'giving');
  perform app.assert_module_enabled(s.center_id, 'giving_counts');
  perform app.assert_module_enabled(s.center_id, 'giving_bank');
  if not (app.has_permission(s.center_id, 'giving.record_offline') or app.has_permission(s.center_id, 'giving.manage')) then
    raise exception 'You don''t have permission to match counts to bank deposits.' using errcode = 'insufficient_privilege';
  end if;
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null or t.center_id is distinct from s.center_id then
    raise exception 'That bank line was not found in this community.' using errcode = 'no_data_found';
  end if;
  if s.bank_transaction_id is not null then
    raise exception 'This count is already matched to a bank deposit.' using errcode = 'check_violation';
  end if;
  if s.payment_id is not null then
    raise exception 'This count is already posted as a payment, so it is not matched to a bank line again.' using errcode = 'check_violation';
  end if;
  if s.total_cents <= 0 then
    raise exception 'Record the counted total before matching the deposit.' using errcode = 'check_violation';
  end if;
  if t.amount_cents <= 0 then
    raise exception 'That bank line is money going out, not a deposit.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from app.counting_sessions c where c.bank_transaction_id = t.id) then
    raise exception 'That bank line is already matched to another count. Pick another line.' using errcode = 'check_violation';
  end if;
  if t.status not in ('unmatched', 'suggested') or t.payment_id is not null or t.payout_id is not null
     or exists (select 1 from app.payments p where p.deposit_bank_transaction_id = t.id) then
    raise exception 'That bank line is already matched or set aside. Pick another line.' using errcode = 'check_violation';
  end if;
  if t.amount_cents <> s.total_cents then
    raise exception 'The count is % but the bank line is %. Only a deposit of exactly the counted amount can be matched; use "Mark deposited" for a deposit that holds more.',
      to_char(s.total_cents / 100.0, 'FM999,999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  update app.counting_sessions set bank_transaction_id = t.id, bank_line_marked = true where id = s.id;
  update app.bank_transactions set status = 'matched', matched_by = auth.uid(), matched_at = now() where id = t.id;
  return jsonb_build_object('count_id', s.id, 'bank_transaction_id', t.id, 'amount_cents', t.amount_cents, 'posted_on', t.posted_on);
end $$;
revoke execute on function app.link_count_to_bank_deposit(uuid, uuid) from public, anon;
grant execute on function app.link_count_to_bank_deposit(uuid, uuid) to authenticated;
comment on function app.link_count_to_bank_deposit(uuid, uuid) is
  'Offering counts (0744): match a count to the bank deposit line of exactly its amount, picked by a counter (giving.record_offline) or a treasurer (giving.manage). Needs Giving, Offering counts and Bank reconciliation on. Marks the line matched; posts nothing to QuickBooks.';

-- ── Undo the match (giving.manage, a reason, not in a locked month) ─────────────────────────────
create or replace function app.unlink_count_from_bank_deposit(p_session uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.counting_sessions; t app.bank_transactions; v_reason text; v_reopen boolean := false;
begin
  select * into s from app.counting_sessions where id = p_session for update;
  if s.id is null then raise exception 'The count was not found.' using errcode = 'no_data_found'; end if;
  perform app.assert_module_enabled(s.center_id, 'giving');
  perform app.assert_module_enabled(s.center_id, 'giving_counts');
  perform app.assert_module_enabled(s.center_id, 'giving_bank');
  if not app.has_permission(s.center_id, 'giving.manage') then
    raise exception 'Only a treasurer (giving.manage) can undo a deposit match.' using errcode = 'insufficient_privilege';
  end if;
  v_reason := app.audit_clean_reason(p_reason);
  if v_reason is null then
    raise exception 'Say why the match is being undone.' using errcode = 'check_violation';
  end if;
  if s.bank_transaction_id is null then
    raise exception 'This count is not matched to a bank deposit.' using errcode = 'check_violation';
  end if;
  select * into t from app.bank_transactions where id = s.bank_transaction_id for update;
  if exists (select 1 from app.accounting_periods ap
              where ap.center_id = s.center_id and ap.status = 'closed'
                and ap.period_month in (date_trunc('month', t.posted_on)::date, date_trunc('month', s.counted_on)::date)) then
    raise exception 'The month is locked (month-end close), so this match cannot be undone. Reopen the month first.'
      using errcode = 'check_violation';
  end if;
  perform app.set_audit_context(v_reason);
  update app.counting_sessions set bank_transaction_id = null, bank_line_marked = false where id = s.id;
  if s.bank_line_marked and t.status = 'matched' and t.payment_id is null and t.payout_id is null
     and not exists (select 1 from app.payments p where p.deposit_bank_transaction_id = t.id) then
    update app.bank_transactions set status = 'unmatched', matched_by = null, matched_at = null where id = t.id;
    v_reopen := true;
  end if;
  return jsonb_build_object('count_id', s.id, 'bank_transaction_id', t.id, 'line_reopened', v_reopen);
end $$;
revoke execute on function app.unlink_count_from_bank_deposit(uuid, text) from public, anon;
grant execute on function app.unlink_count_from_bank_deposit(uuid, text) to authenticated;
comment on function app.unlink_count_from_bank_deposit(uuid, text) is
  'Offering counts (0744): a treasurer (giving.manage) undoes a count''s deposit match, with a reason that is kept in the audit trail. Refused in a locked month. Reopens the bank line only when the match had closed it.';
