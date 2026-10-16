-- 0863 · JSH's yearly Chip In limit: $50 per account per calendar year, set once (owner decision, 2026-10-15).
--
-- The owner decided on 2026-10-15 that JSH's members may each chip in up to $50 a year to Weaver, with suggested amounts of $2, $5
-- and $10. This writes exactly that setting for the community whose web name is "jsh", through the same internal writer (and so the
-- same checks and the same audit entry, with its reason) as a platform admin's save. ASKING STAYS OFF: nothing is asked of any
-- JSH member until a platform admin switches it on at the go-live gate (docs/PAYMENT_ADDONS.md §13).
--
--   * A database without a community called "jsh" (a fresh install, CI before its seed) is left alone: no row is written.
--   * A community that already has a Chip In setting keeps it: running this again changes nothing and writes no audit entry.
--   * Nothing else changes: no payment, no checkout, no other organization.
set client_min_messages = warning;

create or replace function app._chip_in_seed_for(p_slug text) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid;
        v_reason constant text := 'Owner decision 2026-10-15: $50 yearly Chip In limit per account for JSH; asking stays off until the go-live gate';
begin
  select id into v_center from app.centers where slug = p_slug::citext;
  if v_center is null then return 'no community with that web name'; end if;
  if exists (select 1 from app.chip_in_settings where center_id = v_center) then return 'already set'; end if;
  perform app.set_audit_context(v_reason);
  perform app._chip_in_write(v_center, 5000, array[200, 500, 1000]::bigint[], false, v_reason);
  return 'seeded';
end $$;
revoke execute on function app._chip_in_seed_for(text) from public, anon, authenticated, service_role;

select app._chip_in_seed_for('jsh');
