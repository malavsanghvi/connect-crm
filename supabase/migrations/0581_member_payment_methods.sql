-- Payments plan PR 2 (docs/PAYMENTS_PLAN.md §2.7): what the member app may offer, one answer for
-- every way to pay. Replaces the single-processor answer of app.member_payment_options for new app
-- versions (that function keeps answering in its old shape for installed apps).
--
--   app.member_payment_methods(center) → {environment, currency, online_unavailable, methods[]}
--
-- * Card (Stripe) and PayPal: ONE entry per connected processor, so a member can choose PayPal even
--   when Stripe is the default (finding G4). An entry is listed exactly when app.create_checkout
--   would accept that processor: the plugin is on, the organization does not take offline payments
--   only, the processor is test or live (live in production unless the organization is held to
--   test), and its connection is connected. Apple Pay and Google Pay are not entries of their own:
--   they ride on Stripe's checkout page and are listed as the Card entry's "wallets"; ACH as "also".
-- * Zelle: the organization's instructions, and how a payment is reported (plan PR 3). In a sandbox
--   (rehearsal: Zelle has no test mode) the real address is never shown: members see
--   "Sandbox: no real money moves" (and the memo hint), so no tester can send real money.
-- * The offline methods: their instructions, as "How to give" shows them today.
--
-- Members only see what members may see: no other organization's ids, no secrets, no account ids.
-- Money is integer cents everywhere; nothing here takes or records a payment.
set client_min_messages = warning;

create or replace function app.member_payment_methods(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_staff boolean; v_forced boolean; v_offline boolean; v_rehearsal boolean;
        v_methods jsonb := '[]'::jsonb; v_online boolean := false; v_test_mode boolean := false; v_unavailable text;
        r record; cp app.center_payment_processors; v_conn text; v_instr jsonb; v_window text; v_shown jsonb;
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
     where pl.status <> 'suspended' and app.payment_plugin_enabled(p_center, pl.key)
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
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label, 'provider', r.provider,
        'mode', app.payment_api_mode(p_center, r.provider),
        'wallets', case when r.key = 'card' then
                     (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                       where w.key in ('apple_pay','google_pay') and w.status <> 'suspended' and app.payment_plugin_enabled(p_center, w.key))
                   else '[]'::jsonb end,
        'also', case when r.key = 'card' then
                  (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                    where w.key = 'bank_debit' and w.status <> 'suspended' and app.payment_plugin_enabled(p_center, w.key))
                else case when 'venmo' = any (cp.methods) then '["venmo"]'::jsonb else '[]'::jsonb end end,
        'sort', r.sort));
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
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label,
        'mode', case when v_rehearsal then 'rehearsal' else 'live' end,
        'instructions', v_shown,
        'report', jsonb_build_object(
          'available', to_regprocedure('app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)') is not null,
          'confirmation', 'ask',
          -- 3 to 30 days, 10 when not set (the same rule plan PR 3's app.zelle_report_window_days applies).
          'window_days', least(30, greatest(3, case when v_window ~ '^\s*\d{1,4}\s*$' then v_window::int else 10 end))),
        'sort', r.sort));
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

revoke execute on function app.member_payment_methods(uuid) from public, anon;
grant execute on function app.member_payment_methods(uuid) to authenticated;
