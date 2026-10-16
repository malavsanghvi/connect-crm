-- 0862 · Cover the card fee, and the checkout that carries the optional Chip In (docs/PAYMENT_ADDONS.md §5, §6, §7).
-- The owner approved the design on 2026-10-15 ("go with recommendations"). Second of the three migrations of build slice 1 (the
-- database): 0861 made the Chip In's settings and ledger; this one lifts the lock of 0410, adds the columns, the fee rates, the one
-- quote and the extended checkout and worker functions; 0863 seeds JSH.
--
-- INERT BY DEFAULT. Nothing is asked of any member and nothing charges a fee until BOTH of these are true:
--   * fee-cover: an organization switches "donors may cover the card fee" on in Settings › Payments (default off for everyone);
--   * Chip In: a Weaver platform admin sets that organization's limit and suggestions and switches asking on (default off).
-- An app or portal that sends none of the new fields is served exactly as before.
--
-- The money rules this changes (each is a no-op while no payment carries a covered fee):
--   1. payments.amount_cents stays "what the organization is paid by the donor" and becomes gift + covered fee. The covered part is
--      payments.donor_covered_fee_cents (until now never written). The Chip In is NOT in amount_cents: it sits beside the payment
--      (payments.chip_in_cents) and in the ledger, so no existing total of amount_cents ever includes it.
--   2. app.allocate_payment places only the GIFT (amount - covered fee) on pledges. A trigger on payment_allocations refuses to
--      let more than the gift be applied, whoever writes it.
--   3. app.household_credit, the "Not applied to a pledge" line of the payments report and the Pathshala late-payment credit
--      subtract the covered fee, so a covered fee is never credit the treasurer must "handle". (The report gains one more line,
--      "Card fees covered by donors", so its lines still add up to what was received.)
--   4. app.worker_record_online_payment checks the TOTAL (gift + fee + Chip In) and the application fee against what the provider
--      reports, and refuses to record anything that differs.
--   5. The covered fee is one calculation, in the database (app._fee_cover, called by app.fee_estimate and the quote); the phone
--      never works out a fee or a limit. The rates are rows (app.payment_fee_rates), insert-only, with a source and a date.
--
-- Who may change what: an organization (the owner, integrations.manage or giving.manage, with a reason, as for every payment
-- setting) switches fee-cover for Stripe on or off; only a platform admin sets a Chip In or a fee rate; nobody writes the new payment
-- columns except the recording functions.
set client_min_messages = warning;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The Stripe fee rates: one place for them, insert-only
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists app.payment_fee_rates (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid references app.centers(id) on delete cascade,   -- null = the platform default
  method_class   text not null check (method_class in ('card','ach')),
  bps            integer not null check (bps between 0 and 1000),
  fixed_cents    integer not null default 0 check (fixed_cents between 0 and 100),
  cap_cents      integer check (cap_cents is null or cap_cents between 1 and 100000),
  effective_from timestamptz not null default now(),
  source_note    text not null check (char_length(btrim(source_note)) between 1 and 500),
  set_by         uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
comment on table app.payment_fee_rates is
  'Stripe''s standard fee, used only to ESTIMATE the card fee a donor may cover (docs/PAYMENT_ADDONS.md §5.3, §6.5). Insert-only: a rate change adds a row; each checkout stores the row it used. center_id null is the platform default; an organization''s own row (its negotiated or nonprofit rate) is set by a platform admin only. The fee actually recorded on a payment is always Stripe''s own.';
create index if not exists payment_fee_rates_lookup_idx on app.payment_fee_rates (center_id, method_class, effective_from desc, created_at desc);

create or replace function app.payment_fee_rates_insert_only() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  raise exception 'A fee rate is never changed or removed; add a new one.' using errcode = '22023';
end $$;
drop trigger if exists payment_fee_rates_insert_only on app.payment_fee_rates;
create trigger payment_fee_rates_insert_only before update or delete on app.payment_fee_rates
  for each row execute function app.payment_fee_rates_insert_only();

insert into app.module_tables (table_name, module_key) values ('payment_fee_rates', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_payment_fee_rates on app.payment_fee_rates;
create trigger audit_payment_fee_rates after insert or update or delete on app.payment_fee_rates
  for each row execute function app.audit_row();

alter table app.payment_fee_rates enable row level security;
drop policy if exists payment_fee_rates_read on app.payment_fee_rates;
create policy payment_fee_rates_read on app.payment_fee_rates for select to authenticated
  using ((select app.is_platform_admin()));
drop policy if exists module_switch on app.payment_fee_rates;
create policy module_switch on app.payment_fee_rates as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));
revoke all on app.payment_fee_rates from public, anon, authenticated, connect_worker;
grant select on app.payment_fee_rates to authenticated;
grant all on app.payment_fee_rates to service_role;

