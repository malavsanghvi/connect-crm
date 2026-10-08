-- Payments plan PR 5 (docs/PAYMENTS_PLAN.md §2.5 and §2.6; owner decisions 2026-10-02: Q6, and the approval
-- "approve the Zelle and payee money changes when ready"): change control, Community Connect's pause, and
-- what "ready to go live" means for every way to pay.
--
--   app.payee_changes                  a request to change where gifts go (the Zelle address or name, the bank
--                                      account Zelle lines arrive in, the PayPal email). It takes effect only when
--                                      a SECOND, DIFFERENT person with giving.approve confirms it; each of the two
--                                      gives a reason and passes a fresh 2FA check (the shape of
--                                      approve_flagged_refund, 0410)
--   app.request_payee_change           ask for a Zelle change (the PayPal email is asked for when it is verified)
--   app.decide_payee_change            the second person confirms (it takes effect) or turns it down
--   app.cancel_payee_change            withdraw a request
--   app.payee_change_queue             what Settings › Payments shows
--   app.payee_guard_*                  BEFORE UPDATE guards on the three places a payee lives: no route, whoever
--                                      calls it and a platform admin included, changes a payee that is already set
--                                      except through a confirmed request
--   app.payee_notice                   the dated notice members see for 30 days after a confirmed change
--   app.payment_plugin_suspensions     Community Connect's pause of a way to pay, for every organization or one
--   app.suspend_payment_plugin / app.lift_payment_plugin_suspension / app.payment_plugin_pauses
--                                      platform admins only; they never read a credential
--   app.payment_readiness              what "ready to go live" means for each enabled way to pay (§2.6);
--                                      readiness check 6 now walks it
--   app.approve_zelle_instructions     the treasurer's go-live approval of the Zelle instructions, with an
--                                      evidence hash (golive_approvals key zelle_instructions)
--   app.confirm_wallet_in_stripe       the owner records that Apple Pay or Google Pay is on in the Stripe account
--                                      (the fallback until a later release can read it from Stripe)
--
-- Also: a Zelle report that is matched in a sandbox (a rehearsal) now refreshes center_payment_plugins
-- (the follow-up of 0582, BACKLOG B28), and a pause refreshes every organization's plugin rows.
--
-- What does NOT change: recording, allocation, receipts, refunds, QuickBooks posting and how Stripe or PayPal
-- are called. A pause only refuses to START a payment (a new checkout, a new Zelle report); money that already
-- arrived is recorded and matched as before. A center that never changes a payee, never pauses a plugin and
-- is not going live sees the same behaviour as before: first-time settings are saved exactly as they were.
set client_min_messages = warning;

-- ── Columns the readiness needs ──────────────────────────────────────────────
alter table app.center_payment_plugins
  add column if not exists wallet_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists wallet_confirmed_at timestamptz;
comment on column app.center_payment_plugins.wallet_confirmed_at is
  'Apple Pay and Google Pay only: when the owner said the wallet is turned on in the organization''s Stripe account (readiness fallback until the account can be read, plan PR 6).';

-- ── Community Connect's pause ────────────────────────────────────────────────
-- target_center is deliberately not called center_id: a sandbox reset clears every table that has a center_id
-- column, and an organization must not be able to lift Community Connect's pause by resetting its sandbox.
create table if not exists app.payment_plugin_suspensions (
  id              uuid primary key default gen_random_uuid(),
  plugin_key      text not null references app.payment_plugins(key),
  target_center   uuid references app.centers(id) on delete cascade,
  reason          text not null check (char_length(reason) between 1 and 500),
  suspended_by    uuid not null references auth.users(id),
  suspended_at    timestamptz not null default now(),
  previous_status text check (previous_status is null or previous_status in ('available','beta')),
  lifted_by       uuid references auth.users(id),
  lifted_at       timestamptz,
  lift_reason     text check (lift_reason is null or char_length(lift_reason) between 1 and 500),
  constraint payment_plugin_suspensions_lifted check ((lifted_at is null) = (lifted_by is null))
);
comment on table app.payment_plugin_suspensions is
  'Community Connect''s pause of a payment plugin (docs/PAYMENTS_PLAN.md §2.5): target_center null = every organization (the catalog status is then ''suspended''), else that organization only. A row is active until lifted_at is set; history is kept. Platform admins only.';
create unique index if not exists payment_plugin_suspensions_one_active
  on app.payment_plugin_suspensions (plugin_key, coalesce(target_center, '00000000-0000-0000-0000-000000000000'::uuid))
  where lifted_at is null;

insert into app.module_tables (table_name, module_key) values ('payment_plugin_suspensions', null)
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_payment_plugin_suspensions on app.payment_plugin_suspensions;
create trigger audit_payment_plugin_suspensions after insert or update or delete on app.payment_plugin_suspensions
  for each row execute function app.audit_row();

alter table app.payment_plugin_suspensions enable row level security;
drop policy if exists payment_plugin_suspensions_read on app.payment_plugin_suspensions;
create policy payment_plugin_suspensions_read on app.payment_plugin_suspensions for select to authenticated
  using (app.is_platform_admin());
revoke all on app.payment_plugin_suspensions from public, anon, authenticated, connect_worker;
grant select on app.payment_plugin_suspensions to authenticated;
grant all on app.payment_plugin_suspensions to service_role;

-- ── Requests to change a payee ───────────────────────────────────────────────
-- changes: {"recipient": {"from": "old", "to": "new"}, ...}. Fields: Zelle recipient, Zelle name,
-- bank_account_id (the account Zelle lines arrive in; from/to are ids, null = any account), paypal_email.
-- A row is never edited after it is written except by the functions below (status, decision), so the
-- person who confirms exactly what they were shown.
create table if not exists app.payee_changes (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  plugin_key      text not null references app.payment_plugins(key),
  changes         jsonb not null,
  detail          jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                  check (status in ('pending','applied','rejected','cancelled','superseded','expired')),
  requested_by    uuid not null references auth.users(id),
  requested_at    timestamptz not null default now(),
  request_reason  text not null check (char_length(request_reason) between 1 and 500),
  expires_at      timestamptz not null,
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 500),
  applied_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint payee_changes_plugin check (plugin_key in ('zelle','paypal')),
  constraint payee_changes_shape check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb and jsonb_typeof(detail) = 'object'),
  constraint payee_changes_two_people check (status <> 'applied' or (decided_by is not null and decided_by <> requested_by and applied_at is not null)),
  constraint payee_changes_decided check ((status in ('applied','rejected')) = (decided_by is not null))
);
comment on table app.payee_changes is
  'Requests to change where gifts go (docs/PAYMENTS_PLAN.md §2.5, decision Q6). A change takes effect only when a different person with giving.approve confirms it with a fresh 2FA check and a reason; nothing here is written directly.';
create index if not exists payee_changes_center_created on app.payee_changes (center_id, created_at desc);

insert into app.module_tables (table_name, module_key) values ('payee_changes', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_payee_changes on app.payee_changes;
create trigger audit_payee_changes after insert or update or delete on app.payee_changes
  for each row execute function app.audit_row();

-- ── Who may ──────────────────────────────────────────────────────────────────
-- The vault's rule (0170), not has_permission: the owner, or an active role grant with the permission. A
-- platform admin's blanket permissions do NOT count: Community Connect never changes, or confirms a change
-- of, where an organization's gifts go (its only power over payments is the pause).
create or replace function app.payee_has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.is_center_owner(p_center)
    or exists (
      select 1 from app.role_grants g join app.roles r on r.key = g.role_key
       where g.center_id = p_center and g.user_id = auth.uid()
         and g.scope_kind in ('center','platform')
         and g.status = 'active'
         and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
         and (r.permissions ? p_perm or r.permissions ? '*')))
$$;

-- The first person (plan §2.5): the owner, integrations.manage or giving.manage.
create or replace function app.payee_can_request(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.payee_has_permission(p_center, 'integrations.manage') or app.payee_has_permission(p_center, 'giving.manage')
$$;

-- The second person: giving.approve (the owner passes, as everywhere; never the person who asked).
create or replace function app.payee_can_approve(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.payee_has_permission(p_center, 'giving.approve')
$$;

create or replace function app.payee_field_label(p_field text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_field
    when 'recipient' then 'the Zelle address'
    when 'name' then 'the name shown in Zelle'
    when 'bank_account_id' then 'the bank account Zelle payments arrive in'
    when 'paypal_email' then 'the PayPal email'
    else p_field end
$$;

-- Is this plugin paused for this organization: by Community Connect for everyone (the catalog status), or for it alone.
create or replace function app.payment_plugin_is_paused(p_center uuid, p_key text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select pl.status = 'suspended' from app.payment_plugins pl where pl.key = p_key), false)
      or exists (select 1 from app.payment_plugin_suspensions s
                  where s.plugin_key = p_key and s.lifted_at is null and s.target_center = p_center)
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table app.payee_changes enable row level security;
drop policy if exists payee_changes_read on app.payee_changes;
create policy payee_changes_read on app.payee_changes for select to authenticated
  using (app.payments_can_view(center_id) or app.payee_can_approve(center_id));
drop policy if exists module_switch on app.payee_changes;
create policy module_switch on app.payee_changes as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));
revoke all on app.payee_changes from public, anon, authenticated, connect_worker;
grant select on app.payee_changes to authenticated;
grant all on app.payee_changes to service_role;

