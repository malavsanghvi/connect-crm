-- 0875 · Payment proofs, ready for testing: a sandbox community that has not set up any way to pay offline gets check, cash and bank
-- transfer accepted, so "I paid another way" has something to offer. A community that already accepted or declined a method keeps its own
-- choice (a row is never overwritten), and a production community is never touched. Zelle needs a recipient, so it is left to Settings.
set client_min_messages = warning;

create or replace function app._proof_sandbox_methods(p_center uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int := 0; v_name text;
begin
  select name into v_name from app.centers where id = p_center and environment = 'sandbox';
  if v_name is null then return 0; end if;
  if exists (select 1 from app.center_payment_methods where center_id = p_center and accepted) then return 0; end if;
  insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
    (p_center, 'check', true, jsonb_build_object('payee', v_name), 1),
    (p_center, 'cash', true, jsonb_build_object('details', 'Hand it to a treasurer or put it in the offering box.'), 2),
    (p_center, 'ach', true, jsonb_build_object('details', 'Ask the treasurer for the bank details.'), 3)
  on conflict (center_id, method) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app._proof_sandbox_methods(uuid) from public, anon, authenticated;

select app._proof_sandbox_methods(c.id) from app.centers c where c.environment = 'sandbox';
