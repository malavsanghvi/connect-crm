-- 0882 · DonorDelight slice 3, part 2: the thank-you tracker's steps (docs/DONORDELIGHT.md sections 5.4 and 12; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Every gift opens ONE thank-you step, due within the community's window (0881). The step closes by itself, from what already
--   happened, and opens again if that is taken back:
--     an ordinary step    closes with the payment's receipt sent (payments.receipt_sent_at), or any thank-you touch (0762) that went
--                         well (outcome "done", not voided) on or after the gift's day
--     a personal step     closes only with such a thank-you touch made by call, visit, card or video (channel phone, in_person, post,
--                         video): a first gift (when the rules ask) or a gift from the amount the rules name
--   Voiding that touch opens the step again. Nothing is copied: closing is READ, never stored, so it cannot fall out of step.
--
--   app.care_thanks                      the steps: the payment, the day of the gift, the due day, whether it needs a personal thank-you,
--                                        and, when someone decided no thanks is needed, who and why. NO amount and no household is kept
--                                        here: the household is the payment's own (so a merge of two households carries the steps), and
--                                        an amount is read from the payment only by those who may see amounts (app.care_amounts_can).
--   app._care_gifts(center)              the gifts, by 0749's rule: payments that went through (captured, settled, partly refunded), less
--                                        refunds, never opening balances or history imports, never one whose payer is under 18; memberships,
--                                        school and class fees and store sales are not donations unless the rules say so. A gift that
--                                        repeats a standing one (the household has a recurring gift, the same amount came within the 45 days
--                                        before) is not thanked again: recorded payments carry no link to the recurring gift that made them,
--                                        so this is how a repeat is recognised.
--   app._care_thanks_sync(center)        opens the steps that are missing (idempotent; no trigger on payments, the money path is untouched).
--                                        Runs when the screens read; nothing opens before the rules are saved (0881).
--   app._care_thanked(center)            for every step: when and how it was thanked, or nothing
--   app.set_aside_care_thank(step, why)  "no thanks needed" (a test gift, a refund already made): reason required, kept
--   app.reopen_care_thank(step)          undo that
--   Both of the last two: whoever may see the household's care record (0760). Audited by app.audit_private_row (0758).
set client_min_messages = warning;

create table if not exists app.care_thanks (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  -- The step lives and dies with its gift. The household is the payment's own: nothing here to move on a merge.
  payment_id       uuid not null unique references app.payments(id) on delete cascade,
  gift_on          date not null,
  due_on           date not null,
  needs_personal   boolean not null default false,
  opened_at        timestamptz not null default now(),
  set_aside_at     timestamptz,
  set_aside_by     uuid references auth.users(id) on delete set null,
  set_aside_reason text check (set_aside_reason is null or char_length(btrim(set_aside_reason)) between 1 and 500),
  constraint care_thanks_set_aside_together check ((set_aside_at is null) = (set_aside_reason is null))
);
create index if not exists care_thanks_center_due_idx on app.care_thanks (center_id, due_on);
comment on table app.care_thanks is
  'DonorDelight (0882): one thank-you step per gift (the payment, its day, the due day, personal or not, set aside with a reason). No amount and no household: both are read from the payment. Closing is computed from receipts and thank-you touches (app._care_thanked), never stored. Written only by app._care_thanks_sync and app.set_aside_care_thank / app.reopen_care_thank.';

drop trigger if exists audit_care_thanks on app.care_thanks;
create trigger audit_care_thanks after insert or update or delete on app.care_thanks
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_thanks', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_thanks enable row level security;
-- Only those who see every care record read this table directly; an owner who sees their own households reads through the functions.
drop policy if exists care_thanks_read on app.care_thanks;
create policy care_thanks_read on app.care_thanks for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[]));
drop policy if exists module_switch on app.care_thanks;
create policy module_switch on app.care_thanks as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_thanks from public, anon, authenticated;
grant select on app.care_thanks to authenticated;
grant all on app.care_thanks to service_role;

