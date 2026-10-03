-- Payments plan PR 3 · 1 of 2 (docs/PAYMENTS_PLAN.md §2.9, owner decisions 2026-10-02, Q2–Q5):
-- members say "I sent a Zelle"; nothing is credited until a treasurer matches the bank line.
--
--   app.payment_reports            one row per member report: household, who reported it, amount,
--                                  date sent, optional confirmation number (unique per organization
--                                  while not withdrawn or rejected), sender name, chosen pledges, status
--                                  (reported, matched, unmatched, rejected, withdrawn), test flag,
--                                  the report window and the date it is due at the bank
--   app.report_payment             an adult of the family reports a Zelle (plain-English refusals)
--   app.withdraw_payment_report    the reporter or another adult withdraws it
--   app.my_payment_reports         the family's reports of the last 180 days (member app)
--   app.reject_payment_report      the treasurer says why it is not accepted; the member is told
--   app.link_payment_report        bookkeeping: tie a report to a payment already recorded
--   app.payment_report_counts      the Home task's numbers
--   app.zelle_report_window_days   centers.rules.payments.zelle.report_window_days (3–30, default 10)
--   app.set_zelle_reporting        the window and the bank account Zelle lines arrive in (with a reason)
--   app.worker_payment_reports_sweep  hourly (worker job payments.reports_sweep): a report past its
--                                  window becomes "unmatched" and the member is told once, unless the
--                                  treasurer can already settle it: a Zelle of that family and amount is
--                                  already recorded, or its bank line is on the statement waiting for the
--                                  treasurer's click (held for the treasurer). It never creates a payment.
--
-- A report credits nobody: no payment, allocation, receipt or QuickBooks posting exists until a
-- treasurer matches a bank line (0583). Reports are not counted in giving totals, statements or
-- the household's balance (they live in their own table).
--
-- Rehearsal (§2.4): in a sandbox (centers.environment = 'sandbox') members never see the real Zelle
-- address: app.member_payment_options shows "Sandbox: no real money moves" (plus the memo hint) and
-- "rehearsal": true on the Zelle entry, and the Zelle row of center_payment_methods is not readable
-- by members there. Staff keep seeing the real address (payment_settings). Reports made in a
-- sandbox are marked is_test. Production output of member_payment_options is unchanged.
--
-- Zelle configuration stays where it is: the center_payment_methods 'zelle' row (accepted,
-- instructions recipient / name / memo_hint) plus centers.rules.payments.zelle =
-- {"report_window_days": 3..30, "bank_account_id": uuid|null}, written only by set_zelle_reporting.
set client_min_messages = warning;

-- ── The table ────────────────────────────────────────────────────────────────
create table if not exists app.payment_reports (
  id                      uuid primary key default gen_random_uuid(),
  center_id               uuid not null references app.centers(id) on delete cascade,
  household_id            uuid not null references app.households(id),
  reported_by             uuid not null references auth.users(id),
  reported_by_person      uuid references app.people(id),
  method                  app.payment_method not null default 'zelle' check (method = 'zelle'),
  amount_cents            bigint not null check (amount_cents between 1 and 100000000),
  sent_on                 date not null,
  confirmation            text check (confirmation is null or char_length(confirmation) <= 60),
  confirmation_normalized text,
  sender_name             text check (sender_name is null or char_length(sender_name) <= 120),
  sender_normalized       text,
  pledge_ids              uuid[] not null default '{}',
  note                    text check (note is null or char_length(note) <= 500),
  status                  text not null default 'reported'
                          check (status in ('reported','matched','unmatched','rejected','withdrawn')),
  is_test                 boolean not null default false,
  window_days             int not null check (window_days between 3 and 30),
  due_on                  date not null,
  bank_transaction_id     uuid references app.bank_transactions(id),
  payment_id              uuid references app.payments(id),
  matched_by              uuid references auth.users(id),
  matched_at              timestamptz,
  unmatched_at            timestamptz,
  notice_sent_at          timestamptz,
  notice_error            text check (notice_error is null or char_length(notice_error) <= 1000),
  rejected_by             uuid references auth.users(id),
  rejected_at             timestamptz,
  reject_reason           text check (reject_reason is null or char_length(reject_reason) <= 500),
  withdrawn_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint payment_reports_matched_has_payment check (status <> 'matched' or payment_id is not null)
);
comment on table app.payment_reports is
  'Member-reported Zelle payments (payments plan §2.9). A report credits nobody: it is never counted, allocated, receipted or posted. A treasurer matches the bank line (confirm_bank_match with p_report, or attach_bank_line_to_payment), which records the one payment.';
