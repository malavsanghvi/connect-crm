-- 0631: the matching questions, part 2 of 3 — the functions (B87, priority 1).
--
-- The tables of 0630 can only be read by the people who may run imports; every change goes through here. SECURITY DEFINER is used
-- where a policy cannot say what is needed (one answer changing many rows and writing a remembered answer; a result saved in pages
-- and swapped in at the end); each such function checks the permission first, with a plain sentence, and pins
-- search_path = app, public, extensions. The reading functions are ordinary (SECURITY INVOKER): row-level security decides what
-- they return.
--
-- The flow, one call each (src/lib/onboarding/resolve/store.ts):
--   resolve_stage_records   the rows of a run are staged for matching (pages of 500)
--   resolve_begin           a result is about to be saved → a batch id
--   resolve_store_records / _pairs / _clusters / _groups / _items   the engine's result, in pages of 500
--   resolve_finish          what the new result no longer contains is removed, the numbers are saved, the inbox is ready
--   resolve_inbox / resolve_item_detail / resolve_run_metrics   what the inbox screen shows
--   resolve_answer          a person's answer to a question; "the same answer for the other N"; the answer is remembered
--   resolve_set_group_status / resolve_reopen / resolve_revoke_rule   put off, skip, send on, undo
--   resolve_rules           the remembered answers of the community, as the engine reads them
--
-- Saving the same result again changes nothing (items and questions are kept by their keys, and a person's answer is kept); a
-- second file asks nothing the community has already answered (the rules are loaded into the engine, which answers from them).
-- A held item (a child, a money conflict) is never answered from a remembered answer: refused here, and again by the tables.

-- ── Small helpers ────────────────────────────────────────────────────────────

create or replace function app.resolve_texts(p_j jsonb) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case when p_j is not null and jsonb_typeof(p_j) = 'array'
              then coalesce(array(select jsonb_array_elements_text(p_j)), '{}'::text[]) else '{}'::text[] end
$$;

-- A page of a result must be a list of a sensible size.
create or replace function app.resolve_list(p_j jsonb, p_what text, p_max integer default 500) returns void
language plpgsql immutable set search_path = app, public, extensions as $$
begin
  if p_j is null or jsonb_typeof(p_j) is distinct from 'array' then raise exception 'The % must be a list.', p_what; end if;
  if jsonb_array_length(p_j) > p_max then raise exception 'Send at most % % at a time.', p_max, p_what; end if;
end $$;

-- A record as a card shows it: what identifies a household or a person, and nothing more. Never what a row says about children
-- (a "Kids" column, notes, school, grade, age, role, birth date).
create or replace function app.resolve_card(p_raw jsonb) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select case when p_raw is null or jsonb_typeof(p_raw) <> 'object' then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
    'name', p_raw->'name', 'firstName', p_raw->'firstName', 'lastName', p_raw->'lastName',
    'mobile', p_raw->'mobile', 'phone', p_raw->'phone', 'phone2', p_raw->'phone2', 'email', p_raw->'email', 'email2', p_raw->'email2',
    'address1', p_raw->'address1', 'address2', p_raw->'address2', 'city', p_raw->'city', 'state', p_raw->'state', 'zip', p_raw->'zip',
    'ids', p_raw->'ids', 'existing', p_raw->'existing', 'gift', p_raw->'gift')) end
$$;

-- The run, checked for matching: the caller may write its data type (0192), the module is on, and it has not started importing.
create or replace function app.resolve_assert_run(p_run uuid) returns app.import_runs
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('pending', 'staged', 'previewed') then
    raise exception 'Import #% has already started, so its rows can no longer be checked for matches. Start a new import instead.', r.run_number;
  end if;
  return r;
end $$;

-- The same, and the result being saved is still the one this caller started.
create or replace function app.resolve_assert_batch(p_run uuid, p_batch uuid) returns app.import_runs
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.resolve_assert_run(p_run);
  if p_batch is null or not exists (select 1 from app.import_run_metrics m where m.run_id = r.id and m.status = 'storing' and m.batch = p_batch) then
    raise exception 'Another check for matches started on Import #%, so this one was stopped. Try again.', r.run_number;
  end if;
  return r;
end $$;

