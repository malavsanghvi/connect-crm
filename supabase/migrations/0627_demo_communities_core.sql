-- Demo communities (B88) · 1 of 3: the machinery. Two demo organizations, made of invented people, that anyone on the
-- Community Connect team can show, and that start over every night. Nothing here is JSH data and nothing here can be
-- reached by a member: every function below is for the platform team or the background service, and no policy or grant
-- of an existing object is changed.
--
--   app.demo_packs.content            a pack as DATA (steps, rows, personas); loaded by app.demo_load_pack (0629)
--   app.is_demo_center(c)             the flag (centers.rules.demo = true) the guardrails read
--   app.demo_personas                 one demo person per role of the kind's role catalog: e-mail on the reserved domain
--                                     demo.weaverams.org, role, scope and a one-sentence story. LOGIN-LESS: no sign-in and
--                                     no role grant exists yet (the session endpoint and role switcher are a later pull request)
--   app.demo_resolve / demo_put / demo_apply_ops
--                                     the small loader that turns a pack's rows into real rows (a table name and its
--                                     columns; "@ref" = a stable id for this community, "+9d" = nine days from today,
--                                     "+9d@10:00" = then, in the community's time zone)
--   app.demo_pay_ex / demo_op_rsvp / demo_op_order
--                                     the three things a plain insert cannot do: a payment allocated to pledges, an RSVP
--                                     with a ticket per person, a store order that moves through its statuses
--   guardrails                        a demo community takes payments in TEST mode only (a processor cannot be set to
--                                     live, and the API mode of a demo community is always test); messages are refused by
--                                     the worker (worker/src/messaging.ts)
--
-- Existing machinery reused, not forked: app.demo_packs (catalog), app.center_demo_state (what is loaded),
-- app.demo_clear_center (the one place that deletes a sandbox's data, with its sandbox-only guard), app.demo_id,
-- app.demo_today / demo_at / demo_h / demo_p (0312). The new packs are NOT offered on Setup > Demo (active = false).
set client_min_messages = warning;

-- ── The catalog carries the pack's content ───────────────────────────────────
alter table app.demo_packs add column if not exists content jsonb;
alter table app.demo_packs drop constraint if exists demo_packs_content_object;
alter table app.demo_packs add constraint demo_packs_content_object check (content is null or jsonb_typeof(content) = 'object');
comment on column app.demo_packs.content is
  'A demo community pack as data (B88): {center: {...}, order: [step keys], steps: {key: [ops]}, personas: [...]}. Loaded in one transaction by app.demo_load_pack. Null for the older "community" pack, whose steps are functions (0312).';

-- ── The reserved e-mail domain and the flag ──────────────────────────────────
-- Every demo community person has an address on a domain nobody receives mail on.
create or replace function app.demo_persona_domain() returns text
language sql immutable set search_path = app, public, extensions as $$ select 'demo.weaverams.org'::text $$;

-- True for a community flagged as a demo community (rules.demo = true). The flag is set only by app.create_demo_community.
create or replace function app.is_demo_center(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select c.rules->'demo' = 'true'::jsonb from app.centers c where c.id = p_center), false)
$$;

-- ── Demo personas ────────────────────────────────────────────────────────────
create table if not exists app.demo_personas (
  id           uuid primary key,
  center_id    uuid not null references app.centers(id) on delete cascade,
  role_key     text not null references app.roles(key),
  display_name text not null check (btrim(display_name) <> ''),
  headline     text not null check (btrim(headline) <> ''),
  story        text not null check (btrim(story) <> ''),
  email        text not null check (email = lower(email) and email like '%@demo.weaverams.org'),
  person_id    uuid not null references app.people(id) on delete cascade,
  household_id uuid references app.households(id) on delete set null,
  scope_kind   app.scope_kind not null default 'center',
  scope_id     uuid,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (center_id, role_key),
  unique (email)
);
create index if not exists demo_personas_center on app.demo_personas (center_id, sort_order);
comment on table app.demo_personas is
  'One demo person per role of a demo community''s role catalog (B88). Login-less: no sign-in and no role grant exists for a persona yet. role_key + scope_kind + scope_id are the role assignment the later session endpoint will grant. Rebuilt with the community every night; ids are stable (app.demo_id(center, ''persona:<role>'')).';