comment on column app.payment_reports.due_on is 'sent_on + window_days: after this date (in the organization''s time zone) the report is "not seen at the bank".';
comment on column app.payment_reports.is_test is 'Reported in a sandbox (rehearsal): no real money moves there.';

-- One live report per confirmation number: a withdrawn or a rejected report frees it (a member whose
-- report was closed for a wrong amount can report it again, and the real sender can report a number
-- somebody else's rejected report used).
create unique index if not exists payment_reports_confirmation_once on app.payment_reports (center_id, confirmation_normalized)
  where confirmation_normalized is not null and status not in ('withdrawn','rejected');
create index if not exists payment_reports_center_status_due on app.payment_reports (center_id, status, due_on);
create index if not exists payment_reports_household_created on app.payment_reports (household_id, created_at desc);
create unique index if not exists payment_reports_bank_line_once on app.payment_reports (bank_transaction_id)
  where bank_transaction_id is not null;
create index if not exists payment_reports_payment on app.payment_reports (payment_id) where payment_id is not null;

-- Normalized values and the due date are always derived, never typed.
create or replace function app.payment_reports_prepare() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  new.confirmation := nullif(btrim(coalesce(new.confirmation, '')), '');
  new.confirmation_normalized := nullif(upper(regexp_replace(coalesce(new.confirmation, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.sender_name := nullif(btrim(coalesce(new.sender_name, '')), '');
  new.sender_normalized := app.normalize_identifier(new.sender_name);
  new.due_on := new.sent_on + new.window_days;
  return new;
end $$;
drop trigger if exists payment_reports_prepare on app.payment_reports;
create trigger payment_reports_prepare before insert or update on app.payment_reports
  for each row execute function app.payment_reports_prepare();
drop trigger if exists touch_payment_reports on app.payment_reports;
create trigger touch_payment_reports before update on app.payment_reports
  for each row execute function app.touch_updated_at();

insert into app.module_tables (table_name, module_key) values ('payment_reports', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_payment_reports on app.payment_reports;
create trigger audit_payment_reports after insert or update or delete on app.payment_reports
  for each row execute function app.audit_row();

-- RLS: adults of the household read their own reports; giving staff read the organization's.
-- Nobody writes directly: every write goes through the functions below.
alter table app.payment_reports enable row level security;
drop policy if exists payment_reports_read on app.payment_reports;
create policy payment_reports_read on app.payment_reports for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline')
         or app.has_permission(center_id, 'giving.manage') or app.adult_of_household(center_id, household_id));
drop policy if exists module_switch on app.payment_reports;
create policy module_switch on app.payment_reports as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));
revoke all on app.payment_reports from public, anon, authenticated, connect_worker;
grant select on app.payment_reports to authenticated;
grant all on app.payment_reports to service_role;

-- ── Settings ─────────────────────────────────────────────────────────────────
-- The report window: centers.rules.payments.zelle.report_window_days, 3 to 30, 10 when absent.
create or replace function app.zelle_report_window_days(p_center uuid) returns int
language sql stable security definer set search_path = app, public, extensions as $$
  select least(30, greatest(3, coalesce(
    (select case when (c.rules #>> '{payments,zelle,report_window_days}') ~ '^\s*\d{1,4}\s*$'
                 then (c.rules #>> '{payments,zelle,report_window_days}')::int end
       from app.centers c where c.id = p_center), 10)))
$$;

-- The bank account Zelle lines arrive in (when one is set and still active), else null (any account).
create or replace function app.zelle_bank_account_id(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select b.id from app.centers c
    join app.bank_accounts b on b.center_id = c.id and b.active
         and b.id::text = (c.rules #>> '{payments,zelle,bank_account_id}')
   where c.id = p_center
$$;

create or replace function app.set_zelle_reporting(p_center uuid, p_window_days int, p_bank_account uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing how Zelle reports are matched needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_window_days is null or p_window_days < 3 or p_window_days > 30 then
    raise exception 'The report window is 3 to 30 days.' using errcode = '22023';
  end if;
  if p_bank_account is not null and not exists (select 1 from app.bank_accounts b where b.id = p_bank_account and b.center_id = p_center and b.active) then
    raise exception 'Choose one of this organization''s active bank accounts, or none.' using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'change how Zelle reports are matched');
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
                           case when jsonb_typeof(rules->'payments') = 'object' then rules->'payments' else '{}'::jsonb end
                           || jsonb_build_object('zelle',
                                (case when jsonb_typeof(rules #> '{payments,zelle}') = 'object' then rules #> '{payments,zelle}' else '{}'::jsonb end)
                                || jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', p_bank_account)))
   where id = p_center;
  return jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', p_bank_account);
end $$;

-- ── Notices to the member ────────────────────────────────────────────────────
-- Platform defaults (center_id null), like 0290's; an organization can override them.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('zelle_report_unmatched', 'push', 'We have not seen your Zelle yet',
   'Your Zelle of {{amount}} sent on {{sent_on}} to {{center_short_name}} is not on the bank statement after {{days}} days. Check the confirmation number in your bank app, or contact the treasurer. Nothing has been credited yet.'),
  ('zelle_report_unmatched', 'email', 'Your Zelle to {{center_name}} is not on the bank statement yet',
   E'Your Zelle of {{amount}} sent on {{sent_on}} to {{center_short_name}} is not on the bank statement after {{days}} days. Check the confirmation number in your bank app, or contact the treasurer. Nothing has been credited yet.'),
  ('zelle_report_rejected', 'push', 'Your Zelle report was not accepted',
   'The treasurer could not match your Zelle of {{amount}} sent on {{sent_on}}: {{reason}}'),
  ('zelle_report_rejected', 'email', 'Your Zelle report to {{center_name}} was not accepted',
   E'The treasurer could not match your Zelle of {{amount}} sent on {{sent_on}}: {{reason}}\n\nNothing has been credited for this report. If you think this is a mistake, contact the treasurer.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- Tell the member about a report (push to the login that reported it, email to the reporting
-- person when they have one). A refused notice (a sandbox only reaches verified test recipients:
-- CCENT; a suppression; a missing login) is written to notice_error and never fails the caller.
-- Returns {"queued": n, "failed": n}.
create or replace function app._zelle_report_notice(p_report uuid, p_template text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports; v_vars jsonb; v_email text; v_msg uuid; v_status text; v_why text;
        v_queued int := 0; v_failed int := 0; v_errors text[] := '{}'; ch text;
begin
  select * into r from app.payment_reports where id = p_report;
  if r.id is null then return jsonb_build_object('queued', 0, 'failed', 0); end if;
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    update app.payment_reports set notice_error = 'Messaging is not set up, so the member was not told.' where id = r.id;
    return jsonb_build_object('queued', 0, 'failed', 1);
  end if;
  v_vars := jsonb_build_object(
    'amount', to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'),
    'sent_on', to_char(r.sent_on, 'FMMonth FMDD, YYYY'),
    'days', r.window_days,
    'reason', coalesce(r.reject_reason, ''),
    'person_id', coalesce(r.reported_by_person::text, ''));
  select nullif(btrim(p.email::text), '') into v_email from app.people p where p.id = r.reported_by_person;
  foreach ch in array array['push','email'] loop
    continue when ch = 'email' and v_email is null;
    begin
      v_msg := app.enqueue_message(r.center_id, ch, case ch when 'push' then r.reported_by::text else v_email end,
                                   p_template, v_vars, 'notification');
      select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_msg;
      if v_status = 'suppressed' then
        v_failed := v_failed + 1;
        v_errors := v_errors || (ch || ': ' || coalesce(v_why, 'not sent'));
      else
        v_queued := v_queued + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || (ch || ': ' || sqlerrm);
    end;
  end loop;
  update app.payment_reports
     set notice_sent_at = case when v_queued > 0 then now() else notice_sent_at end,
         notice_error = case when cardinality(v_errors) > 0 then left(array_to_string(v_errors, ' · '), 1000) end
   where id = r.id;
  return jsonb_build_object('queued', v_queued, 'failed', v_failed);
end $$;

-- Zelle payments of a family already recorded (by hand, or from a matched bank line) of this
-- amount around a date: what a report or a bank line may duplicate. Internal: the sweep, the
-- treasurer queue, the double-count guard and possible_duplicate_zelle (0583) share it.
create or replace function app.zelle_recorded_payments(p_household uuid, p_amount_cents bigint, p_on date)
returns table (kind text, id uuid, receipt_number text, received_on date, amount_cents bigint, linked boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select case p.provider when 'offline' then 'hand_recorded' else 'bank' end, p.id, p.receipt_number, p.received_on, p.amount_cents,
         exists (select 1 from app.payment_reports r where r.payment_id = p.id)
    from app.payments p
   where p.household_id = p_household and p.method = 'zelle' and p.amount_cents = p_amount_cents
     and p.status in ('captured','pending_clearing','settled')
     and ((p.provider = 'offline' and p.deposit_bank_transaction_id is null) or p.provider = 'bank')
     and p.received_on between p_on - 7 and p_on + 3
   order by abs(p.received_on - p_on), p.received_on, p.created_at
$$;

-- ── Members report and withdraw ──────────────────────────────────────────────
create or replace function app.report_payment(p_center uuid, p_household uuid, p_method text, p_amount_cents bigint, p_sent_on date,
                                              p_confirmation text, p_sender_name text, p_pledge_ids uuid[], p_note text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_today date; v_conf text; v_conf_norm text; v_sender text; v_note text; v_pledges uuid[];
        v_bad int; v_open int; v_window int; v_id uuid; v_due date; v_test boolean; v_short text;
begin
  if auth.uid() is null then raise exception 'Sign in to report a payment.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_short := coalesce(nullif(btrim(c.short_name), ''), c.name);
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can report a payment.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_method, ''))) <> 'zelle' then
    raise exception 'Only a Zelle can be reported here; other gifts are recorded when they arrive.' using errcode = '22023';
  end if;
  if not exists (select 1 from app.center_payment_methods m where m.center_id = p_center and m.method = 'zelle' and m.accepted) then
    raise exception 'Zelle is not one of the ways % takes gifts.', v_short using errcode = '22023';
  end if;
  -- One report at a time per family (a double tap must not make two).
  perform 1 from app.households where id = p_household for update;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'Enter the amount you sent, from $0.01 to $1,000,000.' using errcode = '22023';
  end if;
  v_today := (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date;
  if p_sent_on is null then raise exception 'Enter the date you sent the Zelle.' using errcode = '22023'; end if;
  if p_sent_on > v_today then raise exception 'The date you sent the Zelle cannot be after today.' using errcode = '22023'; end if;
  if p_sent_on < v_today - 60 then
    raise exception 'Report a Zelle you sent in the last 60 days. For an older one, contact the treasurer.' using errcode = '22023';
  end if;
  v_conf := nullif(btrim(coalesce(p_confirmation, '')), '');
  if v_conf is not null then
    v_conf_norm := upper(regexp_replace(v_conf, '[^A-Za-z0-9]', '', 'g'));
    if char_length(v_conf) > 60 or char_length(v_conf_norm) not between 6 and 40 then
      raise exception 'That does not look like a Zelle confirmation number. Leave it blank if you do not have it.' using errcode = '22023';
    end if;
    if exists (select 1 from app.payment_reports r where r.center_id = p_center and r.confirmation_normalized = v_conf_norm
                 and r.status not in ('withdrawn','rejected')) then
      raise exception 'That confirmation number was already reported.' using errcode = '22023';
    end if;
    if exists (select 1 from app.bank_transactions t where t.center_id = p_center and t.status = 'matched' and t.channel = 'zelle'
                 and t.reference is not null and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = v_conf_norm) then
      raise exception 'That Zelle is already on the bank statement and recorded.' using errcode = '22023';
    end if;
  end if;
  v_sender := nullif(btrim(coalesce(p_sender_name, '')), '');
  if char_length(v_sender) > 120 then
    raise exception 'The name your bank shows can be at most 120 characters.' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 500 then raise exception 'The note can be at most 500 characters.' using errcode = '22023'; end if;
  -- The chosen pledges, in the order given, once each.
  select coalesce(array_agg(x order by o), '{}') into v_pledges
    from (select u.x, min(u.o) as o from unnest(coalesce(p_pledge_ids, '{}'::uuid[])) with ordinality as u(x, o)
           where u.x is not null group by u.x) s;
  if cardinality(v_pledges) > 20 then raise exception 'Choose at most 20 pledges.' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if exists (select 1 from app.payment_reports r where r.household_id = p_household and r.amount_cents = p_amount_cents
               and r.sent_on = p_sent_on and r.status in ('reported','unmatched')) then
    raise exception 'You already reported this Zelle; it is waiting for the bank.' using errcode = '22023';
  end if;
  select count(*) into v_open from app.payment_reports r where r.household_id = p_household and r.status in ('reported','unmatched');
  if v_open >= 10 then
    raise exception 'Your family already has 10 Zelle reports waiting for the bank. Wait until they are matched, or contact the treasurer.'
      using errcode = '22023';
  end if;

  v_window := app.zelle_report_window_days(p_center);
  v_test := c.environment = 'sandbox';
  begin
    insert into app.payment_reports (center_id, household_id, reported_by, reported_by_person, method, amount_cents, sent_on,
                                     confirmation, sender_name, pledge_ids, note, is_test, window_days, due_on)
    values (p_center, p_household, auth.uid(), app.my_person_id(p_center), 'zelle', p_amount_cents, p_sent_on,
            v_conf, v_sender, v_pledges, v_note, v_test, v_window, p_sent_on + v_window)
    returning id, due_on into v_id, v_due;
  exception when unique_violation then
    raise exception 'That confirmation number was already reported.' using errcode = '22023';
  end;
  return jsonb_build_object('report_id', v_id, 'status', 'reported', 'due_on', v_due::text, 'is_test', v_test,
    'message', case when v_test then 'Test report saved. In a sandbox no real money moves.'
                    else 'Thank you. The treasurer matches it when it reaches the bank, usually within a few days. Until then it shows as Reported and is not counted as given.' end);
end $$;

create or replace function app.withdraw_payment_report(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports;
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw a report.' using errcode = '42501'; end if;
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not (r.reported_by = auth.uid() or app.adult_of_household(r.center_id, r.household_id)) then
    raise exception 'Only the person who reported it, or another adult of the family, can withdraw this report.' using errcode = '42501';
  end if;
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be withdrawn.',
      case r.status when 'matched' then 'matched to the bank' when 'rejected' then 'closed by the treasurer' else r.status end
      using errcode = '22023';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'The member withdrew the Zelle report'));
  update app.payment_reports set status = 'withdrawn', withdrawn_at = now() where id = r.id;
end $$;

-- The family's reports of the last 180 days, newest first (member app). With p_household null:
-- every family the caller is an adult of.
create or replace function app.my_payment_reports(p_center uuid, p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see your Zelle reports.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if p_household is not null and not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can see its Zelle reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'household_id', r.household_id, 'method', r.method, 'amount_cents', r.amount_cents,
             'sent_on', r.sent_on::text, 'due_on', r.due_on::text, 'status', r.status, 'confirmation', r.confirmation,
             'sender_name', r.sender_name, 'pledge_ids', to_jsonb(r.pledge_ids), 'is_test', r.is_test,
             'receipt_number', p.receipt_number, 'reject_reason', r.reject_reason, 'created_at', r.created_at)
           order by r.created_at desc, r.id)
      from app.payment_reports r
      left join app.payments p on p.id = r.payment_id
     where r.center_id = p_center
       and r.created_at >= now() - interval '180 days'
       and (case when p_household is null then app.adult_of_household(p_center, r.household_id) else r.household_id = p_household end)
  ), '[]'::jsonb);
end $$;

-- ── The treasurer ────────────────────────────────────────────────────────────
create or replace function app.reject_payment_report(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports;
begin
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not (app.has_permission(r.center_id, 'giving.record_offline') or app.has_permission(r.center_id, 'giving.manage')) then
    raise exception 'Closing a member''s Zelle report needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the report is not accepted; the member is told and the reason is kept in the audit log.' using errcode = '22023';
  end if;
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be rejected.',
      case r.status when 'matched' then 'matched' when 'rejected' then 'rejected' else 'withdrawn by the member' end
      using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  update app.payment_reports set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
         reject_reason = left(btrim(p_reason), 500)
   where id = r.id;
  perform app._zelle_report_notice(r.id, 'zelle_report_rejected');
end $$;

-- Bookkeeping only: the report is the Zelle that is already recorded as this payment (by hand,
-- or from the bank statement without the report). The payment itself does not change.
create or replace function app.link_payment_report(p_report uuid, p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports; p app.payments;
begin
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not (app.has_permission(r.center_id, 'giving.record_offline') or app.has_permission(r.center_id, 'giving.manage')) then
    raise exception 'Linking a member''s Zelle report needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  perform app.payments_require_reason(p_reason, 'link this Zelle report to a recorded payment');
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be linked.', r.status using errcode = '22023';
  end if;
  select * into p from app.payments where id = p_payment for update;
  if p.id is null or p.center_id <> r.center_id or p.household_id <> r.household_id then
    raise exception 'That payment is not one of this family''s payments.' using errcode = '22023';
  end if;
  if p.method <> 'zelle' then raise exception 'That payment is not a Zelle payment.' using errcode = '22023'; end if;
  if coalesce(p.provider, '') not in ('offline','bank') then
    raise exception 'Only a Zelle recorded by hand or from the bank statement can be linked to a report.' using errcode = '22023';
  end if;
  if p.status in ('failed','voided') then raise exception 'That payment was voided or failed.' using errcode = '22023'; end if;
  if p.amount_cents <> r.amount_cents then
    raise exception 'The report says % but the payment is %.', to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'),
      to_char(p.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_reports o where o.payment_id = p.id and o.id <> r.id) then
    raise exception 'That payment is already linked to another report.' using errcode = '22023';
  end if;
  update app.payment_reports
     set status = 'matched', payment_id = p.id,
         bank_transaction_id = coalesce(r.bank_transaction_id,
           case when p.deposit_bank_transaction_id is not null
                 and not exists (select 1 from app.payment_reports o where o.bank_transaction_id = p.deposit_bank_transaction_id)
                then p.deposit_bank_transaction_id end),
         matched_by = auth.uid(), matched_at = now()
   where id = r.id;
end $$;

-- The Home task: reports waiting for the bank, and reports not seen there within their window.
create or replace function app.payment_report_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.record_offline')
          or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Seeing Zelle reports needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('reported', count(*) filter (where status = 'reported'),
                                    'unmatched', count(*) filter (where status = 'unmatched'))
            from app.payment_reports where center_id = p_center and status in ('reported','unmatched'));
end $$;

-- ── The hourly sweep (worker job payments.reports_sweep) ─────────────────────
-- A report still waiting after its due date (in its organization's time zone) becomes
-- "unmatched" and its member is told once. A report the treasurer is already in a position to
-- settle stays "reported" and the member is not told that the bank has not seen it: the family
-- already has that Zelle recorded (by hand, or from the bank without the report: Zelle reports ›
-- Recorded by hand), or its bank line is on the imported statement waiting for the treasurer's
-- click (same confirmation number and amount). Idempotent; it never creates a payment.
create or replace function app._zelle_report_held(p_report uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (
    select 1 from app.payment_reports r
     where r.id = p_report
       and (exists (select 1 from app.zelle_recorded_payments(r.household_id, r.amount_cents, r.sent_on) z where not z.linked)
            or (r.confirmation_normalized is not null
                and exists (select 1 from app.bank_transactions t
                             where t.center_id = r.center_id and t.status in ('unmatched','suggested') and t.channel = 'zelle'
                               and not t.is_batch_deposit and t.originator_kind is null and t.amount_cents = r.amount_cents
                               and t.reference is not null
                               and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized))))
$$;

create or replace function app.worker_payment_reports_sweep() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_marked int := 0; v_notices int := 0; v_failures int := 0; v_held int := 0; v_n jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Zelle report not seen on the bank statement within its window');
  select count(*) into v_held
    from app.payment_reports pr join app.centers c on c.id = pr.center_id
   where pr.status = 'reported'
     and pr.due_on < (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date
     and app.module_enabled(pr.center_id, 'giving')
     and app._zelle_report_held(pr.id);
  for r in
    select pr.id
      from app.payment_reports pr
      join app.centers c on c.id = pr.center_id
     where pr.status = 'reported'
       and pr.due_on < (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date
       and app.module_enabled(pr.center_id, 'giving')
       and not app._zelle_report_held(pr.id)
     order by pr.due_on, pr.created_at
     limit 500
     for update of pr skip locked
  loop
    update app.payment_reports set status = 'unmatched', unmatched_at = now() where id = r.id and status = 'reported';
    if not found then continue; end if;
    v_marked := v_marked + 1;
    v_n := app._zelle_report_notice(r.id, 'zelle_report_unmatched');
    if (v_n->>'queued')::int > 0 then v_notices := v_notices + 1; end if;
    if (v_n->>'failed')::int > 0 then v_failures := v_failures + 1; end if;
  end loop;
  return jsonb_build_object('marked', v_marked, 'notices', v_notices, 'notice_failures', v_failures, 'held_for_review', v_held);
end $$;

-- ── Rehearsal: members of a sandbox never see the real Zelle address ─────────
-- 0211's body unchanged except the Zelle offline entry in a sandbox.
create or replace function app.member_payment_options(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; v_online jsonb; v_reason text; v_offline jsonb; v_forced boolean;
begin
  if not (app.is_member_of(p_center) or app.payments_can_view(p_center)) then
    raise exception 'Only members of this community can see how to give.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  select * into cp from app.center_payment_processors
   where center_id = p_center and status in ('test','live')
   order by is_default desc, (status = 'live') desc, processor limit 1;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    v_reason := 'offline_only';
  elsif cp.center_id is null then
    v_reason := 'not_connected';
  elsif cp.status = 'test' and not v_forced then
    v_reason := 'test_mode';
  else
    v_online := jsonb_build_object('processor', cp.processor, 'mode', app.payment_api_mode(p_center, cp.processor),
                                   'methods', to_jsonb(cp.methods), 'donor_covers_fee_allowed', cp.donor_covers_fee_allowed);
  end if;
  select coalesce(jsonb_agg(
           case when m.method = 'zelle' and c.environment = 'sandbox'
                then jsonb_build_object('method', m.method,
                       'instructions', jsonb_build_object('name', 'Sandbox: no real money moves')
                                       || case when nullif(btrim(coalesce(m.instructions->>'memo_hint', '')), '') is not null
                                               then jsonb_build_object('memo_hint', m.instructions->>'memo_hint') else '{}'::jsonb end,
                       'rehearsal', true)
                else jsonb_build_object('method', m.method, 'instructions', m.instructions) end
           order by m.sort, m.method), '[]'::jsonb)
    into v_offline from app.center_payment_methods m where m.center_id = p_center and m.accepted;
  return jsonb_build_object('online', v_online, 'online_unavailable', v_reason, 'offline', v_offline, 'environment', c.environment);
end $$;

-- Rehearsal is exactly "this organization is a sandbox" (read past the centers policy, so a
-- sandbox the member cannot list still hides the address). Answered only to the organization's own
-- members and payment staff: it is not a way to ask whether some other organization is a sandbox.
create or replace function app.zelle_rehearsal(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select c.environment = 'sandbox' from app.centers c
                    where c.id = p_center and (app.is_member_of(c.id) or app.payments_can_view(c.id))), false)
$$;

drop policy if exists center_payment_methods_read on app.center_payment_methods;
create policy center_payment_methods_read on app.center_payment_methods for select to authenticated
  using (app.payments_can_view(center_id)
         or (accepted and app.is_member_of(center_id)
             and not (method = 'zelle' and app.zelle_rehearsal(center_id))));

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.payment_reports_prepare(), app.zelle_report_window_days(uuid), app.zelle_bank_account_id(uuid),
  app.zelle_rehearsal(uuid),
  app.set_zelle_reporting(uuid, int, uuid, text), app._zelle_report_notice(uuid, text),
  app.zelle_recorded_payments(uuid, bigint, date), app._zelle_report_held(uuid),
  app.report_payment(uuid, uuid, text, bigint, date, text, text, uuid[], text), app.withdraw_payment_report(uuid, text),
  app.my_payment_reports(uuid, uuid), app.reject_payment_report(uuid, text), app.link_payment_report(uuid, uuid, text),
  app.payment_report_counts(uuid), app.worker_payment_reports_sweep(), app.member_payment_options(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.zelle_report_window_days(uuid), app.zelle_rehearsal(uuid), app.set_zelle_reporting(uuid, int, uuid, text),
  app.report_payment(uuid, uuid, text, bigint, date, text, text, uuid[], text), app.withdraw_payment_report(uuid, text),
  app.my_payment_reports(uuid, uuid), app.reject_payment_report(uuid, text), app.link_payment_report(uuid, uuid, text),
  app.payment_report_counts(uuid), app.member_payment_options(uuid)
  to authenticated, service_role;
grant execute on function app.worker_payment_reports_sweep() to connect_worker;