-- The platform defaults (Stripe's US pricing page, read 2026-10-15; Apple Pay and Google Pay are card payments).
insert into app.payment_fee_rates (center_id, method_class, bps, fixed_cents, cap_cents, effective_from, source_note)
select null::uuid, 'card', 290, 30, null::integer, timestamptz '2020-01-01 00:00:00+00',
       'Stripe US standard pricing: cards 2.9% + 30 cents (read 2026-10-15). Apple Pay and Google Pay are card payments.'
 where not exists (select 1 from app.payment_fee_rates where center_id is null and method_class = 'card');
insert into app.payment_fee_rates (center_id, method_class, bps, fixed_cents, cap_cents, effective_from, source_note)
select null::uuid, 'ach', 80, 0, 500, timestamptz '2020-01-01 00:00:00+00',
       'Stripe US standard pricing: ACH direct debit 0.8%, capped at $5.00 (read 2026-10-15).'
 where not exists (select 1 from app.payment_fee_rates where center_id is null and method_class = 'ach');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The one calculation of the covered fee (integer cents, §5)
-- ═════════════════════════════════════════════════════════════════════════════
-- card, apple_pay and google_pay are the card class; ach is the bank-debit class; anything else is no class.
create or replace function app._fee_class(p_method text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case lower(btrim(coalesce(p_method, '')))
           when 'card' then 'card' when 'apple_pay' then 'card' when 'google_pay' then 'card' when 'ach' then 'ach' end
$$;

-- What Stripe charges on a charge of p_amount: bps basis points of it, rounded half up, plus the fixed part, never above the cap.
create or replace function app._fee_charge(p_bps integer, p_fixed integer, p_cap integer, p_amount bigint) returns bigint
language sql immutable set search_path = app, public, extensions as $$
  select case when p_cap is null then x.s else least(x.s, p_cap::bigint) end
    from (select ((p_bps::bigint * greatest(coalesce(p_amount, 0), 0) + 5000) / 10000) + p_fixed::bigint as s) x
$$;

-- The fee F to add so that the organization nets the gift exactly: the fee on the WHOLE charge (base + F), solved for itself,
-- then raised a cent at a time while the real rounded fee would still be more than F. p_base is the gift plus any Chip In.
-- The organization is never short; it is at most one cent over. This is the only place the formula exists.
create or replace function app._fee_cover(p_bps integer, p_fixed integer, p_cap integer, p_base bigint) returns bigint
language plpgsql immutable set search_path = app, public, extensions as $$
declare f bigint; n integer := 0;
begin
  if p_base is null or p_base < 0 then raise exception 'The amount to add the fee to is not valid.' using errcode = '22023'; end if;
  f := (p_bps::bigint * p_base + 10000::bigint * p_fixed + (10000 - p_bps) - 1) / (10000 - p_bps);
  if p_cap is not null and f > p_cap then f := p_cap; end if;
  while app._fee_charge(p_bps, p_fixed, p_cap, p_base + f) > f loop
    f := f + 1;
    n := n + 1;
    if n > 1000 then raise exception 'The card fee could not be worked out.' using errcode = '22023'; end if;
  end loop;
  return f;
end $$;

-- The rate that applies to an organization for a class: its own latest row, else the platform default's. All-null when none.
create or replace function app._fee_rate(p_center uuid, p_class text) returns app.payment_fee_rates
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.payment_fee_rates;
begin
  select * into r from app.payment_fee_rates
   where center_id = p_center and method_class = p_class and effective_from <= now()
   order by effective_from desc, created_at desc, id desc limit 1;
  if r.id is null then
    select * into r from app.payment_fee_rates
     where center_id is null and method_class = p_class and effective_from <= now()
     order by effective_from desc, created_at desc, id desc limit 1;
  end if;
  return r;
end $$;

-- What the portal server and the member app call (never a copy of the formula): the fee to add to p_base_cents, for a method.
-- {fee_cents, charge_cents, base_cents, method_class, estimate: true, rate: {id, bps, fixed_cents, cap_cents, custom, source_note}}.
create or replace function app.fee_estimate(p_center uuid, p_method text, p_base_cents bigint) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_class text := app._fee_class(p_method); r app.payment_fee_rates; v_fee bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  if not app.is_member_of(p_center) then
    raise exception 'Only a member of this community can ask for a fee estimate.' using errcode = '42501';
  end if;
  if v_class is null then raise exception 'Choose card or bank account.' using errcode = '22023'; end if;
  if p_base_cents is null or p_base_cents < 50 or p_base_cents > 1000000000 then
    raise exception 'The amount must be between $0.50 and $10,000,000.00.' using errcode = '22023';
  end if;
  r := app._fee_rate(p_center, v_class);
  if r.id is null then raise exception 'No fee rate is set for % payments.', v_class using errcode = '22023'; end if;
  v_fee := app._fee_cover(r.bps, r.fixed_cents, r.cap_cents, p_base_cents);
  return jsonb_build_object('fee_cents', v_fee, 'charge_cents', p_base_cents + v_fee, 'base_cents', p_base_cents,
    'method_class', v_class, 'estimate', true,
    'rate', jsonb_build_object('id', r.id, 'bps', r.bps, 'fixed_cents', r.fixed_cents, 'cap_cents', r.cap_cents,
                               'custom', r.center_id is not null, 'source_note', r.source_note));
end $$;

-- A platform admin adds a rate row (p_center null = the platform default). A reason is required; no fresh 2FA code.
create or replace function app.platform_set_fee_rate(p_center uuid, p_method_class text, p_bps integer, p_fixed_cents integer,
                                                     p_cap_cents integer, p_source_note text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can change a fee rate.' using errcode = '42501';
  end if;
  if p_center is not null and not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  if p_method_class is null or p_method_class not in ('card','ach') then raise exception 'Choose card or bank debit.' using errcode = '22023'; end if;
  if p_bps is null or p_bps < 0 or p_bps > 1000 then raise exception 'The percentage is between 0%% and 10%%.' using errcode = '22023'; end if;
  if p_fixed_cents is null or p_fixed_cents < 0 or p_fixed_cents > 100 then raise exception 'The fixed part is between $0.00 and $1.00.' using errcode = '22023'; end if;
  if p_cap_cents is not null and (p_cap_cents < 1 or p_cap_cents > 100000) then raise exception 'The cap is between $0.01 and $1,000.00.' using errcode = '22023'; end if;
  if nullif(btrim(p_source_note), '') is null then raise exception 'Say where this rate comes from (for example "approved nonprofit pricing, letter of 2026-11-02").' using errcode = '22023'; end if;
  perform app.payments_require_reason(p_reason, 'change a fee rate');
  insert into app.payment_fee_rates (center_id, method_class, bps, fixed_cents, cap_cents, source_note, set_by)
  values (p_center, p_method_class, p_bps, p_fixed_cents, p_cap_cents, left(btrim(p_source_note), 500), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'center_id', p_center, 'method_class', p_method_class, 'bps', p_bps, 'fixed_cents', p_fixed_cents,
                            'cap_cents', p_cap_cents);
end $$;

-- What the organization's staff see: the rate their members' estimate follows, for card and bank debit. No names.
create or replace function app.payment_fee_rates_for(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare k record; v jsonb := '{}'::jsonb; r app.payment_fee_rates;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_view(p_center) then
    raise exception 'Seeing the fee rates needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  for k in select x as cls from unnest(array['card','ach']) x loop
    r := app._fee_rate(p_center, k.cls);
    if r.id is not null then
      v := v || jsonb_build_object(k.cls, jsonb_build_object('bps', r.bps, 'fixed_cents', r.fixed_cents, 'cap_cents', r.cap_cents,
                                   'custom', r.center_id is not null, 'effective_from', r.effective_from, 'source_note', r.source_note));
    end if;
  end loop;
  return v;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Fee-cover is a real switch again (the lock of 0410 is lifted)
-- ═════════════════════════════════════════════════════════════════════════════
alter table app.center_payment_processors drop constraint if exists center_payment_processors_no_donor_fee;
alter table app.center_payment_processors drop constraint if exists center_payment_processors_fee_cover_stripe_only;
alter table app.center_payment_processors add constraint center_payment_processors_fee_cover_stripe_only
  check (not donor_covers_fee_allowed or processor = 'stripe');
comment on column app.center_payment_processors.donor_covers_fee_allowed is
  'Whether the organization lets donors tick "cover the card fee" at checkout (Stripe only; default off). Changed by app.set_payment_processor (owner, integrations.manage or giving.manage, with a reason). Replaces the lock of 0410 (owner decision 2026-09-25 #5, superseded 2026-10-15).';

-- 0410's body with one change: the switch is the organization's again (Stripe only) instead of always off.
create or replace function app.set_payment_processor(p_center uuid, p_processor text, p_methods text[], p_statement_descriptor text,
                                                     p_donor_covers_fee_allowed boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_bad text[]; v_problem text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing the payment settings needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_processor not in ('stripe','paypal') then raise exception 'Choose Stripe or PayPal.' using errcode = '22023'; end if;
  if coalesce(p_donor_covers_fee_allowed, false) and p_processor <> 'stripe' then
    raise exception 'Covering the card fee is not available with PayPal.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_methods), 0) = 0 then raise exception 'Choose at least one online method.' using errcode = '22023'; end if;
  select array_agg(m) into v_bad from unnest(p_methods) m where not (m = any (app.processor_methods(p_processor)));
  if v_bad is not null then
    raise exception '% does not take %.', initcap(p_processor), array_to_string(v_bad, ', ') using errcode = '22023';
  end if;
  v_problem := app.statement_descriptor_problem(p_statement_descriptor);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  perform app.payments_require_reason(p_reason, 'change the ' || initcap(p_processor) || ' settings');
  perform app.payment_processor_ensure(p_center, p_processor);
  update app.center_payment_processors
     set methods = (select array_agg(distinct m order by m) from unnest(p_methods) m),
         statement_descriptor = nullif(btrim(p_statement_descriptor), ''),
         donor_covers_fee_allowed = coalesce(p_donor_covers_fee_allowed, false),
         updated_by = auth.uid()
   where center_id = p_center and processor = p_processor;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The payment and the checkout carry the extras
-- ═════════════════════════════════════════════════════════════════════════════
-- payments: amount_cents = gift + covered fee (unchanged meaning: what the organization is paid by the donor). The covered part is
-- donor_covered_fee_cents. The Chip In is beside the payment, never inside it. charged_cents is what the card was charged in
-- total (null on a payment recorded before this: it was amount_cents). The two *_refunded_cents columns are for the refund slice.
alter table app.payments
  add column if not exists chip_in_cents bigint not null default 0,
  add column if not exists application_fee_cents bigint not null default 0,
  add column if not exists charged_cents bigint,
  add column if not exists provider_refunded_cents bigint not null default 0,
  add column if not exists application_fee_refunded_cents bigint not null default 0,
  add column if not exists gift_cents bigint generated always as (amount_cents - donor_covered_fee_cents) stored;
comment on column app.payments.donor_covered_fee_cents is 'The part of amount_cents the donor added to cover the card fee (Stripe only). Not pledge money and not credit: only gift_cents is applied to pledges.';
comment on column app.payments.gift_cents is 'amount_cents less donor_covered_fee_cents: the part applied to pledges.';
comment on column app.payments.chip_in_cents is 'The donor''s optional contribution to Weaver, paid in the same charge. NOT part of amount_cents, never in the organization''s totals, receipts or pledges.';
comment on column app.payments.application_fee_cents is 'What Weaver took of the charge as the Stripe application fee (the Chip In less the extra card fee Weaver absorbs), as Stripe reported it.';
comment on column app.payments.charged_cents is 'What the card was charged in total (gift + covered fee + Chip In) = the PaymentIntent''s amount_received. Null: the payment predates it (it was amount_cents).';

alter table app.payments drop constraint if exists payments_addons_check;
alter table app.payments add constraint payments_addons_check check (
  donor_covered_fee_cents >= 0 and donor_covered_fee_cents < amount_cents
  and chip_in_cents >= 0 and application_fee_cents >= 0 and application_fee_cents <= chip_in_cents
  and provider_refunded_cents >= 0 and application_fee_refunded_cents >= 0
  and (charged_cents is null or charged_cents = amount_cents + chip_in_cents));
-- Offline, bank, PayPal and imported payments carry none of it (staff can insert offline payments directly under the insert policy).
alter table app.payments drop constraint if exists payments_addons_stripe_only;
alter table app.payments add constraint payments_addons_stripe_only check (
  provider = 'stripe'
  or (donor_covered_fee_cents = 0 and chip_in_cents = 0 and application_fee_cents = 0 and charged_cents is null
      and provider_refunded_cents = 0 and application_fee_refunded_cents = 0));

-- Only the recording functions write these columns. A signed-in session (staff with giving.manage can update payments through the
-- API) is refused; the background service, migrations and the functions' owner have no signed-in person and are not asked.
create or replace function app.payments_addons_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.donor_covered_fee_cents <> 0 or new.chip_in_cents <> 0 or new.application_fee_cents <> 0 or new.charged_cents is not null
       or new.provider_refunded_cents <> 0 or new.application_fee_refunded_cents <> 0 then
      raise exception 'The card fee a donor covered and the Chip In are written only when a Stripe payment is recorded.' using errcode = '42501';
    end if;
  elsif (new.donor_covered_fee_cents, new.chip_in_cents, new.application_fee_cents, new.charged_cents,
         new.provider_refunded_cents, new.application_fee_refunded_cents)
        is distinct from (old.donor_covered_fee_cents, old.chip_in_cents, old.application_fee_cents, old.charged_cents,
                          old.provider_refunded_cents, old.application_fee_refunded_cents) then
    raise exception 'The card fee a donor covered and the Chip In are written only when a Stripe payment is recorded.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists payments_addons_guard on app.payments;
create trigger payments_addons_guard before insert or update on app.payments
  for each row execute function app.payments_addons_guard();

-- A covered fee is never pledge money: whoever writes an allocation (the allocator, an import, a script) cannot apply more than the gift.
-- Cheap: one primary-key lookup, and nothing else happens for a payment with no covered fee.
create or replace function app.payment_allocation_gift_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_covered bigint; v_gift bigint; v_sum bigint;
begin
  select p.donor_covered_fee_cents, p.amount_cents - p.donor_covered_fee_cents into v_covered, v_gift
    from app.payments p where p.id = new.payment_id;
  if coalesce(v_covered, 0) = 0 then return new; end if;
  select coalesce(sum(a.amount_cents), 0) into v_sum
    from app.payment_allocations a where a.payment_id = new.payment_id and a.id is distinct from new.id;
  if v_sum + new.amount_cents > v_gift then
    raise exception 'A card fee the donor covered is not pledge money: at most % of this payment can be applied to pledges.',
      to_char(v_gift / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payment_allocation_gift_guard on app.payment_allocations;
create trigger payment_allocation_gift_guard before insert or update of amount_cents, payment_id on app.payment_allocations
  for each row execute function app.payment_allocation_gift_guard();

-- payment_checkouts: amount_cents becomes the ORGANIZATION'S charge (gift + covered fee), so its 50..100000000 check and the rule
-- "never record an amount the checkout did not ask for" keep working. gift_cents and total_cents are derived (no backfill): an
-- existing row is gift = amount = total.
alter table app.payment_checkouts
  add column if not exists covered_fee_cents bigint not null default 0,
  add column if not exists chip_in_cents bigint not null default 0,
  add column if not exists application_fee_cents bigint not null default 0,
  add column if not exists pay_method text,
  add column if not exists fee_rate_id uuid references app.payment_fee_rates(id),
  add column if not exists gift_cents bigint generated always as (amount_cents - covered_fee_cents) stored,
  add column if not exists total_cents bigint generated always as (amount_cents + chip_in_cents) stored;
comment on column app.payment_checkouts.amount_cents is 'The organization''s charge: the gift plus any card fee the donor chose to cover. The Chip In is chip_in_cents; the card is charged total_cents.';
alter table app.payment_checkouts drop constraint if exists payment_checkouts_addons_check;
alter table app.payment_checkouts add constraint payment_checkouts_addons_check check (
  covered_fee_cents >= 0 and chip_in_cents >= 0 and application_fee_cents >= 0 and application_fee_cents <= chip_in_cents
  and covered_fee_cents < amount_cents
  and ((covered_fee_cents = 0 and chip_in_cents = 0 and application_fee_cents = 0)
       or (processor = 'stripe' and context <> 'processor_test')));
alter table app.payment_checkouts drop constraint if exists payment_checkouts_pay_method_check;
alter table app.payment_checkouts add constraint payment_checkouts_pay_method_check check (pay_method is null or pay_method in ('card','ach'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. A covered fee is never pledge money or credit (§7.1-7.3)
-- ═════════════════════════════════════════════════════════════════════════════
-- 0104's body with one change: what is placed is the payment's GIFT (amount less the covered fee) less what is already allocated.
create or replace function app.allocate_payment(p_payment uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_apply boolean DEFAULT false)
 RETURNS TABLE(pledge_id uuid, amount_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare v_center uuid; v_household uuid; v_remaining bigint; r record; v_take bigint;
begin
  select center_id, household_id,
         amount_cents - donor_covered_fee_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = p_payment),0)
    into v_center, v_household, v_remaining from app.payments where id = p_payment;
  perform app.assert_module_enabled(v_center, 'giving');
  if v_remaining is null or v_remaining <= 0 then return; end if;
  for r in
    select p.id, p.amount_cents - p.paid_cents as open_cents
    from app.pledges p
    where p.center_id = v_center and p.household_id = v_household
      and p.status in ('open','partially_paid')
      and (p_pledge_ids is null or p.id = any(p_pledge_ids))
    order by case when p_pledge_ids is not null then array_position(p_pledge_ids, p.id) end, p.pledged_at
  loop
    exit when v_remaining <= 0;
    v_take := least(r.open_cents, v_remaining);
    if v_take > 0 then
      pledge_id := r.id; amount_cents := v_take;
      if p_apply then
        insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents, chosen_by_donor)
        values (v_center, p_payment, r.id, v_take, p_pledge_ids is not null);
      end if;
      return next;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
end $function$;

-- 0543's body with one change: a covered fee is not credit.
create or replace function app.household_credit(p_household uuid) returns bigint
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_credit bigint;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then return 0; end if;
  if not app.adult_of_household(v_center, p_household) then raise exception 'only an adult of the household can see its credit'; end if;
  select coalesce(sum(greatest(p.amount_cents - p.donor_covered_fee_cents - p.refunded_cents - coalesce(a.alloc, 0), 0)), 0) into v_credit
    from app.payments p
    left join lateral (select sum(amount_cents) as alloc from app.payment_allocations where payment_id = p.id) a on true
   where p.household_id = p_household and p.status in ('captured', 'settled', 'pending_clearing', 'partially_refunded');
  return v_credit;
end $$;

-- 0672's body with two changes: "Not applied to a pledge" leaves out the covered fee, and the covered fees get a line of their own
-- ("Card fees covered by donors") by fund and by campaign, so those lines still add up to what was received.
create or replace function app.reports_payments_summary(p_center uuid, p_from date, p_to date, p_group text default 'method')
returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_group is null or p_group not in ('method', 'month', 'year', 'fund', 'campaign', 'none') then
    raise exception 'Group giving by method, month, year, fund, campaign or none.' using errcode = '22023';
  end if;
  with pay as (
    select p.id, p.method, p.received_on, p.amount_cents, p.refunded_cents, p.donor_covered_fee_cents as covered_cents
      from app.payments p
     where p.center_id = p_center
       and p.received_on between p_from and p_to
       and p.status not in ('failed', 'voided', 'authorized')
  ),
  tot as (
    select count(*)::integer as payments,
           coalesce(sum(pay.amount_cents), 0)::bigint as received,
           coalesce(sum(pay.refunded_cents), 0)::bigint as refunded
      from pay
  ),
  alloc as (
    select al.payment_id, al.amount_cents, coalesce(pl.fund_id, cp.fund_id) as fund_id, pl.campaign_id
      from app.payment_allocations al
      join pay on pay.id = al.payment_id
      join app.pledges pl on pl.id = al.pledge_id
      left join app.campaigns cp on cp.id = pl.campaign_id
     where al.center_id = p_center
  ),
  loose as (
    select count(*)::integer as n, coalesce(sum(r.rem), 0)::bigint as amount
      from (select pay.id, pay.amount_cents - pay.covered_cents - coalesce((select sum(al.amount_cents) from alloc al where al.payment_id = pay.id), 0) as rem
              from pay) r
     where r.rem <> 0
  ),
  covered as (
    select count(*) filter (where pay.covered_cents > 0)::integer as n, coalesce(sum(pay.covered_cents), 0)::bigint as amount
      from pay
  ),
  g as (
    select pm.method::text as k, pm.method::text as label, count(*)::integer as n,
           sum(pm.amount_cents)::bigint as received, sum(pm.refunded_cents)::bigint as refunded
      from pay pm where p_group = 'method' group by pm.method
    union all
    select to_char(pm.received_on, 'YYYY-MM'), to_char(pm.received_on, 'YYYY-MM'), count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'month' group by to_char(pm.received_on, 'YYYY-MM')
    union all
    select extract(year from pm.received_on)::integer::text, extract(year from pm.received_on)::integer::text, count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'year' group by extract(year from pm.received_on)::integer
    union all
    select coalesce(a.fund_id::text, 'none'), coalesce(f.name, 'No fund'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.funds f on f.id = a.fund_id
     where p_group = 'fund' group by a.fund_id, f.name
    union all
    select coalesce(a.campaign_id::text, 'none'), coalesce(ca.name, 'No campaign'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.campaigns ca on ca.id = a.campaign_id
     where p_group = 'campaign' group by a.campaign_id, ca.name
    union all
    select 'unallocated', 'Not applied to a pledge', lo.n, lo.amount, null::bigint
      from loose lo where p_group in ('fund', 'campaign') and lo.n > 0
    union all
    select 'covered_fee', 'Card fees covered by donors', cv.n, cv.amount, null::bigint
      from covered cv where p_group in ('fund', 'campaign') and cv.n > 0
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'group', p_group,
    'totals', jsonb_build_object(
      'payments', tot.payments,
      'received_cents', tot.received,
      'refunded_cents', tot.refunded,
      'net_cents', tot.received - tot.refunded),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.k,
               'label', g.label,
               'payments', g.n,
               'received_cents', g.received,
               'refunded_cents', g.refunded,
               'net_cents', case when g.refunded is null then null else g.received - g.refunded end)
             order by case when p_group in ('month', 'year') then 0 else -(g.received - coalesce(g.refunded, 0)) end, g.k)
        from g), '[]'::jsonb))
    into v
    from tot;
  return v;
end $$;

-- 0591's late-payment credit, with the covered fee left out of the money that is "left" (a fee payment never carries one, because a
-- covered fee is offered for gifts only; this keeps the credit honest if that ever changes).
create or replace function app.pathshala_late_payment_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_left bigint; p app.pledges;
begin
  if new.status <> 'paid' or old.status = 'paid' or new.payment_id is null or coalesce(cardinality(new.pledge_ids), 0) = 0 then return null; end if;
  select pay.amount_cents - pay.donor_covered_fee_cents - pay.refunded_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = pay.id), 0)
    into v_left from app.payments pay where pay.id = new.payment_id;
  if coalesce(v_left, 0) <= 0 then return null; end if;
  select pl.* into p from app.pledges pl
   where pl.id = any (new.pledge_ids) and pl.source = 'pathshala_fee' and pl.status = 'cancelled'
     and exists (select 1 from app.pathshala_enrollments en where en.id = pl.source_ref_id)
   order by pl.pledged_at limit 1;
  if p.id is null then return null; end if;
  insert into app.rsvp_credit_releases (center_id, household_id, enrollment_id, pledge_id, released_cents, created_by, kind)
  values (new.center_id, p.household_id, p.source_ref_id, p.id, v_left, null, 'pathshala_late_payment');
  return null;
exception
  when query_canceled then
    perform app.log_audit(new.center_id, 'pathshala.late_payment_failed', 'payment_checkouts', new.id::text, null,
                          jsonb_build_object('error', 'the statement timed out'), 'A payment after a released seat could not be put in the credit queue');
    return null;
  when others then
    -- Never stop the payment from being recorded: the money is household credit either way.
    perform app.log_audit(new.center_id, 'pathshala.late_payment_failed', 'payment_checkouts', new.id::text, null,
                          jsonb_build_object('error', sqlerrm), 'A payment after a released seat could not be put in the credit queue');
    return null;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. What a payment may carry: the kind of pledge, the quote, and the checkout
-- ═════════════════════════════════════════════════════════════════════════════
-- Gifts (§4.3) may carry a covered fee; dues, tickets, Pathshala fees and the store may not.
create or replace function app.pledge_source_is_gift(p_source text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_source in ('general','recurring','labh','construction','boli','sponsorship','pujan','manual','other')
$$;

-- The processor a checkout would use (0590's choice, in one place): the requested one, else the default, else a live one first.
create or replace function app._checkout_processor(p_center uuid, p_processor text) returns app.center_payment_processors
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare cp app.center_payment_processors;
begin
  select * into cp from app.center_payment_processors
   where center_id = p_center and status in ('test','live') and (p_processor is null or processor = p_processor)
   order by is_default desc, (status = 'live') desc, processor limit 1;
  return cp;
end $$;

-- The one calculation behind the quote and the checkout (never called by an app directly). Validates who is asking and what is
-- being paid, decides whether each extra is offered and why not, and returns the lines and the total. A requested extra that is not
-- allowed is listed in "refusals" (and left out of the numbers); it is not an exception, so the quote can show the member why.
create or replace function app._addons_compute(p_center uuid, p_household uuid, p_gift_cents bigint, p_pledge_ids uuid[], p_context text,
                                               p_processor text, p_method text, p_cover_fee boolean, p_chip_in_cents bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; cp app.center_payment_processors; v_rate app.payment_fee_rates;
  v_pledges uuid[] := coalesce(p_pledge_ids, '{}');
  v_cover boolean := coalesce(p_cover_fee, false);
  v_chip bigint := coalesce(p_chip_in_cents, 0);
  v_name text; v_adult boolean; v_staff boolean; v_person uuid; v_mode text; v_usd boolean; v_online boolean;
  v_card boolean := false; v_ach boolean := false; v_paused boolean := false; v_bad integer; v_nongift integer; v_store boolean;
  v_class text;
  v_fc_ok boolean := false; v_fc_why text;
  v_ci_ok boolean := false; v_ci_why text; v_state jsonb; v_left bigint := 0; v_year integer;
  v_fee bigint := 0; v_app bigint := 0; v_extra bigint;
  v_ref jsonb := '[]'::jsonb; v_lines jsonb;
begin
  -- Who is asking, and what for.
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_name := coalesce(c.short_name, c.name);
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  v_adult := app.adult_of_household(p_center, p_household);
  v_staff := app.has_permission(p_center, 'giving.manage');
  if not (v_adult or v_staff) then raise exception 'Only an adult of the family can pay for it.' using errcode = '42501'; end if;
  if p_gift_cents is null or p_gift_cents < 50 then raise exception 'The amount must be at least $0.50.' using errcode = '22023'; end if;
  if p_gift_cents > 100000000 then raise exception 'Online payments are limited to $1,000,000.' using errcode = '22023'; end if;
  if coalesce(p_context, '') not in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','pathshala') then
    raise exception 'Unknown checkout context "%".', p_context using errcode = '22023';
  end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if p_method is not null and p_method not in ('card','ach') then raise exception 'Choose card or bank account.' using errcode = '22023'; end if;
  if v_chip < 0 then raise exception 'The Chip In amount cannot be negative.' using errcode = '22023'; end if;

  -- What the payment is and how it is paid.
  v_online := not coalesce((c.rules #>> '{payments,offline_only}')::boolean, false);
  cp := app._checkout_processor(p_center, p_processor);
  v_online := v_online and cp.center_id is not null;
  v_usd := upper(coalesce(c.currency, 'USD')) = 'USD';
  v_person := app.my_person_id(p_center);
  v_store := p_context = 'store' or exists (select 1 from app.pledges pl where pl.id = any (v_pledges) and pl.source::text = 'store');
  select count(*) into v_nongift from app.pledges pl where pl.id = any (v_pledges) and not app.pledge_source_is_gift(pl.source::text);
  if v_online then
    v_mode := app.payment_api_mode(p_center, cp.processor);
    v_card := cp.processor = 'stripe' and cp.methods && array['card','apple_pay','google_pay']::text[];
    v_ach := cp.processor = 'stripe' and 'ach' = any (cp.methods);
    v_paused := app.payment_plugin_is_paused(p_center, case cp.processor when 'paypal' then 'paypal' else 'card' end);
  end if;

  -- Fee-cover: offered only for a gift paid with Stripe, by an adult of the family, when the organization switched it on.
  v_fc_why := case
    when not v_online then 'no_online'
    when cp.processor <> 'stripe' then 'not_stripe'
    when not coalesce(cp.donor_covers_fee_allowed, false) then 'switched_off'
    when not v_usd then 'not_usd'
    when not v_adult then 'not_family'
    when v_store then 'store'
    when cardinality(v_pledges) = 0 then 'no_pledge'
    when v_nongift > 0 then 'not_a_gift'
    when not (v_card or v_ach) then 'no_method'
    when v_paused then 'paused' end;
  v_fc_ok := v_fc_why is null;

  -- Chip In: offered when the platform asks, the account is under its yearly limit, and the payer is an adult of the family.
  v_year := app.chip_in_year(p_center);
  v_ci_why := case
    when not v_online then 'no_online'
    when cp.processor <> 'stripe' then 'not_stripe'
    when not v_adult then 'not_family'
    when v_person is null then 'no_account'
    when v_store then 'store'
    when not v_usd then 'not_usd'
    when v_paused then 'paused' end;
  if v_ci_why is null then
    v_state := app._chip_in_state(p_center, v_person, v_mode);
    if not coalesce((v_state->>'configured')::boolean, false) or not coalesce((v_state->>'asking')::boolean, false) then
      v_ci_why := 'switched_off';
    else
      v_left := (v_state->>'left_cents')::bigint;
      if v_left < 100 then v_ci_why := 'limit_reached'; end if;
    end if;
  end if;
  v_ci_ok := v_ci_why is null;

  -- What was asked for and cannot be given.
  if v_cover and not v_fc_ok then
    v_ref := v_ref || jsonb_build_array(jsonb_build_object('code', 'fee_cover_not_offered', 'sqlstate', 'CCFEE', 'reason', v_fc_why,
      'message', case when v_online and cp.processor <> 'stripe' then 'The card fee can be covered only when paying with Stripe.'
                      else format('%s does not take a covered card fee on this kind of payment.', v_name) end));
    v_cover := false;
  end if;
  if v_chip > 0 then
    if not v_ci_ok then
      v_ref := v_ref || jsonb_build_array(jsonb_build_object('code', case when v_ci_why = 'limit_reached' then 'chip_in_limit' else 'chip_in_not_offered' end,
        'sqlstate', case when v_ci_why = 'limit_reached' then 'CCLIM' else 'CCCHP' end, 'reason', v_ci_why,
        'message', case v_ci_why when 'limit_reached' then 'You have reached this year''s Chip In limit.'
                                 when 'not_stripe' then 'A Chip In can be added only when paying with Stripe.'
                                 else 'A Chip In is not available for this payment.' end));
      v_chip := 0;
    elsif v_chip < 100 then
      v_ref := v_ref || jsonb_build_array(jsonb_build_object('code', 'chip_in_amount', 'sqlstate', 'CCCHP', 'reason', 'too_small',
        'message', 'A Chip In is at least $1.00.'));
      v_chip := 0;
    elsif v_chip > v_left then
      v_ref := v_ref || jsonb_build_array(jsonb_build_object('code', 'chip_in_limit', 'sqlstate', 'CCLIM', 'reason', 'over_limit',
        'message', format('A Chip In can be at most %s more this year.', to_char(v_left / 100.0, 'FM$999,999,990.00'))));
      v_chip := 0;
    end if;
  end if;

  -- The method: chosen first; card unless only bank debit is offered. Wallets are cards.
  v_class := p_method;
  if v_online and cp.processor = 'stripe' and (v_cover or v_chip > 0 or v_fc_ok) and v_class is null then
    v_class := case when v_card then 'card' when v_ach then 'ach' end;
  end if;
  if v_online and cp.processor = 'stripe' and v_class is not null and (v_cover or v_chip > 0)
     and not ((v_class = 'card' and v_card) or (v_class = 'ach' and v_ach)) then
    v_ref := v_ref || jsonb_build_array(jsonb_build_object('code', 'method_not_offered', 'sqlstate', '22023', 'reason', 'method',
      'message', format('%s does not take %s payments through Stripe.', v_name, case v_class when 'ach' then 'bank account' else 'card' end)));
    v_cover := false; v_chip := 0;
  end if;

  -- The numbers. The organization's charge is gift + covered fee; the card is charged that plus the Chip In.
  if v_class is not null and v_online and cp.processor = 'stripe' and (v_cover or v_chip > 0 or v_fc_ok) then
    v_rate := app._fee_rate(p_center, v_class);
    if (v_cover or v_chip > 0) and v_rate.id is null then
      raise exception 'No fee rate is set for % payments.', v_class using errcode = '22023';
    end if;
  end if;
  if v_cover then
    v_fee := app._fee_cover(v_rate.bps, v_rate.fixed_cents, v_rate.cap_cents, p_gift_cents + v_chip);
  end if;
  if v_chip > 0 then
    if v_cover then
      v_app := v_chip;                       -- the covered fee already pays Stripe for the Chip In: Weaver keeps all of it
    else
      -- Weaver absorbs the extra card fee the Chip In adds, so the organization nets what it would with no Chip In (§5.4).
      v_extra := app._fee_charge(v_rate.bps, v_rate.fixed_cents, v_rate.cap_cents, p_gift_cents + v_chip)
               - app._fee_charge(v_rate.bps, v_rate.fixed_cents, v_rate.cap_cents, p_gift_cents);
      v_app := greatest(v_chip - v_extra, 0);
    end if;
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('key', 'gift', 'label', 'Your gift', 'cents', p_gift_cents));
  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'covered_fee', 'cents', v_fee,
      'label', case v_class when 'ach' then 'Bank debit fee you chose to cover' else 'Card fee you chose to cover' end));
  end if;
  if v_chip > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'chip_in', 'label', 'Chip In to Weaver (optional)', 'cents', v_chip));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_ref) = 0,
    'refusals', v_ref,
    'center_id', p_center, 'household_id', p_household,
    'processor', cp.processor, 'mode', v_mode, 'currency', lower(coalesce(c.currency, 'usd')),
    'gift_cents', p_gift_cents, 'covered_fee_cents', v_fee, 'chip_in_cents', v_chip, 'application_fee_cents', v_app,
    'org_charge_cents', p_gift_cents + v_fee, 'total_cents', p_gift_cents + v_fee + v_chip,
    'pay_method', case when v_cover or v_chip > 0 then v_class else p_method end,
    'restrict_to_method', v_fee > 0,
    'fee_rate_id', case when v_cover or v_chip > 0 then v_rate.id end,
    'methods', jsonb_build_object('card', v_card, 'ach', v_ach),
    'fee_cover', jsonb_build_object(
      'offered', v_fc_ok, 'reason', v_fc_why, 'selected', v_fee > 0, 'covered_fee_cents', v_fee, 'estimate', true,
      'rate', case when v_fc_ok and v_rate.id is not null
                   then jsonb_build_object('id', v_rate.id, 'method_class', v_rate.method_class, 'bps', v_rate.bps,
                                           'fixed_cents', v_rate.fixed_cents, 'cap_cents', v_rate.cap_cents, 'source_note', v_rate.source_note) end),
    'chip_in', jsonb_build_object(
      'offered', v_ci_ok, 'reason', v_ci_why, 'selected', v_chip > 0, 'chip_in_cents', v_chip, 'application_fee_cents', v_app,
      'calendar_year', v_year, 'yearly_limit_cents', v_state->'yearly_limit_cents', 'used_cents', v_state->'used_cents',
      'left_cents', case when v_ci_ok then to_jsonb(v_left) end,
      'suggested_cents', case when v_ci_ok then v_state->'suggested_cents' else '[]'::jsonb end,
      'min_other_cents', 100, 'max_other_cents', case when v_ci_ok then to_jsonb(v_left) end),
    'lines', v_lines);