-- ── The guards: where a payee lives ──────────────────────────────────────────
-- Zelle address and name: center_payment_methods.instructions. Linked bank account:
-- centers.rules.payments.zelle.bank_account_id. PayPal email: integration_connections.settings.paypal_email.
-- A payee that is already set (not empty) can only be changed while app.decide_payee_change applies a
-- confirmed request (it sets app.payee_apply for that statement). Setting a payee for the first time is
-- unchanged. Sessions without a signed-in person (the service role, the background service, migrations,
-- seeds) are not asked, exactly as app.assert_step_up never asks them. Clearing a payee counts as a change,
-- so "clear it, then set another" is not a way round.
create or replace function app.payee_guard_methods() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_what text;
begin
  if auth.uid() is null or coalesce(current_setting('app.payee_apply', true), '') = 'on' then return new; end if;
  if lower(btrim(coalesce(old.instructions->>'recipient', ''))) <> ''
     and lower(btrim(coalesce(new.instructions->>'recipient', ''))) <> lower(btrim(coalesce(old.instructions->>'recipient', ''))) then
    v_what := 'the Zelle address';
  elsif lower(btrim(coalesce(old.instructions->>'name', ''))) <> ''
     and lower(btrim(coalesce(new.instructions->>'name', ''))) <> lower(btrim(coalesce(old.instructions->>'name', ''))) then
    v_what := 'the name shown in Zelle';
  end if;
  if v_what is not null then
    raise exception 'Changing % needs a second person. Ask for the change in Settings › Payments (Zelle › Request a change); a different person with giving.approve then confirms it.', v_what
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payee_guard on app.center_payment_methods;
create trigger payee_guard before update on app.center_payment_methods
  for each row when (new.method = 'zelle' and old.instructions is distinct from new.instructions)
  execute function app.payee_guard_methods();

