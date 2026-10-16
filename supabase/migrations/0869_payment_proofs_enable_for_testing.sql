-- 0869 · Payment proofs, ready for the owner's testing (2026-10-16): Payment proofs is switched ON for the JSH community and any sandbox
-- community, and the four everyday offline methods are accepted there unless a row already says otherwise. Every other community keeps
-- Payment proofs OFF (0865). An administrator can switch it off again in Settings > Modules.
set client_min_messages = warning;
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at)
select c.id, 'giving_proofs', true, 'Switched on for the owner''s testing (2026-10-16)', now()
  from app.centers c where c.environment = 'sandbox' or c.slug = 'jsh'
on conflict (center_id, module_key) do nothing;
insert into app.center_payment_methods (center_id, method, accepted)
select c.id, m, true
  from app.centers c cross join unnest(array['check', 'cash', 'ach', 'zelle']::app.payment_method[]) m
 where c.environment = 'sandbox' or c.slug = 'jsh'
on conflict (center_id, method) do nothing;
