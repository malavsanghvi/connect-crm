-- 0019 — run on hosted Supabase, where pgcrypto lives in the `extensions` schema.
-- Functions pinned to `search_path = app, public` could not see digest() /
-- gen_random_bytes() there (audit hash chain, ticket tokens, bank fingerprints).
-- Every app function that pins a search_path now includes `extensions`, and the
-- trigger functions that call pgcrypto get one. On plain Postgres the extra schema
-- is harmless.
-- Rule for later migrations: write `set search_path = app, public, extensions`.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f'
      and (exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
           or p.proname in ('audit_chain', 'issue_ticket_tokens', 'bank_transactions_prepare', 'bank_transactions_fingerprint'))
  loop
    execute format('alter function %s set search_path = app, public, extensions', f.sig);
  end loop;
end $$;