create or replace function app.payee_guard_centers() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.payee_apply', true), '') = 'on' then return new; end if;
  if (old.rules #>> '{payments,zelle,bank_account_id}') is not null
     and (old.rules #>> '{payments,zelle,bank_account_id}') is distinct from (new.rules #>> '{payments,zelle,bank_account_id}') then
    raise exception 'Changing the bank account Zelle payments arrive in needs a second person. Ask for the change in Giving › Payments › Bank › Zelle reports; a different person with giving.approve then confirms it.'
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payee_guard on app.centers;
create trigger payee_guard before update of rules on app.centers
  for each row when (old.rules is distinct from new.rules)
  execute function app.payee_guard_centers();

create or replace function app.payee_guard_connections() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.payee_apply', true), '') = 'on' then return new; end if;
  if lower(btrim(coalesce(old.settings->>'paypal_email', ''))) <> ''
     and lower(btrim(coalesce(new.settings->>'paypal_email', ''))) <> lower(btrim(coalesce(old.settings->>'paypal_email', ''))) then
    raise exception 'Changing the PayPal email needs a second person. Verify the new email in Settings › Payments › PayPal; a different person with giving.approve then confirms the change.'
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payee_guard on app.integration_connections;
create trigger payee_guard before update on app.integration_connections
  for each row when (new.provider = 'paypal' and old.settings is distinct from new.settings)
  execute function app.payee_guard_connections();

-- ── One request ──────────────────────────────────────────────────────────────
-- Internal (every caller has checked who may, asked for a fresh 2FA check and a reason). A newer request
-- replaces a waiting one that touches the same fields; a lapsed one is marked lapsed.
create or replace function app._create_payee_change(p_center uuid, p_plugin text, p_changes jsonb, p_detail jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  perform app.set_audit_context(p_reason);
  update app.payee_changes pc
     set status = case when pc.expires_at <= now() then 'expired' else 'superseded' end
   where pc.center_id = p_center and pc.plugin_key = p_plugin and pc.status = 'pending'
     and exists (select 1 from jsonb_object_keys(pc.changes) k where p_changes ? k);
  insert into app.payee_changes (center_id, plugin_key, changes, detail, requested_by, request_reason, expires_at)
  values (p_center, p_plugin, p_changes, coalesce(p_detail, '{}'::jsonb), auth.uid(), left(btrim(p_reason), 500), now() + interval '14 days')
  returning id into v_id;
  return v_id;
end $$;

-- Ask to change the Zelle address, the name shown in Zelle or the bank account. p_changes holds the NEW values:
-- {"recipient": "new@example.org", "name": "New Name", "bank_account_id": "<uuid>" or null}. Only a value that
-- is already set needs this; a value that is not set yet is saved in the form as before.
create or replace function app.request_payee_change(p_center uuid, p_plugin text, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; pm app.center_payment_methods; v_old jsonb; v_new jsonb := '{}'::jsonb; v_proposed jsonb;
        k text; x jsonb; v_old_text text; v_new_text text; v_account uuid; v_old_account text; v_id uuid; v_problem text;
        v_expires timestamptz;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payee_can_request(p_center) then
    raise exception 'Asking to change where gifts go needs the organization owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_plugin is distinct from 'zelle' then
    raise exception 'Only the Zelle address, its name and its bank account are changed this way. The PayPal email is changed when the new one is verified (Settings › Payments › PayPal).' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Say what to change: the Zelle address, the name shown in Zelle or the bank account.' using errcode = '22023';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  select * into pm from app.center_payment_methods where center_id = p_center and method = 'zelle';
  v_old := coalesce(pm.instructions, '{}'::jsonb);
  v_proposed := v_old;
  for k, x in select * from jsonb_each(p_changes) loop
    if k not in ('recipient','name','bank_account_id') then
      raise exception '"%" is not something that needs a second approver.', k using errcode = '22023';
    end if;
    if k in ('recipient','name') then
      if jsonb_typeof(x) <> 'string' or nullif(btrim(x #>> '{}'), '') is null then
        raise exception 'Enter the new %.', case k when 'recipient' then 'Zelle email or phone' else 'name shown in Zelle' end using errcode = '22023';
      end if;
      v_old_text := nullif(btrim(coalesce(v_old->>k, '')), '');
      v_new_text := btrim(x #>> '{}');
      if v_old_text is null then
        raise exception 'Nothing to change: % is not saved yet. Save it in the form; a second approver is needed only to change one that is already set.', app.payee_field_label(k)
          using errcode = '22023';
      end if;
      if lower(v_new_text) = lower(v_old_text) then
        raise exception 'That is the same as the current value of %.', app.payee_field_label(k) using errcode = '22023';
      end if;
      v_new := v_new || jsonb_build_object(k, jsonb_build_object('from', v_old_text, 'to', v_new_text));
      v_proposed := v_proposed || jsonb_build_object(k, v_new_text);
    else
      v_old_account := c.rules #>> '{payments,zelle,bank_account_id}';
      if v_old_account is null then
        raise exception 'No bank account is chosen for Zelle yet, so there is nothing to change. Choose it in Giving › Payments › Bank › Zelle reports.' using errcode = '22023';
      end if;
      if jsonb_typeof(x) = 'null' then
        v_account := null;
      elsif jsonb_typeof(x) = 'string' and (x #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_account := (x #>> '{}')::uuid;
      else
        raise exception 'Choose one of the bank accounts, or any account.' using errcode = '22023';
      end if;
      if v_account is not null and not exists (select 1 from app.bank_accounts b where b.id = v_account and b.center_id = p_center and b.active) then
        raise exception 'Choose one of this organization''s active bank accounts, or none.' using errcode = '22023';
      end if;
      if v_account::text is not distinct from v_old_account then
        raise exception 'That is already the bank account chosen for Zelle.' using errcode = '22023';
      end if;
      v_new := v_new || jsonb_build_object(k, jsonb_build_object('from', v_old_account, 'to', v_account));
    end if;
  end loop;
  -- What would be saved must be valid, so the person who confirms is never asked to confirm something broken.
  v_problem := app.payment_method_instructions_problem('zelle', v_proposed);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  perform app.assert_step_up('payments.payee');
  perform app.payments_require_reason(p_reason, 'ask to change where Zelle gifts go');
  v_id := app._create_payee_change(p_center, 'zelle', v_new, '{}'::jsonb, p_reason);
  select expires_at into v_expires from app.payee_changes where id = v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'expires_at', v_expires,
    'message', 'Waiting for a second person. A different person with giving.approve confirms it; until then members keep seeing the current details.');
end $$;

-- The second person confirms (the change takes effect) or turns it down. Never the person who asked.
create or replace function app.decide_payee_change(p_request uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payee_changes; pm app.center_payment_methods; c app.centers; k text; x jsonb; v_cur text; v_instr jsonb;
        v_email text; v_verified timestamptz; v_conn uuid;
begin
  select * into r from app.payee_changes where id = p_request for update;
  if r.id is null then raise exception 'That request was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not app.payee_can_approve(r.center_id) then
    raise exception 'Confirming a change to where gifts go needs giving.approve, and a different person from the one who asked.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request is already %.',
      case r.status when 'applied' then 'confirmed' when 'rejected' then 'turned down' when 'cancelled' then 'withdrawn'
                    when 'superseded' then 'replaced by a newer request' else 'out of date' end
      using errcode = '22023';
  end if;
  if r.requested_by = auth.uid() then
    raise exception 'The second approver must be a different person from the first (%).', app.refund_person_name(r.center_id, r.requested_by)
      using errcode = '22023';
  end if;
  if r.expires_at <= now() then
    raise exception 'This request lapsed on %. Ask for the change again.', to_char(r.expires_at, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.payee');
  perform app.payments_require_reason(p_reason, case when p_approve then 'confirm this change' else 'turn this change down' end);

  if not p_approve then
    update app.payee_changes
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = left(btrim(p_reason), 500)
     where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'rejected');
  end if;

  select * into c from app.centers where id = r.center_id;
  update app.payee_changes
     set status = 'applied', decided_by = auth.uid(), decided_at = now(), decision_reason = left(btrim(p_reason), 500), applied_at = now()
   where id = r.id;
  perform app.set_audit_context('Payee change confirmed by a second person: ' || left(btrim(p_reason), 450));

  if r.plugin_key = 'zelle' then
    select * into pm from app.center_payment_methods where center_id = r.center_id and method = 'zelle';
    v_instr := coalesce(pm.instructions, '{}'::jsonb);
    for k, x in select * from jsonb_each(r.changes) loop
      if k in ('recipient','name') then
        v_cur := nullif(btrim(coalesce(v_instr->>k, '')), '');
        if v_cur is distinct from (x->>'from') then
          raise exception 'The current value of % changed after this request was made. Ask for the change again.', app.payee_field_label(k) using errcode = '22023';
        end if;
        v_instr := v_instr || jsonb_build_object(k, x->>'to');
      elsif (c.rules #>> '{payments,zelle,bank_account_id}') is distinct from (x->>'from') then
        raise exception 'The bank account chosen for Zelle changed after this request was made. Ask for the change again.' using errcode = '22023';
      end if;
    end loop;
    perform set_config('app.payee_apply', 'on', true);
    if r.changes ? 'recipient' or r.changes ? 'name' then
      update app.center_payment_methods set instructions = v_instr, updated_by = auth.uid()
       where center_id = r.center_id and method = 'zelle';
    end if;
    if r.changes ? 'bank_account_id' then
      update app.centers
         set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
                               (case when jsonb_typeof(rules->'payments') = 'object' then rules->'payments' else '{}'::jsonb end)
                               || jsonb_build_object('zelle',
                                    (case when jsonb_typeof(rules #> '{payments,zelle}') = 'object' then rules #> '{payments,zelle}' else '{}'::jsonb end)
                                    || jsonb_build_object('bank_account_id', r.changes #> '{bank_account_id,to}')))
       where id = r.center_id;
    end if;
    perform set_config('app.payee_apply', 'off', true);
  elsif r.plugin_key = 'paypal' then
    v_conn := nullif(r.detail->>'connection_id', '')::uuid;
    v_email := r.changes #>> '{paypal_email,to}';
    v_verified := nullif(r.detail->>'verified_at', '')::timestamptz;
    select lower(btrim(coalesce(ic.settings->>'paypal_email', ''))) into v_cur from app.integration_connections ic where ic.id = v_conn;
    if not found then
      raise exception 'The PayPal connection no longer exists. Verify the email again.' using errcode = '22023';
    end if;
    if v_cur is distinct from lower(btrim(coalesce(r.changes #>> '{paypal_email,from}', ''))) then
      raise exception 'The PayPal email changed after this request was made. Ask for the change again.' using errcode = '22023';
    end if;
    perform set_config('app.payee_apply', 'on', true);
    update app.integration_connections
       set status = 'connected', connected_at = now(), connected_by = auth.uid(), external_account_id = null, last_error = null,
           display_name = 'PayPal · ' || v_email,
           settings = settings || jsonb_build_object('connect_method', 'email', 'paypal_email', v_email,
                                                     'paypal_email_verified_at', v_verified,
                                                     'mode', coalesce(settings->>'mode', 'test'))
     where id = v_conn;
    update app.center_payment_processors set status = 'test', connection_id = v_conn, updated_by = auth.uid()
     where center_id = r.center_id and processor = 'paypal';
    perform set_config('app.payee_apply', 'off', true);
  end if;

  perform app.payment_plugins_refresh(r.center_id);
  update app.center_payment_plugins
     set changed_by = r.requested_by, changed_at = now(), live_approved_by = auth.uid(), live_approved_at = now()
   where center_id = r.center_id and plugin_key = r.plugin_key;
  return jsonb_build_object('id', r.id, 'status', 'applied');
end $$;

-- Withdraw a request that is still waiting (the person who asked, or anyone who may ask).
create or replace function app.cancel_payee_change(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payee_changes;
begin
  select * into r from app.payee_changes where id = p_request for update;
  if r.id is null then raise exception 'That request was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not (app.payee_can_request(r.center_id) or app.payee_can_approve(r.center_id)) then
    raise exception 'Withdrawing a request to change where gifts go needs the owner, integrations.manage, giving.manage or giving.approve.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request is already %, so it cannot be withdrawn.',
      case r.status when 'applied' then 'confirmed' when 'rejected' then 'turned down' when 'cancelled' then 'withdrawn'
                    when 'superseded' then 'replaced by a newer request' else 'out of date' end
      using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'withdraw this request');
  update app.payee_changes set status = 'cancelled', decision_reason = left(btrim(p_reason), 500), decided_at = now() where id = r.id;
end $$;

-- Settings › Payments: waiting requests first, then what was decided in the last 90 days.
create or replace function app.payee_change_queue(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app.payments_can_view(p_center) or app.payee_can_approve(p_center)) then
    raise exception 'Seeing requests to change where gifts go needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_request', app.payee_can_request(p_center),
    'can_approve', app.payee_can_approve(p_center),
    'requests', coalesce((
      select jsonb_agg(q.j order by q.ord, q.requested_at desc)
        from (
          select case when pc.status = 'pending' then 0 else 1 end as ord, pc.requested_at,
                 jsonb_build_object(
                   'id', pc.id, 'plugin_key', pc.plugin_key, 'status', pc.status,
                   'requested_by', pc.requested_by,
                   'requested_by_name', app.refund_person_name(pc.center_id, pc.requested_by),
                   'requested_at', pc.requested_at, 'request_reason', pc.request_reason, 'expires_at', pc.expires_at,
                   'expired', (pc.status = 'pending' and pc.expires_at <= now()),
                   'decided_by_name', case when pc.decided_by is not null then app.refund_person_name(pc.center_id, pc.decided_by) end,
                   'decided_at', pc.decided_at, 'decision_reason', pc.decision_reason, 'applied_at', pc.applied_at,
                   'mine', (pc.requested_by = auth.uid()),
                   'fields', (select coalesce(jsonb_agg(jsonb_build_object(
                                'field', f.key, 'label', app.payee_field_label(f.key),
                                'from', case when f.key = 'bank_account_id'
                                             then coalesce((select b.name || coalesce(' ····' || b.last4, '') from app.bank_accounts b where b.id::text = f.value->>'from'), 'Any account')
                                             else f.value->>'from' end,
                                'to', case when f.key = 'bank_account_id'
                                           then coalesce((select b.name || coalesce(' ····' || b.last4, '') from app.bank_accounts b where b.id::text = f.value->>'to'), 'Any account')
                                           else f.value->>'to' end) order by f.key), '[]'::jsonb)
                                from jsonb_each(pc.changes) as f(key, value))) as j
            from app.payee_changes pc
           where pc.center_id = p_center and (pc.status = 'pending' or pc.created_at > now() - interval '90 days')
           order by case when pc.status = 'pending' then 0 else 1 end, pc.requested_at desc
           limit 20
        ) q), '[]'::jsonb));
end $$;

-- ── The PayPal email: changed when the new one is verified ───────────────────
-- 0211's confirm_paypal_email, with one branch. The first email an organization verifies is saved at once, as
-- before. Replacing an email that is already set is a payee change: the code proves the new address is the
-- person's, the connection stays as it is, and a different person with giving.approve confirms the change.
create or replace function app.confirm_paypal_email(p_center uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.paypal_email_verifications; ic app.integration_connections; v_old text; v_id uuid;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Connecting PayPal needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  perform app.assert_step_up('payments.connect');
  select * into v from app.paypal_email_verifications where center_id = p_center for update;
  if v.center_id is null or v.used_at is not null then
    return jsonb_build_object('ok', false, 'detail', 'No code is waiting. Send a new code to the PayPal Business email.');
  end if;
  if v.expires_at < now() then
    return jsonb_build_object('ok', false, 'detail', 'That code expired (codes last 15 minutes). Send a new one.');
  end if;
  if v.attempts >= 5 then
    return jsonb_build_object('ok', false, 'detail', 'Too many wrong codes. Send a new one.');
  end if;
  if coalesce(btrim(p_code), '') !~ '^\d{6}$' or encode(digest(btrim(p_code) || ':' || p_center::text, 'sha256'), 'hex') <> v.code_hash then
    update app.paypal_email_verifications set attempts = attempts + 1 where center_id = p_center;
    return jsonb_build_object('ok', false, 'detail', 'That code is not right. ' || (4 - v.attempts) || ' tries left.');
  end if;
  select * into ic from app.integration_connections where id = v.connection_id;
  v_old := lower(btrim(coalesce(ic.settings->>'paypal_email', '')));
  if v_old <> '' and v_old <> lower(btrim(v.email)) then
    perform app.assert_step_up('payments.payee');
    perform app.set_audit_context('PayPal Business email ' || v.email || ' verified; it replaces ' || (ic.settings->>'paypal_email') || ' once a second person confirms it');
    update app.paypal_email_verifications set used_at = now() where center_id = p_center;
    v_id := app._create_payee_change(
      p_center, 'paypal',
      jsonb_build_object('paypal_email', jsonb_build_object('from', ic.settings->>'paypal_email', 'to', v.email)),
      jsonb_build_object('connection_id', v.connection_id, 'verified_at', now()),
      'Changed the PayPal Business email to ' || v.email || ' (verified with a code sent to it)');
    return jsonb_build_object('ok', true, 'pending', true, 'request_id', v_id, 'email', v.email,
      'detail', 'PayPal Business email ' || v.email || ' verified. It replaces ' || (ic.settings->>'paypal_email')
                || ', so a different person with giving.approve must confirm the change before PayPal gifts go to it.');
  end if;
  perform app.set_audit_context('PayPal Business email verified: ' || v.email);
  update app.paypal_email_verifications set used_at = now() where center_id = p_center;
  update app.integration_connections
     set status = 'connected', connected_at = now(), connected_by = auth.uid(), external_account_id = null, last_error = null,
         display_name = 'PayPal · ' || v.email,
         settings = settings || jsonb_build_object('connect_method', 'email', 'paypal_email', v.email,
                                                   'paypal_email_verified_at', now(),
                                                   'mode', coalesce(settings->>'mode', 'test'))
   where id = v.connection_id;
  update app.center_payment_processors set status = 'test', connection_id = v.connection_id, updated_by = auth.uid()
   where center_id = p_center and processor = 'paypal';
  return jsonb_build_object('ok', true, 'detail', 'PayPal Business email ' || v.email || ' verified.', 'email', v.email);
end $$;

-- ── The bank account Zelle lines arrive in ───────────────────────────────────
-- 0582's set_zelle_reporting. The report window is saved as before. Choosing the bank account for the first
-- time is saved as before; CHANGING an account that is already chosen is a payee change and waits for a second
-- person (the window is saved now, the account stays as it was). The answer gains "pending_change" only then.
create or replace function app.set_zelle_reporting(p_center uuid, p_window_days int, p_bank_account uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_old text; v_keep uuid; v_pending uuid;
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
  select rules #>> '{payments,zelle,bank_account_id}' into v_old from app.centers where id = p_center;
  v_keep := p_bank_account;
  if v_old is not null and p_bank_account::text is distinct from v_old then
    if not app.payee_can_request(p_center) then
      raise exception 'Changing the bank account Zelle payments arrive in needs the organization owner, integrations.manage or giving.manage.' using errcode = '42501';
    end if;
    perform app.assert_step_up('payments.payee');
    v_pending := app._create_payee_change(p_center, 'zelle',
      jsonb_build_object('bank_account_id', jsonb_build_object('from', v_old, 'to', p_bank_account)), '{}'::jsonb, p_reason);
    v_keep := v_old::uuid;
  end if;
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
                           case when jsonb_typeof(rules->'payments') = 'object' then rules->'payments' else '{}'::jsonb end
                           || jsonb_build_object('zelle',
                                (case when jsonb_typeof(rules #> '{payments,zelle}') = 'object' then rules #> '{payments,zelle}' else '{}'::jsonb end)
                                || jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', v_keep)))
   where id = p_center;
  return jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', v_keep)
         || case when v_pending is not null then jsonb_build_object('pending_change', v_pending) else '{}'::jsonb end;
end $$;

-- ── What members are told ────────────────────────────────────────────────────
-- For 30 days after a confirmed change of the Zelle details or the PayPal account: {changed_on, days, text}.
create or replace function app.payee_notice(p_center uuid, p_key text) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('changed_on', x.d::text, 'days', 30,
           'text', format('The %s changed on %s. Check it before you pay.',
                          case p_key when 'zelle' then 'Zelle details' else 'PayPal account' end, to_char(x.d, 'FMMonth FMDD, YYYY')))
    from (select (pc.applied_at at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date as d
            from app.payee_changes pc join app.centers c on c.id = pc.center_id
           where pc.center_id = p_center and pc.plugin_key = p_key and pc.status = 'applied'
             and pc.applied_at > now() - interval '30 days'
           order by pc.applied_at desc limit 1) x
$$;

-- ── The plugin status: a pause reads "suspended" ─────────────────────────────
-- Same function as 0580. The only change: a pause by Community Connect, for everyone or for this organization.
create or replace function app.payment_plugin_status(p_center uuid, p_key text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; v_env text; cp app.center_payment_processors; v_conn text; v_mode text; v_card text;
        v_instr jsonb; v_matched boolean;
begin
  select * into pl from app.payment_plugins where key = p_key;
  if pl.key is null then return null; end if;
  if app.payment_plugin_is_paused(p_center, p_key) then return 'suspended'; end if;
  if not app.payment_plugin_enabled(p_center, p_key) then return 'off'; end if;
  select environment into v_env from app.centers where id = p_center;

  if pl.family = 'provider_checkout' then
    -- Apple Pay, Google Pay and ACH ride on Card: they cannot be ready while Card is not (a paused
    -- Card leaves them needing setup; payment_plugin_problem then says Card is paused).
    if 'card' = any (pl.depends_on) then
      v_card := app.payment_plugin_status(p_center, 'card');
      if v_card in ('needs_setup','suspended') then return 'needs_setup'; end if;
    end if;
    select * into cp from app.center_payment_processors where center_id = p_center and processor = pl.provider;
    select ic.status into v_conn from app.integration_connections ic where ic.id = cp.connection_id;
    if cp.center_id is null or cp.status not in ('test','live') or v_conn is distinct from 'connected' then
      return 'needs_setup';
    end if;
    v_mode := app.payment_api_mode(p_center, pl.provider);
    if cp.status = 'live' and v_mode = 'live' then return 'live'; end if;
    if exists (select 1 from app.payment_processor_tests t
                where t.center_id = p_center and t.processor = pl.provider and t.mode = v_mode and t.ok) then
      return 'test_passed';
    end if;
    return 'ready';
  end if;

  select m.instructions into v_instr from app.center_payment_methods m
   where m.center_id = p_center and m.method = pl.legacy_method::app.payment_method;
  v_instr := coalesce(v_instr, '{}'::jsonb);
  if pl.key = 'zelle' then
    if app.payment_method_instructions_problem('zelle', v_instr) is not null
       or (v_env = 'production' and nullif(btrim(coalesce(v_instr->>'name', '')), '') is null) then
      return 'needs_setup';
    end if;
    if v_env = 'production' then return 'live'; end if;
    -- A rehearsal report matched end to end (plan PR 3's table).
    if to_regclass('app.payment_reports') is not null
       and (select count(*) from pg_attribute a
             where a.attrelid = to_regclass('app.payment_reports') and a.attnum > 0 and not a.attisdropped
               and a.attname in ('center_id','status','is_test')) = 3 then
      execute 'select exists (select 1 from app.payment_reports where center_id = $1 and is_test and status = ''matched'')'
        into v_matched using p_center;
      if v_matched then return 'test_passed'; end if;
    end if;
    return 'ready';
  end if;

  if app.payment_method_instructions_problem(pl.legacy_method::app.payment_method, v_instr) is not null then return 'needs_setup'; end if;
  return case when v_env = 'production' then 'live' else 'ready' end;
end $$;

-- ── Keeping the stored rows in step ──────────────────────────────────────────
-- A pause (the catalog status changing) or a lifted pause refreshes every organization's rows; a pause for one
-- organization refreshes that one. A Zelle report matched or changed in a sandbox refreshes its organization
-- (0582's follow-up: the stored "test passed" of the Zelle plugin reads payment_reports).
-- The refresh writes audit rows that carry an organization's id, which the organization's own staff can read
-- (audit.view). The reason Community Connect gave for a pause is for platform admins only, so both triggers
-- replace the transaction's audit reason with a generic one BEFORE they refresh. (The audit rows of the pause
-- itself, payment_plugin_suspensions and payment_plugins, carry no organization id and keep the real reason;
-- they are written first, because AFTER triggers fire in name order.)
create or replace function app.payment_plugins_catalog_sync() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.set_audit_context('Community Connect paused or resumed a way to pay');
  perform app.payment_plugins_refresh(c.id) from app.centers c;
  return null;
end $$;
drop trigger if exists payment_plugins_catalog_sync on app.payment_plugins;
create trigger payment_plugins_catalog_sync after update of status on app.payment_plugins
  for each row when (old.status is distinct from new.status) execute function app.payment_plugins_catalog_sync();

create or replace function app.payment_plugins_suspension_sync() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.set_audit_context('Community Connect paused or resumed a way to pay');
  perform app.payment_plugins_refresh(new.target_center);
  return null;
end $$;
drop trigger if exists payment_plugins_suspension_sync on app.payment_plugin_suspensions;
create trigger payment_plugins_suspension_sync after insert or update on app.payment_plugin_suspensions
  for each row when (new.target_center is not null) execute function app.payment_plugins_suspension_sync();

drop trigger if exists payment_plugins_sync_reports on app.payment_reports;
create trigger payment_plugins_sync_reports after insert or update of status, is_test or delete on app.payment_reports
  for each row execute function app.payment_plugins_sync();

-- ── A pause stops new payments from starting ─────────────────────────────────
-- Only the START of a payment: a new checkout, a new Zelle report. Recording what already arrived, matching
-- bank lines and refunds are not touched.
create or replace function app.payment_checkouts_pause_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_key text := case new.processor when 'paypal' then 'paypal' else 'card' end;
begin
  if app.payment_plugin_is_paused(new.center_id, v_key) then
    raise exception 'Community Connect has paused % for now, so this payment cannot be started. Try again later, or use another way to give.',
      (select label from app.payment_plugins where key = v_key) using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payment_checkouts_pause_guard on app.payment_checkouts;
create trigger payment_checkouts_pause_guard before insert on app.payment_checkouts
  for each row execute function app.payment_checkouts_pause_guard();

create or replace function app.payment_reports_pause_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if app.payment_plugin_is_paused(new.center_id, 'zelle') then
    raise exception 'Community Connect has paused Zelle for now, so a Zelle payment cannot be reported. Try again later, or use another way to give.'
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists payment_reports_pause_guard on app.payment_reports;
create trigger payment_reports_pause_guard before insert on app.payment_reports
  for each row execute function app.payment_reports_pause_guard();

-- ── Pausing and resuming (Community Connect only) ────────────────────────────
-- p_center null = every organization. A pause is the only power platform admins have over payments: it
-- turns a way to pay off for members, it never reads a credential and never moves money.
create or replace function app.suspend_payment_plugin(p_key text, p_center uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; v_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can pause a way to pay.' using errcode = '42501';
  end if;
  select * into pl from app.payment_plugins where key = p_key for update;
  if pl.key is null then raise exception 'That is not a payment method Community Connect offers.' using errcode = '22023'; end if;
  if p_center is not null and not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  if pl.status = 'suspended' then
    raise exception '% is already paused for every community.', pl.label using errcode = '22023';
  end if;
  if p_center is not null and exists (select 1 from app.payment_plugin_suspensions s
                                       where s.plugin_key = p_key and s.target_center = p_center and s.lifted_at is null) then
    raise exception '% is already paused for that community.', pl.label using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.suspend');
  perform app.payments_require_reason(p_reason, 'pause ' || pl.label);
  insert into app.payment_plugin_suspensions (plugin_key, target_center, reason, suspended_by, previous_status)
  values (p_key, p_center, left(btrim(p_reason), 500), auth.uid(), case when p_center is null then pl.status end)
  returning id into v_id;
  if p_center is null then
    update app.payment_plugins set status = 'suspended' where key = p_key;
  end if;
  return jsonb_build_object('id', v_id, 'plugin', p_key, 'center_id', p_center);
end $$;

create or replace function app.lift_payment_plugin_suspension(p_key text, p_center uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; s app.payment_plugin_suspensions;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can resume a way to pay.' using errcode = '42501';
  end if;
  select * into pl from app.payment_plugins where key = p_key for update;
  if pl.key is null then raise exception 'That is not a payment method Community Connect offers.' using errcode = '22023'; end if;
  select * into s from app.payment_plugin_suspensions
   where plugin_key = p_key and lifted_at is null and target_center is not distinct from p_center for update;
  if s.id is null and not (p_center is null and pl.status = 'suspended') then
    raise exception '% is not paused%.', pl.label, case when p_center is null then ' for every community' else ' for that community' end using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.suspend');
  perform app.payments_require_reason(p_reason, 'resume ' || pl.label);
  if s.id is not null then
    update app.payment_plugin_suspensions
       set lifted_by = auth.uid(), lifted_at = now(), lift_reason = left(btrim(p_reason), 500)
     where id = s.id;
  end if;
  if p_center is null then
    update app.payment_plugins set status = coalesce(s.previous_status, 'available') where key = p_key;
  end if;
  return jsonb_build_object('plugin', p_key, 'center_id', p_center);
end $$;

-- Platform › Payments: every plugin with its pauses, the history, and the communities to choose from.
create or replace function app.payment_plugin_pauses() returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can see the paused ways to pay.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plugins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', pl.key, 'label', pl.label, 'family', pl.family, 'status', pl.status,
               'platform_pause', (select jsonb_build_object('id', s.id, 'reason', s.reason, 'at', s.suspended_at,
                                                            'by', (select u.email::text from auth.users u where u.id = s.suspended_by))
                                    from app.payment_plugin_suspensions s
                                   where s.plugin_key = pl.key and s.target_center is null and s.lifted_at is null limit 1),
               'centers', coalesce((select jsonb_agg(jsonb_build_object(
                                      'id', s.id, 'center_id', s.target_center, 'center_name', c.name, 'slug', c.slug,
                                      'reason', s.reason, 'at', s.suspended_at,
                                      'by', (select u.email::text from auth.users u where u.id = s.suspended_by)) order by s.suspended_at)
                                      from app.payment_plugin_suspensions s join app.centers c on c.id = s.target_center
                                     where s.plugin_key = pl.key and s.lifted_at is null), '[]'::jsonb)) order by pl.sort)
        from app.payment_plugins pl), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.ts desc)
        from (select s.suspended_at as ts,
                     jsonb_build_object(
                       'id', s.id, 'plugin_key', s.plugin_key, 'platform_wide', s.target_center is null,
                       'center_name', (select c.name from app.centers c where c.id = s.target_center),
                       'reason', s.reason, 'suspended_at', s.suspended_at,
                       'suspended_by', (select u.email::text from auth.users u where u.id = s.suspended_by),
                       'lifted_at', s.lifted_at, 'lift_reason', s.lift_reason,
                       'lifted_by', (select u.email::text from auth.users u where u.id = s.lifted_by)) as j
                from app.payment_plugin_suspensions s order by s.suspended_at desc limit 30) h), '[]'::jsonb),
    'centers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'environment', c.environment) order by c.name)
                           from app.centers c), '[]'::jsonb));
end $$;

-- ── What members see: a pause hides it, a recent payee change is dated ───────
-- 0581's member_payment_methods. Changes: a way to pay paused for everyone or for this organization is not
-- listed (was: only a paused catalog row), and the Zelle (not in a sandbox rehearsal) and PayPal entries carry
-- "payee_notice" for 30 days after a confirmed change of where gifts go. Nothing else differs.
create or replace function app.member_payment_methods(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_staff boolean; v_forced boolean; v_offline boolean; v_rehearsal boolean;
        v_methods jsonb := '[]'::jsonb; v_online boolean := false; v_test_mode boolean := false; v_unavailable text;
        r record; cp app.center_payment_processors; v_conn text; v_instr jsonb; v_window text; v_shown jsonb; v_notice jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see how to give.' using errcode = '42501'; end if;
  v_staff := app.payments_can_view(p_center);
  if not (app.is_member_of(p_center) or v_staff) then
    raise exception 'Only members of this community can see how to give.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if not v_staff and not app.i_am_adult(p_center) then
    raise exception 'Only an adult of the family can pay for it.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  v_offline := coalesce((c.rules #>> '{payments,offline_only}')::boolean, false);
  v_rehearsal := c.environment = 'sandbox';

  for r in
    select pl.key, pl.family, pl.provider, pl.legacy_method,
           coalesce(cpp.label_override, pl.label) as label, coalesce(cpp.sort, pl.sort) as sort
      from app.payment_plugins pl
      left join app.center_payment_plugins cpp on cpp.center_id = p_center and cpp.plugin_key = pl.key
     where not app.payment_plugin_is_paused(p_center, pl.key) and app.payment_plugin_enabled(p_center, pl.key)
     order by coalesce(cpp.sort, pl.sort), pl.sort, pl.key
  loop
    if r.family = 'provider_checkout' then
      -- One entry per processor: the wallets and ACH are part of Card's entry.
      continue when r.key not in ('card','paypal');
      select * into cp from app.center_payment_processors where center_id = p_center and processor = r.provider;
      select ic.status into v_conn from app.integration_connections ic where ic.id = cp.connection_id;
      if cp.status = 'test' and not v_forced then v_test_mode := true; end if;
      continue when v_offline or cp.center_id is null or cp.status not in ('test','live')
                 or not (cp.status = 'live' or v_forced) or v_conn is distinct from 'connected';
      v_notice := case when r.key = 'paypal' then app.payee_notice(p_center, 'paypal') end;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label, 'provider', r.provider,
        'mode', app.payment_api_mode(p_center, r.provider),
        'wallets', case when r.key = 'card' then
                     (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                       where w.key in ('apple_pay','google_pay') and not app.payment_plugin_is_paused(p_center, w.key)
                         and app.payment_plugin_enabled(p_center, w.key))
                   else '[]'::jsonb end,
        'also', case when r.key = 'card' then
                  (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                    where w.key = 'bank_debit' and not app.payment_plugin_is_paused(p_center, w.key)
                      and app.payment_plugin_enabled(p_center, w.key))
                else case when 'venmo' = any (cp.methods) then '["venmo"]'::jsonb else '[]'::jsonb end end,
        'sort', r.sort)
        || case when v_notice is not null then jsonb_build_object('payee_notice', v_notice) else '{}'::jsonb end);
      v_online := true;
    elsif r.family = 'reported_transfer' then
      select m.instructions into v_instr from app.center_payment_methods m
       where m.center_id = p_center and m.method = r.legacy_method::app.payment_method;
      v_instr := coalesce(v_instr, '{}'::jsonb);
      v_shown := case when v_rehearsal
                      then jsonb_build_object('name', 'Sandbox: no real money moves')
                           || jsonb_strip_nulls(jsonb_build_object('memo_hint', nullif(btrim(coalesce(v_instr->>'memo_hint', '')), '')))
                      else jsonb_strip_nulls(jsonb_build_object(
                             'recipient', nullif(btrim(coalesce(v_instr->>'recipient', '')), ''),
                             'name', nullif(btrim(coalesce(v_instr->>'name', '')), ''),
                             'memo_hint', nullif(btrim(coalesce(v_instr->>'memo_hint', '')), ''))) end;
      v_window := c.rules #>> '{payments,zelle,report_window_days}';
      v_notice := case when not v_rehearsal then app.payee_notice(p_center, 'zelle') end;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label,
        'mode', case when v_rehearsal then 'rehearsal' else 'live' end,
        'instructions', v_shown,
        'report', jsonb_build_object(
          'available', to_regprocedure('app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)') is not null,
          'confirmation', 'ask',
          -- 3 to 30 days, 10 when not set (the same rule plan PR 3's app.zelle_report_window_days applies).
          'window_days', least(30, greatest(3, case when v_window ~ '^\s*\d{1,4}\s*$' then v_window::int else 10 end))),
        'sort', r.sort)
        || case when v_notice is not null then jsonb_build_object('payee_notice', v_notice) else '{}'::jsonb end);
    else
      select m.instructions into v_instr from app.center_payment_methods m
       where m.center_id = p_center and m.method = r.legacy_method::app.payment_method;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label, 'method', r.legacy_method,
        'instructions', coalesce(v_instr, '{}'::jsonb), 'sort', r.sort));
    end if;
  end loop;

  if v_offline then v_unavailable := 'offline_only';
  elsif not v_online then v_unavailable := case when v_test_mode then 'test_mode' else 'not_connected' end;
  end if;
  return jsonb_build_object('environment', c.environment, 'currency', lower(coalesce(c.currency, 'usd')),
                            'online_unavailable', v_unavailable, 'methods', v_methods);
end $$;

-- ── Go-live: the treasurer approves the Zelle instructions (plan §2.6) ───────
-- golive_approvals.key gains zelle_instructions. As with the receipt templates (check 8) the approval records a
-- fingerprint of exactly what was approved (address, name, memo, bank account, report window); if any of it
-- changes afterwards the check stops passing and says so until the treasurer approves the new version.
do $$
declare v_name text;
begin
  for v_name in select conname from pg_constraint
                 where conrelid = 'app.golive_approvals'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%statement_templates%' loop
    execute format('alter table app.golive_approvals drop constraint %I', v_name);
  end loop;
  alter table app.golive_approvals add constraint golive_approvals_key_check
    check (key in ('statement_templates','niva_content','zelle_instructions'));
end $$;

create or replace function app.zelle_instructions_evidence(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'recipient', nullif(btrim(coalesce(m.instructions->>'recipient', '')), ''),
           'name', nullif(btrim(coalesce(m.instructions->>'name', '')), ''),
           'memo_hint', nullif(btrim(coalesce(m.instructions->>'memo_hint', '')), ''),
           'bank_account_id', c.rules #>> '{payments,zelle,bank_account_id}',
           'report_window_days', app.zelle_report_window_days(p_center))
    from app.centers c
    left join app.center_payment_methods m on m.center_id = c.id and m.method = 'zelle'
   where c.id = p_center
$$;

-- 0300's function with one more key.
create or replace function app.golive_approval_state(p_center uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare a app.golive_approvals; v_now jsonb; v_who text;
begin
  select * into a from app.golive_approvals where center_id = p_center and key = p_key;
  if a.center_id is null then return jsonb_build_object('state', 'none'); end if;
  v_now := case p_key when 'statement_templates' then app.statement_templates_evidence(p_center)
                      when 'zelle_instructions' then app.zelle_instructions_evidence(p_center)
                      else app.niva_content_evidence(p_center) end;
  select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name into v_who
    from app.center_users cu join app.people pe on pe.id = cu.person_id
   where cu.center_id = p_center and cu.user_id = a.approved_by limit 1;
  if v_who is null then select email into v_who from auth.users where id = a.approved_by; end if;
  return jsonb_build_object(
    'state', case when app.golive_evidence_hash(v_now) = a.evidence_hash then 'current' else 'changed' end,
    'approved_by', a.approved_by, 'approved_by_name', coalesce(v_who, 'someone'), 'approved_at', a.approved_at,
    'approver_role', a.approver_role, 'note', a.note);
end $$;

create or replace function app.approve_zelle_instructions(p_center uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ev jsonb; v_note text := app.audit_clean_reason(p_note); v_instr jsonb; v_problem text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.is_active_treasurer(p_center) then
    raise exception 'Only the treasurer approves the Zelle instructions. Ask the person with the Treasurer role to approve them.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_note is not null and char_length(btrim(p_note)) > 1000 then
    raise exception 'Keep the note under 1,000 characters.' using errcode = '22023';
  end if;
  if not app.payment_plugin_enabled(p_center, 'zelle') then
    raise exception 'Zelle is not turned on, so there is nothing to approve.' using errcode = '22023';
  end if;
  select m.instructions into v_instr from app.center_payment_methods m where m.center_id = p_center and m.method = 'zelle';
  v_instr := coalesce(v_instr, '{}'::jsonb);
  v_problem := app.payment_method_instructions_problem('zelle', v_instr);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  if nullif(btrim(coalesce(v_instr->>'name', '')), '') is null then
    raise exception 'Add the name shown in Zelle first, so members can check they are paying the right account.' using errcode = '22023';
  end if;
  if app.zelle_bank_account_id(p_center) is null then
    raise exception 'Choose the bank account Zelle payments arrive in first (Giving › Payments › Bank › Zelle reports).' using errcode = '22023';
  end if;
  v_ev := app.zelle_instructions_evidence(p_center);
  perform app.set_audit_context(coalesce(v_note, 'Treasurer approved the Zelle instructions and matching process'));
  insert into app.golive_approvals (center_id, key, approved_by, approver_role, note, evidence, evidence_hash)
  values (p_center, 'zelle_instructions', auth.uid(), 'Treasurer', v_note, v_ev, app.golive_evidence_hash(v_ev))
  on conflict (center_id, key) do update
     set approved_by = excluded.approved_by, approved_at = now(), approver_role = excluded.approver_role,
         note = excluded.note, evidence = excluded.evidence, evidence_hash = excluded.evidence_hash;
  return app.golive_approval_state(p_center, 'zelle_instructions');
end $$;

-- The owner says Apple Pay or Google Pay is turned on in the organization's Stripe account. Hosted Checkout shows
-- a wallet only when the account allows it and Community Connect cannot read that setting yet (plan PR 6), so
-- readiness asks for this statement, with a reason, until it can.
create or replace function app.confirm_wallet_in_stripe(p_center uuid, p_key text, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Saying a wallet is turned on in Stripe needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('apple_pay','google_pay') then
    raise exception 'Only Apple Pay and Google Pay are confirmed this way.' using errcode = '22023';
  end if;
  select * into pl from app.payment_plugins where key = p_key;
  if not app.payment_plugin_enabled(p_center, p_key) then
    raise exception 'Turn % on first.', pl.label using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'say that ' || pl.label || ' is turned on in Stripe');
  perform app.payment_plugins_refresh(p_center);
  update app.center_payment_plugins set wallet_confirmed_by = auth.uid(), wallet_confirmed_at = now()
   where center_id = p_center and plugin_key = p_key;
end $$;

-- ── Readiness (plan §2.6) ────────────────────────────────────────────────────
-- One processor (Stripe or PayPal) is ready to go live when it is connected and verified, in the mode it charges
-- in (live in production, test in a sandbox), authorized in that mode, and its latest $1 charge and refund in
-- that mode passed. A connection that says it was made in test mode (Stripe livemode false, PayPal sandbox) is
-- not ready for production.
create or replace function app._payment_processor_readiness(p_center uuid, p_processor text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; t app.payment_processor_tests;
        v_who text := case p_processor when 'paypal' then 'PayPal' else 'Stripe' end;
        v_card text := case p_processor when 'paypal' then 'PayPal' else 'Card' end;
        v_need text; v_note text := '';
begin
  select * into c from app.centers where id = p_center;
  select * into cp from app.center_payment_processors where center_id = p_center and processor = p_processor;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if cp.center_id is null or cp.status in ('not_connected','disabled') then
    return jsonb_build_object('ready', false, 'detail', format('Connect %s first (%s › Connect).', v_who, v_card));
  end if;
  if cp.status = 'pending_verification' then
    return jsonb_build_object('ready', false, 'detail', format('%s is still verifying the organization. Finish the steps in the %s dashboard.', v_who, v_who));
  end if;
  if ic.id is null or ic.status is distinct from 'connected' then
    return jsonb_build_object('ready', false, 'detail', format('%s is not connected right now. Reconnect it (%s › Reconnect).', v_who, v_card));
  end if;
  if ic.settings->'charges_enabled' = 'false'::jsonb then
    return jsonb_build_object('ready', false, 'detail', format('%s has not finished verifying this account yet. Finish the steps in the %s dashboard.', v_who, v_who));
  end if;
  if c.environment = 'production' then
    if app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb then
      return jsonb_build_object('ready', false, 'detail', 'Community Connect is holding this organization to test mode, so members cannot pay online yet.');
    end if;
    if cp.status <> 'live' then
      return jsonb_build_object('ready', false, 'detail', format('%s is still in test mode. Switch it to live (%s › Switch to live).', v_who, v_card));
    end if;
    if p_processor = 'stripe' and ic.settings->'livemode' = 'false'::jsonb then
      return jsonb_build_object('ready', false, 'detail', 'Stripe was connected in test mode, so it cannot take live payments. Connect it again in live mode (Card › Reconnect Stripe).');
    end if;
    if p_processor = 'paypal' and ic.settings->>'provider_env' = 'sandbox' then
      return jsonb_build_object('ready', false, 'detail', 'PayPal was connected to its sandbox, so it cannot take live payments. Connect it again in live mode (PayPal › Reconnect PayPal).');
    end if;
    v_need := 'live';
  else
    v_need := 'test';
  end if;
  select * into t from app.payment_processor_tests
   where center_id = p_center and processor = p_processor and mode = v_need order by ran_at desc limit 1;
  if t.id is null then
    return jsonb_build_object('ready', false, 'detail', format('Run the $1 %s test (%s › Run the $1 test).', v_need, v_card));
  end if;
  if not t.ok then
    return jsonb_build_object('ready', false, 'detail', format('The last $1 %s test of %s failed: %s', v_need, v_who, coalesce(t.detail, 'no detail')));
  end if;
  if p_processor = 'paypal' and ic.settings->>'connect_method' = 'email' then
    v_note := ' It is connected by its Business email only: Community Connect cannot refund through it, so refunds are recorded by hand after two approvals.';
  end if;
  return jsonb_build_object('ready', true, 'detail', format('%s passed the $1 %s charge and refund.%s', v_who, v_need, v_note));
end $$;

-- One enabled way to pay: {ready, detail}.
create or replace function app._payment_plugin_readiness(p_center uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; c app.centers; v_status text; v_instr jsonb; v_problem text; v_card jsonb;
        v_bank uuid; v_format text; a jsonb; v_ack timestamptz;
begin
  select * into pl from app.payment_plugins where key = p_key;
  select * into c from app.centers where id = p_center;
  if pl.key is null or c.id is null then
    return jsonb_build_object('ready', false, 'detail', 'That way to pay was not found.');
  end if;
  v_status := app.payment_plugin_status(p_center, p_key);
  if v_status = 'suspended' then
    return jsonb_build_object('ready', false,
      'detail', format('Community Connect has paused %s for now. Turn it off to go live without it, or wait until it is resumed.', pl.label));
  end if;

  if pl.family = 'provider_checkout' then
    if p_key in ('card','bank_debit','paypal') then
      return app._payment_processor_readiness(p_center, pl.provider);
    end if;
    -- Apple Pay and Google Pay ride on Card (hosted Checkout), and are on only when the Stripe account allows them.
    v_card := app._payment_processor_readiness(p_center, 'stripe');
    if not (v_card->>'ready')::boolean then
      return jsonb_build_object('ready', false, 'detail', 'Card is not ready yet. ' || (v_card->>'detail'));
    end if;
    select cpp.wallet_confirmed_at into v_ack from app.center_payment_plugins cpp where cpp.center_id = p_center and cpp.plugin_key = p_key;
    if v_ack is null then
      return jsonb_build_object('ready', false,
        'detail', format('Turn %s on in your Stripe payment settings, then say so (Settings › Payments › %s › "I turned it on in Stripe"). Community Connect cannot read that setting yet.', pl.label, pl.label));
    end if;
    return jsonb_build_object('ready', true, 'detail', format('%s was confirmed as turned on in Stripe on %s.', pl.label, to_char(v_ack at time zone 'UTC', 'FMMonth FMDD, YYYY')));
  end if;

  select m.instructions into v_instr from app.center_payment_methods m
   where m.center_id = p_center and m.method = pl.legacy_method::app.payment_method;
  v_instr := coalesce(v_instr, '{}'::jsonb);

  if p_key = 'zelle' then
    v_problem := app.payment_method_instructions_problem('zelle', v_instr);
    if v_problem is not null then return jsonb_build_object('ready', false, 'detail', v_problem); end if;
    if nullif(btrim(coalesce(v_instr->>'name', '')), '') is null then
      return jsonb_build_object('ready', false, 'detail', 'Add the name shown in Zelle so members can check they are paying the right account.');
    end if;
    v_bank := app.zelle_bank_account_id(p_center);
    if v_bank is null then
      return jsonb_build_object('ready', false, 'detail', 'Choose the bank account Zelle payments arrive in (Giving › Payments › Bank › Zelle reports).');
    end if;
    select b.statement_format into v_format from app.bank_accounts b where b.id = v_bank;
    if v_format = 'ofx' then
      return jsonb_build_object('ready', false, 'detail', 'That bank account''s statement format (OFX) cannot be read for Zelle lines yet. Use a Chase or a generic CSV statement.');
    end if;
    a := app.golive_approval_state(p_center, 'zelle_instructions');
    if a->>'state' = 'none' then
      return jsonb_build_object('ready', false, 'detail', 'The treasurer has not approved the Zelle instructions and matching process yet (Settings › Payments › Zelle).');
    elsif a->>'state' = 'changed' then
      return jsonb_build_object('ready', false,
        'detail', format('The Zelle details changed after %s approved them on %s. The treasurer approves the new version (Settings › Payments › Zelle).',
                         a->>'approved_by_name', to_char((a->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')));
    end if;
    if c.environment = 'sandbox' and v_status <> 'test_passed' then
      return jsonb_build_object('ready', false,
        'detail', 'Rehearse it once: report a test Zelle in the member app, import a sample statement line and match it (Giving › Payments › Bank › Zelle reports).');
    end if;
    return jsonb_build_object('ready', true,
      'detail', format('Address, name and bank account are set and the treasurer approved them on %s.', to_char((a->>'approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')));
  end if;

  -- The offline methods: their instructions are filled in.
  if v_status = 'needs_setup' then
    return jsonb_build_object('ready', false, 'detail', coalesce(app.payment_plugin_problem(p_center, p_key), 'Finish the instructions.'));
  end if;
  return jsonb_build_object('ready', true, 'detail', 'The instructions are filled in.');
end $$;

-- Every enabled way to pay, in the organization's order. Online ways are listed as passing while the
-- organization takes offline payments only (they are not offered); Zelle and the offline methods still count.
create or replace function app._payment_readiness(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_offline boolean; r record; v_plugins jsonb := '[]'::jsonb; e jsonb; v_all boolean := true;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then
    return jsonb_build_object('ok', false, 'offline_only', false, 'environment', null::text, 'plugins', '[]'::jsonb);
  end if;
  v_offline := coalesce((c.rules #>> '{payments,offline_only}')::boolean, false);
  for r in
    select pl.key, pl.label, pl.family
      from app.payment_plugins pl
      left join app.center_payment_plugins cpp on cpp.center_id = p_center and cpp.plugin_key = pl.key
     where app.payment_plugin_enabled(p_center, pl.key)
     order by coalesce(cpp.sort, pl.sort), pl.sort, pl.key
  loop
    if v_offline and r.family = 'provider_checkout' then
      e := jsonb_build_object('ready', true, 'detail', 'Not offered while the organization takes offline payments only.');
    else
      e := app._payment_plugin_readiness(p_center, r.key);
    end if;
    v_all := v_all and coalesce((e->>'ready')::boolean, false);
    v_plugins := v_plugins || jsonb_build_array(jsonb_build_object('key', r.key, 'label', r.label, 'family', r.family) || e);
  end loop;
  return jsonb_build_object('ok', v_all, 'offline_only', v_offline, 'environment', c.environment, 'plugins', v_plugins);
end $$;

-- What Settings › Payments shows (staff who may see the payment settings).
create or replace function app.payment_readiness(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_view(p_center) then
    raise exception 'Seeing the payment readiness needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  return app._payment_readiness(p_center)
         || jsonb_build_object('zelle_approval', app.golive_approval_state(p_center, 'zelle_instructions'),
                               'is_treasurer', app.is_active_treasurer(p_center),
                               'can_configure', app.payments_can_configure(p_center));
end $$;

-- ── Readiness check 6 walks every enabled way to pay ─────────────────────────
-- The earlier rules stay exactly as they were (a default processor in the mode it charges in with a passing
-- $1 test, "offline only" passes, Giving switched off passes, flagged refunds are named). On top of them every
-- ENABLED way to pay must be ready (_payment_readiness); the ones that are not are named after "Not ready:".
do $$ begin
  if to_regprocedure('app._check_payments_live_before_0597(uuid)') is null then
    alter function app.check_payments_live(uuid) rename to _check_payments_live_before_0597;
  end if;
end $$;
create or replace function app.check_payments_live(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app._check_payments_live_before_0597(p_center); r jsonb; p jsonb; v_bad text[] := '{}';
begin
  if not app.module_enabled(p_center, 'giving') then return v; end if;
  r := app._payment_readiness(p_center);
  for p in select * from jsonb_array_elements(r->'plugins') loop
    if not coalesce((p->>'ready')::boolean, false) then
      v_bad := v_bad || ((p->>'label') || ': ' || (p->>'detail'));
    end if;
  end loop;
  if cardinality(v_bad) = 0 then return v; end if;
  v := jsonb_set(v, '{ok}', 'false'::jsonb);
  v := jsonb_set(v, '{detail}', to_jsonb(coalesce(v->>'detail', '') || ' · Not ready: ' || array_to_string(v_bad, ' · ')));
  return v;
end $$;
-- check_fn is a regproc (an OID): the rename above left the registry pointing at the old function.
update app.readiness_checks set check_fn = 'app.check_payments_live'::regproc where key = 'payments_live';

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- A rehearsal report matched before this migration left the stored "test passed" behind: bring every
-- organization's rows in step (rows are only written when a value changed).
do $$ begin
  perform app.set_audit_context('Payment change control (0597): plugin rows brought in step with the Zelle reports');
  perform app.payment_plugins_refresh(c.id) from app.centers c;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.payee_has_permission(uuid, text), app.payee_can_request(uuid), app.payee_can_approve(uuid),
  app.payee_field_label(text), app.payment_plugin_is_paused(uuid, text),
  app.payee_guard_methods(), app.payee_guard_centers(), app.payee_guard_connections(),
  app._create_payee_change(uuid, text, jsonb, jsonb, text),
  app.request_payee_change(uuid, text, jsonb, text), app.decide_payee_change(uuid, boolean, text), app.cancel_payee_change(uuid, text),
  app.payee_change_queue(uuid), app.payee_notice(uuid, text),
  app.confirm_paypal_email(uuid, text), app.set_zelle_reporting(uuid, int, uuid, text),
  app.payment_plugin_status(uuid, text), app.payment_plugins_catalog_sync(), app.payment_plugins_suspension_sync(),
  app.payment_checkouts_pause_guard(), app.payment_reports_pause_guard(),
  app.suspend_payment_plugin(text, uuid, text), app.lift_payment_plugin_suspension(text, uuid, text), app.payment_plugin_pauses(),
  app.member_payment_methods(uuid),
  app.zelle_instructions_evidence(uuid), app.golive_approval_state(uuid, text),
  app.approve_zelle_instructions(uuid, text), app.confirm_wallet_in_stripe(uuid, text, text),
  app._payment_processor_readiness(uuid, text), app._payment_plugin_readiness(uuid, text), app._payment_readiness(uuid),
  app.payment_readiness(uuid), app.check_payments_live(uuid), app._check_payments_live_before_0597(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.payee_can_request(uuid), app.payee_can_approve(uuid),
  app.request_payee_change(uuid, text, jsonb, text), app.decide_payee_change(uuid, boolean, text), app.cancel_payee_change(uuid, text),
  app.payee_change_queue(uuid), app.confirm_paypal_email(uuid, text), app.set_zelle_reporting(uuid, int, uuid, text),
  app.suspend_payment_plugin(text, uuid, text), app.lift_payment_plugin_suspension(text, uuid, text), app.payment_plugin_pauses(),
  app.member_payment_methods(uuid), app.approve_zelle_instructions(uuid, text), app.confirm_wallet_in_stripe(uuid, text, text),
  app.payment_readiness(uuid), app.check_payments_live(uuid)
  to authenticated, service_role;
