-- 0880 · The product WeCare is now named DonorDelight (owner decision 2026-10-16; docs/WECARE.md section 1).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Only what a person reads changes. The module key stays `care`, so the permission keys (care.view, care.own, care.manage), the roles
--   (care_lead, relationship_owner), the tables, the `/care` address and every stored record are exactly as they were.
--     * app.modules, app.marketplace_products: the product's name, its two-letter mark and the notes that name it.
--     * app.roles: the two role descriptions that say "WeCare:".
--     * Four functions whose plain-English error messages name the product (care_keep_household, care_keep_person, care_row_adult,
--       roles_private_guard): each is re-created from its own definition with the name replaced, so nothing else in it can differ.
--   Left alone on purpose: earlier migrations (applied files are never edited), the audit log's own history (append-only, hash-chained),
--   and the label each kind gives the section (app.category_modules: "Donor care" for non-profit and civic kinds, "Member care" for faith
--   and community kinds). DonorDelight is the product's name on the Marketplace card, the website and in the docs.
set client_min_messages = warning;

select app.set_audit_context('0880: the product WeCare is now called DonorDelight (names and notes only)');

update app.modules set label = 'DonorDelight' where key = 'care' and label = 'WeCare';

update app.marketplace_products
   set name = replace(name, 'WeCare', 'DonorDelight'),
       mark = case when mark = 'WC' then 'DD' else mark end,
       on_note = replace(on_note, 'WeCare', 'DonorDelight'),
       off_note = replace(off_note, 'WeCare', 'DonorDelight')
 where module_key = 'care'
   and (name like '%WeCare%' or mark = 'WC' or on_note like '%WeCare%' or off_note like '%WeCare%');

update app.roles set description = replace(description, 'WeCare', 'DonorDelight') where description like '%WeCare%';

-- The functions that say the name in a message: re-created from their own definitions, the name replaced and nothing else.
do $$
declare r record;
begin
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%WeCare%'
  loop
    execute replace(pg_get_functiondef(r.oid), 'WeCare', 'DonorDelight');
  end loop;
end $$;
