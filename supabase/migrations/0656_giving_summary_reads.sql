-- 0656: Giving summary reads (BACKLOG B90 phase 4, B83). No table, column or policy changes: four read-only SQL functions
-- that answer, in one call, what the Giving commands (and so Niva) used to work out by reading many rows in page code.
--
--   app.giving_pledges_behind(center, today, min_days, limit, fund)   who is behind on pledges, ranked, with age buckets
--   app.giving_household_summary(household, today)                    one household's giving: years, recent payments, open pledges
--   app.giving_unmatched_bank_lines(center, limit, today)             bank lines nobody has matched yet, and how old they are
--   app.giving_zelle_waiting(center, limit, today)                    Zelle reports waiting for the bank, oldest first
--
-- Every function is SECURITY INVOKER: it reads the same tables the Giving screens read, as the person asking, so row-level
-- security decides what comes back (a person who may not see payments gets zeros and empty lists, never somebody else's
-- numbers). The command layer says "You don't have access to this area" before it gets here. Money is integer cents;
-- the functions never format dollars. Nothing here writes.
--
-- The rule for "behind" is the one the command used before this migration: an open pledge is behind when it is past its due
-- date, or, when it has none, 30 days after it was made (counted in the community's own time zone).
set client_min_messages = warning;

-- ── Who is behind on pledges ─────────────────────────────────────────────────
create or replace function app.giving_pledges_behind(
  p_center uuid,
  p_today date default null,
  p_min_days integer default 1,
  p_limit integer default 10,
  p_fund uuid default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  open_p as (
    select p.household_id,
           p.amount_cents - p.paid_cents as open_cents,
           (select today from t) - coalesce(p.due_on, ((p.pledged_at at time zone (select tz from z))::date + 30)) as days_over
      from app.pledges p
     where p.center_id = p_center
       and p.status in ('open', 'partially_paid')
       and (p_fund is null or p.fund_id = p_fund)
  ),
  behind as (
    select * from open_p
     where open_cents > 0 and days_over >= greatest(coalesce(p_min_days, 1), 1)
  ),
  per as (
    select household_id,
           count(*)::integer as pledges_behind,
           sum(open_cents)::bigint as open_cents,
           max(days_over)::integer as oldest_days_overdue
      from behind
     group by household_id
  ),
  ranked as (
    select per.*, row_number() over (order by per.open_cents desc, per.oldest_days_overdue desc, per.household_id) as rn
      from per
  ),
  ages as (
    select case when days_over <= 30 then 1 when days_over <= 60 then 2 when days_over <= 90 then 3 else 4 end as ord,
           count(*)::integer as pledges,
           sum(open_cents)::bigint as open_cents
      from behind
     group by 1
  )
  select jsonb_build_object(
    'as_of', (select today from t),
    'households_behind', (select count(*) from per)::integer,
    'pledges_behind', coalesce((select sum(pledges_behind) from per), 0)::integer,
    'total_open_cents', coalesce((select sum(open_cents) from per), 0)::bigint,
    'by_age', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bucket', case a.ord when 1 then '1 to 30 days' when 2 then '31 to 60 days' when 3 then '61 to 90 days' else 'Over 90 days' end,
               'pledges', a.pledges,
               'open_cents', a.open_cents) order by a.ord)
        from ages a), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'household_id', r.household_id,
               'pledges_behind', r.pledges_behind,
               'open_cents', r.open_cents,
               'oldest_days_overdue', r.oldest_days_overdue) order by r.rn)
        from ranked r
       where r.rn <= greatest(coalesce(p_limit, 10), 1)), '[]'::jsonb)
  )
$$;