-- Where each question of a run stands once its items are answered: answered when none is left open, open again when one is.
create or replace function app.resolve_refresh_groups(p_run uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.import_exceptions g set status = 'answered', answered_at = coalesce(g.answered_at, now())
   where g.run_id = p_run and g.status <> 'answered'
     and exists (select 1 from app.import_exception_items i where i.run_id = g.run_id and i.signature = g.signature)
     and not exists (select 1 from app.import_exception_items i where i.run_id = g.run_id and i.signature = g.signature and i.answer is null);
  update app.import_exceptions g set status = 'open'
   where g.run_id = p_run and g.status = 'answered'
     and exists (select 1 from app.import_exception_items i where i.run_id = g.run_id and i.signature = g.signature and i.answer is null);
end $$;

-- Takes answers back: every item a withdrawn remembered answer had answered, in this community's imports that have not started.
create or replace function app.resolve_withdraw(p_center uuid, p_rules text[]) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_runs uuid[]; v_run uuid; v_n integer;
begin
  with cleared as (
    update app.import_exception_items i
       set answer = null, answer_source = null, answered_by = null, answered_at = null
     where i.center_id = p_center
       and i.answer_source = any (array(select 'rule:' || x from unnest(p_rules) x))
       and i.run_id in (select r.id from app.import_runs r where r.center_id = p_center and r.status in ('pending', 'staged', 'previewed'))
    returning i.run_id)
  select coalesce(array_agg(distinct c.run_id), '{}'::uuid[]), count(*) into v_runs, v_n from cleared c;
  foreach v_run in array v_runs loop
    perform app.resolve_refresh_groups(v_run);
  end loop;
  return v_n;
end $$;

-- ── Staging a run's rows for matching ────────────────────────────────────────

-- Stage rows (pages of at most 500). Each is {id, source, source_kind, row_no, order_no, kind, read_confidence, raw}. Staging a row
-- again replaces it and forgets what was found about it; `p_first` starts the run's staging over. Original records are cleared
-- 90 days after the run, as import_rows.raw is.
create or replace function app.resolve_stage_records(p_run uuid, p_records jsonb, p_first boolean default false) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; x jsonb; n integer := 0; v_i integer := 0; v_id text; v_sk text; v_kind text; v_conf numeric;
begin
  r := app.resolve_assert_run(p_run);
  perform app.resolve_list(p_records, 'rows');
  perform app.import_audit(r, 'Matching');
  if p_first then
    delete from app.import_staged_records where run_id = r.id;
    update app.import_staged_records s set raw = null, normalized = null
     where s.center_id = r.center_id and (s.raw is not null or s.normalized is not null)
       and s.run_id in (select o.id from app.import_runs o where o.center_id = r.center_id and o.created_at < now() - interval '90 days');
  end if;
  -- New rows mean the last result no longer describes them: it is hidden until a new one is saved.
  insert into app.import_run_metrics (run_id, center_id, status) values (r.id, r.center_id, 'staged')
  on conflict (run_id) do update set status = 'staged', batch = null;
  for x in select * from jsonb_array_elements(p_records) loop
    v_id := nullif(btrim(x->>'id'), '');
    if v_id is null or char_length(v_id) > 200 then
      raise exception 'Row %: every row needs a name of 1 to 200 characters to be told apart.', coalesce(x->>'row_no', '?');
    end if;
    v_sk := coalesce(x->>'source_kind', 'spreadsheet');
    if v_sk not in ('spreadsheet', 'connector', 'paper', 'existing') then
      raise exception 'Row %: "%" is not a place rows come from.', coalesce(x->>'row_no', '?'), v_sk;
    end if;
    v_kind := coalesce(x->>'kind', 'unknown');
    if v_kind not in ('person', 'household', 'gift', 'unknown') then
      raise exception 'Row %: "%" is not a kind of record.', coalesce(x->>'row_no', '?'), v_kind;
    end if;
    if jsonb_typeof(x->'raw') is distinct from 'object' then
      raise exception 'Row %: the record itself is missing.', coalesce(x->>'row_no', '?');
    end if;
    v_conf := nullif(x->>'read_confidence', '')::numeric;
    insert into app.import_staged_records (run_id, center_id, id, source, source_kind, row_no, order_no, kind, read_confidence, raw)
    values (r.id, r.center_id, v_id, left(coalesce(nullif(btrim(x->>'source'), ''), r.file_name, 'file'), 200), v_sk,
            coalesce((x->>'row_no')::integer, 0), coalesce((x->>'order_no')::integer, v_i), v_kind, v_conf, x->'raw')
    on conflict (run_id, id) do update
      set source = excluded.source, source_kind = excluded.source_kind, row_no = excluded.row_no, order_no = excluded.order_no,
          kind = excluded.kind, read_confidence = excluded.read_confidence, raw = excluded.raw,
          normalized = null, fingerprint = null, minor = false, minor_reasons = '{}', type_uncertain = false, problems = '{}',
          status = null, how = null, tier = null, cluster_id = null, duplicate_of = null;
    n := n + 1;
    v_i := v_i + 1;
  end loop;
  return n;
end $$;

-- A page of the staged records, in order, for the engine to read: [{id, order_no, raw}]. Row-level security applies.
create or replace function app.resolve_staged_page(p_run uuid, p_after integer default -1, p_limit integer default 500) returns jsonb
language sql stable set search_path = app, public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'order_no', s.order_no, 'raw', s.raw) order by s.order_no), '[]'::jsonb)
    from (select t.id, t.order_no, t.raw from app.import_staged_records t
           where t.run_id = p_run and t.order_no > p_after order by t.order_no limit least(greatest(coalesce(p_limit, 500), 1), 1000)) s
$$;

-- ── Saving the engine's result ───────────────────────────────────────────────

