-- 0525 (Giving taxonomy rebuild, B16 · 1 of the priority list in docs/giving_taxonomy_plan.md)
-- "Make this opportunity recurring" becomes real: recurring_gifts can now point at the specific
-- opportunity it renews, and an opportunity can declare which frequencies it allows and which
-- email template confirms each cycle's auto-pledge.
--
--   app.recurring_gifts.opportunity_id     new FK — which opportunity this gift renews (nullable:
--                                          plain fund/campaign recurring gifts are unaffected)
--   app.opportunities.allow_recurring      admin turns recurring on for this opportunity
--   app.opportunities.recurring_frequencies the frequencies members may pick (subset of the
--                                          existing recurring_gifts.frequency values, minus
--                                          special_day — that only makes sense off a person's
--                                          own family special day, not a shared opportunity)
--   app.opportunities.notification_template_key  which app.message_templates row (channel
--                                          'email') confirms a cycle's pledge; required once
--                                          allow_recurring is on
--   app.create_recurring_gift(..., p_opportunity)  extended, backward compatible (new trailing
--                                          param defaults to null) — validates the opportunity
--                                          allows recurring and the chosen frequency, and derives
--                                          the campaign/fund from it
--   app.run_recurring_gift_cycle(p_recurring_gift)  the actual "one cycle" step: creates the
--                                          pledge, advances next_charge_on per the end rule, and
--                                          — when the gift is opportunity-linked — enqueues the
--                                          opportunity's confirmation template. Worker-only (see
--                                          "Deferred" below): granted to connect_worker, not to
--                                          end users or admins, matching app.claim_jobs' pattern
--                                          in 0171 (a security definer function's real boundary
--                                          is the GRANT, not an internal role check).
--
-- Deferred (documented in docs/giving_taxonomy_plan.md's open questions, not silently dropped):
-- nothing in this repository enqueues app.run_recurring_gift_cycle when a gift falls due — there
-- is no existing recurring-charge scheduler at all (checked: no pg_cron, no cron worker handler,
-- no Vercel cron route). Wiring "on next_charge_on, run a cycle" into a real trigger (a new
-- connect_worker job handler polling due recurring_gifts, or a scheduled job) is the next step;
-- this migration ships the correct, tested unit of work that trigger will call.
set client_min_messages = warning;

-- ── recurring_gifts.opportunity_id ──────────────────────────────────────────
alter table app.recurring_gifts add column opportunity_id uuid references app.opportunities(id) on delete set null;
create index on app.recurring_gifts (opportunity_id) where opportunity_id is not null;
comment on column app.recurring_gifts.opportunity_id is
  'Which opportunity this gift renews (0525). Null for a plain fund/campaign recurring gift or a labh yearly gift.';

-- ── opportunities: recurring eligibility + confirmation template ───────────
alter table app.opportunities add column allow_recurring boolean not null default false;
alter table app.opportunities add column recurring_frequencies text[] not null default '{}'::text[];
alter table app.opportunities add column notification_template_key text;
alter table app.opportunities add constraint opportunities_recurring_frequencies_check
  check (recurring_frequencies <@ array['weekly','monthly','quarterly','yearly']::text[]);
alter table app.opportunities add constraint opportunities_allow_recurring_needs_setup check (
  not allow_recurring or (cardinality(recurring_frequencies) > 0 and notification_template_key is not null)
);
comment on column app.opportunities.recurring_frequencies is
  'Frequencies a member may choose when making this opportunity recurring. special_day is not offered here — it only applies to a labh on a family''s own special day (app.commit_labh).';
comment on column app.opportunities.notification_template_key is
  'app.message_templates key (channel=email) sent on each recurring cycle''s auto-pledge. Tokens: {{amount}} {{frequency}} {{next_date}} {{opportunity_name}}.';

-- The chosen template must exist (center-specific or platform default) for channel 'email'
-- before an opportunity can turn recurring on — the same "fail at save time, not at cycle time"
-- principle as check_opportunity_option (0022).
create or replace function app.check_opportunity_recurring_template() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not new.allow_recurring or new.notification_template_key is null then return new; end if;
  if not exists (
    select 1 from app.message_templates m
     where m.key = new.notification_template_key and m.channel = 'email'
       and (m.center_id = new.center_id or m.center_id is null)
  ) then
    raise exception 'Choose a confirmation email template that exists before turning recurring on for this opportunity.';
  end if;
  return new;
end $$;
create trigger opportunities_recurring_template before insert or update of allow_recurring, notification_template_key on app.opportunities
  for each row execute function app.check_opportunity_recurring_template();

-- ── create_recurring_gift: accept an opportunity, validate it allows the chosen frequency ──
drop function if exists app.create_recurring_gift(uuid, uuid, uuid, integer, text, date, text, integer, date, uuid);
create or replace function app.create_recurring_gift(
  p_household uuid, p_fund uuid, p_campaign uuid, p_amount_cents integer, p_frequency text,
  p_starts_on date default current_date, p_end_kind text default 'until_stopped', p_end_count integer default null,
  p_end_on date default null, p_special_day uuid default null, p_opportunity uuid default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid; v_start date := coalesce(p_starts_on, current_date); o app.opportunities;
  v_campaign uuid := p_campaign; v_fund uuid := p_fund;
begin
  select center_id into v_center from app.households where id = p_household;
  perform app.assert_module_enabled(v_center, 'giving');
  if v_center is null or not app.adult_of_household(v_center, p_household) then
    raise exception 'only an adult of the household can set up a recurring gift';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount greater than zero'; end if;
  if p_frequency not in ('weekly','monthly','quarterly','yearly','special_day') then raise exception 'choose how often to give'; end if;
  if v_start < current_date then raise exception 'the first gift cannot be in the past'; end if;
  if coalesce(p_end_kind, 'until_stopped') not in ('until_stopped','count','until_date') then raise exception 'choose when the gift ends'; end if;
  if p_end_kind = 'count' and coalesce(p_end_count, 0) <= 0 then raise exception 'enter how many gifts to make'; end if;
  if p_end_kind = 'until_date' and (p_end_on is null or p_end_on < v_start) then raise exception 'the end date must be after the first gift'; end if;
  if p_opportunity is not null then
    select * into o from app.opportunities where id = p_opportunity and center_id = v_center;
    if o.id is null then raise exception 'that opportunity was not found'; end if;
    if not o.allow_recurring then raise exception 'this opportunity cannot be made recurring'; end if;
    if not (p_frequency = any(o.recurring_frequencies)) then raise exception 'that frequency is not offered for this opportunity'; end if;
    v_campaign := o.campaign_id;
  end if;
  if v_fund is not null and not exists (select 1 from app.funds where id = v_fund and center_id = v_center and active) then
    raise exception 'that fund is not available';
  end if;
  if v_campaign is not null and not exists (select 1 from app.campaigns where id = v_campaign and center_id = v_center and status = 'published') then
    raise exception 'that campaign is not open for giving';
  end if;
  if v_fund is null and v_campaign is not null then select fund_id into v_fund from app.campaigns where id = v_campaign; end if;
  if p_special_day is not null and not exists (select 1 from app.special_days where id = p_special_day and household_id = p_household) then
    raise exception 'that special day belongs to another family';
  end if;
  insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, opportunity_id, amount_cents, frequency,
                                   special_day_id, status, starts_on, next_charge_on, end_kind, end_count, end_on)
    values (v_center, p_household, app.my_person_id(v_center), v_campaign, v_fund, p_opportunity, p_amount_cents, p_frequency,
            p_special_day, 'pending_payment_method', v_start, v_start, coalesce(p_end_kind, 'until_stopped'),
            case when p_end_kind = 'count' then p_end_count end, case when p_end_kind = 'until_date' then p_end_on end)
    returning id into v_id;
  return v_id;
end $$;

-- ── run_recurring_gift_cycle: the unit of work a scheduler will call ───────
-- One cycle: insert the pledge (source 'recurring', source_ref_id = the recurring gift), advance
-- next_charge_on (or end the gift per its end_kind), and — when opportunity-linked — enqueue the
-- opportunity's confirmation email via the existing messaging outbox (app.enqueue_message, 0221).
-- A household with no email on file is not an error: the pledge is still recorded, a warning is
-- logged (there is no per-recipient failure channel for a system-generated confirmation), and
-- nothing here talks to a payment processor — that remains out of scope, same as the rest of
-- recurring_gifts today (see recurring_gifts.status comment, 0022: "waiting for a payment method").
create or replace function app.run_recurring_gift_cycle(p_recurring_gift uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  g app.recurring_gifts; o app.opportunities; v_pledge uuid; v_next date; v_end_count integer;
  v_next_status text; v_to text; v_tpl app.message_templates;
begin
  select * into g from app.recurring_gifts where id = p_recurring_gift for update;
  if g.id is null then raise exception 'recurring gift not found'; end if;
  if g.status <> 'active' then raise exception 'this recurring gift is % — only an active gift can run a cycle', g.status; end if;
  if g.next_charge_on is null or g.next_charge_on > current_date then raise exception 'this recurring gift is not due yet'; end if;

  insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, opportunity_id, fund_id, source, source_ref_id, amount_cents, due_on)
    values (g.center_id, g.household_id, g.person_id, g.campaign_id, g.opportunity_id, g.fund_id, 'recurring', g.id, g.amount_cents, g.next_charge_on)
    returning id into v_pledge;

  v_next := case g.frequency
    when 'weekly'    then (g.next_charge_on + interval '7 days')::date
    when 'monthly'   then (g.next_charge_on + interval '1 month')::date
    when 'quarterly' then (g.next_charge_on + interval '3 months')::date
    when 'yearly'    then (g.next_charge_on + interval '1 year')::date
    when 'special_day' then app.next_special_day_on(g.special_day_id, g.next_charge_on + 1)
  end;
  v_end_count := case when g.end_kind = 'count' then coalesce(g.end_count, 1) - 1 else g.end_count end;
  v_next_status := case
    when v_next is null then 'cancelled'
    when g.end_kind = 'until_date' and g.end_on is not null and v_next > g.end_on then 'cancelled'
    when g.end_kind = 'count' and v_end_count <= 0 then 'cancelled'
    else g.status
  end;
  update app.recurring_gifts
     set next_charge_on = case when v_next_status = 'cancelled' then null else v_next end,
         -- end_count > 0 is enforced even once cancelled, so a count-ended gift keeps its last
         -- positive remaining-count rather than being zeroed out — "cancelled" + next_charge_on
         -- null is what says it is done; end_count is only ever informational once that happens.
         end_count = case when g.end_kind = 'count' and v_end_count > 0 then v_end_count else g.end_count end,
         status = v_next_status
   where id = g.id;

  if g.opportunity_id is not null then
    select * into o from app.opportunities where id = g.opportunity_id;
    if o.notification_template_key is not null then
      select * into v_tpl from app.message_templates m
       where m.key = o.notification_template_key and m.channel = 'email' and (m.center_id = g.center_id or m.center_id is null)
       order by m.center_id nulls last, m.version desc limit 1;
      if v_tpl.id is not null then
        select coalesce(gp.email, hp.email) into v_to
          from app.recurring_gifts rg
          left join app.people gp on gp.id = rg.person_id
          left join app.household_members hm on hm.household_id = rg.household_id and hm.is_primary
          left join app.people hp on hp.id = hm.person_id
         where rg.id = g.id;
        if v_to is not null then
          perform app.enqueue_message(g.center_id, 'email', v_to, o.notification_template_key,
            jsonb_build_object('amount', to_char(g.amount_cents / 100.0, 'FM999,999,990.00'),
                                'frequency', g.frequency, 'next_date', coalesce(v_next::text, ''), 'opportunity_name', o.name),
            'notification');
        else
          raise warning 'run_recurring_gift_cycle: no email on file for household % — confirmation for opportunity % (pledge %) not sent', g.household_id, o.name, v_pledge;
        end if;
      else
        raise warning 'run_recurring_gift_cycle: template % not found for center % — confirmation for pledge % not sent', o.notification_template_key, g.center_id, v_pledge;
      end if;
    end if;
  end if;

  return v_pledge;
end $$;

revoke execute on function app.check_opportunity_recurring_template() from public, anon, authenticated;
revoke execute on function app.create_recurring_gift(uuid, uuid, uuid, integer, text, date, text, integer, date, uuid, uuid) from public, anon;
grant execute on function app.create_recurring_gift(uuid, uuid, uuid, integer, text, date, text, integer, date, uuid, uuid) to authenticated;
revoke execute on function app.run_recurring_gift_cycle(uuid) from public, anon, authenticated, service_role;
grant execute on function app.run_recurring_gift_cycle(uuid) to connect_worker;
grant execute on all functions in schema app to service_role;