-- ── One household's giving ───────────────────────────────────────────────────
-- Opening-balance lines and payments that never completed (failed, voided, authorized only) are left out, as the year-end
-- statements leave them out. "received" is what came in; "refunded" is what went back.
create or replace function app.giving_household_summary(p_household uuid, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with h as (
    select hh.id, hh.center_id from app.households hh where hh.id = p_household and hh.merged_into_id is null
  ),
  z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c join h on h.center_id = c.id), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  pay as (
    select p.id, p.receipt_number, p.received_on, p.method, p.amount_cents, p.refunded_cents, p.status
      from app.payments p join h on p.household_id = h.id and p.center_id = h.center_id
     where p.status not in ('failed', 'voided', 'authorized') and not p.is_opening_balance
  ),
  yearly as (
    select extract(year from received_on)::integer as yr,
           count(*)::integer as payments,
           sum(amount_cents)::bigint as received_cents,
           sum(refunded_cents)::bigint as refunded_cents
      from pay
     where extract(year from received_on) >= extract(year from (select today from t)) - 2
     group by 1
  ),
  recent as (
    select * from pay order by received_on desc, id limit 5
  ),
  plg as (
    select pl.id, pl.pledge_number, pl.source, pl.amount_cents, pl.paid_cents,
           pl.amount_cents - pl.paid_cents as open_cents,
           pl.due_on, pl.pledged_at, f.name as fund, c.name as campaign,
           (select today from t) - coalesce(pl.due_on, ((pl.pledged_at at time zone (select tz from z))::date + 30)) as days_over
      from app.pledges pl
      join h on pl.household_id = h.id and pl.center_id = h.center_id
      left join app.funds f on f.id = pl.fund_id
      left join app.campaigns c on c.id = pl.campaign_id
     where pl.status in ('open', 'partially_paid') and pl.amount_cents > pl.paid_cents
  ),
  plg_shown as (
    select * from plg order by pledged_at, id limit 25
  )
  select jsonb_build_object(
    'household_id', h.id,
    'as_of', (select today from t),
    'lifetime', jsonb_build_object(
      'payments', (select count(*) from pay)::integer,
      'received_cents', coalesce((select sum(amount_cents) from pay), 0)::bigint,
      'refunded_cents', coalesce((select sum(refunded_cents) from pay), 0)::bigint,
      'first_gift_on', (select min(received_on) from pay),
      'last_gift_on', (select max(received_on) from pay)),
    'years', coalesce((
      select jsonb_agg(jsonb_build_object(
               'year', y.yr, 'payments', y.payments, 'received_cents', y.received_cents, 'refunded_cents', y.refunded_cents)
               order by y.yr desc)
        from yearly y), '[]'::jsonb),
    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'receipt_number', r.receipt_number, 'received_on', r.received_on, 'method', r.method,
               'amount_cents', r.amount_cents, 'refunded_cents', r.refunded_cents, 'status', r.status)
               order by r.received_on desc, r.id)
        from recent r), '[]'::jsonb),
    'open_pledge_count', (select count(*) from plg)::integer,
    'open_cents', coalesce((select sum(open_cents) from plg), 0)::bigint,
    'behind_cents', coalesce((select sum(open_cents) from plg where days_over >= 1), 0)::bigint,
    'open_pledges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'pledge_number', s.pledge_number, 'source', s.source, 'fund', s.fund, 'campaign', s.campaign,
               'amount_cents', s.amount_cents, 'paid_cents', s.paid_cents, 'open_cents', s.open_cents,
               'due_on', s.due_on, 'pledged_on', (s.pledged_at at time zone (select tz from z))::date,
               'days_overdue', greatest(s.days_over, 0))
               order by s.pledged_at, s.id)
        from plg_shown s), '[]'::jsonb),
    'recurring_active', (
      select count(*)::integer from app.recurring_gifts g
       where g.household_id = h.id and g.center_id = h.center_id and g.status = 'active')
  )
  from h
$$;

-- ── Bank lines nobody has matched ────────────────────────────────────────────
-- The views of Giving > Payments > Bank: gifts (money in, not a batch), deposits (a batch of checks or cash), debits (money
-- out) and card payouts. A line is waiting when it is unmatched or only suggested. Oldest first, as the screen lists them.
create or replace function app.giving_unmatched_bank_lines(p_center uuid, p_limit integer default 10, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  waiting as (
    select b.id, b.bank_account_id, b.posted_on, b.amount_cents, b.description, b.channel, b.payer_name, b.reference,
           b.status, b.is_batch_deposit,
           case when b.amount_cents > 0 and not b.is_batch_deposit then 'gift'
                when b.amount_cents > 0 and b.is_batch_deposit then 'deposit'
                else 'debit' end as kind
      from app.bank_transactions b
     where b.center_id = p_center and b.status in ('unmatched', 'suggested')
  ),
  credits as (
    select w.*, row_number() over (order by w.posted_on, w.id) as rn from waiting w where w.kind in ('gift', 'deposit')
  )
  select jsonb_build_object(
    'as_of', (select today from t),
    'gifts', (select count(*) from waiting where kind = 'gift')::integer,
    'gifts_cents', coalesce((select sum(amount_cents) from waiting where kind = 'gift'), 0)::bigint,
    'deposits', (select count(*) from waiting where kind = 'deposit')::integer,
    'deposits_cents', coalesce((select sum(amount_cents) from waiting where kind = 'deposit'), 0)::bigint,
    'debits', (select count(*) from waiting where kind = 'debit')::integer,
    'payouts', (select count(*) from app.bank_transactions b where b.center_id = p_center and b.status = 'payout')::integer,
    'oldest_posted_on', (select min(posted_on) from waiting where kind in ('gift', 'deposit')),
    'oldest_days', (select (select today from t) - min(posted_on) from waiting where kind in ('gift', 'deposit')),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'posted_on', c.posted_on,
               'days_waiting', (select today from t) - c.posted_on,
               'amount_cents', c.amount_cents,
               'channel', c.channel,
               'payer_name', c.payer_name,
               'reference', c.reference,
               'description', left(c.description, 200),
               'status', c.status,
               'account', (select a.name from app.bank_accounts a where a.id = c.bank_account_id))
               order by c.rn)
        from credits c
       where c.rn <= greatest(coalesce(p_limit, 10), 1)), '[]'::jsonb)
  )
