-- 0110 · Giving module switch reaches the household card (stream w-giving).
--
-- app.household_card() is the People disambiguation card every picker shows. It
-- is security definer, so its two money columns (last gift date, open pledge
-- total) were still computed from payments/pledges after an admin switched
-- "Pledges & donations" off — the one place money data leaked past the module
-- switch (docs/MODULES.md: "money data is hidden ... for everyone but platform
-- admins"). Same signature, same access rule, same columns; the two money
-- columns are NULL while the giving module is off. Restricts only.

create or replace function app.household_card(p_household uuid)
returns table (household_id uuid, household_name text, household_number text, org_household_id text,
               members text, primary_member text, primary_org_member_id text, zone text, city text,
               last_gift_on date, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public, extensions as $$
  select h.id, h.display_name, h.household_number,
         (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
            and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
         (select string_agg(coalesce(p.preferred_name, p.first_name), ', ' order by hm.is_primary desc, p.date_of_birth nulls last)
            from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.left_at is null),
         (select p.first_name || ' ' || p.last_name from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null limit 1),
         (select e.value from app.household_members hm join app.external_ids e on e.person_id = hm.person_id and e.kind = 'org_member'
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null and e.valid_to is null limit 1),
         z.name, h.city,
         case when g.giving_on then (select max(pay.received_on) from app.payments pay where pay.household_id = h.id) end,
         case when g.giving_on then (select coalesce(sum(pl.amount_cents - pl.paid_cents), 0) from app.pledges pl
                               where pl.household_id = h.id and pl.status in ('open','partially_paid')) end
  from app.households h
  left join app.zones z on z.id = h.zone_id
  cross join lateral (select app.module_enabled(h.center_id, 'giving') or app.is_platform_admin() as giving_on) g
  where h.id = p_household
    and (app.has_permission(h.center_id, 'people.view') or app.has_permission(h.center_id, 'giving.view')
         or app.has_permission(h.center_id, 'giving.record_offline') or app.in_my_household(h.center_id, h.id))
$$;
