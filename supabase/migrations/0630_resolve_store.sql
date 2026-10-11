-- 0630: the matching questions, part 1 of 3 — where the work is kept (B87, priority 1, "data onboarding intelligence").
--
-- The resolve engine (src/lib/onboarding/resolve/**) is pure code: given the rows of a file it decides most matches itself and
-- turns the rest into the fewest, best-worded questions. This migration is the storage for its work, tied to the import engine
-- that already exists (0192 import_runs and import_rows, 0545 guided onboarding): a run's rows are staged here for matching, the
-- engine's result is saved, a person answers the questions, and every answer is remembered so a later file never asks twice.
--
--   app.import_signatures        the kinds of question (a closed catalog, mirrors SIGNATURES in the engine): who is best placed to
--                                answer, the allowed answers, whether an answer may be remembered. Held kinds never can be.
--   app.import_staged_records    one row per input row of a run: the original record, its normalised form, a content fingerprint
--                                (recognises the same record on a later pull) and what happened to it (auto / bulk / asked / held).
--   app.import_record_links      every scored pair of records, with its tier, score, evidence and conflicts.
--   app.import_clusters          households and people the engine joined automatically.
--   app.import_exceptions        the questions: one per pattern, ranked by value, with the plain-English wording, the recommended
--                                answer and where it stands (open / answered / put off / skipped / sent on).
--   app.import_exception_items   what each question is about: one pair or one held record, with its own answer.
--   app.import_decision_rules    remembered answers, scoped to the community, who answered and when.
--   app.import_run_metrics       per run: the engine version, the settings it ran with (so a run can be replayed) and the numbers.
--
-- ACCESS. The same people who may run an import today, for the three kinds of file that are matched (people, households,
-- payments): whoever may write the run's data type (0192, app.import_run_allowed) AND holds one of the guided onboarding's
-- permissions (0545: people.manage or giving.manage); platform admins always. Someone who may import only zones, events, the
-- store, Pathshala or bank accounts gets nothing. Remembered answers belong to the community and follow the guided onboarding's
-- rule. Gift questions need giving.manage for everything done to them (answer, put off, send on, take back, withdraw). Nobody can
-- write any of these tables directly: `authenticated` can only SELECT, every change goes through the functions of 0631, which
-- check the permission again.
--
-- PERSONAL DATA. import_staged_records.raw and .normalized are the uploaded rows (names, mobiles, e-mails, addresses, amounts, and a
-- child's row too, held for a person). They are kept like import_rows.raw: cleared 90 days after the run, never sent to a model,
-- and deleted with the run; the daily retention sweep (app.resolve_purge, 0631) also clears what the screens derived from them
-- (the phone, e-mail and address two records share, the blocking keys of a pair, the example lines of a question) and removes
-- the personal values of a remembered answer that has not been used for 90 days. Six tables are left out of the row-by-row audit
-- log on purpose (supabase/tests/13 lists them): import_staged_records, import_record_links, import_clusters,
-- import_exceptions, import_exception_items and import_decision_rules. They hold the uploaded file again, or what was derived
-- from it, or (the items and the rules) the phone numbers, e-mails and addresses they were made from, and the audit log is
-- append-only and kept for good: copying that into it, and again on every save, would keep personal data there after the file is
-- purged. What a PERSON decided is audited another way, by explicit entries that carry no personal value (app.log_audit, from
-- the functions of 0631): the answer given to a question and how many items it covered, a question put off or sent on or taken
-- back, a remembered answer made or withdrawn, and the retention sweep. The catalog and the run header (settings and numbers
-- only) are audited row by row.

-- ── The kinds of question ────────────────────────────────────────────────────
-- Kept in step with SIGNATURES in src/lib/onboarding/resolve/exceptions.ts by tests/onboarding-resolve-store.test.ts.
create table if not exists app.import_signatures (
  signature     text primary key,
  tier          text not null check (tier in ('C', 'D')),
  -- The first answer is the one Weaver recommends. At most three.
  answers       text[] not null check (cardinality(answers) between 1 and 3),
  -- A held kind (tier D: a child, a money conflict) can never be remembered, so a rule can never answer it.
  rememberable  boolean not null,
  default_scope text not null check (default_scope in ('exact_pair', 'identifier', 'pattern')),
  route_to      text check (route_to in ('treasurer', 'membership')),
  money         boolean not null,
  same_for_rest boolean not null,
  -- The ways a remembered answer to this kind of question may be scoped (none when it may not be remembered).
  scopes        text[] not null default '{}',
  -- Whether an item of this kind is about a pair of records or about one record on its own.
  item_kind     text not null check (item_kind in ('pair', 'record')),
  check (not (tier = 'D' and rememberable)),
  -- Money is never remembered: a gift is decided again each time (a recommendation to the owner, enforced).
  check (not (money and rememberable)),
  check (rememberable = (cardinality(scopes) > 0)),
  check (scopes <@ array['exact_pair', 'identifier', 'pattern']::text[]),
  check (not rememberable or default_scope = any (scopes)),
  check (answers <@ array['same_household', 'same_person', 'separate', 'same_gift', 'different_gifts', 'use_first', 'use_second', 'hold',
                          'person_will_add', 'ignore_row', 'is_person', 'is_household', 'confirm_read', 'fix_in_source']::text[])
);
comment on table app.import_signatures is
  'The kinds of matching question (0630): the allowed answers, the recommended one first, who is best placed to answer, whether an answer may be remembered and how widely. Held kinds (tier D), money and a name alone never can. Mirrors SIGNATURES in the resolve engine, and is stricter than it in three places (a name only, a gift in two sources, a child answered in bulk): tests/onboarding-resolve-store.test.ts lists them.';

insert into app.import_signatures (signature, tier, answers, rememberable, default_scope, route_to, money, same_for_rest, scopes, item_kind) values
  ('spouse_maiden_name',           'C', array['same_household', 'separate'],                true,  'pattern',    'membership', false, true,  array['pattern', 'exact_pair'],    'pair'),
  ('shared_phone_households',      'C', array['separate', 'same_household'],                true,  'identifier', 'membership', false, true,  array['identifier', 'exact_pair'], 'pair'),
  ('address_unit_differs',         'C', array['separate', 'same_household'],                true,  'identifier', 'membership', false, true,  array['identifier', 'exact_pair'], 'pair'),
  ('shared_email_households',      'C', array['separate', 'same_household'],                true,  'identifier', 'membership', false, true,  array['identifier', 'exact_pair'], 'pair'),
  ('name_only',                    'C', array['separate', 'same_person'],                   false, 'exact_pair', 'membership', false, true,  '{}'::text[],                     'pair'),
  ('birth_year_differs',           'C', array['separate', 'same_person'],                   true,  'exact_pair', 'membership', false, true,  array['exact_pair'],              'pair'),
  ('ids_differ',                   'C', array['separate', 'same_person'],                   true,  'exact_pair', 'membership', false, true,  array['exact_pair'],              'pair'),
  ('id_name_differs',              'C', array['same_person', 'separate'],                   true,  'exact_pair', 'membership', false, true,  array['exact_pair'],              'pair'),
  ('duplicate_gift_two_sources',   'C', array['same_gift', 'different_gifts'],              false, 'exact_pair', 'treasurer',  true,  true,  '{}'::text[],                     'pair'),
  ('low_confidence_read',          'C', array['confirm_read', 'ignore_row'],                false, 'exact_pair', null,         false, false, '{}'::text[],                     'record'),
  ('linked_through_another_record','C', array['separate', 'same_household'],                true,  'exact_pair', 'membership', false, true,  array['exact_pair'],              'pair'),
  ('amount_differs_cents',         'D', array['hold', 'use_first', 'use_second'],           false, 'exact_pair', 'treasurer',  true,  false, '{}'::text[],                     'pair'),
  ('amount_differs',               'D', array['hold', 'use_first', 'use_second'],           false, 'exact_pair', 'treasurer',  true,  false, '{}'::text[],                     'pair'),
  ('minor_record',                 'D', array['person_will_add', 'ignore_row'],             false, 'exact_pair', 'membership', false, false, '{}'::text[],                     'record'),
  ('uncertain_type',               'D', array['is_person', 'is_household', 'ignore_row'],   false, 'exact_pair', 'membership', false, true,  '{}'::text[],                     'record'),
  ('unreadable_money',             'D', array['fix_in_source', 'ignore_row'],               false, 'exact_pair', 'treasurer',  true,  false, '{}'::text[],                     'record')
on conflict (signature) do update
  set tier = excluded.tier, answers = excluded.answers, rememberable = excluded.rememberable, default_scope = excluded.default_scope,
      route_to = excluded.route_to, money = excluded.money, same_for_rest = excluded.same_for_rest, scopes = excluded.scopes,
      item_kind = excluded.item_kind;

-- ── Remembered answers ───────────────────────────────────────────────────────
create table if not exists app.import_decision_rules (
  -- 'rule:<signature>:<scope>:<hash of the conditions>': the same answer to the same situation is the same rule.
  id            text not null,
  center_id     uuid not null references app.centers(id) on delete cascade,
  signature     text not null references app.import_signatures(signature),
  scope         text not null check (scope in ('exact_pair', 'identifier', 'pattern')),
  -- [{type:'pair', fingerprints:[..]} | {type:'identifier', field, value} | {type:'evidence', requires:[..], allowsConflicts:[..]}]
  conditions    jsonb not null check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) >= 1),
  answer        text not null check (answer in ('same_household', 'same_person', 'separate')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz not null default now(),
  from_group    text,
  from_run      uuid references app.import_runs(id) on delete set null,
  uses          integer not null default 0 check (uses >= 0),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null,
  primary key (center_id, id),
  -- NEVER a held kind (a child, a money conflict, a row of unknown type, an unreadable amount, a read that needs eyes), money
  -- (a gift in two sources) or a name alone. The engine refuses the held kinds too (memory.ts) and so do the functions; this is
  -- the table saying no in its own right.
  constraint import_decision_rules_never_held check (signature not in
    ('amount_differs_cents', 'amount_differs', 'minor_record', 'uncertain_type', 'unreadable_money', 'low_confidence_read',
     'name_only', 'duplicate_gift_two_sources'))
);
-- Checked again at every insert and change: the kind of question may be remembered, the scope is one it allows, the answer is one
-- of its answers, and an answer that joins two records is never made from a name alone.
create or replace function app.import_decision_rules_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare s app.import_signatures; c jsonb; v_req text[]; v_type text;
begin
  -- A withdrawn rule keeps its signature and answer; its personal values are removed, so only its shape has to hold.
  if new.revoked_at is not null then return new; end if;
  select * into s from app.import_signatures where signature = new.signature;
  if s.signature is null or not s.rememberable then
    raise exception 'Answers to this kind of question are never remembered.';
  end if;
  if not (new.scope = any (s.scopes)) then
    raise exception 'That is not a way to remember an answer to this kind of question.';
  end if;
  if not (new.answer = any (s.answers)) then
    raise exception 'That is not one of the answers to this kind of question.';
  end if;
  for c in select * from jsonb_array_elements(new.conditions) loop
    v_type := c->>'type';
    if v_type = 'pair' then
      if jsonb_typeof(c->'fingerprints') is distinct from 'array' or jsonb_array_length(c->'fingerprints') <> 2 then
        raise exception 'A remembered answer about a pair needs the two rows.';
      end if;
    elsif v_type = 'identifier' then
      if (c->>'field') not in ('phone', 'email', 'address', 'id') or coalesce(btrim(c->>'value'), '') = '' then
        raise exception 'A remembered answer about a phone, e-mail, address or ID needs which one.';
      end if;
    elsif v_type = 'evidence' then
      if jsonb_typeof(c->'requires') is distinct from 'array' or jsonb_typeof(c->'allowsConflicts') is distinct from 'array' then
        raise exception 'A remembered answer about a pattern needs what must agree and what may differ.';
      end if;
      v_req := array(select jsonb_array_elements_text(c->'requires'));
      -- Joining two records needs something that is not a name: an ID, a phone, an e-mail, an address, a birth date, a check number.
      if new.answer in ('same_household', 'same_person') and not (v_req && array['id', 'phone', 'email', 'address', 'dob', 'gift_ref']) then
        raise exception 'A remembered answer cannot join two records because of a name alone.';
      end if;
    else
      raise exception 'That is not a kind of condition a remembered answer can have.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists import_decision_rules_guard on app.import_decision_rules;
create trigger import_decision_rules_guard before insert or update on app.import_decision_rules
  for each row execute function app.import_decision_rules_guard();
comment on table app.import_decision_rules is
  'Remembered answers to matching questions (0630), scoped to the community: who answered, when, how widely it applies. Loaded into the next run so the same question is never asked twice. Never for a held kind (a child, a money conflict), a gift or a name alone: the table refuses it. The personal values in conditions (a phone, an e-mail, an address) are removed when the rule is withdrawn or has not been used for 90 days; a withdrawn rule is deleted after another 90.';
create index if not exists import_decision_rules_live_idx on app.import_decision_rules (center_id) where revoked_at is null;

-- ── What a run staged, found and asks ────────────────────────────────────────
create table if not exists app.import_run_metrics (
  run_id         uuid primary key references app.import_runs(id) on delete cascade,
  center_id      uuid not null references app.centers(id) on delete cascade,
  -- staged: rows are in, no result yet · storing: a result is being saved · ready: the inbox may be shown
  status         text not null default 'staged' check (status in ('staged', 'storing', 'ready')),
  -- The result being saved (rows of an older result are removed when this one is finished).
  batch          uuid,
  engine_version text,
  -- The ResolveConfig the engine ran with (today, thresholds, date orders): enough to replay the run.
  config         jsonb check (config is null or jsonb_typeof(config) = 'object'),
  -- The RunMetrics the engine measured: share resolved automatically, questions per 1,000 rows, minutes.
  metrics        jsonb check (metrics is null or jsonb_typeof(metrics) = 'object'),
  record_count   integer not null default 0,
  started_by     uuid references auth.users(id) on delete set null,
  started_at     timestamptz,
  stored_at      timestamptz,
  created_at     timestamptz not null default now()
);
comment on table app.import_run_metrics is
  'Per import run (0630): whether a matching result is ready, the engine version and settings it ran with (so it can be replayed) and what it measured.';

create table if not exists app.import_staged_records (
  run_id          uuid not null references app.import_runs(id) on delete cascade,
  center_id       uuid not null references app.centers(id) on delete cascade,
  -- Unique within the run, e.g. 'people.csv#12'.
  id              text not null check (char_length(id) between 1 and 200),
  source          text not null check (char_length(source) between 1 and 200),
  source_kind     text not null check (source_kind in ('spreadsheet', 'connector', 'paper', 'existing')),
  row_no          integer not null,
  order_no        integer not null,
  kind            text not null check (kind in ('person', 'household', 'gift', 'unknown')),
  read_confidence numeric(4, 3) check (read_confidence is null or read_confidence between 0 and 1),
  -- PERSONAL DATA (cleared 90 days after the run; never sent to a model; not in the audit log).
  raw             jsonb check (raw is null or jsonb_typeof(raw) = 'object'),
  normalized      jsonb check (normalized is null or jsonb_typeof(normalized) = 'object'),
  -- A short content hash, stable across runs: recognises the same record on a later pull. Not the data.
  fingerprint     text,
  minor           boolean not null default false,
  minor_reasons   text[] not null default '{}',
  type_uncertain  boolean not null default false,
  problems        text[] not null default '{}',
  -- What happened to it: auto (decided by code) · bulk (approve in bulk) · asked (a question) · held (a person adds it) · learned (a remembered answer).
  status          text check (status is null or status in ('auto', 'bulk', 'asked', 'held', 'learned')),
  how             text check (how is null or how in ('linked', 'new', 'duplicate_gift', 'review', 'question', 'hold', 'rule')),
  tier            text check (tier is null or tier in ('A', 'B', 'C', 'D')),
  cluster_id      text,
  -- A gift seen in two sources is loaded once: this one is skipped and points at the one that is kept.
  duplicate_of    text,
  primary key (run_id, id)
);
comment on table app.import_staged_records is
  'The rows of an import run staged for matching (0630). PERSONAL DATA: raw and normalized hold the uploaded record; cleared after 90 days, deleted with the run, not in the audit log.';
create index if not exists import_staged_records_order_idx on app.import_staged_records (run_id, order_no);
create index if not exists import_staged_records_status_idx on app.import_staged_records (run_id, status);
create index if not exists import_staged_records_fingerprint_idx on app.import_staged_records (center_id, fingerprint) where fingerprint is not null;

create table if not exists app.import_record_links (
  run_id      uuid not null references app.import_runs(id) on delete cascade,
  center_id   uuid not null references app.centers(id) on delete cascade,
  a           text not null,
  b           text not null,
  relation    text not null check (relation in ('same_person', 'same_household', 'same_gift')),
  strength    text not null check (strength in ('strong', 'medium', 'weak')),
  score       numeric(6, 2) not null,
  independent integer not null,
  -- [{kind, independent, points, label}] and [{kind, severity, label}]
  evidence    jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  conflicts   jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  name_level  text,
  name_only   boolean not null default false,
  via_keys    text[] not null default '{}',
  money       jsonb,
  tier        text not null check (tier in ('A', 'B', 'C', 'D')),
  tier_reasons text[] not null default '{}',
  hold        text check (hold is null or hold in ('minor', 'money_conflict', 'uncertain_type', 'unreadable_money')),
  signature   text,
  affected    text[] not null default '{}',
  implied     boolean not null default false,
  batch       uuid,
  primary key (run_id, a, b)
);
comment on table app.import_record_links is
  'Every scored pair of staged records (0630) with its tier, score, evidence and conflicts. Derived by the engine from the staged rows; not in the audit log.';
create index if not exists import_record_links_tier_idx on app.import_record_links (run_id, tier);

create table if not exists app.import_clusters (
  run_id     uuid not null references app.import_runs(id) on delete cascade,
  center_id  uuid not null references app.centers(id) on delete cascade,
  kind       text not null check (kind in ('household', 'person')),
  id         text not null,
  record_ids text[] not null,
  -- Households already in the records that this cluster lands in (more than one is never merged here).
  existing   text[] not null default '{}',
  batch      uuid,
  primary key (run_id, kind, id)
);
comment on table app.import_clusters is
  'Households and people the engine joined automatically (0630). Derived; not in the audit log.';

-- ── The questions ────────────────────────────────────────────────────────────
create table if not exists app.import_exceptions (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  run_id         uuid not null references app.import_runs(id) on delete cascade,
  signature      text not null references app.import_signatures(signature),
  tier           text not null check (tier in ('C', 'D')),
  batch          uuid,
  -- The engine's Question: title, detail, answers, examples. Plain English, written by code.
  question       jsonb not null check (jsonb_typeof(question) = 'object'),
  recommended    text not null,
  subject_count  integer not null default 0,
  item_count     integer not null default 0,
  -- Value, for ranking: money first, then members, then contacts.
  money_cents    bigint not null default 0,
  members        integer not null default 0,
  contacts       integer not null default 0,
  rank_no        integer not null,
  route_suggested text check (route_suggested is null or route_suggested in ('treasurer', 'membership')),
  status         text not null default 'open' check (status in ('open', 'answered', 'postponed', 'skipped', 'sent')),
  -- The answer given most recently to the group, and whether it was applied to the rest.
  answer         text,
  apply_to_rest  boolean not null default false,
  answered_by    uuid references auth.users(id) on delete set null,
  answered_at    timestamptz,
  -- Who it was passed to (a role to start with; helper links come later).
  routed_to      text,
  status_by      uuid references auth.users(id) on delete set null,
  status_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (run_id, signature)
);
comment on table app.import_exceptions is
  'The matching questions of an import run (0630), one per pattern, ranked by value: the plain wording, the recommended answer and where it stands. A person changes it through the functions only.';
create index if not exists import_exceptions_rank_idx on app.import_exceptions (run_id, rank_no);

create table if not exists app.import_exception_items (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  run_id        uuid not null references app.import_runs(id) on delete cascade,
  -- Stable across runs: the pattern plus content hashes of the records, so the same pair is recognised again.
  key           text not null,
  signature     text not null references app.import_signatures(signature),
  kind          text not null check (kind in ('pair', 'record')),
  tier          text not null check (tier in ('C', 'D')),
  subject       text not null,
  record_ids    text[] not null,
  fingerprints  text[] not null,
  evidence_kinds text[] not null default '{}',
  conflict_kinds text[] not null default '{}',
  -- The phone, e-mail, address or ID the two records share (what an "identifier" rule is made from).
  shared        jsonb not null default '{}'::jsonb check (jsonb_typeof(shared) = 'object'),
  money_cents   bigint not null default 0,
  members       integer not null default 0,
  contacts      integer not null default 0,
  batch         uuid,
  answer        text check (answer is null or answer in ('same_household', 'same_person', 'separate', 'same_gift', 'different_gifts',
                  'use_first', 'use_second', 'hold', 'person_will_add', 'ignore_row', 'is_person', 'is_household', 'confirm_read', 'fix_in_source')),
  -- 'person' (one answer) · 'person_bulk' ("same answer for the others") · 'rule:<rule id>' (a remembered answer)
  answer_source text check (answer_source is null or answer_source ~ '^(person|person_bulk|rule:.+)$'),
  answered_by   uuid references auth.users(id) on delete set null,
  answered_at   timestamptz,
  unique (run_id, key),
  check ((answer is null) = (answer_source is null)),
  -- A held item (a child, a money conflict) is decided by a person each time: a remembered answer can never be the source.
  constraint import_exception_items_held_by_a_person check (tier = 'C' or answer_source is null or answer_source !~ '^rule:')
);
comment on table app.import_exception_items is
  'What each matching question is about (0630): one pair of records, or one held record, with its own answer. A held item (tier D) can only ever be answered by a person.';
create index if not exists import_exception_items_group_idx on app.import_exception_items (run_id, signature);
create index if not exists import_exception_items_open_idx on app.import_exception_items (run_id, signature) where answer is null;
create index if not exists import_exception_items_rule_idx on app.import_exception_items (center_id, answer_source) where answer_source is not null;

-- ── Modules and audit ────────────────────────────────────────────────────────
-- Core platform tables (no module), like the import engine's own.
insert into app.module_tables (table_name, module_key) values
  ('import_signatures', null), ('import_decision_rules', null), ('import_run_metrics', null), ('import_staged_records', null),
  ('import_record_links', null), ('import_clusters', null), ('import_exceptions', null), ('import_exception_items', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- Audited row by row: the catalog and the run header (settings and numbers, nothing personal). The other six tables are left out on
-- purpose (see the note at the top, and supabase/tests/13); what a person decides is written to the log by explicit entries.
drop trigger if exists audit_import_signatures on app.import_signatures;
create trigger audit_import_signatures after insert or update or delete on app.import_signatures
  for each row execute function app.audit_row('signature');
drop trigger if exists audit_import_run_metrics on app.import_run_metrics;
create trigger audit_import_run_metrics after insert or update or delete on app.import_run_metrics
  for each row execute function app.audit_row('run_id');

-- ── Who may see what ─────────────────────────────────────────────────────────
-- The guided onboarding's rule for things that belong to the community rather than to one run (0545): people.manage or giving.manage.
-- Someone who may import only zones, events, the store, Pathshala or bank accounts does not pass.
create or replace function app.resolve_center_allowed(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.onboarding_dataset_allowed(p_center, null)
$$;

-- Every run the signed-in person may use: a people, households or payments file, by someone who may write that data type and holds
-- one of the guided onboarding's permissions (platform admins all). One lookup per query: the policies below compare against its
-- result instead of calling a function for every row.
create or replace function app.resolve_runs_allowed() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
    from app.import_runs r join app.import_entities e on e.key = r.entity
   where r.entity in ('people', 'households', 'payments')
     and app.import_has_any(r.center_id, e.write_perms)
     and app.resolve_center_allowed(r.center_id)
$$;

alter table app.import_signatures enable row level security;
alter table app.import_decision_rules enable row level security;
alter table app.import_run_metrics enable row level security;
alter table app.import_staged_records enable row level security;
alter table app.import_record_links enable row level security;
alter table app.import_clusters enable row level security;
alter table app.import_exceptions enable row level security;
alter table app.import_exception_items enable row level security;

drop policy if exists import_signatures_read on app.import_signatures;
create policy import_signatures_read on app.import_signatures for select to authenticated using (true);
drop policy if exists import_decision_rules_read on app.import_decision_rules;
create policy import_decision_rules_read on app.import_decision_rules for select to authenticated using (app.resolve_center_allowed(center_id));
drop policy if exists import_run_metrics_read on app.import_run_metrics;
create policy import_run_metrics_read on app.import_run_metrics for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));
drop policy if exists import_staged_records_read on app.import_staged_records;
create policy import_staged_records_read on app.import_staged_records for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));
drop policy if exists import_record_links_read on app.import_record_links;
create policy import_record_links_read on app.import_record_links for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));
drop policy if exists import_clusters_read on app.import_clusters;
create policy import_clusters_read on app.import_clusters for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));
drop policy if exists import_exceptions_read on app.import_exceptions;
create policy import_exceptions_read on app.import_exceptions for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));
drop policy if exists import_exception_items_read on app.import_exception_items;
create policy import_exception_items_read on app.import_exception_items for select to authenticated using (run_id = any ((select app.resolve_runs_allowed())::uuid[]));

revoke all on app.import_signatures, app.import_decision_rules, app.import_run_metrics, app.import_staged_records,
  app.import_record_links, app.import_clusters, app.import_exceptions, app.import_exception_items
  from public, anon, authenticated, connect_worker;
grant select on app.import_signatures, app.import_decision_rules, app.import_run_metrics, app.import_staged_records,
  app.import_record_links, app.import_clusters, app.import_exceptions, app.import_exception_items to authenticated;
grant all on app.import_signatures, app.import_decision_rules, app.import_run_metrics, app.import_staged_records,
  app.import_record_links, app.import_clusters, app.import_exceptions, app.import_exception_items to service_role;

revoke execute on function app.resolve_runs_allowed(), app.resolve_center_allowed(uuid) from public, anon;
-- The policies call these as the signed-in user.
grant execute on function app.resolve_runs_allowed(), app.resolve_center_allowed(uuid) to authenticated;
