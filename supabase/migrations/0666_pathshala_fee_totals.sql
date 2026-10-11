-- 0666: Pathshala fee totals, as sums only (B90 phase 4, Learning; decision D2).
--
-- Niva for administrators may be asked "how much has Pathshala billed and collected this term?". The answer is money added up, never
-- people: app.pathshala_fee_totals(term) returns sums and counts of fee lines for one term, in total and level by level. No name, no
-- household, no enrollment and no learner id is in the answer, so nothing about a learner can reach an AI provider through it.
-- (The rows it adds up are one per learner; the function reads them and gives back only the totals.)
--
-- It is a read function that runs with the CALLER's own rights (SECURITY INVOKER, no SECURITY DEFINER): row-level security on
-- app.pathshala_enrollment_fees still decides which rows are visible. It also says plainly "You don't have access to this area" when
-- the caller may not see fee totals (pathshala.manage, giving.view or giving.manage), instead of answering with zeros that look like
-- "nothing billed". An adult of a household can read their own household's fee lines through the policy, but may not call this.
--
-- Nothing is written. No table, column or policy changes. Idempotent: create or replace.
create or replace function app.pathshala_fee_totals(p_term uuid) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare
  t app.pathshala_terms;
  v_all jsonb;
  v_levels jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found, or you don''t have access to it.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if not (app.has_permission(t.center_id, 'pathshala.manage') or app.has_permission(t.center_id, 'giving.view')
          or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'You don''t have access to this area (the Pathshala fee totals need pathshala.manage or giving.view).' using errcode = '42501';
  end if;

  -- A cancelled line is not billed and is left out. Every sum is in cents (the apps show dollars).
  select jsonb_build_object(
           'term_id', t.id,
           'term', t.name,
           'fee_lines', count(*),
           'base_cents', coalesce(sum(f.base_fee_cents), 0),
           'sibling_discount_cents', coalesce(sum(f.sibling_discount_cents), 0),
           'cap_reduction_cents', coalesce(sum(f.cap_reduction_cents), 0),
           'late_fee_cents', coalesce(sum(f.late_fee_cents), 0),
           'assistance_cents', coalesce(sum(f.assistance_cents), 0),
           'total_cents', coalesce(sum(f.total_cents), 0),
           'paid_cents', coalesce(sum(f.total_cents) filter (where f.status = 'paid'), 0),
           'billed_unpaid_cents', coalesce(sum(f.total_cents) filter (where f.status = 'billed'), 0),
           'not_billed_cents', coalesce(sum(f.total_cents) filter (where f.status in ('quoted', 'not_billed_giving_off')), 0),
           'unpriced_lines', count(*) filter (where not f.priced))
    into v_all
    from app.pathshala_enrollment_fees f
   where f.term_id = p_term and f.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('level_id', x.level_id, 'level', x.level, 'track', x.track, 'fee_lines', x.n,
                                               'total_cents', x.total, 'paid_cents', x.paid)
                            order by x.track, x.sort_order, x.level), '[]'::jsonb)
    into v_levels
    from (select f.level_id,
                 coalesce(l.name, 'No level yet') as level,
                 coalesce(tr.name, '') as track,
                 coalesce(l.sort_order, 0) as sort_order,
                 count(*) as n,
                 coalesce(sum(f.total_cents), 0) as total,
                 coalesce(sum(f.total_cents) filter (where f.status = 'paid'), 0) as paid
            from app.pathshala_enrollment_fees f
            left join app.pathshala_levels l on l.id = f.level_id
            left join app.pathshala_tracks tr on tr.id = l.track_id
           where f.term_id = p_term and f.status <> 'cancelled'
           group by f.level_id, l.name, tr.name, l.sort_order) x;

  return v_all || jsonb_build_object('by_level', v_levels);
end $$;

comment on function app.pathshala_fee_totals(uuid) is
  'Sums only, for one term (B90 Learning, decision D2): {term_id, term, fee_lines, base_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents, assistance_cents, total_cents, paid_cents, billed_unpaid_cents, not_billed_cents, unpriced_lines, by_level[{level_id, level, track, fee_lines, total_cents, paid_cents}]}. No name, household, enrollment or learner id. SECURITY INVOKER (the caller''s own row-level security applies); needs pathshala.manage, giving.view or giving.manage and says "You don''t have access to this area" otherwise.';

revoke execute on function app.pathshala_fee_totals(uuid) from public, anon;
grant execute on function app.pathshala_fee_totals(uuid) to authenticated, service_role;
