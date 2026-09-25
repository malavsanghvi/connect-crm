-- Integration fix (found by the shared e2e run just after midnight UTC).
--
-- app.my_practice_standing counted "done today" and the month with current_date — the database's
-- UTC day — while the member app logs practices on the community's own day (log_practice p_on). For
-- a community west of UTC, every evening after 00:00 UTC showed "0 done today" for practices the
-- member had just ticked, and the month rolled over early. Use the community's local date, as the
-- rest of the Jain Way does. Nothing else changes (same columns, same privacy rule, same thresholds).
set client_min_messages = warning;

create or replace function app.my_practice_standing(p_person uuid)
 returns table(category text, top_percent integer, practices_count integer, done_today integer)
 language plpgsql stable security definer
 set search_path to 'app', 'public', 'extensions'
as $function$
#variable_conflict use_column
declare v_center uuid; v_today date; v_from date;
begin
  select center_id into v_center from app.people where id = p_person;
  perform app.assert_module_enabled(v_center, 'jain_way');
  if v_center is null or not app.can_act_for_person(v_center, p_person) then
    raise exception 'your standing is private to you';
  end if;
  select (now() at time zone coalesce(c.time_zone, 'UTC'))::date into v_today from app.centers c where c.id = v_center;
  v_from := date_trunc('month', v_today)::date;
  return query
  with totals as (
    select pr.category, l.person_id, sum(pr.points)::int as pts
      from app.practice_logs l join app.practices pr on pr.id = l.practice_id
     where l.center_id = v_center and l.logged_on between v_from and v_today
     group by pr.category, l.person_id
  ),
  cats as (
    select pr.category from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id where ps.person_id = p_person
    union
    select t.category from totals t where t.person_id = p_person
  )
  select c.category,
         case when (select count(*) from totals t where t.category = c.category) < 10 then null
              when coalesce((select t.pts from totals t where t.category = c.category and t.person_id = p_person), 0) <= 0 then null
              else greatest(1, ceil(100.0 * (1 + (select count(*) from totals t where t.category = c.category
                                                      and t.pts > (select t2.pts from totals t2 where t2.category = c.category and t2.person_id = p_person)))
                                    / (select count(*) from totals t where t.category = c.category)))::int
         end,
         (select count(*)::int from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id
           where ps.person_id = p_person and pr.category = c.category),
         (select count(*)::int from app.practice_logs l join app.practices pr on pr.id = l.practice_id
           where l.person_id = p_person and l.logged_on = v_today and pr.category = c.category)
    from cats c
   order by c.category;
end $function$;