comment on column app.demo_personas.story is 'One sentence, in plain words: who this person is and what their role can do.';
alter table app.demo_personas enable row level security;
drop policy if exists demo_personas_read on app.demo_personas;
create policy demo_personas_read on app.demo_personas for select to authenticated using (app.is_platform_admin());
revoke all on app.demo_personas from anon;
revoke insert, update, delete, truncate on app.demo_personas from authenticated;
grant select on app.demo_personas to authenticated;
grant all on app.demo_personas to service_role;
drop trigger if exists audit_demo_personas on app.demo_personas;
create trigger audit_demo_personas after insert or update or delete on app.demo_personas
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('demo_personas', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The loader: a pack's rows become real rows ───────────────────────────────
-- "@center" the community, "@actor" the person who loaded it, "@<ref>" a stable id for <ref> in this community,
-- "+9d" / "-30d" a date relative to today, "+9d@10:00" a moment relative to today (the community's time zone). Strings
-- inside arrays are resolved the same way; anything else is kept as it is.
create or replace function app.demo_resolve(p_val jsonb, p_center uuid, p_seed uuid, p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare s text; m text[];
begin
  if p_val is null then return null; end if;
  if jsonb_typeof(p_val) = 'array' then
    return coalesce((select jsonb_agg(coalesce(app.demo_resolve(e.value, p_center, p_seed, p_actor), 'null'::jsonb) order by e.ord)
                       from jsonb_array_elements(p_val) with ordinality e(value, ord)), '[]'::jsonb);
  end if;
  if jsonb_typeof(p_val) <> 'string' then return p_val; end if;
  s := p_val #>> '{}';
  if s = '@center' then return to_jsonb(p_center); end if;
  if s = '@actor' then return case when p_actor is null then 'null'::jsonb else to_jsonb(p_actor) end; end if;
  if s like '@_%' then return to_jsonb(app.demo_id(p_seed, substr(s, 2))); end if;
  m := regexp_match(s, '^([+-][0-9]+)d$');
  if m is not null then return to_jsonb((app.demo_today(p_center) + m[1]::int)::text); end if;
  m := regexp_match(s, '^([+-][0-9]+)d@([0-9]{2}:[0-9]{2})$');
  if m is not null then return to_jsonb(app.demo_at(p_center, m[1]::int, m[2]::time)::text); end if;
  return p_val;
end $$;

-- Insert one row. The columns are the row's keys (so a column the pack leaves out gets its default); center_id is added
-- when the table has one. A failure names the table and the row.
create or replace function app.demo_put(p_table text, p_row jsonb, p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_row jsonb; v_cols text; v_reg regclass;
begin
  if coalesce(p_table, '') !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Demo pack: there is no table "%".', p_table;
  end if;
  v_reg := to_regclass('app.' || quote_ident(p_table));
  if v_reg is null then raise exception 'Demo pack: there is no table "%".', p_table; end if;
  select coalesce(jsonb_object_agg(e.key, coalesce(app.demo_resolve(e.value, p_center, p_seed, p_actor), 'null'::jsonb)), '{}'::jsonb)
    into v_row from jsonb_each(p_row) e;
  if not (v_row ? 'center_id') and exists (select 1 from pg_attribute a where a.attrelid = v_reg and a.attname = 'center_id' and not a.attisdropped) then
    v_row := v_row || jsonb_build_object('center_id', p_center);
  end if;
  select string_agg(quote_ident(k), ', ' order by k) into v_cols from jsonb_object_keys(v_row) k;
  begin
    execute format('insert into app.%1$I (%2$s) select %2$s from jsonb_populate_record(null::app.%1$I, $1)', p_table, v_cols) using v_row;
  exception when others then
    raise exception 'Demo pack: could not add a row to %: % (row: %)', p_table, sqlerrm, left(p_row::text, 240) using errcode = sqlstate;
  end;
end $$;

-- A payment, recorded as history (never queued for QuickBooks) and allocated by the existing rule (the chosen pledges,
-- or the earliest open pledge first). p_provider 'stripe' with a "pi_test_…" reference is a TEST-mode card payment.
create or replace function app.demo_pay_ex(p_center uuid, p_seed uuid, p_actor uuid, p_ref text, p_household text, p_payer text,
                                           p_amount bigint, p_method app.payment_method, p_days_ago int, p_pledges uuid[],
                                           p_check text, p_memo text, p_provider text, p_provider_ref text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v uuid := app.demo_id(p_seed, 'pay:' || p_ref);
begin
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, provider, provider_ref, status, check_number,
                            received_on, recorded_by, memo, is_historical, crm_external_id)
  values (v, p_center, app.demo_h(p_seed, p_household), app.demo_p(p_seed, p_payer), p_amount, p_method, coalesce(p_provider, 'offline'), p_provider_ref,
          'settled', p_check, app.demo_today(p_center) - p_days_ago, p_actor, coalesce(p_memo, 'Demo data'), true, 'demo:' || p_ref);
  perform app.allocate_payment(v, p_pledges, true);
  update app.pledges pl set closed_at = (app.demo_today(p_center) - p_days_ago)::timestamp + time '12:00'
   where pl.id in (select a.pledge_id from app.payment_allocations a where a.payment_id = v) and pl.status = 'paid';
  return v;
end $$;

-- An RSVP of a household with a ticket for every person in it. status: confirmed, rsvpd, cancelled, attended, no_show.
create or replace function app.demo_op_rsvp(p_center uuid, p_seed uuid, o jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ev uuid := app.demo_id(p_seed, o->>'event'); v_hh uuid := app.demo_h(p_seed, o->>'household'); v_st text := o->>'status';
        v_rsvp uuid := app.demo_id(p_seed, 'rsvp:' || (o->>'event') || ':' || (o->>'household')); v_starts timestamptz; hm record;
begin
  select e.starts_at into v_starts from app.events e where e.id = v_ev;
  insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source, commitment_mode, confirmed_at, cancelled_at)
  select v_rsvp, p_center, v_ev, v_hh, m.person_id,
         (case v_st when 'attended' then 'confirmed' when 'no_show' then 'confirmed' else v_st end)::app.rsvp_status,
         'app', 'none',
         case when v_st in ('confirmed','attended','no_show') then now() - interval '1 day' end,
         case when v_st = 'cancelled' then now() - interval '3 days' end
    from app.household_members m where m.household_id = v_hh and m.is_primary;
  for hm in
    select p.id, p.first_name || ' ' || p.last_name as name, p.date_of_birth
      from app.household_members m join app.people p on p.id = m.person_id
     where m.household_id = v_hh order by m.is_primary desc, p.date_of_birth
  loop
    insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, is_senior, status, ticket_revoked,
                               checked_in_at, checked_in_station)
    values (p_center, v_ev, v_rsvp, hm.id, hm.name, hm.date_of_birth > app.demo_today(p_center) - interval '12 years',
            hm.date_of_birth < app.demo_today(p_center) - interval '65 years', v_st::app.rsvp_status, v_st = 'cancelled',
            case when v_st = 'attended' then v_starts - interval '20 minutes' end, case when v_st = 'attended' then 'entry' end);
  end loop;
end $$;

-- A store order that leaves the cart and moves on: the database prices it, counts the pickup and takes the stock.
-- status: placed, preparing, ready, picked_up, cancelled. lines: [[item ref, quantity], ...]
create or replace function app.demo_op_order(p_center uuid, p_seed uuid, p_actor uuid, o jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_o uuid := app.demo_id(p_seed, 'order:' || (o->>'ref')); v_st text := o->>'status'; l jsonb;
        v_past boolean := coalesce((o->>'past')::boolean, false);
begin
  insert into app.store_orders (id, center_id, household_id, person_id, pickup_window_id, status, notes)
  values (v_o, p_center, app.demo_h(p_seed, o->>'household'), app.demo_p(p_seed, o->>'person'), app.demo_id(p_seed, o->>'window'), 'cart', null);
  for l in select e.value from jsonb_array_elements(o->'lines') e loop
    insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents, is_gift)
    select p_center, v_o, i.id, (l->>1)::int, i.price_cents, false from app.store_items i where i.id = app.demo_id(p_seed, l->>0);
  end loop;
  update app.store_orders set status = 'placed',
         placed_at = case when v_past then app.demo_at(p_center, -16, '19:00') else now() - interval '1 day' end
   where id = v_o;
  if v_st in ('preparing','ready','picked_up') then update app.store_orders set status = 'preparing' where id = v_o; end if;
  if v_st in ('ready','picked_up') then update app.store_orders set status = 'ready', ready_at = coalesce(ready_at, now() - interval '2 hours') where id = v_o; end if;
  if v_st = 'picked_up' then
    update app.store_orders set status = 'picked_up', ready_at = app.demo_at(p_center, -13, '10:45'), picked_up_at = app.demo_at(p_center, -13, '11:30'),
           picked_up_by = p_actor where id = v_o;
  end if;
  if v_st = 'cancelled' then update app.store_orders set status = 'cancelled', notes = 'Family travelling (demo)' where id = v_o; end if;
end $$;

-- Run a list of ops: {t, r} one row of table t; {t, rows: [..]} several; {op: pay|rsvp|order, ...}.
create or replace function app.demo_apply_ops(p_center uuid, p_seed uuid, p_actor uuid, p_ops jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare o jsonb; r jsonb;
begin
  for o in select e.value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) e loop
    if o ? 't' then
      if o ? 'rows' then
        for r in select e.value from jsonb_array_elements(o->'rows') e loop
          perform app.demo_put(o->>'t', r, p_center, p_seed, p_actor);
        end loop;
      else
        perform app.demo_put(o->>'t', o->'r', p_center, p_seed, p_actor);
      end if;
    elsif o->>'op' = 'pay' then
      perform app.demo_pay_ex(p_center, p_seed, p_actor, o->>'ref', o->>'household', o->>'payer', (o->>'cents')::bigint,
                              (o->>'method')::app.payment_method, (o->>'days_ago')::int,
                              case when o ? 'pledges' then array(select app.demo_id(p_seed, 'pledge:' || x) from jsonb_array_elements_text(o->'pledges') x) end,
                              o->>'check', o->>'memo', o->>'provider', o->>'provider_ref');
    elsif o->>'op' = 'rsvp' then
      perform app.demo_op_rsvp(p_center, p_seed, o);
    elsif o->>'op' = 'order' then
      perform app.demo_op_order(p_center, p_seed, p_actor, o);
    else
      raise exception 'Demo pack: unknown item %', left(o::text, 160);
    end if;
  end loop;
end $$;

-- Rows per clearable table (the same numbers as app.demo_data_counts, without its permission check; internal).
create or replace function app.demo_counts_raw(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t text; n bigint; v jsonb := '{}'::jsonb;
begin
  foreach t in array app.demo_clear_tables() loop
    execute format('select count(*) from app.%I t where %s', t,
                   case t when 'gyan_levels' then 't.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)'
                          when 'gyan_steps' then 't.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)'
                          else 't.center_id = $1' end) into n using p_center;
    if n > 0 then v := v || jsonb_build_object(t, n); end if;
  end loop;
  return v;
end $$;

-- ── Guardrail: test mode only ────────────────────────────────────────────────
-- A demo community can never take a real payment. Its payment API mode is always test (the older rule already said
-- "a sandbox is always test"; the flag makes it true even if the environment were ever changed), and a payment processor
-- of a demo community cannot be set to live by any route (the portal's switch, the worker, a direct write).
create or replace function app.payment_api_mode(p_center uuid, p_processor text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when c.environment = 'sandbox' or app.is_demo_center(c.id) or app.entitlement(c.id, 'payments.mode') = '"test"'::jsonb then 'test'
    when p_processor = 'paypal' then 'live'
    when (select status from app.center_payment_processors where center_id = c.id and processor = p_processor) = 'live' then 'live'
    else 'test' end
    from app.centers c where c.id = p_center
$$;

create or replace function app.demo_test_mode_only() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'live' and app.is_demo_center(new.center_id) then
    raise exception 'A demo community takes payments in test mode only. Nothing real is ever charged there.' using errcode = 'CCDMO';
  end if;
  return new;
end $$;
drop trigger if exists demo_test_mode_only on app.center_payment_processors;
create trigger demo_test_mode_only before insert or update of status on app.center_payment_processors
  for each row execute function app.demo_test_mode_only();

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.demo_resolve(jsonb, uuid, uuid, uuid), app.demo_put(text, jsonb, uuid, uuid, uuid),
  app.demo_pay_ex(uuid, uuid, uuid, text, text, text, bigint, app.payment_method, int, uuid[], text, text, text, text),
  app.demo_op_rsvp(uuid, uuid, jsonb), app.demo_op_order(uuid, uuid, uuid, jsonb), app.demo_apply_ops(uuid, uuid, uuid, jsonb),
  app.demo_counts_raw(uuid), app.demo_test_mode_only(), app.demo_persona_domain() from public, anon, authenticated;
revoke execute on function app.is_demo_center(uuid) from public, anon;
grant execute on function app.is_demo_center(uuid) to authenticated, connect_worker, service_role;
