-- 0865 · Payment proofs, step 2 of 4: tables, status logic, storage, module (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §3, §4.5).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A member who paid another way (cash, check, bank transfer, stock...) sends a photo or file ("a proof"). The pledges it covers,
--   oldest first, show SOFT CREDIT until the treasury team verifies it. Nothing is booked: no payment, allocation, receipt, QuickBooks
--   posting or giving total exists for a soft credit. On approval (0866) a payment is recorded with the proof as evidence.
--
--   app.payment_proofs / payment_proof_files / soft_credits / payment_proof_events   the new tables (no direct writes: RPCs only, 0866)
--   pledges.soft_credit_cents, pledges.reconciled_at(+_kind)   soft credit on a pledge, and "Bank reconciled" (status stays 'paid')
--   payments.reconciled_at   when the payment was matched to the bank (deposit, line, payout) or is history
--   app.recompute_pledge_status   (replaced) the ONE writer of status, paid/soft cents, closed_at and reconciled_at
--   app.proof_policy(center)   centers.rules.payments.proofs merged over its defaults
--   module giving_proofs ("Payment proofs"), OFF by default; bucket payment-evidence (private)
--
-- OPEN BALANCE (owner rule 2026-10-15): amount - paid - soft credit, so a soft-credited or reconciled pledge adds nothing to it.
-- ROLLBACK: drop the four tables, the columns, the module rows and the bucket rows; put recompute_pledge_status back to 0104's body.
set client_min_messages = warning;

-- ── 1. The module (off by default) ───────────────────────────────────────────────────────────────────────────────────────────
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('giving_proofs', 'Payment proofs',
   'Members send a photo or file when they paid another way. The pledges it covers show Soft credit until the treasury team verifies it.',
   false, '{giving}', 4)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;
insert into app.category_modules (category_key, module_key, availability)
  select category_key, 'giving_proofs', 'default_off' from app.category_modules where module_key = 'giving'
on conflict (category_key, module_key) do update set availability = 'default_off';

-- ── 2. Columns ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table app.pledges
  add column if not exists soft_credit_cents bigint not null default 0 check (soft_credit_cents >= 0),
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_kind text check (reconciled_kind in ('bank', 'historical'));
-- New writes only: a pledge with soft credit can never be over-covered. (Old rows are not re-checked.)
alter table app.pledges add constraint pledges_cover_check
  check (soft_credit_cents = 0 or paid_cents + soft_credit_cents <= amount_cents) not valid;
alter table app.payments add column if not exists reconciled_at timestamptz;