$$;

-- ── Zelle reports waiting for the bank ───────────────────────────────────────
-- A member's "I sent a Zelle" credits nobody until the treasurer matches a bank line (0582). Waiting = reported (not yet
-- seen) or unmatched (the window passed and the bank never showed it). Oldest first. The confirmation number itself is not
-- returned, only whether one was given.
create or replace function app.giving_zelle_waiting(p_center uuid, p_limit integer default 10, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  waiting as (
    select r.id, r.household_id, r.status, r.amount_cents, r.sent_on, r.due_on, r.sender_name, r.is_test,
           (r.confirmation_normalized is not null) as has_confirmation,
           coalesce(array_length(r.pledge_ids, 1), 0) as pledges_named,
           row_number() over (order by r.sent_on, r.created_at, r.id) as rn
      from app.payment_reports r
     where r.center_id = p_center and r.status in ('reported', 'unmatched')
  )
  select jsonb_build_object(
    'as_of', (select today from t),
    'reported', (select count(*) from waiting where status = 'reported')::integer,
    'unmatched', (select count(*) from waiting where status = 'unmatched')::integer,
    'past_window', (select count(*) from waiting where due_on < (select today from t))::integer,
    'total_cents', coalesce((select sum(amount_cents) from waiting), 0)::bigint,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id,
               'household_id', w.household_id,
               'status', w.status,
               'amount_cents', w.amount_cents,
               'sent_on', w.sent_on,
               'days_waiting', (select today from t) - w.sent_on,
               'due_on', w.due_on,
               'past_window', w.due_on < (select today from t),
               'sender_name', w.sender_name,
               'has_confirmation', w.has_confirmation,
               'pledges_named', w.pledges_named,
               'is_test', w.is_test)
               order by w.rn)
        from waiting w
       where w.rn <= greatest(coalesce(p_limit, 10), 1)), '[]'::jsonb)
  )
$$;

revoke execute on function app.giving_pledges_behind(uuid, date, integer, integer, uuid),
  app.giving_household_summary(uuid, date),
  app.giving_unmatched_bank_lines(uuid, integer, date),
  app.giving_zelle_waiting(uuid, integer, date) from public, anon;
grant execute on function app.giving_pledges_behind(uuid, date, integer, integer, uuid),
  app.giving_household_summary(uuid, date),
  app.giving_unmatched_bank_lines(uuid, integer, date),
  app.giving_zelle_waiting(uuid, integer, date) to authenticated;

comment on function app.giving_pledges_behind(uuid, date, integer, integer, uuid) is
  'Who is behind on pledges: households ranked by the unpaid balance, with totals and age buckets. Security invoker (RLS applies). Read only.';
comment on function app.giving_household_summary(uuid, date) is
  'One household''s giving: lifetime and last three years, recent payments, open pledges. Null when the household is not visible. Security invoker. Read only.';
comment on function app.giving_unmatched_bank_lines(uuid, integer, date) is
  'Bank lines waiting to be matched (unmatched or suggested): counts by kind and the oldest lines. Security invoker. Read only.';
comment on function app.giving_zelle_waiting(uuid, integer, date) is
  'Zelle reports waiting for the bank (reported or unmatched), oldest first. Security invoker. Read only.';