-- Start saving a result. The run's last result stays in place until resolve_finish swaps this one in.
create or replace function app.resolve_begin(p_run uuid, p_engine_version text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; v_batch uuid := gen_random_uuid(); v_n integer;
begin
  r := app.resolve_assert_run(p_run);
  if p_config is null or jsonb_typeof(p_config) <> 'object' then raise exception 'The settings of the check are missing.'; end if;
  select count(*) into v_n from app.import_staged_records where run_id = r.id;
  if v_n = 0 then raise exception 'Import #% has no rows staged for matching yet.', r.run_number; end if;
  if exists (select 1 from app.import_staged_records where run_id = r.id and raw is null) then
    raise exception 'The original rows of Import #% were cleared after 90 days, so it cannot be checked again. Upload the file again.', r.run_number;
  end if;
  perform app.import_audit(r, 'Matching');
  insert into app.import_run_metrics (run_id, center_id, status, batch, engine_version, config, record_count, started_by, started_at)
  values (r.id, r.center_id, 'storing', v_batch, left(coalesce(p_engine_version, ''), 40), p_config, v_n, auth.uid(), now())
  on conflict (run_id) do update
    set status = 'storing', batch = excluded.batch, engine_version = excluded.engine_version, config = excluded.config,
        record_count = excluded.record_count, started_by = excluded.started_by, started_at = excluded.started_at;
  return v_batch;
end $$;

-- What was found about each row: its normalised form, fingerprint and what happens to it. [{id, normalized, fingerprint, minor,
-- minor_reasons, type_uncertain, problems, status, how, tier, cluster_id, duplicate_of}]
create or replace function app.resolve_store_records(p_run uuid, p_batch uuid, p_records jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; n integer;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  perform app.resolve_list(p_records, 'rows');
  update app.import_staged_records s
     set normalized = x.normalized, fingerprint = x.fingerprint, minor = coalesce(x.minor, false),
         minor_reasons = app.resolve_texts(x.minor_reasons), type_uncertain = coalesce(x.type_uncertain, false),
         problems = app.resolve_texts(x.problems), status = x.status, how = x.how, tier = x.tier,
         cluster_id = x.cluster_id, duplicate_of = x.duplicate_of
    from jsonb_to_recordset(p_records) as x(id text, normalized jsonb, fingerprint text, minor boolean, minor_reasons jsonb,
                                            type_uncertain boolean, problems jsonb, status text, how text, tier text,
                                            cluster_id text, duplicate_of text)
   where s.run_id = r.id and s.id = x.id;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_records) then
    raise exception 'Some rows of the result do not belong to Import #%. Nothing more was saved; check again.', r.run_number;
  end if;
  return n;
end $$;

-- The scored pairs. [{a, b, relation, strength, score, independent, evidence, conflicts, name_level, name_only, via_keys, money,
-- tier, tier_reasons, hold, signature, affected, implied}]
create or replace function app.resolve_store_pairs(p_run uuid, p_batch uuid, p_pairs jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; n integer;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  perform app.resolve_list(p_pairs, 'pairs');
  insert into app.import_record_links (run_id, center_id, a, b, relation, strength, score, independent, evidence, conflicts, name_level,
                                       name_only, via_keys, money, tier, tier_reasons, hold, signature, affected, implied, batch)
  select distinct on (x.a, x.b)
         r.id, r.center_id, x.a, x.b, x.relation, x.strength, coalesce(x.score, 0), coalesce(x.independent, 0),
         coalesce(x.evidence, '[]'::jsonb), coalesce(x.conflicts, '[]'::jsonb), x.name_level, coalesce(x.name_only, false),
         app.resolve_texts(x.via_keys), x.money, x.tier, app.resolve_texts(x.tier_reasons), x.hold, x.signature,
         app.resolve_texts(x.affected), coalesce(x.implied, false), p_batch
    from jsonb_to_recordset(p_pairs) as x(a text, b text, relation text, strength text, score numeric, independent integer,
                                          evidence jsonb, conflicts jsonb, name_level text, name_only boolean, via_keys jsonb,
                                          money jsonb, tier text, tier_reasons jsonb, hold text, signature text, affected jsonb,
                                          implied boolean)
   order by x.a, x.b, x.score desc nulls last
  on conflict (run_id, a, b) do update
    set relation = excluded.relation, strength = excluded.strength, score = excluded.score, independent = excluded.independent,
        evidence = excluded.evidence, conflicts = excluded.conflicts, name_level = excluded.name_level,
        name_only = excluded.name_only, via_keys = excluded.via_keys, money = excluded.money, tier = excluded.tier,
        tier_reasons = excluded.tier_reasons, hold = excluded.hold, signature = excluded.signature,
        affected = excluded.affected, implied = excluded.implied, batch = excluded.batch;
  get diagnostics n = row_count;
  return n;
end $$;

-- The households and people joined automatically. [{kind, id, record_ids, existing}]
create or replace function app.resolve_store_clusters(p_run uuid, p_batch uuid, p_clusters jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; n integer;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  perform app.resolve_list(p_clusters, 'groups of rows');
  insert into app.import_clusters (run_id, center_id, kind, id, record_ids, existing, batch)
  select distinct on (x.kind, x.id) r.id, r.center_id, x.kind, x.id, app.resolve_texts(x.record_ids), app.resolve_texts(x.existing), p_batch
    from jsonb_to_recordset(p_clusters) as x(kind text, id text, record_ids jsonb, existing jsonb)
   order by x.kind, x.id
  on conflict (run_id, kind, id) do update
    set record_ids = excluded.record_ids, existing = excluded.existing, batch = excluded.batch;
  get diagnostics n = row_count;
  return n;
end $$;

-- The questions, ranked. [{signature, tier, question, recommended, subject_count, item_count, money_cents, members, contacts,
-- rank_no, route_suggested}]. A question already there keeps where it stands (answered, put off, sent on).
create or replace function app.resolve_store_groups(p_run uuid, p_batch uuid, p_groups jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; n integer;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  perform app.resolve_list(p_groups, 'questions', 200);
  perform app.import_audit(r, 'Matching');
  insert into app.import_exceptions (center_id, run_id, signature, tier, batch, question, recommended, subject_count, item_count,
                                     money_cents, members, contacts, rank_no, route_suggested)
  select distinct on (x.signature) r.center_id, r.id, x.signature, x.tier, p_batch, x.question, x.recommended,
         coalesce(x.subject_count, 0), coalesce(x.item_count, 0), coalesce(x.money_cents, 0), coalesce(x.members, 0),
         coalesce(x.contacts, 0), coalesce(x.rank_no, 0), x.route_suggested
    from jsonb_to_recordset(p_groups) as x(signature text, tier text, question jsonb, recommended text, subject_count integer,
                                           item_count integer, money_cents bigint, members integer, contacts integer,
                                           rank_no integer, route_suggested text)
   order by x.signature
  on conflict (run_id, signature) do update
    set tier = excluded.tier, batch = excluded.batch, question = excluded.question, recommended = excluded.recommended,
        subject_count = excluded.subject_count, item_count = excluded.item_count, money_cents = excluded.money_cents,
        members = excluded.members, contacts = excluded.contacts, rank_no = excluded.rank_no,
        route_suggested = excluded.route_suggested;
  get diagnostics n = row_count;
  return n;
end $$;

-- What each question is about. [{key, signature, kind, tier, subject, record_ids, fingerprints, evidence_kinds, conflict_kinds,
-- shared, money_cents, members, contacts, rule_id, rule_answer}]. `rule_id` and `rule_answer` say a remembered answer already
-- answers the item. That is refused for a held item (tier D), for a record, for a rule that is not the community's, withdrawn, for
-- another pattern, or with another answer. A person's answer to an item is kept when the result is saved again.
create or replace function app.resolve_store_items(p_run uuid, p_batch uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; n integer; v_bad integer;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  perform app.resolve_list(p_items, 'items');
  select count(*) into v_bad
    from jsonb_to_recordset(p_items) as x(key text, signature text, kind text, tier text, rule_id text, rule_answer text)
   where x.rule_id is not null
     and not exists (select 1 from app.import_decision_rules d
                      where d.center_id = r.center_id and d.id = x.rule_id and d.revoked_at is null and d.signature = x.signature
                        and d.answer = x.rule_answer and x.tier = 'C' and x.kind = 'pair');
  if v_bad > 0 then
    raise exception 'A remembered answer was about % item(s) it does not apply to (a child, a money conflict, or another kind of question). Nothing was saved.', v_bad;
  end if;
  perform app.import_audit(r, 'Matching');
  insert into app.import_exception_items as i (center_id, run_id, key, signature, kind, tier, subject, record_ids, fingerprints,
                                               evidence_kinds, conflict_kinds, shared, money_cents, members, contacts, batch,
                                               answer, answer_source, answered_at)
  select distinct on (x.key) r.center_id, r.id, x.key, x.signature, x.kind, x.tier, x.subject, app.resolve_texts(x.record_ids),
         app.resolve_texts(x.fingerprints), app.resolve_texts(x.evidence_kinds), app.resolve_texts(x.conflict_kinds),
         coalesce(x.shared, '{}'::jsonb), coalesce(x.money_cents, 0), coalesce(x.members, 0), coalesce(x.contacts, 0), p_batch,
         case when x.rule_id is not null then x.rule_answer end,
         case when x.rule_id is not null then 'rule:' || x.rule_id end,
         case when x.rule_id is not null then now() end
    from jsonb_to_recordset(p_items) as x(key text, signature text, kind text, tier text, subject text, record_ids jsonb,
                                          fingerprints jsonb, evidence_kinds jsonb, conflict_kinds jsonb, shared jsonb,
                                          money_cents bigint, members integer, contacts integer, rule_id text, rule_answer text)
   order by x.key
  on conflict (run_id, key) do update
    set signature = excluded.signature, kind = excluded.kind, tier = excluded.tier, subject = excluded.subject,
        record_ids = excluded.record_ids, fingerprints = excluded.fingerprints, evidence_kinds = excluded.evidence_kinds,
        conflict_kinds = excluded.conflict_kinds, shared = excluded.shared, money_cents = excluded.money_cents,
        members = excluded.members, contacts = excluded.contacts, batch = excluded.batch,
        -- A person's answer stands. Anything else follows what the engine says now (a remembered answer, or none).
        answer = case when i.answer_source in ('person', 'person_bulk') then i.answer else excluded.answer end,
        answer_source = case when i.answer_source in ('person', 'person_bulk') then i.answer_source else excluded.answer_source end,
        answered_by = case when i.answer_source in ('person', 'person_bulk') then i.answered_by else null end,
        answered_at = case when i.answer_source in ('person', 'person_bulk') then i.answered_at
                           when excluded.answer is not null then coalesce(i.answered_at, excluded.answered_at) end;
  get diagnostics n = row_count;
  return n;
end $$;

-- The result is complete: what the new result no longer contains goes, the numbers are saved and the inbox is ready.
create or replace function app.resolve_finish(p_run uuid, p_batch uuid, p_metrics jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.resolve_assert_batch(p_run, p_batch);
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'object' then raise exception 'The numbers of the result are missing.'; end if;
  perform app.import_audit(r, 'Matching');
  delete from app.import_record_links where run_id = r.id and batch is distinct from p_batch;
  delete from app.import_clusters where run_id = r.id and batch is distinct from p_batch;
  delete from app.import_exceptions where run_id = r.id and batch is distinct from p_batch;
  delete from app.import_exception_items where run_id = r.id and batch is distinct from p_batch;
  perform app.resolve_refresh_groups(r.id);
  -- How often each remembered answer has been used, counted from the items that carry it (so saving twice counts once).
  update app.import_decision_rules d
     set uses = (select count(*) from app.import_exception_items i where i.center_id = d.center_id and i.answer_source = 'rule:' || d.id),
         last_used_at = (select max(i.answered_at) from app.import_exception_items i where i.center_id = d.center_id and i.answer_source = 'rule:' || d.id)
   where d.center_id = r.center_id;
  update app.import_run_metrics
     set status = 'ready', metrics = p_metrics, stored_at = now()
   where run_id = r.id;
  return jsonb_build_object('questions', (select count(*) from app.import_exceptions where run_id = r.id),
                            'items', (select count(*) from app.import_exception_items where run_id = r.id),
                            'items_answered_by_rules', (select count(*) from app.import_exception_items where run_id = r.id and answer_source like 'rule:%'));
end $$;

-- ── Answering ────────────────────────────────────────────────────────────────

-- A person's answer. It is for one item (the one given, or the first still open); `p_apply_rest` gives the same answer to the
-- other open items of the same question ("same answer for the other N"). The answer is remembered for the community (so a later
-- file never asks again) unless `p_remember` is false or the kind of question cannot be remembered. Held items (a child, a money
-- conflict) are never remembered, and a money conflict is never answered in bulk. Questions about gifts need giving.manage.
create or replace function app.resolve_answer(p_group uuid, p_answer text, p_item uuid default null, p_apply_rest boolean default false,
                                              p_remember boolean default true, p_scope text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.import_exceptions; r app.import_runs; spec app.import_signatures; it app.import_exception_items;
        v_rest integer := 0; v_open integer; v_rule text; v_scope text; v_cond jsonb; v_field text; v_val text;
        v_order text[]; v_f text; v_perms text[];
begin
  select * into g from app.import_exceptions where id = p_group for update;
  if g.id is null then raise exception 'That question was not found.'; end if;
  r := app.resolve_assert_run(g.run_id);
  if (select m.status from app.import_run_metrics m where m.run_id = g.run_id) is distinct from 'ready' then
    raise exception 'The matches for Import #% are still being worked out. Try again in a moment.', r.run_number;
  end if;
  select * into spec from app.import_signatures where signature = g.signature;
  if p_answer is null or not (p_answer = any (spec.answers)) then raise exception 'That is not one of the answers to this question.'; end if;
  if spec.money then
    v_perms := coalesce((select e.write_perms from app.import_entities e where e.key = 'payments'), '{}'::text[]);
    if not app.import_has_any(r.center_id, v_perms) then
      raise exception 'Answering questions about gifts needs one of these permissions: %.', array_to_string(v_perms, ', ')
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if p_apply_rest and not spec.same_for_rest then
    raise exception 'Each of these needs its own answer, so one answer cannot be used for the others.';
  end if;
  if p_item is not null then
    select * into it from app.import_exception_items where id = p_item and run_id = g.run_id and signature = g.signature;
    if it.id is null then raise exception 'That item does not belong to this question.'; end if;
  else
    select * into it from app.import_exception_items
     where run_id = g.run_id and signature = g.signature and answer is null order by money_cents desc, key limit 1;
    if it.id is null then raise exception 'Every item in this question already has an answer.'; end if;
  end if;
  perform app.import_audit(r, 'Matching');

  update app.import_exception_items
     set answer = p_answer, answer_source = 'person', answered_by = auth.uid(), answered_at = now()
   where id = it.id;
  if p_apply_rest then
    update app.import_exception_items
       set answer = p_answer, answer_source = 'person_bulk', answered_by = auth.uid(), answered_at = now()
     where run_id = g.run_id and signature = g.signature and answer is null and id <> it.id;
    get diagnostics v_rest = row_count;
  end if;

  -- Remember it: never a held kind, never a record on its own (only a pair of records can be a pattern).
  if p_remember and spec.rememberable and it.tier = 'C' and it.kind = 'pair' then
    v_scope := coalesce(p_scope, spec.default_scope);
    if v_scope not in ('exact_pair', 'identifier', 'pattern') then raise exception 'That is not a way to remember an answer.'; end if;
    if v_scope = 'identifier' then
      v_order := case g.signature
                   when 'shared_phone_households' then array['phone', 'email', 'address', 'id']
                   when 'shared_email_households' then array['email', 'phone', 'address', 'id']
                   when 'address_unit_differs' then array['address', 'phone', 'email', 'id']
                   else array['phone', 'email', 'address', 'id'] end;
      foreach v_f in array v_order loop
        if nullif(it.shared->>v_f, '') is not null then v_field := v_f; v_val := it.shared->>v_f; exit; end if;
      end loop;
      if v_field is null then
        v_scope := 'exact_pair';
      else
        v_cond := jsonb_build_array(jsonb_build_object('type', 'identifier', 'field', v_field, 'value', v_val));
      end if;
    end if;
    if v_scope = 'pattern' then
      v_cond := jsonb_build_array(jsonb_build_object('type', 'evidence', 'requires', to_jsonb(it.evidence_kinds),
                                                     'allowsConflicts', to_jsonb(it.conflict_kinds)));
    elsif v_scope = 'exact_pair' then
      v_cond := jsonb_build_array(jsonb_build_object('type', 'pair',
                   'fingerprints', jsonb_build_array(it.fingerprints[1], coalesce(it.fingerprints[2], it.fingerprints[1]))));
    end if;
    v_rule := 'rule:' || g.signature || ':' || v_scope || ':' || substr(md5(v_cond::text), 1, 12);
    insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer, decided_by, decided_at, from_group, from_run)
    values (v_rule, r.center_id, g.signature, v_scope, v_cond, p_answer, auth.uid(), now(), 'grp:' || g.signature, r.id)
    on conflict (center_id, id) do update
      set answer = excluded.answer, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
          from_group = excluded.from_group, from_run = excluded.from_run, revoked_at = null, revoked_by = null;
  end if;

  select count(*) into v_open from app.import_exception_items where run_id = g.run_id and signature = g.signature and answer is null;
  update app.import_exceptions
     set answer = p_answer, apply_to_rest = coalesce(p_apply_rest, false), answered_by = auth.uid(), answered_at = now(),
         status = case when v_open = 0 then 'answered' else 'open' end, routed_to = null, status_by = auth.uid(), status_at = now()
   where id = g.id;
  return jsonb_build_object('answered', 1 + v_rest, 'open_items', v_open, 'status', case when v_open = 0 then 'answered' else 'open' end,
                            'remembered_as', v_rule);
end $$;

-- Put a question off (postponed), skip it, send it on to someone else, or bring it back (open). An answered question is reopened
-- with resolve_reopen. Sending on records who it was meant for; helper links come later.
create or replace function app.resolve_set_group_status(p_group uuid, p_status text, p_routed_to text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.import_exceptions; r app.import_runs; v_route text;
begin
  if p_status is null or p_status not in ('open', 'postponed', 'skipped', 'sent') then
    raise exception 'A question can be put off, skipped, sent on or opened again.';
  end if;
  select * into g from app.import_exceptions where id = p_group for update;
  if g.id is null then raise exception 'That question was not found.'; end if;
  r := app.resolve_assert_run(g.run_id);
  if g.status = 'answered' then raise exception 'This question is already answered. Reopen it first.'; end if;
  v_route := case when p_status = 'sent' then coalesce(nullif(btrim(p_routed_to), ''), g.route_suggested) end;
  if p_status = 'sent' and v_route is null then raise exception 'Choose who to send this question to.'; end if;
  perform app.import_audit(r, 'Matching');
  update app.import_exceptions
     set status = p_status, routed_to = v_route, status_by = auth.uid(), status_at = now()
   where id = g.id;
end $$;

-- Take a question's answers back: the answers a person gave to its items are cleared, the remembered answers made from it are
-- withdrawn (and the items they had answered in imports that have not started are open again), and the question is open.
create or replace function app.resolve_reopen(p_group uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.import_exceptions; r app.import_runs; v_rules text[]; v_cleared integer; v_withdrawn integer := 0;
begin
  select * into g from app.import_exceptions where id = p_group for update;
  if g.id is null then raise exception 'That question was not found.'; end if;
  r := app.resolve_assert_run(g.run_id);
  perform app.import_audit(r, 'Matching');
  update app.import_exception_items
     set answer = null, answer_source = null, answered_by = null, answered_at = null
   where run_id = g.run_id and signature = g.signature and answer_source in ('person', 'person_bulk');
  get diagnostics v_cleared = row_count;
  with gone as (
    update app.import_decision_rules d set revoked_at = now(), revoked_by = auth.uid()
     where d.center_id = r.center_id and d.from_run = g.run_id and d.from_group = 'grp:' || g.signature and d.revoked_at is null
    returning d.id)
  select coalesce(array_agg(gone.id), '{}'::text[]) into v_rules from gone;
  if cardinality(v_rules) > 0 then v_withdrawn := app.resolve_withdraw(r.center_id, v_rules); end if;
  update app.import_exceptions
     set status = 'open', answer = null, apply_to_rest = false, answered_by = null, answered_at = null, routed_to = null,
         status_by = auth.uid(), status_at = now()
   where id = g.id;
  perform app.resolve_refresh_groups(g.run_id);
  return jsonb_build_object('cleared', v_cleared, 'rules_withdrawn', cardinality(v_rules), 'items_reopened_elsewhere', v_withdrawn);
end $$;

-- Withdraw one remembered answer. Items it answered, in imports that have not started, are open again.
create or replace function app.resolve_revoke_rule(p_center uuid, p_rule text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n integer;
begin
  if not app.resolve_center_allowed(p_center) then
    raise exception 'Withdrawing a remembered answer needs one of these permissions: %.', array_to_string(app.onboarding_perms(null), ', ')
      using errcode = 'insufficient_privilege';
  end if;
  perform app.set_audit_context('Matching · remembered answer withdrawn');
  update app.import_decision_rules set revoked_at = now(), revoked_by = auth.uid()
   where center_id = p_center and id = p_rule and revoked_at is null;
  if not found then raise exception 'That remembered answer was not found, or it was already withdrawn.'; end if;
  v_n := app.resolve_withdraw(p_center, array[p_rule]);
  return jsonb_build_object('items_reopened', v_n);
end $$;

-- ── What the screens read ────────────────────────────────────────────────────

-- The community's remembered answers, in the shape the engine reads them (DecisionRule in memory.ts).
create or replace function app.resolve_rules(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.resolve_center_allowed(p_center) then
    raise exception 'Reading the remembered answers needs one of these permissions: %.', array_to_string(app.onboarding_perms(null), ', ')
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'signature', d.signature, 'scope', d.scope, 'conditions', d.conditions, 'answer', d.answer,
             'decidedBy', coalesce(d.decided_by::text, ''),
             'decidedAt', to_char(d.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'fromGroup', d.from_group, 'revokedAt', null) order by d.decided_at, d.id)
      from app.import_decision_rules d where d.center_id = p_center and d.revoked_at is null), '[]'::jsonb);
end $$;

-- Where a run's questions stand, and what is left: questions left, items left, minutes left (from the settings the run used).
create or replace function app.resolve_progress(p_run uuid, p_config jsonb) returns jsonb
language sql stable set search_path = app, public, extensions as $$
  with it as (
    select i.signature,
           count(*) filter (where i.answer is null) as open_items,
           count(*) filter (where i.answer is not null) as answered_items,
           count(*) as total_items
      from app.import_exception_items i where i.run_id = p_run group by i.signature),
  gs as (
    select g.status, g.tier, s.money, coalesce(it.open_items, 0) as open_items,
           (g.status in ('open', 'postponed') and coalesce(it.open_items, 0) > 0) as to_do
      from app.import_exceptions g join app.import_signatures s on s.signature = g.signature
      left join it on it.signature = g.signature where g.run_id = p_run),
  who as (
    select count(*) filter (where i.answer_source in ('person', 'person_bulk')) as by_person,
           count(*) filter (where i.answer_source like 'rule:%') as by_rule,
           count(*) filter (where i.answer_source in ('person', 'person_bulk') and i.answer = g.recommended) as accepted,
           min(i.answered_at) filter (where i.answer_source in ('person', 'person_bulk')) as first_at,
           max(i.answered_at) filter (where i.answer_source in ('person', 'person_bulk')) as last_at
      from app.import_exception_items i left join app.import_exceptions g on g.run_id = i.run_id and g.signature = i.signature
     where i.run_id = p_run)
  select jsonb_build_object(
    'groups_total', (select count(*) from gs),
    'groups_open', (select count(*) from gs where status = 'open'),
    'groups_answered', (select count(*) from gs where status = 'answered'),
    'groups_postponed', (select count(*) from gs where status = 'postponed'),
    'groups_skipped', (select count(*) from gs where status = 'skipped'),
    'groups_sent', (select count(*) from gs where status = 'sent'),
    'questions_left', (select count(*) from gs where to_do),
    'items_total', (select coalesce(sum(total_items), 0) from it),
    'items_open', (select coalesce(sum(open_items), 0) from it),
    'items_answered', (select coalesce(sum(answered_items), 0) from it),
    'answered_by_people', (select by_person from who),
    'answered_by_rules', (select by_rule from who),
    'suggestions_accepted', (select accepted from who),
    'first_answered_at', (select first_at from who),
    'last_answered_at', (select last_at from who),
    'minutes_left', round((select coalesce(sum(
        coalesce((p_config->'budget'->>'secondsPerQuestion')::numeric, 30)
        + case when gs.tier = 'D' then gs.open_items * (case when gs.money
                 then coalesce((p_config->'budget'->>'secondsPerHeldMoneyItem')::numeric, 30)
                 else coalesce((p_config->'budget'->>'secondsPerHeldOtherItem')::numeric, 1) end) else 0 end), 0)
        from gs where gs.to_do) / 60.0, 1))
$$;

-- The inbox of a run: the questions ranked by value (money, then members, then contacts), each with how many items are open and
-- the next one to show; the numbers at the top; what is left. Row-level security applies: someone who may not use the run gets
-- status 'none'.
create or replace function app.resolve_inbox(p_run uuid) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare m app.import_run_metrics; v_groups jsonb;
begin
  select * into m from app.import_run_metrics where run_id = p_run;
  if m.run_id is null then return jsonb_build_object('status', 'none', 'groups', '[]'::jsonb); end if;
  with it as (
    select i.signature,
           count(*) filter (where i.answer is null) as open_items,
           count(*) filter (where i.answer is not null) as answered_items
      from app.import_exception_items i where i.run_id = p_run group by i.signature),
  nxt as (
    select distinct on (i.signature) i.signature, i.id
      from app.import_exception_items i where i.run_id = p_run and i.answer is null
     order by i.signature, i.money_cents desc, i.key)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'signature', g.signature, 'tier', g.tier, 'status', g.status, 'question', g.question,
           'recommended', g.recommended, 'route_suggested', g.route_suggested, 'routed_to', g.routed_to,
           'subject_count', g.subject_count, 'item_count', g.item_count,
           'open_items', coalesce(it.open_items, 0), 'answered_items', coalesce(it.answered_items, 0),
           'money_cents', g.money_cents, 'members', g.members, 'contacts', g.contacts, 'rank', g.rank_no,
           'answer', g.answer, 'apply_to_rest', g.apply_to_rest, 'next_item_id', nxt.id,
           'money', s.money, 'same_for_rest', s.same_for_rest, 'rememberable', s.rememberable) order by g.rank_no, g.signature), '[]'::jsonb)
    into v_groups
    from app.import_exceptions g
    join app.import_signatures s on s.signature = g.signature
    left join it on it.signature = g.signature
    left join nxt on nxt.signature = g.signature
   where g.run_id = p_run;
  return jsonb_build_object(
    'status', m.status,
    'stalled', (m.status = 'storing' and m.started_at < now() - interval '15 minutes'),
    'engine_version', m.engine_version, 'stored_at', m.stored_at, 'record_count', m.record_count,
    'metrics', m.metrics, 'progress', app.resolve_progress(p_run, m.config), 'groups', v_groups);
end $$;

-- One item for its card: the pair, the evidence, the conflicts, and each record as a card. A child's record is never opened (its
-- card holds only that it is held), and a card never carries what a row says about children.
create or replace function app.resolve_item_detail(p_item uuid) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare i app.import_exception_items; v_records jsonb; v_link jsonb;
begin
  select * into i from app.import_exception_items where id = p_item;
  if i.id is null then return null; end if;
  select coalesce(jsonb_agg(
           case when s.minor then jsonb_build_object('id', s.id, 'minor', true, 'row_no', s.row_no, 'source', s.source, 'kind', s.kind)
                else jsonb_build_object('id', s.id, 'minor', false, 'row_no', s.row_no, 'source', s.source, 'source_kind', s.source_kind,
                                        'kind', s.kind, 'card', app.resolve_card(s.raw)) end
           order by array_position(i.record_ids, s.id)), '[]'::jsonb)
    into v_records
    from app.import_staged_records s where s.run_id = i.run_id and s.id = any (i.record_ids);
  select jsonb_build_object('relation', l.relation, 'strength', l.strength, 'score', l.score, 'evidence', l.evidence,
                            'conflicts', l.conflicts, 'tier_reasons', to_jsonb(l.tier_reasons))
    into v_link
    from app.import_record_links l
   where l.run_id = i.run_id and ((l.a = i.record_ids[1] and l.b = i.record_ids[2]) or (l.a = i.record_ids[2] and l.b = i.record_ids[1]))
   limit 1;
  return jsonb_build_object(
    'item', jsonb_build_object('id', i.id, 'key', i.key, 'signature', i.signature, 'kind', i.kind, 'tier', i.tier, 'subject', i.subject,
                               'record_ids', to_jsonb(i.record_ids), 'money_cents', i.money_cents, 'answer', i.answer,
                               'answer_source', i.answer_source, 'answered_at', i.answered_at),
    'link', v_link, 'records', v_records);
end $$;

-- The numbers of a run: what the engine measured when the result was saved, and how the questions stand now.
create or replace function app.resolve_run_metrics(p_run uuid) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare m app.import_run_metrics;
begin
  select * into m from app.import_run_metrics where run_id = p_run;
  if m.run_id is null then return null; end if;
  return jsonb_build_object('status', m.status, 'engine_version', m.engine_version, 'stored_at', m.stored_at,
                            'record_count', m.record_count, 'config', m.config, 'metrics', m.metrics,
                            'live', app.resolve_progress(p_run, m.config));
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.resolve_assert_run(uuid), app.resolve_assert_batch(uuid, uuid), app.resolve_refresh_groups(uuid),
  app.resolve_withdraw(uuid, text[]) from public, anon, authenticated;
revoke execute on function app.resolve_texts(jsonb), app.resolve_list(jsonb, text, integer), app.resolve_card(jsonb),
  app.resolve_stage_records(uuid, jsonb, boolean), app.resolve_staged_page(uuid, integer, integer),
  app.resolve_begin(uuid, text, jsonb), app.resolve_store_records(uuid, uuid, jsonb), app.resolve_store_pairs(uuid, uuid, jsonb),
  app.resolve_store_clusters(uuid, uuid, jsonb), app.resolve_store_groups(uuid, uuid, jsonb), app.resolve_store_items(uuid, uuid, jsonb),
  app.resolve_finish(uuid, uuid, jsonb), app.resolve_answer(uuid, text, uuid, boolean, boolean, text),
  app.resolve_set_group_status(uuid, text, text), app.resolve_reopen(uuid), app.resolve_revoke_rule(uuid, text),
  app.resolve_rules(uuid), app.resolve_progress(uuid, jsonb), app.resolve_inbox(uuid), app.resolve_item_detail(uuid),
  app.resolve_run_metrics(uuid) from public, anon;
grant execute on function app.resolve_texts(jsonb), app.resolve_list(jsonb, text, integer), app.resolve_card(jsonb),
  app.resolve_stage_records(uuid, jsonb, boolean), app.resolve_staged_page(uuid, integer, integer),
  app.resolve_begin(uuid, text, jsonb), app.resolve_store_records(uuid, uuid, jsonb), app.resolve_store_pairs(uuid, uuid, jsonb),
  app.resolve_store_clusters(uuid, uuid, jsonb), app.resolve_store_groups(uuid, uuid, jsonb), app.resolve_store_items(uuid, uuid, jsonb),
  app.resolve_finish(uuid, uuid, jsonb), app.resolve_answer(uuid, text, uuid, boolean, boolean, text),
  app.resolve_set_group_status(uuid, text, text), app.resolve_reopen(uuid), app.resolve_revoke_rule(uuid, text),
  app.resolve_rules(uuid), app.resolve_progress(uuid, jsonb), app.resolve_inbox(uuid), app.resolve_item_detail(uuid),
  app.resolve_run_metrics(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
