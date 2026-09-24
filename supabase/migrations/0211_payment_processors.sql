-- Onboarding Wave B · stream o-payments · 2 of 4: Settings › Payments
-- (ONBOARDING_PLAN §4 Step 1.2; ONBOARDING_WAVE_B.md "Payments (o-payments)").
--
-- The owner's decision (2026-09-24): an organization connects Stripe or
-- PayPal, or both, each with its own account; one is the default at checkout.
--
--   app.center_payment_processors   one row per (center, stripe|paypal): the connection, default,
--                                   online methods, statement descriptor, donor-may-cover-fee, status
--   app.center_payment_methods      offline methods the organization accepts, with the
--                                   instructions members see ("how to give")
--   app.payment_processor_tests     the $1 charge and refund, per processor and mode
--   app.payment_checkouts           one row per online checkout (member or staff, or a $1 test):
--                                   what is being paid, where, and what came of it
--   app.oauth_states                single-use connect states (bound to center, user, connection)
--   app.paypal_email_verifications  the 6-digit code for the PayPal Business email fallback (hashed)
--
-- Who may do what (no new permission keys):
--   see Settings › Payments        integrations.view/manage, giving.view/manage, or the owner
--   connect / disconnect / live    the owner or integrations.manage (as the vault: credentials),
--                                  a fresh 2FA check and a reason
--   methods, descriptor, default,  the owner, integrations.manage or giving.manage, with a reason
--   offline methods, offline only
-- Nothing here changes a money rule: online payments are recorded by the worker
-- (0212) through the existing allocation and posting functions.

-- ── Who may ──────────────────────────────────────────────────────────────────
create or replace function app.payments_can_view(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.has_permission(p_center, 'integrations.view') or app.has_permission(p_center, 'integrations.manage')
    or app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')
    or app.is_center_owner(p_center))
$$;
create or replace function app.payments_can_configure(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.is_center_owner(p_center) or app.has_permission(p_center, 'integrations.manage')
    or app.has_permission(p_center, 'giving.manage'))