-- The gifts of a community, with whether each is a household's first and whether it only repeats a standing gift.
create or replace function app._care_gifts(p_center uuid)
returns table (payment_id uuid, household_id uuid, received_on date, recorded_on date, donation_cents bigint, first_ever boolean, repeat boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  with tz as (select coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago') as z),
  cfg as (select coalesce((select s.count_fees from app.care_settings s where s.center_id = p_center), false) as count_fees),
  pay as (
    select p.id, p.household_id, p.received_on, (p.created_at at time zone (select z from tz))::date as recorded_on, p.created_at,
           greatest(p.amount_cents - p.refunded_cents, 0)::bigint as net
      from app.payments p
     where p.center_id = p_center
       and p.status in ('captured', 'settled', 'partially_refunded')
       and not p.is_opening_balance and not p.is_historical
       and (p.payer_person_id is null or not app.person_is_minor(p.payer_person_id))
  ),
  fee as (
    select al.payment_id, sum(al.amount_cents)::bigint as fee
      from app.payment_allocations al join app.pledges pl on pl.id = al.pledge_id
     where al.center_id = p_center and pl.source in ('membership_fee', 'pathshala_fee', 'store')
     group by al.payment_id
  ),
  g as (
    select pay.*, case when (select count_fees from cfg) then pay.net else pay.net - least(coalesce(fee.fee, 0), pay.net) end as donation
      from pay left join fee on fee.payment_id = pay.id
  ),
  w as (
    select g.*,
           row_number() over (partition by g.household_id order by g.received_on, g.created_at, g.id) = 1 as first_ever,
           lag(g.donation) over (partition by g.household_id order by g.received_on, g.created_at, g.id) as prev_donation,
           lag(g.received_on) over (partition by g.household_id order by g.received_on, g.created_at, g.id) as prev_on
      from g where g.donation > 0
  )
  select w.id, w.household_id, w.received_on, w.recorded_on, w.donation, w.first_ever,
         coalesce(w.prev_donation = w.donation and w.received_on - w.prev_on between 0 and 45
                  and exists (select 1 from app.recurring_gifts r where r.household_id = w.household_id), false) as repeat
    from w
$$;
revoke execute on function app._care_gifts(uuid) from public, anon, authenticated;

-- Opens the steps that are missing. Idempotent. Nothing before the rules are saved; nothing when DonorDelight or Giving is off.
create or replace function app._care_thanks_sync(p_center uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings; n integer;
begin
  select * into s from app.care_settings where center_id = p_center;
  if s.center_id is null then return 0; end if;
  if not app._org_private_module_on(p_center, 'care') or not app.module_enabled(p_center, 'giving') then return 0; end if;
  insert into app.care_thanks (center_id, payment_id, gift_on, due_on, needs_personal)
  select p_center, g.payment_id, g.received_on,
         greatest(g.received_on, g.recorded_on) + s.thank_window_days,
         (s.first_gift_personal and g.first_ever) or (s.personal_from_cents is not null and g.donation_cents >= s.personal_from_cents)
    from app._care_gifts(p_center) g
   where greatest(g.received_on, g.recorded_on) >= s.thanks_from and not g.repeat
  on conflict (payment_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app._care_thanks_sync(uuid) from public, anon, authenticated;

-- When and how each step was thanked (null when it is open). Read live, so voiding a touch opens the step again.
create or replace function app._care_thanked(p_center uuid)
returns table (thank_id uuid, thanked_at timestamptz, how text)
language sql stable security definer set search_path = app, public, extensions as $$
  with tz as (select coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago') as z)
  select t.id,
         case when rc.at is null then tc.at when tc.at is null then rc.at else least(rc.at, tc.at) end,
         case when rc.at is null and tc.at is null then null
              when rc.at is null or (tc.at is not null and tc.at <= rc.at) then 'touch' else 'receipt' end
    from app.care_thanks t
    join app.payments p on p.id = t.payment_id
    left join lateral (select case when not t.needs_personal then p.receipt_sent_at end as at) rc on true
    left join lateral (
      select min(c.touched_at) as at
        from app.care_touches c
       where c.household_id = p.household_id and c.kind = 'thank_you' and c.outcome = 'done' and c.voided_at is null
         and (not t.needs_personal or c.channel in ('in_person', 'phone', 'post', 'video'))
         and c.touched_at >= (t.gift_on::timestamp at time zone (select z from tz))
    ) tc on true
   where t.center_id = p_center
$$;
revoke execute on function app._care_thanked(uuid) from public, anon, authenticated;

-- "No thanks needed", with the reason. Whoever may see the household's care record.
create or replace function app.set_aside_care_thank(p_thank uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.care_thanks; v_hh uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into t from app.care_thanks where id = p_thank for update;
  if t.id is null then raise exception 'That thank-you step was not found.' using errcode = 'P0002'; end if;
  select p.household_id into v_hh from app.payments p where p.id = t.payment_id;
  perform app._care_household_or_raise(v_hh);
  if v_reason is null then raise exception 'Say why no thank-you is needed. It is kept.' using errcode = '23514'; end if;
  if char_length(v_reason) > 500 then raise exception 'The reason is at most 500 characters.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care thank-you set aside');
  update app.care_thanks set set_aside_at = now(), set_aside_by = auth.uid(), set_aside_reason = v_reason where id = p_thank;
end $$;

create or replace function app.reopen_care_thank(p_thank uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.care_thanks; v_hh uuid;
begin
  select * into t from app.care_thanks where id = p_thank for update;
  if t.id is null then raise exception 'That thank-you step was not found.' using errcode = 'P0002'; end if;
  select p.household_id into v_hh from app.payments p where p.id = t.payment_id;
  perform app._care_household_or_raise(v_hh);
  perform app.set_audit_context('Care thank-you reopened');
  update app.care_thanks set set_aside_at = null, set_aside_by = null, set_aside_reason = null where id = p_thank;
end $$;

revoke execute on function app.set_aside_care_thank(uuid, text), app.reopen_care_thank(uuid) from public, anon;
grant execute on function app.set_aside_care_thank(uuid, text), app.reopen_care_thank(uuid) to authenticated, service_role;