end $$;

-- What the Pay sheet asks the database before it shows a total (docs/PAYMENT_ADDONS.md §6.6). Read-only. The paying adult of the
-- family (or the treasurer paying for a family, who is offered neither extra). Returns app._addons_compute's answer:
-- {ok, refusals: [{code, sqlstate, reason, message}], gift_cents, covered_fee_cents, chip_in_cents, application_fee_cents,
--  org_charge_cents, total_cents, pay_method, restrict_to_method, fee_rate_id, methods: {card, ach}, fee_cover: {...}, chip_in: {...},
--  lines: [{key, label, cents}], processor, mode, currency}.
create or replace function app.payment_addons_quote(p_center uuid, p_household uuid, p_gift_cents bigint, p_pledge_ids uuid[], p_context text,
                                                    p_method text default null, p_cover_fee boolean default false,
                                                    p_chip_in_cents bigint default 0, p_processor text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
begin
  return app._addons_compute(p_center, p_household, p_gift_cents, p_pledge_ids, p_context, p_processor, p_method, p_cover_fee, p_chip_in_cents);
end $$;

-- create_checkout v2: 0590's checks and result, plus cover_fee, chip_in_cents, pay_method and expected_total_cents (all with
-- defaults). p_amount_cents is the GIFT. The OLD seven-argument form is dropped here, in the same migration (PostgREST cannot choose
-- between two overloads); an app that sends none of the new fields is charged exactly as before. The checkout refuses when the
-- quote's total is not p_expected_total_cents, so the member is never charged a total they did not see.
drop function if exists app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text);
create or replace function app.create_checkout(p_center uuid, p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[],
                                               p_processor text, p_context text, p_for_label text,
                                               p_cover_fee boolean default false, p_chip_in_cents bigint default 0,
                                               p_pay_method text default null, p_expected_total_cents bigint default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; v_id uuid; v_mode text; v_forced boolean;
        v_staff boolean; v_bad int; v_pledges uuid[] := coalesce(p_pledge_ids, '{}');
        q jsonb; v_ref jsonb; v_person uuid; v_year integer; v_charge bigint; v_total bigint; v_fee bigint; v_chip bigint; v_app bigint;
        v_method text;
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  v_staff := app.has_permission(p_center, 'giving.manage');
  if not (app.adult_of_household(p_center, p_household) or v_staff) then
    raise exception 'Only an adult of the family can pay for it.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents < 50 then raise exception 'The amount must be at least $0.50.' using errcode = '22023'; end if;
  if p_amount_cents > 100000000 then raise exception 'Online payments are limited to $1,000,000.' using errcode = '22023'; end if;
  if coalesce(p_context, '') not in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','pathshala') then
    raise exception 'Unknown checkout context "%".', p_context using errcode = '22023';
  end if;
  if nullif(btrim(p_for_label), '') is null then raise exception 'Say what the payment is for.' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    raise exception '% takes offline payments only.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;

  cp := app._checkout_processor(p_center, p_processor);
  if cp.center_id is null then
    raise exception 'Online payment is not set up for % yet.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  if cp.status = 'test' and not v_forced then
    raise exception 'Online payment for % is still in test mode, so it cannot take real payments yet.', coalesce(c.short_name, c.name)
      using errcode = '22023';
  end if;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if ic.id is null or ic.status <> 'connected' then
    raise exception '% is not connected right now.', initcap(cp.processor) using errcode = '22023';
  end if;
  v_mode := app.payment_api_mode(p_center, cp.processor);

  -- The extras. Two checkouts of one account in one year are serialised first (the lock is held to the end of this
  -- transaction), so the second counts the first's reservation and cannot both fit under the limit.
  v_person := app.my_person_id(p_center);
  if coalesce(p_chip_in_cents, 0) > 0 and v_person is not null and cp.processor = 'stripe' then
    v_year := app.chip_in_year(p_center);
    perform app.chip_in_lock(p_center, v_person, v_year);
  end if;
  q := app._addons_compute(p_center, p_household, p_amount_cents, v_pledges, p_context, cp.processor, p_pay_method,
                           p_cover_fee, p_chip_in_cents);
  if not (q->>'ok')::boolean then
    v_ref := q->'refusals'->0;
    raise exception '%', v_ref->>'message' using errcode = coalesce(nullif(v_ref->>'sqlstate', ''), '22023');
  end if;
  v_charge := (q->>'org_charge_cents')::bigint;
  v_total := (q->>'total_cents')::bigint;
  v_fee := (q->>'covered_fee_cents')::bigint;
  v_chip := (q->>'chip_in_cents')::bigint;
  v_app := (q->>'application_fee_cents')::bigint;
  v_method := q->>'pay_method';
  if v_charge > 100000000 then raise exception 'Online payments are limited to $1,000,000.' using errcode = '22023'; end if;
  if p_expected_total_cents is not null and p_expected_total_cents <> v_total then
    raise exception 'The total changed from % to %. Review it and try again.',
      to_char(p_expected_total_cents / 100.0, 'FM$999,999,990.00'), to_char(v_total / 100.0, 'FM$999,999,990.00') using errcode = 'CCTOT';
  end if;

  insert into app.payment_checkouts (center_id, household_id, person_id, processor, mode, context, amount_cents, currency,
                                     pledge_ids, for_label, created_by, covered_fee_cents, chip_in_cents, application_fee_cents,
                                     pay_method, fee_rate_id)
  values (p_center, p_household, v_person, cp.processor, v_mode, p_context, v_charge, lower(coalesce(c.currency, 'usd')),
          v_pledges, left(btrim(p_for_label), 200), auth.uid(), v_fee, v_chip, v_app, v_method, nullif(q->>'fee_rate_id', '')::uuid)
  returning id into v_id;
  if v_chip > 0 then
    insert into app.chip_in_ledger (center_id, household_id, account_person_id, calendar_year, checkout_id, mode, chip_in_cents,
                                    application_fee_cents, status, expires_at)
    values (p_center, p_household, v_person, v_year, v_id, v_mode, v_chip, v_app, 'reserved',
            now() + case when v_method = 'ach' then interval '14 days' else interval '26 hours' end);
  end if;
  return jsonb_build_object('checkout_id', v_id, 'processor', cp.processor, 'mode', v_mode, 'amount_cents', v_charge,
                            'currency', lower(coalesce(c.currency, 'usd')), 'account_id', ic.external_account_id,
                            'payee_email', case when ic.settings->>'connect_method' = 'email' then ic.settings->>'paypal_email' end,
                            'statement_descriptor', cp.statement_descriptor, 'methods', to_jsonb(cp.methods),
                            'center_name', c.name, 'for_label', left(btrim(p_for_label), 200),
                            'gift_cents', p_amount_cents, 'covered_fee_cents', v_fee, 'chip_in_cents', v_chip,
                            'application_fee_cents', v_app, 'total_cents', v_total, 'pay_method', v_method,
                            'restrict_to_method', v_fee > 0, 'fee_rate_id', nullif(q->>'fee_rate_id', ''),
                            'session_minutes', case when v_chip > 0 then 60 end, 'lines', q->'lines');
end $$;

-- A provider that refused the checkout releases its Chip In reservation too (0211's body plus the release).
create or replace function app.fail_checkout(p_checkout uuid, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.payment_checkouts set status = 'failed', error = left(coalesce(p_error, 'The provider refused the checkout.'), 1000)
   where id = p_checkout and created_by = auth.uid() and status in ('created','pending');
  if found then perform app._chip_in_release(p_checkout); end if;
end $$;

-- 0211's body plus what the thank-you screen shows.
create or replace function app.checkout_status(p_checkout uuid)
returns jsonb language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('checkout_id', k.id, 'status', k.status, 'processor', k.processor, 'mode', k.mode,
                            'amount_cents', k.amount_cents, 'payment_id', k.payment_id, 'error', k.error, 'paid_at', k.paid_at,
                            'receipt_number', (select receipt_number from app.payments where id = k.payment_id),
                            'gift_cents', k.gift_cents, 'covered_fee_cents', k.covered_fee_cents, 'chip_in_cents', k.chip_in_cents,
                            'total_cents', k.total_cents)
    from app.payment_checkouts k
   where k.id = p_checkout
     and (k.created_by = auth.uid() or app.has_permission(k.center_id, 'giving.view') or app.payments_can_view(k.center_id))
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. The background service
-- ═════════════════════════════════════════════════════════════════════════════
-- 0212's body plus the amounts the worker needs to compare with the provider.
create or replace function app.worker_checkout_json(k app.payment_checkouts) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare ic app.integration_connections;
begin
  select i.* into ic from app.center_payment_processors cp join app.integration_connections i on i.id = cp.connection_id
   where cp.center_id = k.center_id and cp.processor = k.processor;
  return jsonb_build_object('id', k.id, 'center_id', k.center_id, 'household_id', k.household_id, 'person_id', k.person_id,
           'processor', k.processor, 'mode', k.mode, 'context', k.context, 'amount_cents', k.amount_cents, 'currency', k.currency,
           'pledge_ids', to_jsonb(k.pledge_ids), 'status', k.status, 'provider_ref', k.provider_ref,
           'provider_payment_ref', k.provider_payment_ref, 'payment_id', k.payment_id,
           'account_id', ic.external_account_id, 'connect_method', ic.settings->>'connect_method',
           'payee_email', ic.settings->>'paypal_email',
           'gift_cents', k.gift_cents, 'covered_fee_cents', k.covered_fee_cents, 'chip_in_cents', k.chip_in_cents,
           'application_fee_cents', k.application_fee_cents, 'total_cents', k.total_cents, 'pay_method', k.pay_method,
           'fee_rate_id', k.fee_rate_id);
end $$;

-- 0212's recorder, extended. p_amount_cents is what the provider says it charged in TOTAL (Stripe's amount_received), as before;
-- it must equal the checkout's total (gift + covered fee + Chip In), and for a checkout with a Chip In p_application_fee_cents must
-- equal the application fee the checkout asked for. Anything else is not recorded and someone must look. p_fee_cents is the
-- provider's PROCESSING fee only (Stripe's stripe_fee entries), never the application fee. The payment is recorded with
-- amount = gift + covered fee, allocated on the GIFT only; the Chip In goes beside it and its ledger row is collected, in the same
-- transaction. The OLD six-argument form is dropped (the old call still works through the default of the new last argument).
drop function if exists app.worker_record_online_payment(uuid, text, bigint, bigint, text, text);
create or replace function app.worker_record_online_payment(p_checkout uuid, p_provider_ref text, p_amount_cents bigint,
                                                            p_fee_cents bigint, p_method text, p_detail text default null,
                                                            p_application_fee_cents bigint default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.payment_checkouts; c app.centers; v_payment uuid; v_existing uuid; v_method app.payment_method; v_job bigint; v_n integer;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if nullif(btrim(p_provider_ref), '') is null then raise exception 'The provider''s payment reference is missing.'; end if;
  select * into k from app.payment_checkouts where id = p_checkout for update;
  if k.id is null then raise exception 'Checkout % was not found.', p_checkout; end if;
  if p_amount_cents is distinct from k.total_cents then
    -- Never record an amount the checkout did not ask for; someone must look.
    raise exception '% reports % cents for checkout %, which asked for % cents. Not recorded.',
      initcap(k.processor), p_amount_cents, k.id, k.total_cents;
  end if;
  if k.chip_in_cents > 0 and p_application_fee_cents is distinct from k.application_fee_cents then
    raise exception '% reports an application fee of % cents for checkout %, which asked for % cents. Not recorded.',
      initcap(k.processor), p_application_fee_cents, k.id, k.application_fee_cents;
  end if;
  if k.chip_in_cents = 0 and coalesce(p_application_fee_cents, 0) <> 0 then
    raise exception '% reports an application fee of % cents for checkout %, which asked for none. Not recorded.',
      initcap(k.processor), p_application_fee_cents, k.id;
  end if;
  if k.payment_id is not null or (k.context = 'processor_test' and k.status = 'paid') then
    return jsonb_build_object('duplicate', true, 'payment_id', k.payment_id, 'checkout_id', k.id);
  end if;
  select * into c from app.centers where id = k.center_id;
  perform app.set_audit_context('Paid online · ' || initcap(k.processor) || ' ' || btrim(p_provider_ref)
                                || case when k.mode = 'test' then ' (test mode)' else '' end);

  if k.context = 'processor_test' then
    update app.payment_checkouts set status = 'paid', provider_payment_ref = btrim(p_provider_ref), paid_at = now(), error = null
     where id = k.id;
    v_job := app.enqueue_job(k.center_id, 'payments.test_charge',
                             jsonb_build_object('checkout_id', k.id, 'provider_payment_ref', btrim(p_provider_ref)), now(), 5);
    return jsonb_build_object('test', true, 'checkout_id', k.id, 'refund_job', v_job);
  end if;

  select id into v_existing from app.payments
   where center_id = k.center_id and provider = k.processor and provider_ref = btrim(p_provider_ref);
  if v_existing is not null then
    update app.payment_checkouts set status = 'paid', payment_id = v_existing, provider_payment_ref = btrim(p_provider_ref),
                                     paid_at = coalesce(paid_at, now())
     where id = k.id;
    return jsonb_build_object('duplicate', true, 'payment_id', v_existing, 'checkout_id', k.id);
  end if;

  v_method := case when p_method in ('card','ach','apple_pay','google_pay','paypal','venmo') then p_method::app.payment_method
                   else 'card'::app.payment_method end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, fee_cents, donor_covered_fee_cents, chip_in_cents,
                            application_fee_cents, charged_cents, method, status, provider, provider_ref, received_on, memo)
  values (k.center_id, k.household_id, k.person_id, k.amount_cents, greatest(coalesce(p_fee_cents, 0), 0), k.covered_fee_cents,
          k.chip_in_cents, k.application_fee_cents, case when k.processor = 'stripe' then k.total_cents end,
          v_method, 'captured',
          k.processor, btrim(p_provider_ref), (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date,
          left('Paid online · ' || k.for_label || case when k.mode = 'test' then ' · test mode' else '' end
               || coalesce(' · ' || nullif(btrim(p_detail), ''), ''), 500))
  returning id into v_payment;
  -- The existing rules: the donor's chosen pledges first, else earliest open; overpayment rolls on. Only the GIFT is placed.
  perform app.allocate_payment(v_payment, case when cardinality(k.pledge_ids) > 0 then k.pledge_ids end, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.payment_checkouts set status = 'paid', payment_id = v_payment, provider_payment_ref = btrim(p_provider_ref),
                                   paid_at = now(), error = null
   where id = k.id;
  if k.chip_in_cents > 0 then
    v_n := app._chip_in_collect(k.id, v_payment, p_application_fee_cents);
    if v_n = 0 and k.person_id is not null then
      -- No reservation was found (it cannot happen through create_checkout): the Chip In still counts, from now on.
      insert into app.chip_in_ledger (center_id, household_id, account_person_id, calendar_year, checkout_id, payment_id, mode,
                                      chip_in_cents, application_fee_cents, status, expires_at, collected_at)
      values (k.center_id, k.household_id, k.person_id, app.chip_in_year(k.center_id), k.id, v_payment, k.mode,
              k.chip_in_cents, least(coalesce(p_application_fee_cents, 0), k.chip_in_cents), 'collected', now(), now());
    end if;
  end if;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (k.center_id, k.processor, 'inbound', 'payment', 'payments', v_payment, btrim(p_provider_ref), 'ok',
          jsonb_build_object('checkout_id', k.id, 'mode', k.mode, 'amount_cents', k.amount_cents, 'fee_cents', coalesce(p_fee_cents, 0),
                             'covered_fee_cents', k.covered_fee_cents, 'chip_in_cents', k.chip_in_cents, 'total_cents', k.total_cents));
  return jsonb_build_object('duplicate', false, 'payment_id', v_payment, 'checkout_id', k.id,
                            'gift_cents', k.gift_cents, 'covered_fee_cents', k.covered_fee_cents, 'chip_in_cents', k.chip_in_cents);
end $$;

-- 0212's closer plus the release of the Chip In reservation, at once (the daily sweep, 0861, is only the safety net).
create or replace function app.worker_checkout_closed(p_checkout uuid, p_status text, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status not in ('failed','cancelled','expired') then raise exception 'Unknown checkout outcome "%".', p_status; end if;
  perform app.set_audit_context('Checkout ' || p_status || coalesce(': ' || nullif(btrim(p_error), ''), ''));
  update app.payment_checkouts set status = p_status, error = left(p_error, 1000)
   where id = p_checkout and status in ('created','pending');
  get diagnostics n = row_count;
  if n > 0 then perform app._chip_in_release(p_checkout); end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Execute rights and the demo keep list
-- ═════════════════════════════════════════════════════════════════════════════
revoke execute on function app._fee_class(text), app._fee_charge(integer, integer, integer, bigint),
  app._fee_cover(integer, integer, integer, bigint), app._fee_rate(uuid, text), app.pledge_source_is_gift(text),
  app._checkout_processor(uuid, text),
  app._addons_compute(uuid, uuid, bigint, uuid[], text, text, text, boolean, bigint),
  app.payments_addons_guard(), app.payment_allocation_gift_guard(), app.payment_fee_rates_insert_only()
  from public, anon, authenticated, service_role;
revoke execute on function app.fee_estimate(uuid, text, bigint), app.platform_set_fee_rate(uuid, text, integer, integer, integer, text, text),
  app.payment_fee_rates_for(uuid), app.payment_addons_quote(uuid, uuid, bigint, uuid[], text, text, boolean, bigint, text),
  app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text, boolean, bigint, text, bigint)
  from public, anon;
grant execute on function app.fee_estimate(uuid, text, bigint), app.platform_set_fee_rate(uuid, text, integer, integer, integer, text, text),
  app.payment_fee_rates_for(uuid), app.payment_addons_quote(uuid, uuid, bigint, uuid[], text, text, boolean, bigint, text),
  app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text, boolean, bigint, text, bigint)
  to authenticated, service_role;
revoke execute on function app.worker_record_online_payment(uuid, text, bigint, bigint, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app.worker_record_online_payment(uuid, text, bigint, bigint, text, text, bigint) to connect_worker;

-- 0861's list plus payment_fee_rates (the platform default and every organization's own rate rows survive a demo or sandbox reset).
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs',
    -- 0785: what a demo community's reset puts back
    'demo_qbo_links',
    -- 0861: the Weaver team's Chip In setting for the organization
    'chip_in_settings',
    -- 0862: the Stripe fee rates (the platform default and each organization's own)
    'payment_fee_rates'
  ]::text[]
$$;
