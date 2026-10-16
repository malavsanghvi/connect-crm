-- 0876: a person reads "payment confirmation", never "proof". Only text changed: the module row, the three notice templates and the
-- string literals of the functions that speak to people. The internal names (giving_proofs, proof_* keys) are untouched.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
begin;
select pg_temp.assert((select label from app.modules where key = 'giving_proofs') = 'Payment confirmations', 'the module is called Payment confirmations');
select pg_temp.assert((select description !~* 'proof' and description ~ 'approves it' from app.modules where key = 'giving_proofs'), 'its description says no proof and no verify');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and key in ('proof_approved', 'proof_rejected', 'proof_question') and language = 'en') = 6,
                      'the three platform notices still have a push and an email each');
select pg_temp.assert(not exists (select 1 from app.message_templates
                                   where center_id is null and key in ('proof_approved', 'proof_rejected', 'proof_question') and language = 'en'
                                     and (coalesce(subject, '') || ' ' || body) ~* 'proof'),
                      'no platform notice says proof');
select pg_temp.assert((select body like '%payment confirmation%' from app.message_templates where center_id is null and key = 'proof_question' and channel = 'email'::app.channel and language = 'en'),
                      'the question email says payment confirmation');
-- every function that speaks to a person: no string literal of more than one word mentions a proof (comments and key names are not read)
select pg_temp.assert(not exists (
  select 1 from pg_proc p
   where p.pronamespace = 'app'::regnamespace and p.proname <> 'submit_org_verification'
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '''[^''\n]*[[:space:]][Pp]roofs?([^a-zA-Z_:][^''\n]*)?''|''[Pp]roofs?[[:space:]][^''\n]*'''),
  'no function text a person reads still says proof');
select pg_temp.assert((select count(*) from pg_proc where pronamespace = 'app'::regnamespace
                        and proname in ('submit_payment_proof', 'approve_payment_proof', 'reject_payment_proof', 'ask_proof_question', 'answer_proof_question',
                                        'withdraw_payment_proof', 'payment_proof_queue', 'proof_policy')) = 8,
                      'the function names are unchanged');
rollback;
