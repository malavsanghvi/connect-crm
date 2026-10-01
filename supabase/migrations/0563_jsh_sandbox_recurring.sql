-- 0563: "Make this recurring" switched on for the JSH sandbox's giving opportunities (owner request, 2026-10-01).
--
-- The member app offers "Give once / Make this recurring" on an opportunity only where the office has allowed it
-- (0525: opportunities.allow_recurring + recurring_frequencies, set in the portal under Giving › Opportunities). The
-- sandbox's opportunities (0513) were seeded with it off, so nobody could try it. This turns it on for them.
--
--   * Frequencies: monthly, quarterly and yearly (not weekly).
--   * The database refuses recurring without an existing confirmation email template (0525), so this adds one for the
--     organization: recurring_gift_confirmation, our own plain wording, editable in Communications. It is written for
--     the tokens the recurring cycle fills: {{amount}}, {{frequency}}, {{next_date}}, {{opportunity_name}} (plus the
--     always-available {{center_name}}).
--   * An opportunity the office has already configured (recurring on, or any frequency or template chosen) is left as
--     it is; only never-configured ones are switched on.
--   * Open-amount and tiered opportunities both get it; the member app never offers it for a multi-pick (several
--     options at once).
--
-- What recurring does today (unchanged by this file): a gift set up before an online card or bank account exists has
-- status pending_payment_method and is never charged (owner decision 2026-09-24), and nothing yet runs
-- app.run_recurring_gift_cycle when a gift falls due (BACKLOG B16), so no pledge or email is created automatically.
--
-- Safety: app.seed_jsh_recurring_opportunities does nothing for an organization that is not a sandbox, adds nothing
-- twice, and is not called from seed.sql. This migration runs it once, for JSH, only while JSH is a sandbox.
set client_min_messages = warning;

create or replace function app.seed_jsh_recurring_opportunities(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_env text; v_tpl int := 0; v_on int := 0;
begin
  select environment into v_env from app.centers where id = p_center;
  if v_env is null then return jsonb_build_object('template_added', 0, 'opportunities_enabled', 0, 'skipped', 'no such organization'); end if;
  if v_env <> 'sandbox' then return jsonb_build_object('template_added', 0, 'opportunities_enabled', 0, 'skipped', 'not a sandbox'); end if;
  perform app.set_audit_context('JSH sandbox: recurring switched on for the giving opportunities (owner request, 2026-10-01)');

  if not exists (select 1 from app.message_templates t
                  where t.center_id = p_center and t.key = 'recurring_gift_confirmation' and t.channel = 'email' and t.language = 'en') then
    insert into app.message_templates (center_id, key, channel, language, subject, body)
    values (p_center, 'recurring_gift_confirmation', 'email', 'en',
            'Your {{frequency}} gift to {{opportunity_name}}',
            E'Thank you for giving to {{opportunity_name}} at {{center_name}}.\n\n'
            || E'Your {{frequency}} gift of ${{amount}} has been added to your pledges. The next one is on {{next_date}}.\n\n'
            || E'You can pause, change or stop it at any time in the app under Give › Your recurring gifts.\n\n'
            || E'Jai Jinendra,\n{{center_name}}');
    v_tpl := 1;
  end if;

  update app.opportunities o
     set allow_recurring = true,
         recurring_frequencies = array['monthly', 'quarterly', 'yearly']::text[],
         notification_template_key = 'recurring_gift_confirmation'
   where o.center_id = p_center
     and not o.allow_recurring and cardinality(o.recurring_frequencies) = 0 and o.notification_template_key is null;
  get diagnostics v_on = row_count;
  return jsonb_build_object('template_added', v_tpl, 'opportunities_enabled', v_on);
end $$;
comment on function app.seed_jsh_recurring_opportunities(uuid) is
  'Switches "Make this recurring" on (monthly, quarterly, yearly) for a SANDBOX organization''s never-configured giving opportunities and adds the recurring_gift_confirmation email template (0563). Idempotent; refuses anything that is not a sandbox.';
revoke execute on function app.seed_jsh_recurring_opportunities(uuid) from public, anon, authenticated;
grant execute on function app.seed_jsh_recurring_opportunities(uuid) to service_role;

do $$ declare r jsonb; begin
  select app.seed_jsh_recurring_opportunities(id) into r from app.centers where slug = 'jsh' and environment = 'sandbox';
  raise warning '0563 recurring opportunities for the JSH sandbox: %', coalesce(r::text, 'JSH is not a sandbox (or does not exist) - nothing changed');
end $$;