-- ── 3. Tables ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app.payment_proofs (
  id                    uuid primary key default gen_random_uuid(),
  center_id             uuid not null references app.centers(id) on delete cascade,
  household_id          uuid not null references app.households(id),
  submitted_by          uuid references auth.users(id),
  submitted_by_person   uuid references app.people(id),
  entry                 text not null default 'open_pledges'
                        check (entry in ('open_pledges','rsvp','store','opportunity','labh','pathshala_fee','membership','other')),
  entry_ref             uuid,
  method                app.payment_method not null check (method in ('cash','check','ach','zelle','stock','daf','matching_gift','other')),
  amount_cents          bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  paid_on               date not null,
  reference             text check (reference is null or char_length(reference) <= 80),
  note                  text check (note is null or char_length(note) <= 500),
  status                text not null default 'submitted'
                        check (status in ('submitted','needs_info','approved','rejected','withdrawn','merged')),
  idempotency_key       text check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  is_test               boolean not null default false,
  excess_cents          bigint not null default 0 check (excess_cents >= 0),
  question              text,
  question_at           timestamptz,
  answered_at           timestamptz,
  first_approved_by     uuid references auth.users(id),
  first_approved_at     timestamptz,
  decided_by            uuid references auth.users(id),
  decided_at            timestamptz,
  decision_reason       text,
  approved_amount_cents bigint,
  payment_id            uuid references app.payments(id),
  bank_transaction_id   uuid references app.bank_transactions(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists payment_proofs_key_uniq on app.payment_proofs (center_id, idempotency_key) where idempotency_key is not null;
create index if not exists payment_proofs_queue on app.payment_proofs (center_id, status, created_at);
create index if not exists payment_proofs_household on app.payment_proofs (household_id, created_at desc);
create index if not exists payment_proofs_payment on app.payment_proofs (payment_id) where payment_id is not null;

create table if not exists app.payment_proof_files (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  proof_id       uuid references app.payment_proofs(id) on delete cascade,
  payment_id     uuid references app.payments(id) on delete set null,
  household_id   uuid references app.households(id),
  storage_path   text not null unique,
  content_type   text not null check (content_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')),
  bytes          bigint not null check (bytes > 0 and bytes <= 10485760),
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  member_visible boolean not null default true,
  uploaded_by    uuid references auth.users(id),
  deleted_at     timestamptz,
  deleted_reason text,
  created_at     timestamptz not null default now(),
  check (proof_id is not null or payment_id is not null)
);
create index if not exists payment_proof_files_proof on app.payment_proof_files (proof_id);
create index if not exists payment_proof_files_payment on app.payment_proof_files (payment_id) where payment_id is not null;
create index if not exists payment_proof_files_sha on app.payment_proof_files (center_id, sha256) where sha256 is not null;

create table if not exists app.soft_credits (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  proof_id     uuid not null references app.payment_proofs(id) on delete cascade,
  pledge_id    uuid not null references app.pledges(id),
  amount_cents bigint not null check (amount_cents > 0),
  position     int not null default 0,
  state        text not null default 'active' check (state in ('active','converted','released')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proof_id, pledge_id)
);
create index if not exists soft_credits_pledge on app.soft_credits (pledge_id) where state = 'active';

create table if not exists app.payment_proof_events (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  proof_id   uuid not null references app.payment_proofs(id) on delete cascade,
  kind       text not null,
  body       text not null,
  actor      uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists payment_proof_events_proof on app.payment_proof_events (proof_id, created_at);

create trigger touch_payment_proofs before update on app.payment_proofs for each row execute function app.touch_updated_at();
create trigger touch_soft_credits before update on app.soft_credits for each row execute function app.touch_updated_at();

-- ── 4. Policy defaults ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.proof_policy(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'required_methods', '["check","ach","stock","daf","matching_gift","other"]'::jsonb,
           'retention_years', 7,
           'legal_hold', false,
           'second_approver_over_cents', 0,
           'reply_wait_days', 14,
           'honour_event_entry', true,
           'release_store_orders', false)
         || coalesce((select c.rules -> 'payments' -> 'proofs' from app.centers c where c.id = p_center), '{}'::jsonb)
$$;
revoke all on function app.proof_policy(uuid) from public, anon;
grant execute on function app.proof_policy(uuid) to authenticated, service_role;

-- ── 5. Status: ONE writer ───────────────────────────────────────────────────────────────────────────────────────────────────
-- soft_credit = fully covered by paid + active soft credit, with some soft credit still unverified. A pledge only partly covered stays
-- open / partially_paid (soft_credit_cents shows the rest), so its remainder is still payable. Reconciled = fully paid and every
-- payment allocated to it is reconciled (kind 'historical' when it is all history).
create or replace function app.recompute_pledge_status(p_pledge uuid)
 returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_paid bigint; v_soft bigint; v_amount bigint; v_status app.pledge_status; v_all_rec boolean; v_all_hist boolean; v_n int;
begin
  if pg_trigger_depth() = 0 then
    perform app.assert_module_enabled((select center_id from app.pledges where id = p_pledge), 'giving');
  end if;
  select coalesce(sum(amount_cents),0) into v_paid from app.payment_allocations where pledge_id = p_pledge;
  select coalesce(sum(amount_cents),0) into v_soft from app.soft_credits where pledge_id = p_pledge and state = 'active';
  select amount_cents, status into v_amount, v_status from app.pledges where id = p_pledge;
  if v_status in ('written_off','cancelled') then return; end if;
  select count(*), bool_and(p.reconciled_at is not null), bool_and(coalesce(p.is_historical, false))
    into v_n, v_all_rec, v_all_hist
    from app.payment_allocations a join app.payments p on p.id = a.payment_id
   where a.pledge_id = p_pledge and p.status not in ('failed','voided');
  update app.pledges set paid_cents = v_paid, soft_credit_cents = v_soft,
    status = (case when v_paid >= v_amount then 'paid'
                   when v_soft > 0 and v_paid + v_soft >= v_amount then 'soft_credit'
                   when v_paid > 0 then 'partially_paid' else 'open' end)::app.pledge_status,
    closed_at = case when v_paid >= v_amount then coalesce(closed_at, now()) else null end,
    reconciled_at = case when v_paid >= v_amount and coalesce(v_n, 0) > 0 and coalesce(v_all_rec, false) then coalesce(reconciled_at, now()) end,
    reconciled_kind = case when v_paid >= v_amount and coalesce(v_n, 0) > 0 and coalesce(v_all_rec, false)
                           then case when coalesce(v_all_hist, false) then 'historical' else 'bank' end end
  where id = p_pledge;
end $$;

create or replace function app._soft_credit_changed() returns trigger language plpgsql security definer
set search_path = app, public, extensions as $$
begin
  perform app.recompute_pledge_status(coalesce(new.pledge_id, old.pledge_id));
  return null;
end $$;
create trigger soft_credits_recompute after insert or update or delete on app.soft_credits
  for each row execute function app._soft_credit_changed();

-- payments.reconciled_at: set when the payment is matched to a bank line / deposit / payout, or is history; cleared on un-matching.
create or replace function app._payment_reconciled_stamp() returns trigger language plpgsql
set search_path = app, public, extensions as $$
begin
  new.reconciled_at := case
    when new.deposit_bank_transaction_id is not null or coalesce(new.is_historical, false)
         or (coalesce(new.provider, '') not in ('offline', 'bank') and new.status = 'settled')
      then coalesce(case when tg_op = 'UPDATE' then old.reconciled_at end, now())
    else null end;
  return new;
end $$;
create trigger payments_reconciled_stamp before insert or update of deposit_bank_transaction_id, status on app.payments
  for each row execute function app._payment_reconciled_stamp();

create or replace function app._payment_reconciled_changed() returns trigger language plpgsql security definer
set search_path = app, public, extensions as $$
declare r record;
begin
  if tg_op = 'INSERT' or new.reconciled_at is distinct from old.reconciled_at then
    for r in select distinct pledge_id from app.payment_allocations where payment_id = new.id loop
      perform app.recompute_pledge_status(r.pledge_id);
    end loop;
  end if;
  return null;
end $$;
create trigger payments_reconciled_changed after insert or update of reconciled_at, deposit_bank_transaction_id, status on app.payments
  for each row execute function app._payment_reconciled_changed();

-- Backfill: history and anything already matched to the bank count as reconciled; then the pledges they close.
update app.payments set reconciled_at = coalesce(reconciled_at, created_at)
 where reconciled_at is null and (coalesce(is_historical, false) or deposit_bank_transaction_id is not null
       or (coalesce(provider, '') not in ('offline', 'bank') and status = 'settled'));
update app.pledges pl set reconciled_at = coalesce(pl.reconciled_at, pl.closed_at, now()),
       reconciled_kind = case when x.all_hist then 'historical' else 'bank' end
  from (select a.pledge_id, bool_and(p.reconciled_at is not null) as all_rec, bool_and(coalesce(p.is_historical, false)) as all_hist
          from app.payment_allocations a join app.payments p on p.id = a.payment_id
         where p.status not in ('failed','voided') group by a.pledge_id) x
 where x.pledge_id = pl.id and x.all_rec and pl.status = 'paid' and pl.reconciled_at is null;

-- ── 6. Access: RPCs only; reads by the family's adults and by the treasury team ─────────────────────────────────────────────
insert into app.module_tables (table_name, module_key) values
  ('payment_proofs','giving_proofs'),('payment_proof_files','giving_proofs'),('soft_credits','giving_proofs'),('payment_proof_events','giving_proofs')
on conflict (table_name) do update set module_key = excluded.module_key;

create trigger audit_payment_proofs after insert or update or delete on app.payment_proofs for each row execute function app.audit_row();
create trigger audit_soft_credits after insert or update or delete on app.soft_credits for each row execute function app.audit_row();
create trigger audit_payment_proof_events after insert or update or delete on app.payment_proof_events for each row execute function app.audit_row();
create trigger audit_payment_proof_files after insert or update or delete on app.payment_proof_files for each row execute function app.audit_row();

alter table app.payment_proofs enable row level security;
alter table app.payment_proof_files enable row level security;
alter table app.soft_credits enable row level security;
alter table app.payment_proof_events enable row level security;

create policy payment_proofs_read on app.payment_proofs for select to authenticated
  using (app.has_permission(center_id,'giving.view') or app.has_permission(center_id,'giving.record_offline')
         or app.has_permission(center_id,'giving.manage') or app.adult_of_household(center_id, household_id));
create policy payment_proof_files_read on app.payment_proof_files for select to authenticated
  using (app.has_permission(center_id,'giving.view') or app.has_permission(center_id,'giving.record_offline')
         or app.has_permission(center_id,'giving.manage')
         or (member_visible and household_id is not null and app.adult_of_household(center_id, household_id)));
create policy soft_credits_read on app.soft_credits for select to authenticated
  using (app.has_permission(center_id,'giving.view') or app.has_permission(center_id,'giving.record_offline')
         or app.has_permission(center_id,'giving.manage')
         or exists (select 1 from app.payment_proofs pp where pp.id = proof_id and app.adult_of_household(pp.center_id, pp.household_id)));
create policy payment_proof_events_read on app.payment_proof_events for select to authenticated
  using (app.has_permission(center_id,'giving.view') or app.has_permission(center_id,'giving.record_offline')
         or app.has_permission(center_id,'giving.manage')
         or exists (select 1 from app.payment_proofs pp where pp.id = proof_id and app.adult_of_household(pp.center_id, pp.household_id)));

do $$ declare t text; v_qual text := '(select app.is_platform_admin()) or not (center_id = any ((select app.module_off_centers(''giving_proofs''))::uuid[]))';
begin
  foreach t in array array['payment_proofs','payment_proof_files','soft_credits','payment_proof_events'] loop
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;

revoke all on app.payment_proofs, app.payment_proof_files, app.soft_credits, app.payment_proof_events from public, anon, authenticated;
grant select on app.payment_proofs, app.payment_proof_files, app.soft_credits, app.payment_proof_events to authenticated;
grant all on app.payment_proofs, app.payment_proof_files, app.soft_credits, app.payment_proof_events to service_role;

-- ── 7. The private bucket: <center>/<household>/<proof>/<uuid>.<ext> (the family) and <center>/staff/<payment>/<uuid>.<ext> (staff) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-evidence', 'payment-evidence', false, 10485760,
   array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.storage_bucket_module(p_bucket text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_bucket when 'content' then 'content' when 'photos' then 'content' when 'store' then 'store'
                       when 'statements' then 'giving_statements' when 'recordings' then 'gyan_path' when 'homework' then 'gyan_path'
                       when 'payment-evidence' then 'giving_proofs' end
$$;
create or replace function app.connect_storage_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports','payment-evidence']
$$;

do $$
declare v_list text := $l$array['branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework','payment-evidence']$l$;
begin
  execute 'drop policy if exists connect_objects_read on storage.objects';
  execute 'drop policy if exists connect_objects_insert on storage.objects';
  execute 'drop policy if exists connect_objects_update on storage.objects';
  execute 'drop policy if exists connect_objects_delete on storage.objects';
  execute format('create policy connect_objects_read on storage.objects for select to anon, authenticated using (bucket_id = any (%s) and app.can_read_object(bucket_id, name))', v_list);
  execute format('create policy connect_objects_insert on storage.objects for insert to authenticated with check (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list);
  execute format('create policy connect_objects_update on storage.objects for update to authenticated using (bucket_id = any (%s) and app.can_write_object(bucket_id, name)) with check (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list, v_list);
  execute format('create policy connect_objects_delete on storage.objects for delete to authenticated using (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list);
end $$;
