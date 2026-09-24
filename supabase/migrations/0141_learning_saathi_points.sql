-- 0141 (wave 3 · w-learning): Saathi points follow the rules the office sets.
--
-- Content › Practices & points edits centers.rules.points.anumodana_points and
-- support_points ("once per person per day"), and the member app shows those
-- numbers, but send_anumodana always credited 5 and 3. It now reads the rules
-- (same defaults), and a second support message to the same person on the same
-- day is still delivered but earns nothing, as the rule says. The daily cap
-- (anumodana_daily_cap) is unchanged.
create or replace function app.send_anumodana(p_center uuid, p_to uuid, p_kind text default 'celebrate', p_message text default null)
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_from uuid := app.my_person_id(p_center); v_cap int; v_today int; v_pts int; v_rules jsonb; v_repeat boolean;
begin
  perform app.assert_module_enabled(p_center, 'jain_way');
  if not app.same_household_person(p_center, p_to) then raise exception 'Saathi works within your family circle'; end if;
  select coalesce(rules->'points', '{}'::jsonb) into v_rules from app.centers where id = p_center;
  v_repeat := p_kind = 'support' and exists (
    select 1 from app.anumodana a
     where a.from_person_id = v_from and a.to_person_id = p_to and a.kind = 'support'
       and (a.created_at at time zone (select time_zone from app.centers where id = p_center))::date
           = (now() at time zone (select time_zone from app.centers where id = p_center))::date);
  insert into app.anumodana (center_id, from_person_id, to_person_id, kind, message) values (p_center, v_from, p_to, p_kind, p_message);
  v_cap := coalesce((v_rules->>'anumodana_daily_cap')::int, 5);
  select count(*) into v_today from app.points_ledger where person_id = v_from and reason = 'anumodana_sent' and occurred_at::date = current_date;
  v_pts := case when v_today >= v_cap or v_repeat then 0
                when p_kind = 'support' then coalesce((v_rules->>'support_points')::int, 3)
                else coalesce((v_rules->>'anumodana_points')::int, 5) end;
  if v_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id) values (p_center, v_from, v_pts, 'anumodana_sent', p_to);
  end if;
  return v_pts;
end $$;
grant execute on function app.send_anumodana(uuid, uuid, text, text) to authenticated;