$$;
-- Connecting an account is handling credentials: exactly the vault's rule (0170).
create or replace function app.payments_can_connect(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.can_manage_integration_secrets(p_center)
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists app.center_payment_processors (
  center_id     uuid not null references app.centers(id) on delete cascade,
  processor     text not null check (processor in ('stripe','paypal')),
  connection_id uuid references app.integration_connections(id) on delete set null,
  is_default    boolean not null default false,
  methods       text[] not null default '{}',
  statement_descriptor text check (statement_descriptor is null or char_length(statement_descriptor) between 5 and 22),
  donor_covers_fee_allowed boolean not null default false,
  status        text not null default 'not_connected'
                check (status in ('not_connected','pending_verification','test','live','disabled')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  primary key (center_id, processor)
);
create unique index if not exists center_payment_processors_one_default
  on app.center_payment_processors (center_id) where is_default;
comment on table app.center_payment_processors is
  'Online processors per organization (Stripe via Connect, PayPal via partner sign-up or a verified Business email). At most one default.';

create table if not exists app.center_payment_methods (
  center_id    uuid not null references app.centers(id) on delete cascade,
  method       app.payment_method not null
               check (method in ('check','cash','zelle','ach','stock','daf','matching_gift','other')),
  accepted     boolean not null default false,
  instructions jsonb not null default '{}'::jsonb check (jsonb_typeof(instructions) = 'object'),
  sort         int not null default 0,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  primary key (center_id, method)
);
comment on table app.center_payment_methods is
  'Offline methods an organization accepts, with the instructions members see (check payee + address, Zelle recipient, ACH/wire, stock, DAF/matching legal name + EIN).';

create table if not exists app.payment_checkouts (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  household_id  uuid references app.households(id),
  person_id     uuid references app.people(id),
  processor     text not null check (processor in ('stripe','paypal')),
  mode          text not null check (mode in ('test','live')),
  context       text not null check (context in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','processor_test')),
  amount_cents  bigint not null check (amount_cents between 50 and 100000000),
  currency      text not null default 'usd',
  pledge_ids    uuid[] not null default '{}',
  for_label     text not null check (char_length(for_label) between 1 and 200),
  status        text not null default 'created' check (status in ('created','pending','paid','failed','cancelled','expired')),
  provider_ref  text,            -- Stripe Checkout Session id / PayPal order id
  provider_payment_ref text,     -- Stripe PaymentIntent id / PayPal capture id
  checkout_url  text,
  payment_id    uuid references app.payments(id),
  error         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  paid_at       timestamptz,
  check ((context = 'processor_test') = (household_id is null))
);
create unique index if not exists payment_checkouts_provider_ref_idx
  on app.payment_checkouts (processor, provider_ref) where provider_ref is not null;
create index if not exists payment_checkouts_center_idx on app.payment_checkouts (center_id, created_at desc);
create index if not exists payment_checkouts_creator_idx on app.payment_checkouts (created_by, created_at desc);

create table if not exists app.payment_processor_tests (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  processor   text not null check (processor in ('stripe','paypal')),
  mode        text not null check (mode in ('test','live')),
  checkout_id uuid references app.payment_checkouts(id),
  charge_ref  text,
  refund_ref  text,
  ok          boolean not null,
  ran_by      uuid references auth.users(id),
  ran_at      timestamptz not null default now(),
  detail      text
);
create index if not exists payment_processor_tests_center_idx on app.payment_processor_tests (center_id, processor, mode, ran_at desc);

create table if not exists app.oauth_states (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  provider      text not null,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  nonce_hash    text not null,
  redirect_uri  text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 minutes',
  used_at       timestamptz
);
comment on table app.oauth_states is
  'Single-use connect states: the random nonce is only stored hashed; bound to the center, the user who started and the connection.';

create table if not exists app.paypal_email_verifications (
  center_id     uuid primary key references app.centers(id) on delete cascade,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  email         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  message_id    uuid,
  requested_by  uuid references auth.users(id),
  requested_at  timestamptz not null default now(),
  used_at       timestamptz
);

drop trigger if exists touch_center_payment_processors on app.center_payment_processors;
create trigger touch_center_payment_processors before update on app.center_payment_processors for each row execute function app.touch_updated_at();
drop trigger if exists touch_center_payment_methods on app.center_payment_methods;
create trigger touch_center_payment_methods before update on app.center_payment_methods for each row execute function app.touch_updated_at();
drop trigger if exists touch_payment_checkouts on app.payment_checkouts;
create trigger touch_payment_checkouts before update on app.payment_checkouts for each row execute function app.touch_updated_at();

-- Audit and modules.
insert into app.module_tables (table_name, module_key) values
  ('center_payment_processors', 'giving'), ('center_payment_methods', 'giving'), ('payment_checkouts', 'giving'),
  ('payment_processor_tests', 'giving'), ('oauth_states', null), ('paypal_email_verifications', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_center_payment_processors on app.center_payment_processors;
create trigger audit_center_payment_processors after insert or update or delete on app.center_payment_processors
  for each row execute function app.audit_row('center_id', 'processor');
drop trigger if exists audit_center_payment_methods on app.center_payment_methods;
create trigger audit_center_payment_methods after insert or update or delete on app.center_payment_methods
  for each row execute function app.audit_row('center_id', 'method');
drop trigger if exists audit_payment_checkouts on app.payment_checkouts;
create trigger audit_payment_checkouts after insert or update or delete on app.payment_checkouts
  for each row execute function app.audit_row();
drop trigger if exists audit_payment_processor_tests on app.payment_processor_tests;
create trigger audit_payment_processor_tests after insert or update or delete on app.payment_processor_tests
  for each row execute function app.audit_row();
drop trigger if exists audit_oauth_states on app.oauth_states;
create trigger audit_oauth_states after insert or update or delete on app.oauth_states
  for each row execute function app.audit_row();
drop trigger if exists audit_paypal_email_verifications on app.paypal_email_verifications;
create trigger audit_paypal_email_verifications after insert or update or delete on app.paypal_email_verifications
  for each row execute function app.audit_row('center_id');

-- RLS: read-only over the API; every write goes through the functions below.
alter table app.center_payment_processors enable row level security;
alter table app.center_payment_methods enable row level security;
alter table app.payment_checkouts enable row level security;
alter table app.payment_processor_tests enable row level security;
alter table app.oauth_states enable row level security;
alter table app.paypal_email_verifications enable row level security;

drop policy if exists center_payment_processors_read on app.center_payment_processors;
create policy center_payment_processors_read on app.center_payment_processors for select to authenticated
  using (app.payments_can_view(center_id));
drop policy if exists center_payment_methods_read on app.center_payment_methods;
create policy center_payment_methods_read on app.center_payment_methods for select to authenticated
  using (app.payments_can_view(center_id) or (accepted and app.is_member_of(center_id)));
drop policy if exists payment_checkouts_read on app.payment_checkouts;
create policy payment_checkouts_read on app.payment_checkouts for select to authenticated
  using (created_by = auth.uid() or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage')
         or app.payments_can_view(center_id));
drop policy if exists payment_processor_tests_read on app.payment_processor_tests;
create policy payment_processor_tests_read on app.payment_processor_tests for select to authenticated
  using (app.payments_can_view(center_id));
-- oauth_states and paypal_email_verifications: no policy, no grant — functions only.

do $$
declare t text; v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''giving''))::uuid[]))';
begin
  foreach t in array array['center_payment_processors','center_payment_methods','payment_checkouts','payment_processor_tests'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;

revoke all on app.center_payment_processors, app.center_payment_methods, app.payment_checkouts, app.payment_processor_tests,
  app.oauth_states, app.paypal_email_verifications from public, anon, authenticated;
grant select on app.center_payment_processors, app.center_payment_methods, app.payment_checkouts, app.payment_processor_tests to authenticated;

-- ── Small rules ──────────────────────────────────────────────────────────────
-- Online methods each processor can take (ONBOARDING_PLAN §1.2).
create or replace function app.processor_methods(p_processor text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case p_processor when 'stripe' then array['card','ach','apple_pay','google_pay']
                          when 'paypal' then array['paypal','venmo','card'] else '{}'::text[] end
$$;

-- Card-statement text: 5–22 characters, at least one letter, none of < > \ ' " * (Stripe's and PayPal's shared limits).
create or replace function app.statement_descriptor_problem(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p is null or btrim(p) = '' then null
    when char_length(btrim(p)) < 5 then 'The statement descriptor needs at least 5 characters.'
    when char_length(btrim(p)) > 22 then 'The statement descriptor can be at most 22 characters.'
    when btrim(p) !~ '[A-Za-z]' then 'The statement descriptor needs at least one letter.'
    when btrim(p) ~ '[<>\\''"*]' then 'The statement descriptor cannot contain < > \ '' " or *.'
    when btrim(p) !~ '^[ -~]+$' then 'The statement descriptor can use plain English letters, digits and punctuation only.'
    else null end
$$;

-- Which instructions each offline method needs before it can be accepted.
create or replace function app.payment_method_required_fields(p_method app.payment_method) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case p_method::text
    when 'check' then array['payee','address']
    when 'cash' then array['where']
    when 'zelle' then array['recipient']
    when 'ach' then array['details']
    when 'stock' then array['details']
    when 'daf' then array['legal_name','ein']
    when 'matching_gift' then array['legal_name','ein']
    else array['details'] end
$$;

create or replace function app.payment_method_instructions_problem(p_method app.payment_method, p jsonb) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare k text; v jsonb; f text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'The instructions must be a set of fields.'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z_]{1,30}$' then return format('"%s" is not an instructions field.', k); end if;
    if jsonb_typeof(v) not in ('string','null') then return format('The "%s" field must be text.', k); end if;
    if char_length(coalesce(v #>> '{}', '')) > 600 then return format('The "%s" field can be at most 600 characters.', k); end if;
  end loop;
  foreach f in array app.payment_method_required_fields(p_method) loop
    if nullif(btrim(coalesce(p->>f, '')), '') is null then
      return format('Fill in "%s" before accepting %s.', replace(f, '_', ' '), replace(p_method::text, '_', ' '));
    end if;
  end loop;
  if p_method in ('daf','matching_gift') and btrim(p->>'ein') !~ '^\d{2}-?\d{7}$' then
    return 'The EIN is 9 digits, written like 12-3456789.';
  end if;
  if p_method = 'zelle' and btrim(p->>'recipient') !~ '(^[^@\s]+@[^@\s]+\.[^@\s]+$)|(^\+?[0-9 ().-]{10,20}$)' then
    return 'The Zelle recipient is an email address or a US phone number.';
  end if;
  return null;
end $$;

-- The provider API mode a checkout uses: a sandbox (or an organization held to
-- test by Community Connect) is always test; a PayPal account is in PayPal's
-- live environment in production; Stripe follows the processor's own switch.
create or replace function app.payment_api_mode(p_center uuid, p_processor text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when c.environment = 'sandbox' or app.entitlement(c.id, 'payments.mode') = '"test"'::jsonb then 'test'
    when p_processor = 'paypal' then 'live'
    when (select status from app.center_payment_processors where center_id = c.id and processor = p_processor) = 'live' then 'live'
    else 'test' end
    from app.centers c where c.id = p_center
$$;

-- The processor row and its connection row, created when missing.
create or replace function app.payment_processor_ensure(p_center uuid, p_processor text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_conn uuid;
begin
  if p_processor not in ('stripe','paypal') then raise exception 'Choose Stripe or PayPal.' using errcode = '22023'; end if;
  insert into app.integration_connections (center_id, provider, status, display_name, settings)
  values (p_center, p_processor, 'disconnected', initcap(p_processor), jsonb_build_object('mode', 'test'))
  on conflict (center_id, provider) do nothing;
  select id into v_conn from app.integration_connections where center_id = p_center and provider = p_processor;
  insert into app.center_payment_processors (center_id, processor, connection_id, methods, updated_by)
  values (p_center, p_processor, v_conn, case p_processor when 'stripe' then array['card'] else array['paypal'] end, auth.uid())
  on conflict (center_id, processor) do update set connection_id = excluded.connection_id
    where app.center_payment_processors.connection_id is distinct from excluded.connection_id;
  return v_conn;
end $$;

create or replace function app.payments_require_reason(p_reason text, p_doing text) returns void
language plpgsql set search_path = app, public, extensions as $$
begin
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why you are going to %; the reason is kept in the audit log.', p_doing using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
end $$;

-- ── What Settings › Payments shows ───────────────────────────────────────────
create or replace function app.payment_settings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_procs jsonb; v_methods jsonb; v_tests jsonb; v_pending jsonb; v_payouts jsonb;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_view(p_center) then
    raise exception 'Seeing the payment settings needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  select coalesce(jsonb_agg(jsonb_build_object(
           'processor', p.p, 'status', coalesce(cp.status, 'not_connected'), 'is_default', coalesce(cp.is_default, false),
           'methods', coalesce(to_jsonb(cp.methods), '[]'::jsonb), 'statement_descriptor', cp.statement_descriptor,
           'donor_covers_fee_allowed', coalesce(cp.donor_covers_fee_allowed, false), 'updated_at', cp.updated_at,
           'api_mode', app.payment_api_mode(p_center, p.p),
           'connection', case when ic.id is null then null else jsonb_build_object(
               'id', ic.id, 'status', ic.status, 'external_account_id', ic.external_account_id, 'display_name', ic.display_name,
               'connected_at', ic.connected_at, 'last_error', ic.last_error,
               'mode', coalesce(ic.settings->>'mode', 'test'), 'connect_method', ic.settings->>'connect_method',
               'charges_enabled', ic.settings->'charges_enabled', 'paypal_email', ic.settings->>'paypal_email',
               'paypal_email_verified_at', ic.settings->>'paypal_email_verified_at') end,
           'last_job', (select jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'last_error', j.last_error,
                                                  'created_at', j.created_at, 'finished_at', j.finished_at)
                          from app.jobs j where j.center_id = p_center and j.kind = 'oauth.exchange'
                           and j.payload->>'connection_id' = ic.id::text order by j.id desc limit 1),
           'tests', (select coalesce(jsonb_agg(jsonb_build_object('mode', t.mode, 'ok', t.ok, 'ran_at', t.ran_at, 'detail', t.detail,
                                                                  'charge_ref', t.charge_ref, 'refund_ref', t.refund_ref)
                                               order by t.ran_at desc), '[]'::jsonb)
                       from (select * from app.payment_processor_tests t2 where t2.center_id = p_center and t2.processor = p.p
                              order by t2.ran_at desc limit 5) t),
           'test_pending', (select jsonb_build_object('checkout_id', k.id, 'status', k.status, 'mode', k.mode, 'created_at', k.created_at,
                                                      'checkout_url', k.checkout_url)
                              from app.payment_checkouts k where k.center_id = p_center and k.processor = p.p
                               and k.context = 'processor_test' and k.status in ('created','pending','paid')
                               and not exists (select 1 from app.payment_processor_tests t3 where t3.checkout_id = k.id)
                               and k.created_at > now() - interval '1 day'
                             order by k.created_at desc limit 1)
         ) order by p.ord), '[]'::jsonb)
    into v_procs
    from (values ('stripe', 1), ('paypal', 2)) p(p, ord)
    left join app.center_payment_processors cp on cp.center_id = p_center and cp.processor = p.p
    left join app.integration_connections ic on ic.center_id = p_center and ic.provider = p.p;

  select coalesce(jsonb_agg(jsonb_build_object('method', m.m, 'accepted', coalesce(pm.accepted, false),
                                               'instructions', coalesce(pm.instructions, '{}'::jsonb), 'sort', coalesce(pm.sort, m.ord),
                                               'required', to_jsonb(app.payment_method_required_fields(m.m::app.payment_method)),
                                               'updated_at', pm.updated_at) order by coalesce(pm.sort, m.ord), m.ord), '[]'::jsonb)
    into v_methods
    from (values ('check', 1), ('cash', 2), ('zelle', 3), ('ach', 4), ('stock', 5), ('daf', 6), ('matching_gift', 7)) m(m, ord)
    left join app.center_payment_methods pm on pm.center_id = p_center and pm.method = m.m::app.payment_method;

  select jsonb_build_object('email', v.email, 'expires_at', v.expires_at, 'requested_at', v.requested_at, 'attempts', v.attempts)
    into v_pending from app.paypal_email_verifications v
   where v.center_id = p_center and v.used_at is null and v.expires_at > now();

  select coalesce(jsonb_agg(jsonb_build_object('provider', po.provider, 'provider_ref', po.provider_ref, 'gross_cents', po.gross_cents,
                                               'fee_cents', po.fee_cents, 'net_cents', po.net_cents, 'arrives_on', po.arrives_on,
                                               'matched', po.matched) order by po.arrives_on desc nulls last, po.created_at desc), '[]'::jsonb)
    into v_payouts
    from (select * from app.payouts where center_id = p_center and provider in ('stripe','paypal')
           order by arrives_on desc nulls last, created_at desc limit 10) po;

  return jsonb_build_object(
    'environment', c.environment,
    'forced_test', c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb,
    'offline_only', coalesce((c.rules #>> '{payments,offline_only}')::boolean, false),
    'processors', v_procs,
    'methods', v_methods,
    'paypal_email_pending', v_pending,
    'payouts', v_payouts,
    'messaging_available', to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is not null,
    'can_configure', app.payments_can_configure(p_center),
    'can_connect', app.payments_can_connect(p_center));
end $$;

-- ── Online processor settings ────────────────────────────────────────────────
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

create or replace function app.set_default_payment_processor(p_center uuid, p_processor text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_status text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Choosing the default processor needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_processor is not null then
    select status into v_status from app.center_payment_processors where center_id = p_center and processor = p_processor;
    if v_status is null or v_status not in ('test','live') then
      raise exception 'Connect % before making it the default.', initcap(p_processor) using errcode = '22023';
    end if;
  end if;
  perform app.payments_require_reason(p_reason, 'change the default processor');
  update app.center_payment_processors set is_default = false, updated_by = auth.uid()
   where center_id = p_center and is_default and processor is distinct from p_processor;
  if p_processor is not null then
    update app.center_payment_processors set is_default = true, updated_by = auth.uid()
     where center_id = p_center and processor = p_processor and not is_default;
  end if;
end $$;

-- Test or live. Live is refused in a sandbox (CCENT) and needs a fresh 2FA check.
create or replace function app.set_payment_mode(p_center uuid, p_processor text, p_mode text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare cp app.center_payment_processors; ic app.integration_connections;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Switching a processor between test and live needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  if p_mode not in ('test','live') then raise exception 'The mode is test or live.' using errcode = '22023'; end if;
  select * into cp from app.center_payment_processors where center_id = p_center and processor = p_processor;
  if cp.status is null or cp.status not in ('test','live') then
    raise exception 'Connect % before choosing test or live.', initcap(coalesce(p_processor, 'the processor')) using errcode = '22023';
  end if;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if p_mode = 'live' then
    perform app.assert_entitlement(p_center, 'payments.mode', '"live"'::jsonb);
    if p_processor = 'stripe' and ic.settings->'charges_enabled' = 'false'::jsonb then
      raise exception 'Stripe has not finished verifying this account yet, so it cannot take live payments. Finish the steps in your Stripe dashboard, then try again.'
        using errcode = '22023';
    end if;
    perform app.assert_step_up('payments.live');
  end if;
  perform app.payments_require_reason(p_reason, 'switch ' || initcap(p_processor) || ' to ' || p_mode || ' mode');
  update app.integration_connections set settings = settings || jsonb_build_object('mode', p_mode) where id = ic.id;
  update app.center_payment_processors set status = p_mode, updated_by = auth.uid()
   where center_id = p_center and processor = p_processor and status is distinct from p_mode;
end $$;

-- ── Connecting (Stripe Connect OAuth; PayPal partner sign-up) ────────────────
-- Returns the connect state "<id>.<nonce>" the portal puts in the provider's
-- redirect; only the nonce's hash is stored. Step-up: this starts a credential change.
create or replace function app.begin_payment_connect(p_center uuid, p_processor text, p_redirect_uri text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_conn uuid; v_nonce text := encode(gen_random_bytes(24), 'hex'); v_state uuid;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Connecting a payment account needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  if p_processor not in ('stripe','paypal') then raise exception 'Choose Stripe or PayPal.' using errcode = '22023'; end if;
  if p_redirect_uri is not null and p_redirect_uri !~ '^https?://[^\s]+$' then
    raise exception 'The return address must be a web address.' using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.connect');
  perform app.payments_require_reason(p_reason, 'connect ' || initcap(p_processor));
  v_conn := app.payment_processor_ensure(p_center, p_processor);
  update app.center_payment_processors set status = 'pending_verification', updated_by = auth.uid()
   where center_id = p_center and processor = p_processor and status in ('not_connected','disabled');
  -- Earlier unfinished states for this connection stop working.
  update app.oauth_states set used_at = now() where connection_id = v_conn and used_at is null;
  insert into app.oauth_states (center_id, provider, connection_id, user_id, nonce_hash, redirect_uri)
  values (p_center, p_processor, v_conn, auth.uid(), encode(digest(v_nonce, 'sha256'), 'hex'), p_redirect_uri)
  returning id into v_state;
  return jsonb_build_object('state', v_state::text || '.' || v_nonce, 'connection_id', v_conn,
                            'mode', app.payment_api_mode(p_center, p_processor),
                            'environment', (select environment from app.centers where id = p_center));
end $$;

-- The provider sent the person back with a code (Stripe) or merchant id
-- (PayPal): check the state, keep the code in the vault as "oauth.code", and
-- queue oauth.exchange. The code never goes in a job payload or a log.
create or replace function app.oauth_store_code(p_state text, p_code text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_nonce text; s app.oauth_states; sec app.integration_secrets; v_vault uuid; v_job bigint;
begin
  if p_state is null or p_state !~ '^[0-9a-f-]{36}\.[0-9a-f]{48}$' then
    raise exception 'That connect link is not valid. Start connecting again from Settings › Payments.' using errcode = '22023';
  end if;
  v_id := split_part(p_state, '.', 1)::uuid;
  v_nonce := split_part(p_state, '.', 2);
  select * into s from app.oauth_states where id = v_id for update;
  if s.id is null or s.nonce_hash <> encode(digest(v_nonce, 'sha256'), 'hex') then
    raise exception 'That connect link is not valid. Start connecting again from Settings › Payments.' using errcode = '22023';
  end if;
  if s.user_id is distinct from auth.uid() then
    raise exception 'This connection was started by someone else. Sign in as that person, or start again.' using errcode = '42501';
  end if;
  if s.used_at is not null then
    raise exception 'That connect link was already used. Start connecting again from Settings › Payments.' using errcode = '22023';
  end if;
  if s.expires_at < now() then
    raise exception 'That connect link expired (they last 30 minutes). Start connecting again from Settings › Payments.' using errcode = '22023';
  end if;
  if p_code is null or char_length(btrim(p_code)) < 8 or char_length(p_code) > 4000 then
    raise exception 'The provider did not send back a usable authorization. Start connecting again.' using errcode = '22023';
  end if;
  perform app.assert_module_enabled(s.center_id, 'giving');
  perform app.set_audit_context('Connecting ' || initcap(s.provider) || ': authorization received');
  update app.oauth_states set used_at = now() where id = s.id;

  select * into sec from app.integration_secrets where connection_id = s.connection_id and name = 'oauth.code' for update;
  if sec.id is not null then
    perform vault.update_secret(sec.vault_secret_id, btrim(p_code));
    update app.integration_secrets set fingerprint = right(btrim(p_code), 4), set_by = auth.uid(), set_at = now(), rotated_at = now()
     where id = sec.id;
  else
    v_vault := vault.create_secret(btrim(p_code), 'connect/' || s.connection_id || '/oauth.code',
                                   'Community Connect ' || s.provider || ' authorization code');
    insert into app.integration_secrets (center_id, connection_id, name, vault_secret_id, fingerprint, set_by)
    values (s.center_id, s.connection_id, 'oauth.code', v_vault, right(btrim(p_code), 4), auth.uid());
  end if;
  update app.integration_connections
     set settings = settings || jsonb_build_object('connect_method', case s.provider when 'paypal' then 'partner' else 'oauth' end,
                                                   'connecting_user', auth.uid()),
         last_error = null
   where id = s.connection_id;
  v_job := app.enqueue_job(s.center_id, 'oauth.exchange',
                           jsonb_build_object('provider', s.provider, 'connection_id', s.connection_id, 'code_secret', 'oauth.code',
                                              'redirect_uri', s.redirect_uri,
                                              'mode', app.payment_api_mode(s.center_id, s.provider)), now(), 5);
  return jsonb_build_object('center_id', s.center_id, 'provider', s.provider, 'connection_id', s.connection_id, 'job_id', v_job);
end $$;

-- ── PayPal Business email, verified by a 6-digit code ────────────────────────
create or replace function app.start_paypal_email_verification(p_center uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_email text := lower(btrim(p_email)); v_conn uuid; v_code text; v_msg uuid; v_center app.centers;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Connecting PayPal needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter the PayPal Business account''s email address.' using errcode = '22023';
  end if;
  if exists (select 1 from app.paypal_email_verifications where center_id = p_center and used_at is null
               and requested_at > now() - interval '60 seconds') then
    raise exception 'A code was sent less than a minute ago. Wait a minute before asking for another.' using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.connect');
  select * into v_center from app.centers where id = p_center;
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    -- The messaging service (o-messaging) is not in this database yet: nothing can be sent, so no code is made.
    raise log 'o-payments: app.enqueue_message is missing; the PayPal email code for center % was not sent', p_center;
    return jsonb_build_object('sent', false, 'reason', 'messaging_unavailable');
  end if;
  perform app.set_audit_context('PayPal Business email: verification code sent to ' || v_email);
  v_conn := app.payment_processor_ensure(p_center, 'paypal');
  v_code := lpad((((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000))::text, 6, '0');
  execute 'select app.enqueue_message($1, $2, $3, $4, $5, $6)' into v_msg
    using p_center, 'email', v_email, 'paypal_email_code',
          jsonb_build_object('code', v_code, 'organization', coalesce(v_center.short_name, v_center.name), 'minutes', 15),
          'verification_code';
  insert into app.paypal_email_verifications (center_id, connection_id, email, code_hash, expires_at, attempts, message_id, requested_by, requested_at, used_at)
  values (p_center, v_conn, v_email, encode(digest(v_code || ':' || p_center::text, 'sha256'), 'hex'), now() + interval '15 minutes', 0, v_msg,
          auth.uid(), now(), null)
  on conflict (center_id) do update set connection_id = excluded.connection_id, email = excluded.email, code_hash = excluded.code_hash,
    expires_at = excluded.expires_at, attempts = 0, message_id = excluded.message_id, requested_by = excluded.requested_by,
    requested_at = excluded.requested_at, used_at = null;
  update app.center_payment_processors set status = 'pending_verification', updated_by = auth.uid()
   where center_id = p_center and processor = 'paypal' and status in ('not_connected','disabled');
  return jsonb_build_object('sent', true, 'email', v_email, 'expires_at', now() + interval '15 minutes', 'message_id', v_msg);
end $$;

-- Returns {ok, detail}: a wrong code is counted (5 tries), not raised, so the count sticks.
create or replace function app.confirm_paypal_email(p_center uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.paypal_email_verifications;
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

-- Disconnect: nothing is deleted. The connection is marked disconnected and the
-- processor stops taking payments; stored tokens stay in the vault until the
-- owner removes them (Settings › Integrations), so the history keeps its trail.
create or replace function app.disconnect_payment_processor(p_center uuid, p_processor text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare cp app.center_payment_processors;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Disconnecting a payment account needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  select * into cp from app.center_payment_processors where center_id = p_center and processor = p_processor;
  if cp.center_id is null or cp.status = 'not_connected' then
    raise exception '% is not connected.', initcap(coalesce(p_processor, 'That processor')) using errcode = '22023';
  end if;
  perform app.assert_step_up('payments.disconnect');
  perform app.payments_require_reason(p_reason, 'disconnect ' || initcap(p_processor));
  update app.integration_connections set status = 'disconnected' where id = cp.connection_id;
  update app.oauth_states set used_at = now() where connection_id = cp.connection_id and used_at is null;
  update app.center_payment_processors set status = 'not_connected', is_default = false, updated_by = auth.uid()
   where center_id = p_center and processor = p_processor;
end $$;

-- ── Offline methods ──────────────────────────────────────────────────────────
create or replace function app.set_payment_method(p_center uuid, p_method app.payment_method, p_accepted boolean, p_instructions jsonb,
                                                  p_sort int, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_problem text; v_clean jsonb;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing the accepted payment methods needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_method::text not in ('check','cash','zelle','ach','stock','daf','matching_gift') then
    raise exception 'Online methods are set on the Stripe or PayPal card; this list is for offline methods.' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(k, btrim(v #>> '{}')) filter (where nullif(btrim(coalesce(v #>> '{}', '')), '') is not null), '{}'::jsonb)
    into v_clean from jsonb_each(coalesce(p_instructions, '{}'::jsonb)) as e(k, v) where jsonb_typeof(v) = 'string';
  if jsonb_typeof(coalesce(p_instructions, '{}'::jsonb)) <> 'object' then
    raise exception 'The instructions must be a set of fields.' using errcode = '22023';
  end if;
  -- Shape (field names, text, length) always; the required fields only when accepting.
  v_problem := app.payment_method_instructions_problem(p_method, v_clean);
  if v_problem is not null and (coalesce(p_accepted, false) or v_problem !~ '^Fill in') then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'change how members pay by ' || replace(p_method::text, '_', ' '));
  insert into app.center_payment_methods (center_id, method, accepted, instructions, sort, updated_by)
  values (p_center, p_method, coalesce(p_accepted, false), v_clean, coalesce(p_sort, 0), auth.uid())
  on conflict (center_id, method) do update set accepted = excluded.accepted, instructions = excluded.instructions,
    sort = coalesce(p_sort, app.center_payment_methods.sort), updated_by = excluded.updated_by;
end $$;

-- "Offline only" (O13): going live without card payments is allowed.
create or replace function app.set_payments_offline_only(p_center uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Choosing offline-only payments needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  perform app.payments_require_reason(p_reason, case when p_on then 'take offline payments only' else 'take online payments too' end);
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
                           coalesce(rules->'payments', '{}'::jsonb) || jsonb_build_object('offline_only', coalesce(p_on, false)))
   where id = p_center;
end $$;

-- ── What members see ─────────────────────────────────────────────────────────
-- Online: the default processor (or the only one) when it may take member
-- payments: live in production; test or live in a sandbox (always charged in
-- test mode there). Offline: the accepted methods with their instructions.
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
  select coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'instructions', m.instructions) order by m.sort, m.method), '[]'::jsonb)
    into v_offline from app.center_payment_methods m where m.center_id = p_center and m.accepted;
  return jsonb_build_object('online', v_online, 'online_unavailable', v_reason, 'offline', v_offline, 'environment', c.environment);
end $$;

-- ── Checkouts ────────────────────────────────────────────────────────────────
-- Called by the portal's server route (src/app/api/payments/intent) with the
-- member's (or staff member's) own session. Returns what the route needs to
-- ask the provider for a checkout; the route then calls app.attach_checkout.
create or replace function app.create_checkout(p_center uuid, p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[],
                                               p_processor text, p_context text, p_for_label text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; v_id uuid; v_mode text; v_forced boolean;
        v_staff boolean; v_bad int; v_pledges uuid[] := coalesce(p_pledge_ids, '{}');
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
  if coalesce(p_context, '') not in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal') then
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

  select * into cp from app.center_payment_processors
   where center_id = p_center and status in ('test','live') and (p_processor is null or processor = p_processor)
   order by is_default desc, (status = 'live') desc, processor limit 1;
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
  insert into app.payment_checkouts (center_id, household_id, person_id, processor, mode, context, amount_cents, currency,
                                     pledge_ids, for_label, created_by)
  values (p_center, p_household, app.my_person_id(p_center), cp.processor, v_mode, p_context, p_amount_cents, lower(coalesce(c.currency, 'usd')),
          v_pledges, left(btrim(p_for_label), 200), auth.uid())
  returning id into v_id;
  return jsonb_build_object('checkout_id', v_id, 'processor', cp.processor, 'mode', v_mode, 'amount_cents', p_amount_cents,
                            'currency', lower(coalesce(c.currency, 'usd')), 'account_id', ic.external_account_id,
                            'payee_email', case when ic.settings->>'connect_method' = 'email' then ic.settings->>'paypal_email' end,
                            'statement_descriptor', cp.statement_descriptor, 'methods', to_jsonb(cp.methods),
                            'center_name', c.name, 'for_label', left(btrim(p_for_label), 200));
end $$;

-- The $1 test: a checkout with no family; its payment is refunded automatically
-- and recorded only in payment_processor_tests, never as a gift.
create or replace function app.create_processor_test_checkout(p_center uuid, p_processor text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; v_id uuid; v_mode text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_connect(p_center) then
    raise exception 'Running the $1 test needs the organization owner or integrations.manage.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  select * into cp from app.center_payment_processors where center_id = p_center and processor = p_processor;
  if cp.status is null or cp.status not in ('test','live') then
    raise exception 'Connect % before running the $1 test.', initcap(coalesce(p_processor, 'the processor')) using errcode = '22023';
  end if;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if ic.status <> 'connected' then raise exception '% is not connected right now.', initcap(p_processor) using errcode = '22023'; end if;
  v_mode := app.payment_api_mode(p_center, p_processor);
  if v_mode = 'live' then perform app.assert_step_up('payments.live_test'); end if;
  perform app.set_audit_context('$1 ' || v_mode || ' test of ' || initcap(p_processor));
  insert into app.payment_checkouts (center_id, household_id, person_id, processor, mode, context, amount_cents, currency, for_label, created_by)
  values (p_center, null, app.my_person_id(p_center), p_processor, v_mode, 'processor_test', 100, lower(coalesce(c.currency, 'usd')),
          'Community Connect $1 test (refunded automatically)', auth.uid())
  returning id into v_id;
  return jsonb_build_object('checkout_id', v_id, 'processor', p_processor, 'mode', v_mode, 'amount_cents', 100,
                            'currency', lower(coalesce(c.currency, 'usd')), 'account_id', ic.external_account_id,
                            'payee_email', case when ic.settings->>'connect_method' = 'email' then ic.settings->>'paypal_email' end,
                            'statement_descriptor', cp.statement_descriptor, 'methods', to_jsonb(cp.methods),
                            'center_name', c.name, 'for_label', 'Community Connect $1 test (refunded automatically)');
end $$;

create or replace function app.attach_checkout(p_checkout uuid, p_provider_ref text, p_checkout_url text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if nullif(btrim(p_provider_ref), '') is null or p_checkout_url !~ '^https?://' then
    raise exception 'The provider did not return a checkout.' using errcode = '22023';
  end if;
  update app.payment_checkouts set provider_ref = btrim(p_provider_ref), checkout_url = p_checkout_url, status = 'pending'
   where id = p_checkout and created_by = auth.uid() and status = 'created';
  if not found then raise exception 'That checkout was not found, or it already started.' using errcode = '22023'; end if;
end $$;

create or replace function app.fail_checkout(p_checkout uuid, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.payment_checkouts set status = 'failed', error = left(coalesce(p_error, 'The provider refused the checkout.'), 1000)
   where id = p_checkout and created_by = auth.uid() and status in ('created','pending');
end $$;

create or replace function app.checkout_status(p_checkout uuid)
returns jsonb language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('checkout_id', k.id, 'status', k.status, 'processor', k.processor, 'mode', k.mode,
                            'amount_cents', k.amount_cents, 'payment_id', k.payment_id, 'error', k.error, 'paid_at', k.paid_at,
                            'receipt_number', (select receipt_number from app.payments where id = k.payment_id))
    from app.payment_checkouts k
   where k.id = p_checkout
     and (k.created_by = auth.uid() or app.has_permission(k.center_id, 'giving.view') or app.payments_can_view(k.center_id))
$$;

-- ── Refunds through the provider (the existing two-person refund path) ───────
-- A card or PayPal payment is refunded by the provider, not recorded by hand:
-- once the refund was requested (refund_approved_by, refund_requested_cents)
-- and approved by a second, different person (app.approve_as_second), this
-- queues payments.refund. The worker asks the provider and then records it
-- exactly as a hand-recorded refund is recorded (0212).
create or replace function app.request_provider_refund(p_payment uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_job bigint;
begin
  select * into p from app.payments where id = p_payment;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p.center_id, 'giving');
  if not app.has_permission(p.center_id, 'giving.manage') then
    raise exception 'Refunding a payment needs giving.manage.' using errcode = '42501';
  end if;
  if coalesce(p.provider, '') not in ('stripe','paypal') then
    raise exception 'This payment was not taken online; record its refund by hand instead.' using errcode = '22023';
  end if;
  if p.refund_approved_by is null or p.refund_second_approver is null or p.refund_approved_by = p.refund_second_approver then
    raise exception 'A refund needs two different approvers: request it, then a second person with giving.approve approves it.'
      using errcode = '22023';
  end if;
  if coalesce(p.refund_requested_cents, 0) <= 0 or p.refund_requested_cents > p.amount_cents - p.refunded_cents then
    raise exception 'The requested refund is more than what is left on this payment.' using errcode = '22023';
  end if;
  if exists (select 1 from app.jobs where kind = 'payments.refund' and status in ('queued','running') and payload->>'payment_id' = p.id::text) then
    raise exception 'A refund of this payment is already on its way to %.', initcap(p.provider) using errcode = '22023';
  end if;
  perform app.assert_step_up('giving.refund');
  perform app.payments_require_reason(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 'refund through ' || initcap(p.provider));
  v_job := app.enqueue_job(p.center_id, 'payments.refund',
                           jsonb_build_object('payment_id', p.id, 'amount_cents', p.refund_requested_cents,
                                              'refunded_before', p.refunded_cents, 'provider', p.provider), now(), 5);
  return v_job;
end $$;

-- "Sync payouts now" (the worker also syncs every connected Stripe account daily).
create or replace function app.request_payout_sync(p_center uuid)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Syncing payouts needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if exists (select 1 from app.jobs where center_id = p_center and kind = 'payments.sync_payouts' and status in ('queued','running')) then
    raise exception 'A payout sync is already waiting to run.' using errcode = '22023';
  end if;
  return app.enqueue_job(p_center, 'payments.sync_payouts', jsonb_build_object('center_id', p_center), now(), 3);
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.payments_can_view(uuid), app.payments_can_configure(uuid), app.payments_can_connect(uuid),
  app.processor_methods(text), app.statement_descriptor_problem(text), app.payment_method_required_fields(app.payment_method),
  app.payment_method_instructions_problem(app.payment_method, jsonb), app.payment_api_mode(uuid, text),
  app.payment_processor_ensure(uuid, text), app.payments_require_reason(text, text), app.payment_settings(uuid),
  app.set_payment_processor(uuid, text, text[], text, boolean, text), app.set_default_payment_processor(uuid, text, text),
  app.set_payment_mode(uuid, text, text, text), app.begin_payment_connect(uuid, text, text, text), app.oauth_store_code(text, text),
  app.start_paypal_email_verification(uuid, text), app.confirm_paypal_email(uuid, text),
  app.disconnect_payment_processor(uuid, text, text),
  app.set_payment_method(uuid, app.payment_method, boolean, jsonb, int, text), app.set_payments_offline_only(uuid, boolean, text),
  app.member_payment_options(uuid), app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text),
  app.create_processor_test_checkout(uuid, text), app.attach_checkout(uuid, text, text), app.fail_checkout(uuid, text),
  app.checkout_status(uuid), app.request_provider_refund(uuid, text), app.request_payout_sync(uuid)
  from public, anon;
revoke execute on function app.payment_processor_ensure(uuid, text), app.payments_require_reason(text, text) from authenticated;
grant execute on function app.payments_can_view(uuid), app.payments_can_configure(uuid), app.payments_can_connect(uuid),
  app.processor_methods(text), app.statement_descriptor_problem(text), app.payment_method_required_fields(app.payment_method),
  app.payment_method_instructions_problem(app.payment_method, jsonb), app.payment_api_mode(uuid, text), app.payment_settings(uuid),
  app.set_payment_processor(uuid, text, text[], text, boolean, text), app.set_default_payment_processor(uuid, text, text),
  app.set_payment_mode(uuid, text, text, text), app.begin_payment_connect(uuid, text, text, text), app.oauth_store_code(text, text),
  app.start_paypal_email_verification(uuid, text), app.confirm_paypal_email(uuid, text),
  app.disconnect_payment_processor(uuid, text, text),
  app.set_payment_method(uuid, app.payment_method, boolean, jsonb, int, text), app.set_payments_offline_only(uuid, boolean, text),
  app.member_payment_options(uuid), app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text),
  app.create_processor_test_checkout(uuid, text), app.attach_checkout(uuid, text, text), app.fail_checkout(uuid, text),
  app.checkout_status(uuid), app.request_provider_refund(uuid, text), app.request_payout_sync(uuid)
  to authenticated;
