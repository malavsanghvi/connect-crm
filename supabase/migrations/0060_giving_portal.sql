-- 0060_giving_portal.sql (stream P-GIVING)
-- Admin portal Giving parity (docs/parity/p3-giving-accounting-reports.md §5, §3):
--   1. Labh fulfillment: which labh a special-day pledge chose and whether it is
--      scheduled (app.labh_fulfillments), and who fulfils each labh on the menu
--      (labh_options.fulfilled_by). commit_labh records the fulfillment row with
--      the occasion's label (special days stay private to the family).
--   2. Campaigns and opportunities are audited, so the opportunity builder's
--      "saved and audited" is true.
-- Money rules (allocation, write-off, refunds) are unchanged; no permission keys added.

alter table app.labh_options add column fulfilled_by text;
comment on column app.labh_options.fulfilled_by is 'Who carries out the labh (e.g. "Pujari schedule", "Class teacher"); shown on the labh menu.';

create table app.labh_fulfillments (
  id             uuid not null default gen_random_uuid() unique,
  pledge_id      uuid primary key references app.pledges(id) on delete cascade,
  center_id      uuid not null references app.centers(id) on delete cascade,
  labh_option_id uuid references app.labh_options(id) on delete set null,
  occasion       text,                                   -- the special day's label, copied so staff never read special_days
  status         text not null default 'to_schedule' check (status in ('to_schedule','scheduled','done','cancelled')),
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) default auth.uid()
);
create index on app.labh_fulfillments (center_id, status);
create trigger stamp_labh_fulfillments before insert or update on app.labh_fulfillments
  for each row execute function app.stamp_updated_by();
create trigger audit_labh_fulfillments after insert or update or delete on app.labh_fulfillments
  for each row execute function app.audit_row();
alter table app.labh_fulfillments enable row level security;
-- Same pattern as the other giving staff tables (0010 _staff_policies): read giving.view|giving.manage, write giving.manage.
create policy labh_fulfillments_staff_read on app.labh_fulfillments for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage'));
create policy labh_fulfillments_staff_write on app.labh_fulfillments for all to authenticated
  using (app.has_permission(center_id, 'giving.manage')) with check (app.has_permission(center_id, 'giving.manage'));
grant select, insert, update, delete on app.labh_fulfillments to authenticated;

-- The fulfillment row must belong to the pledge's center and a labh pledge.
create or replace function app.check_labh_fulfillment() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not exists (select 1 from app.pledges p where p.id = new.pledge_id and p.center_id = new.center_id and p.source = 'labh') then
    raise exception 'labh fulfillment must point at a labh pledge of the same center' using errcode = 'check_violation';
  end if;
  if new.labh_option_id is not null and not exists (
       select 1 from app.labh_options lo where lo.id = new.labh_option_id and lo.center_id = new.center_id) then
    raise exception 'that labh is not on this center''s menu' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger labh_fulfillment_check before insert or update on app.labh_fulfillments
  for each row execute function app.check_labh_fulfillment();

create or replace function app.commit_labh(p_special_day uuid, p_option_ids uuid[], p_dedication text default null,
                                           p_repeat_yearly boolean default false)
returns text[] language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.special_days; o record; v_numbers text[] := '{}'; v_number text; v_pledge uuid; v_me uuid; v_next date;
begin
  select * into d from app.special_days where id = p_special_day;
  if d.id is null then raise exception 'special day not found'; end if;
  if not app.adult_of_household(d.center_id, d.household_id) then
    raise exception 'only an adult of the family can take a labh';
  end if;
  if coalesce(array_length(p_option_ids, 1), 0) = 0 then raise exception 'choose at least one labh'; end if;
  if exists (select 1 from unnest(p_option_ids) i where not exists (
       select 1 from app.labh_options lo where lo.id = i and lo.center_id = d.center_id and lo.active)) then
    raise exception 'one of the chosen labh options is no longer offered';
  end if;
  v_me := app.my_person_id(d.center_id);
  v_next := app.next_special_day_on(d.id, current_date);
  for o in
    select lo.*, array_position(p_option_ids, lo.id) as pos from app.labh_options lo
     where lo.id = any(p_option_ids) order by array_position(p_option_ids, lo.id)
  loop
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, fund_id, source, source_ref_id,
                             amount_cents, dedication, due_on, created_by)
      values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, 'labh', d.id,
              o.amount_cents, nullif(trim(p_dedication), ''), v_next, auth.uid())
      returning id, pledge_number into v_pledge, v_number;
    v_numbers := v_numbers || v_number;
    -- Fulfillment starts "to schedule" and remembers which labh was chosen (0060).
    insert into app.labh_fulfillments (pledge_id, center_id, labh_option_id, occasion)
      values (v_pledge, d.center_id, o.id, coalesce(nullif(trim(d.label), ''), initcap(d.kind)));
    if coalesce(p_repeat_yearly, false) then
      insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency,
                                       special_day_id, status, starts_on, next_charge_on, end_kind)
        values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, o.amount_cents, 'yearly',
                d.id, 'pending_payment_method', (v_next + interval '1 year')::date, (v_next + interval '1 year')::date, 'until_stopped');
    end if;
  end loop;
  return v_numbers;
end $$;

create trigger audit_campaigns after insert or update or delete on app.campaigns
  for each row execute function app.audit_row();
create trigger audit_opportunities after insert or update or delete on app.opportunities
  for each row execute function app.audit_row();

revoke execute on function app.check_labh_fulfillment() from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
