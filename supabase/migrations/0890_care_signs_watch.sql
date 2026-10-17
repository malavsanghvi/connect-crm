-- 0890 · DonorDelight, Today groups: which households may be cooling (docs/DONORDELIGHT.md sections 6, 9 and 12; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_signs_watch(center, limit)   the households, among those the caller may see, whose giving makes them a candidate for the
--       Cooling or At risk sign: they gave in the last 24 months and either gave nothing in the last 12 months, gave fewer times than the
--       year before, or have not given for six months. It is a SHORTLIST, not a verdict: the portal asks app.care_health_facts (0884) for
--       these households and src/lib/care/health.ts decides the level and its reasons, so there is one place for the rules in words. The
--       shortlist is deliberately a little wider than the rules (it includes a household that would read Lapsed after counting events), so
--       a change to the wording never needs a change here.
--   Order: gave last year and nothing since first, then the others; within each the longest quiet first. At most 100 households.
--   Who sees which: care.view and care.manage every household, care.own only the households they own or back up (0760); nobody else,
--   platform admins included. Gifts by 0882's rule (donations that went through, less refunds, never opening balances or history
--   imports, never a payer under 18). NO AMOUNT is read or returned, so no giving role is needed beyond the care key. Each household
--   comes as its household card (adults only) with its relationship owner. Giving off, or the thank-you rules not needed: the answer
--   says state "giving_off". Every read is logged without names.
set client_min_messages = warning;

create or replace function app.care_signs_watch(p_center uuid, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_all boolean; v_today date; v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100)); v_mine uuid[]; v_total integer; v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  if not app.module_enabled(p_center, 'giving') then
    perform app.log_private_read(p_center, 'care', 'signs_watch', 0);
    return jsonb_build_object('state', 'giving_off', 'total', 0, 'rows', '[]'::jsonb);
  end if;
  v_all := app.care_can(p_center, 'view');
  v_mine := app.care_my_households();
  v_today := app._care_today(p_center);

  with g as (
    select x.household_id,
           count(*) filter (where x.received_on > v_today - 365 and x.received_on <= v_today) as gifts_12,
           count(*) filter (where x.received_on > v_today - 730 and x.received_on <= v_today - 365) as gifts_prev_12,
           max(x.received_on) as last_gift_on
      from app._care_gifts(p_center) x
     group by x.household_id
  ),
  cand as (
    select g.*, case when g.gifts_prev_12 > 0 and g.gifts_12 = 0 then 0 else 1 end as rank
      from g
      join app.households h on h.id = g.household_id and h.center_id = p_center and h.merged_into_id is null
     where (v_all or g.household_id = any (v_mine))
       and (g.gifts_12 + g.gifts_prev_12) > 0
       and ((g.gifts_prev_12 > 0 and g.gifts_12 < g.gifts_prev_12)
            or (g.gifts_12 > 0 and g.last_gift_on < v_today - 183))
  ),
  shown as (select * from cand c order by c.rank, c.last_gift_on, c.household_id limit v_limit)
  select (select count(*) from cand),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'household', app._care_household_head(s.household_id),
                   'owner', (select case when o.owner_user_id is not null then app._user_label(p_center, o.owner_user_id) end
                               from app.care_owners o where o.household_id = s.household_id),
                   'last_touch_at', (select max(t.touched_at) from app.care_touches t
                                      where t.household_id = s.household_id and t.voided_at is null))
                 order by s.rank, s.last_gift_on, s.household_id), '[]'::jsonb)
            from shown s)
    into v_total, v_rows;

  perform app.log_private_read(p_center, 'care', 'signs_watch', jsonb_array_length(v_rows));
  return jsonb_build_object('state', 'ok', 'total', v_total, 'rows', v_rows);
end $$;

revoke execute on function app.care_signs_watch(uuid, integer) from public, anon;
grant execute on function app.care_signs_watch(uuid, integer) to authenticated, service_role;
comment on function app.care_signs_watch(uuid, integer) is
  'DonorDelight (0890): the shortlist of households (that the caller may see) that may read Cooling or At risk; health.ts decides. No amounts. Logged.';
