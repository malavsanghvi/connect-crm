-- 0579_niva_own_answers.sql: Niva answers from Community Connect's own infrastructure, at no AI cost, at once.
--
-- Owner decision 2026-10-02: Niva must answer from the community's approved content without spending AI tokens, and
-- fast. Until now every question was a niva.answer job: the background service picked it up, called Claude (Opus) and
-- stored the answer, 10-15 seconds later. This migration answers inside app.niva_ask itself, right after the question
-- is saved and before any job is queued, so the row niva_ask returns already carries the answer (the member app shows
-- an answered row at once: connect-mobile learning.ts nivaPhase). No model is called.
--
--   1. app.niva_own_answer(conversation, include_in_review default false)            internal, security definer
--      Three tiers, the first that answers wins:
--        (a) cache    an earlier answered member question of the same community with the same normalised question
--                     (app.niva_normalize_question: lower case, punctuation and extra spaces removed) whose cited
--                     sources are all still published (or, for a Guide section, public), still answered from
--                     (centers.rules.niva.answer_from) and unchanged since that answer: its answer and sources are
--                     copied. An answer that cited a live item (an event, a day's timings, the address) is never
--                     copied: "today" or "tomorrow" in it was about the day it was written.
--        (b) faq      an approved FAQ item (kind 'faq', when the community answers from its FAQ), a Niva source whose
--                     heading is a question, or a public Guide section titled as a question (when the community
--                     answers from its Guide) that closely matches the question: the same kind of question (when,
--                     where, who, how much ...) and a Dice similarity of at least 0.75 over the two questions' key
--                     words (English stems without filler words or the community's own name, the glossary's synonyms
--                     folded together: app.niva_question_terms). pg_trgm is not installed in this database (neither
--                     the migrations nor tests/stub_supabase.sql create it), so the match is word based and strict.
--                     Its answer text is used as written (markdown marks removed), with that source cited.
--        (c) extract  the best of the top three results of the search Niva has always used (app.niva_search_core,
--                     the body of 0575's niva_worker_search_sources) whose rank is at least 0.01 and which holds at
--                     least 60 % of the question's key words (a question with one key word: that word in the
--                     source's title): its one to three most relevant sentences (plain text, at most about 600
--                     characters; for a when / where / how much question at least one of them must hold a time, a
--                     place or an amount), then the source's title, citing it with its address. The sentences
--                     themselves must hold 60 % of the key words; the heading may supply the rest only when it is
--                     wholly about the question ("Derasar timings"), never one about something else.
--      Answers are recorded as answer_status 'answered', model 'own:cache' | 'own:faq' | 'own:extract', answered_at.
--      Doctrinal questions keep the existing rule (answer from approved content, refer to Pathshala teachers): an own
--      answer to a doctrinal question or from a doctrinal source (app.niva_is_doctrinal, a small keyword list; no
--      classification existed) ends with a fixed referral line. A question about the member's own details
--      (eligibility, my pledges, am I ..., app.niva_is_personal) is never answered by these tiers: it goes on as today.
--   2. centers.rules.niva.ai = 'off' | 'haiku' (app.niva_ai_mode; 'off' when not set, for every community; JSH is set
--      'off' explicitly by app.seed_jsh_niva_ai_off). When the own tiers find nothing:
--        off    answer_status 'no_source' at once, with a plain outcome, and NO job: the member app then shows the
--               owner's unable message and Send to the team straight away;
--        haiku  niva.answer is queued as before; the worker (worker/src/handlers/niva.answer.ts) first tries the own
--               tiers again (app.niva_worker_own_answer: a regenerate or a retry may find a newly approved source) and
--               otherwise asks Claude Haiku 4.5. niva_worker_get_conversation now returns ai.
--      Staff tests (niva_test_ask) follow the same tiers and setting. niva_regenerate and niva_retry_unanswered try
--      the own tiers at once, with no job, while AI answers are off (a regenerate that finds nothing keeps the old
--      answer while a source it cited is still current, as the worker's regenerate does); while they are on they
--      queue jobs as before.
--   3. niva_health also returns ai and answered_by_7d {cache, faq, extract, ai} (members' answers of the last 7 days
--      by how they were made). Everything else in it is as 0575.
--   4. niva_worker_search_sources (4 arguments) keeps its signature, grants and results: its body moves to
--      app.niva_search_core (no worker check), which niva_own_answer also runs.
--
-- 0572, 0573, 0574 and 0575 are applied and untouched; their functions are replaced here with create or replace
-- (same signatures, so their grants stay). Anyone who changes niva_ask, niva_test_ask, niva_regenerate,
-- niva_retry_unanswered, niva_worker_get_conversation or niva_health again must start from THIS migration.

set client_min_messages = warning;

-- ── 2. The AI setting ─────────────────────────────────────────────────────────
-- centers.rules.niva.ai: 'off' (Niva answers only from the community's approved content, at no AI cost) or 'haiku'
-- (when nothing there answers, Claude Haiku writes an answer). Anything else, or nothing, is 'off'.
create or replace function app.niva_ai_mode(p_center uuid) returns text
language sql stable set search_path = app, public, extensions as $$
  select coalesce((select case when c.rules #>> '{niva,ai}' = 'haiku' then 'haiku' end
                     from app.centers c where c.id = p_center), 'off')
$$;
comment on function app.niva_ai_mode(uuid) is
  'Whether Niva may ask an AI model when the community''s own content has no answer (0579): ''haiku'' when centers.rules.niva.ai says so, else ''off''.';

-- centers.rules with niva.<key> set; rules.version (when the rules carry one) moves on by one, as 0573's
-- niva_rules_with_answer_from does, so a rules form opened before the change cannot save over it.
create or replace function app.niva_rules_with(p_rules jsonb, p_key text, p_value jsonb) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select r || jsonb_build_object('niva', case when jsonb_typeof(r -> 'niva') = 'object' then r -> 'niva' else '{}'::jsonb end
                                         || jsonb_build_object(p_key, p_value))
           || case when jsonb_typeof(r -> 'version') = 'number' and (r ->> 'version') ~ '^[0-9]+$'
                   then jsonb_build_object('version', (r ->> 'version')::bigint + 1) else '{}'::jsonb end
    from (select coalesce(p_rules, '{}'::jsonb) as r) x
$$;

-- JSH: AI answers off, explicitly (owner decision 2026-10-02). A later choice in the portal is never undone; before
-- seed.sql creates JSH (a brand-new database) this does nothing, and test 69 runs it.
create or replace function app.seed_jsh_niva_ai_off() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_jsh constant uuid := '00000000-0000-4000-8000-000000000001';
  v_n integer;
begin
  if not exists (select 1 from app.centers where id = v_jsh) then
    return jsonb_build_object('skipped', 'no JSH community yet');
  end if;
  update app.centers
     set rules = app.niva_rules_with(rules, 'ai', to_jsonb('off'::text))
   where id = v_jsh and rules #> '{niva,ai}' is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n = 1);
end $$;
comment on function app.seed_jsh_niva_ai_off() is
  'One-off (0579): JSH''s Niva answers only from its approved content (rules.niva.ai = ''off''), unless JSH has already chosen.';

-- ── Reading a question ───────────────────────────────────────────────────────
-- Lower case, punctuation and extra spaces removed: "When is the Derasar open??" and "when is the derasar open" are
-- one question.
create or replace function app.niva_normalize_question(p text) returns text
language sql immutable parallel safe set search_path = app, public, extensions as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[[:punct:]“”‘’…–—]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
$$;

-- The answer cache's lookup: members' answered questions of a community by their normalised text.
create index if not exists niva_conversations_answer_cache_idx
  on app.niva_conversations (center_id, app.niva_normalize_question(question))
  where answer is not null and not is_test;

-- A question about the member's own details: their eligibility, pledges, payments, RSVPs, registration or account.
-- Niva has no access to them, so its own tiers never answer one (the AI path, when it is on, answers only the general
-- part a source covers, as before). A small keyword list, strict on purpose: "How do I register my son for Pathshala?"
-- is not one; "Am I eligible to vote?", "Did I pay my pledge?" and "What is my balance?" are.
create or replace function app.niva_is_personal(p text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select q ~ '^(am|are|was|were|have|has|did) (i|we)\M'
      or q ~ '^(is|are|was|were|has|have|did) (my|our)\M'
      or q ~ '\m(do|does|did|can|could|will|would|should) (i|we) (still )?(owe|qualify)\M'
      or q ~ '\mhow (much|many)( [[:alpha:]]+){0,2} (do|did|have|will|should|can) (i|we)\M'
      or q ~ '\m(my|our) (own )?(pledges?|payments?|donations?|contributions?|giving|dues|balance|account|status|receipts?|rsvps?|tickets?|bookings?|orders?|points|refunds?|invoices?|records?|profile|eligibility|subscriptions?|tax receipts?)\M'
      or (q ~ '\meligib' and q ~ '\m(i|me|my|we|us|our)\M')
      or q ~ '\m(i|we) (am|are|was|were)( not)? (eligible|registered|enrolled|signed up|a member|members|paid up|on the list)\M'
    from (select app.niva_normalize_question(p) as q) x
$$;
comment on function app.niva_is_personal(text) is
  'A question about the asking member''s own details (eligibility, pledges, payments, RSVPs, account): Niva''s own answers never take it (0579).';

-- Doctrine and practice: what Jain teaching says, what is permitted, the meaning behind a practice. No classification
-- existed (the AI's own rule 3 decided), so this is a small keyword list over the question and the source's title.
create or replace function app.niva_is_doctrinal(p text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select q ~ '\m(karmas?|ahimsa|aparigraha|anekant[[:alpha:]]*|syadvad[[:alpha:]]*|moksh|moksha|nirvana|kevali|kevalgyan|keval gyan|jiva|jeev|ajiva|atma|soul|tirthankar[[:alpha:]]*|mahavir[[:alpha:]]*|parshvanath|parshwanath|navkar|namokar|mantras?|sutras?|stotras?|agams?|agamas?|scriptures?|samayik[[:alpha:]]*|pratikraman[[:alpha:]]*|tapasya|upvas|upwas|ayambil|aayambil|ekasan[[:alpha:]]*|biyasan[[:alpha:]]*|pachchakhan[[:alpha:]]*|pachakkhan[[:alpha:]]*|paccakkhan[[:alpha:]]*|vrat|vratas|vows?|dharma|dharm|sins?|paap|punya|meditation|dhyan|doctrines?|philosophy|jainism|santhara|sallekhana|kshamapana|micchami)\M'
      or q ~ '\m(why do|why does|why should|should) (jains?|we|i)\M'
      or q ~ '\m(is it|are we|am i) (allowed|permitted|ok|okay|wrong|a sin)\M'
      or q ~ '\m(can|may|do) jains?\M'
      or q ~ '\m(meaning|significance|importance|purpose) of\M'
    from (select app.niva_normalize_question(p) as q) x
$$;

-- The fixed line an own answer to a doctrinal question ends with (the guardrail on Content › Niva).
create or replace function app.niva_referral_line() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'For anything beyond this, please speak with a Pathshala teacher.'::text
$$;

-- What kind of question it is, from how it starts: two questions only match when they ask the same kind of thing
-- ("When is Paryushan?" is not "What is Paryushan?"). Null: it does not say.
create or replace function app.niva_question_kind(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
           when q ~ '^(when|what time|what times|which day|which days|what day|what days|what date|how late|how early|till when|until when|until what time|till what time)\M' then 'when'
           when q ~ '^(where|which address|what address|what is the address|whats the address)\M' then 'where'
           when q ~ '^(who|whom|whose)\M' then 'who'
           when q ~ '^why\M' then 'why'
           when q ~ '^(how much|how many|what does it cost|what is the cost|what is the fee|what are the fees|what is the price)\M' then 'how_much'
           when q ~ '^how\M' then 'how'
           when q ~ '^(what|whats)\M' then 'what'
           when q ~ '^which\M' then 'which'
           when q ~ '^(is|are|am|was|were|can|could|do|does|did|will|would|should|may|has|have)\M' then 'yes_no'
         end
    from (select app.niva_normalize_question(p) as q) x
$$;

-- ── Key words ────────────────────────────────────────────────────────────────
-- The glossary (0573) as English stems: each word's stem and its group's first word's stem, so "temple", "mandir"
-- and "derasar" are one key word, and "open", "hours" and "timings" another.
create or replace function app.niva_glossary_stems() returns table (stem text, canon text)
language sql immutable set search_path = app, public, extensions as $$
  select distinct on (s.stem) s.stem, s.canon
    from (select (tsvector_to_array(to_tsvector('english', t)))[1] as stem,
                 (tsvector_to_array(to_tsvector('english', g.terms[1])))[1] as canon, g.n
            from app.niva_glossary() with ordinality as g(terms, n)
           cross join unnest(g.terms) as t
           where position(' ' in t) = 0) s
   where s.stem is not null and s.canon is not null
   order by s.stem, s.n
$$;

-- A text's key words: its English stems without filler words, single letters and the like, glossary words folded.
create or replace function app.niva_text_terms(p text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(array_agg(distinct coalesce(g.canon, l.l) order by coalesce(g.canon, l.l)), '{}')
    from unnest(tsvector_to_array(to_tsvector('english', left(coalesce(p, ''), 100000)))) as l(l)
    left join app.niva_glossary_stems() g on g.stem = l.l
   where char_length(l.l) > 1 or l.l ~ '^[0-9]$'
$$;

-- A question's key words: its text's, without the community's own name, short name and slug (nearly every source of
-- a community names it); a name word that is a glossary word ("Temple" in "Jain Temple of X") stays.
create or replace function app.niva_question_terms(p_center uuid, p text) returns text[]
language sql stable set search_path = app, public, extensions as $$
  select coalesce(array_agg(t order by t), '{}')
    from unnest(app.niva_text_terms(p)) as t
   where t in (select g.canon from app.niva_glossary_stems() g)
      or t <> all (coalesce((select tsvector_to_array(to_tsvector('english', concat_ws(' ', c.name, c.short_name, c.slug::text)))
                               from app.centers c where c.id = p_center), '{}'::text[]))
$$;

-- How many of the question's key words a text holds (a key word of four letters or more also matches a longer word
-- that starts with it, as the search does).
create or replace function app.niva_terms_covered(p_q text[], p_s text[]) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select count(*)::int
    from unnest(coalesce(p_q, '{}'::text[])) as q
   where q = any (coalesce(p_s, '{}'::text[]))
      or (char_length(q) >= 4 and exists (select 1 from unnest(coalesce(p_s, '{}'::text[])) as s where left(s, char_length(q)) = q))
$$;

-- ── Plain text ───────────────────────────────────────────────────────────────
-- A source's text without markdown or HTML marks: the member app shows an answer as plain text. A table's rows become
-- lines ("| Derasar | 7:30 AM – 6:00 PM daily |" is "Derasar: 7:30 AM – 6:00 PM daily"); its header row goes.
create or replace function app.niva_plain_text(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      replace(coalesce(p, ''), E'\r\n', E'\n'),
      -- a table's header row and the |---|---| line under it
      '(^|\n)[ \t]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*(?=\n|$)', '\1', 'g'),
      '(^|\n)[ \t]*\|[ \t]*([^|\n]*[^|\n[:space:]])[ \t]*\|[ \t]*', '\1\2: ', 'g'),   -- a row's first cell, then ": "
      '[ \t]*\|[ \t]*(?=\n|$)', '', 'g'),                                            -- its closing |
      '[ \t]+\|[ \t]+', ', ', 'g'),                                                  -- the cells between
      '<[^>]+>', ' ', 'g'),                                         -- HTML tags
      '!\[[^]]*\]\([^)]*\)', '', 'g'),                              -- images
      '\[([^]]+)\]\([^)]*\)', '\1', 'g'),                           -- links: their text
      '(^|\n)[ \t]*(#{1,6}|>|[-*+•]|[0-9]+[.)])[ \t]+', '\1', 'g'), -- headings, quotes, bullets, numbered lists
      '(\*\*|__|~~|`)', '', 'g'),                                   -- bold, strike-through, code
      '(^|[[:space:](])[*_]([^*_\n]+)[*_]', '\1\2', 'g'),           -- italics
      '[ \t]+', ' ', 'g'),
      '\n{3,}', E'\n\n', 'g'),
    E' \t\n')
$$;

-- For a when / where / how much question: does a sentence hold a time, a place or an amount?
create or replace function app.niva_sentence_fits(p_kind text, p text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select case p_kind
    when 'when' then p ~* '([0-9]{1,2}(:[0-9]{2})?[[:space:]]*(am|pm|a\.m\.|p\.m\.)|\m[0-9]{1,2}:[0-9]{2}\M|\m(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weekends?|daily|every day|everyday|january|february|march|april|may|june|july|august|september|october|november|december|morning|evening|afternoon|noon|midnight|sunrise|sunset|tithi)\M|\m[0-9]{4}\M)'
    when 'where' then p ~* '(\m[0-9]+[[:space:]]+[[:alpha:]]+|\m(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|hall|room|lot|floor|building|campus|address|located|location|entrance|parking|upstairs|downstairs|next to|behind|opposite)\M)'
    when 'how_much' then p ~* '(\$[[:space:]]?[0-9]|\m[0-9]+\M|\m(free|no charge|fee|fees|cost|costs|price|dollars?)\M)'
    else true end
$$;

-- A sentence's key words for a question: its own, plus the timings key word ('time': timings, hours, open) when the
-- question has it and the sentence gives a time ("Derasar: 7:30 AM – 6:00 PM daily" answers "When does it open?").
create or replace function app.niva_sentence_terms(p text, p_q text[]) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select app.niva_text_terms(p)
         || case when 'time' = any (coalesce(p_q, '{}'::text[])) and app.niva_sentence_fits('when', p) then array['time'] else '{}'::text[] end
$$;

-- The one to three sentences of a text that hold most of the question's key words, in the order they come, at most
-- p_max characters (the first one is cut at a word when it alone is longer), each ending in punctuation. A sentence
-- of fewer than three words (a heading) is left out, and so is one holding no more than half as many key words as
-- the best one. Null when no sentence holds a key word, or (when / where / how much) none of them a time, place or
-- amount.
create or replace function app.niva_extract_sentences(p_body text, p_q text[], p_kind text default null, p_max int default 600)
returns text language plpgsql stable set search_path = app, public, extensions as $$
declare
  r record;
  v_ns int[] := '{}';
  v_ts text[] := '{}';
  v_len int := 0;
  v_t text;
  v_fits boolean := false;
begin
  if p_body is null or cardinality(coalesce(p_q, '{}'::text[])) = 0 then return null; end if;
  for r in
    with s as (
      select t.n::int as n, btrim(t.x) as txt
        from regexp_split_to_table(
               regexp_replace(app.niva_plain_text(p_body), '([.!?])[ \t]+(?=["“(]?[[:upper:][:digit:]])', E'\\1\n', 'g'),
               E'[ \t]*\n+[ \t]*') with ordinality as t(x, n)
       where btrim(t.x) <> ''
       limit 400
    ), scored as (
      select s.n, s.txt, app.niva_terms_covered(p_q, app.niva_sentence_terms(s.txt, p_q)) as score
        from s
       where cardinality(regexp_split_to_array(s.txt, '[[:space:]]+')) >= 3
    ), ranked as (
      select sc.*, max(sc.score) over () as best from scored sc
    )
    select ranked.n, ranked.txt, ranked.score from ranked
     where ranked.score > 0 and ranked.score * 2 > ranked.best
     order by ranked.score desc, ranked.n
     limit 3
  loop
    v_t := r.txt || case when r.txt ~ '[.!?:;…)"”]$' then '' else '.' end;
    if cardinality(v_ns) = 0 then
      if char_length(v_t) > p_max then
        v_t := regexp_replace(left(v_t, p_max - 1), '[[:space:]]+[^[:space:]]*$', '') || '…';
      end if;
    elsif v_len + 1 + char_length(v_t) > p_max then
      continue;
    end if;
    v_ns := v_ns || r.n;
    v_ts := v_ts || v_t;
    v_len := v_len + char_length(v_t) + 1;
    v_fits := v_fits or app.niva_sentence_fits(p_kind, v_t);
  end loop;
  if cardinality(v_ns) = 0 or not v_fits then return null; end if;
  return (select string_agg(x.t, ' ' order by x.n) from unnest(v_ns, v_ts) as x(n, t));
end $$;

-- ── 4. The search, without the worker check ──────────────────────────────────
-- 0575's niva_worker_search_sources, unchanged, as an internal function so niva_ask (which runs for a member, not
-- the worker) can search too. Anyone who changes this search again must start from THIS definition.
create or replace function app.niva_search_core(p_center uuid, p_query text, p_limit int, p_statuses text[])
returns jsonb language plpgsql stable set search_path = app, public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_statuses text[] := case when cardinality(p_statuses) > 0 then p_statuses else array['published'] end;
  v_tradition app.tradition;
  v_from text[];
  v_guide boolean;
  v_faq boolean;
  v_tsq tsquery;
  v_out jsonb;
begin
  if exists (select 1 from unnest(v_statuses) s where s is null or s not in ('published', 'in_review')) then
    raise exception 'Niva answers only from published sources, or also from sources waiting for approval in a staff test (asked for: %).',
      array_to_string(v_statuses, ', ', '(none)') using errcode = '22023';
  end if;

  select c.tradition into v_tradition from app.centers c where c.id = p_center;
  if not found then return '[]'::jsonb; end if;
  v_tsq := app.niva_search_tsquery(p_center, p_query);
  if v_tsq is null then return '[]'::jsonb; end if;
  v_from := app.niva_answer_from(p_center);
  v_guide := 'guide' = any (v_from);
  v_faq := 'faq' = any (v_from);

  with cand as (
    -- The community's own sources, and the shared pack for its tradition (or for every tradition).
    select c.id::text as ref, c.kind, c.title, coalesce(c.body_md, '') as body, c.metadata->>'source_url' as source_url,
           c.updated_at, ts_rank_cd(c.niva_tsv, v_tsq, 1 | 32) as score
      from app.content_items c
     where c.kind = 'niva_source'
       and c.status = any (v_statuses)
       and (c.status = 'published' or c.center_id = p_center)   -- 0575: never a shared source the platform has not approved
       and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)))
       and c.niva_tsv @@ v_tsq
    union all
    -- FAQ, when the community answers from it.
    select c.id::text, c.kind, c.title, coalesce(c.body_md, ''), c.metadata->>'source_url',
           c.updated_at, ts_rank_cd(c.niva_tsv, v_tsq, 1 | 32)
      from app.content_items c
     where v_faq and c.kind = 'faq'
       and c.status = any (v_statuses)
       and (c.status = 'published' or c.center_id = p_center)   -- 0575: never a shared source the platform has not approved
       and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)))
       and c.niva_tsv @@ v_tsq
    union all
    -- Public Guide sections, when the community answers from them. Weighed like a hand-written source.
    select 'guide_section:' || g.id::text, 'guide_section', g.title, g.body_md, null,
           g.updated_at, ts_rank_cd(v.tsv, v_tsq, 1 | 32)
      from app.guide_sections g
     cross join lateral (select setweight(to_tsvector('english', g.title), 'A')
                                || setweight(to_tsvector('english', g.body_md), 'B')
                                || setweight(to_tsvector('simple', g.body_md), 'D') as tsv) v
     where v_guide and g.center_id = p_center and g.public
       and v.tsv @@ v_tsq
  ), ranked as (
    select cand.*, row_number() over (order by cand.score desc, cand.updated_at desc, cand.ref collate "C") as rn
      from cand
  ), picked as (
    select r.*, case when char_length(r.body) <= 4000 then r.body
                     when to_tsvector('english', substr(r.body, 1501, 98500)) @@ v_tsq
                       then left(r.body, 1500) || E'\n\n[…]\n\n' || app.niva_excerpt(substr(r.body, 1501, 98500), v_tsq)
                     else left(r.body, 4000) end as excerpt
      from ranked r
     where r.rn <= v_limit
  ), budget as (
    select p.*, sum(char_length(p.title) + char_length(p.excerpt)) over (order by p.rn) as used
      from picked p
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.ref, 'kind', b.kind, 'title', b.title, 'body_md', b.excerpt,
                                               'rank', b.score, 'source_url', b.source_url, 'updated_at', b.updated_at)
                            order by b.rn), '[]'::jsonb)
    into v_out
    from budget b
   where b.rn = 1 or b.used <= 24000;
  return v_out;
end $$;
comment on function app.niva_search_core(uuid, text, int, text[]) is
  'Internal (0579): the ranked search for a Niva question (0573/0575), run by niva_worker_search_sources and by niva_own_answer.';

create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int, p_statuses text[])
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return app.niva_search_core(p_center, p_query, p_limit, p_statuses);
end $$;
comment on function app.niva_worker_search_sources(uuid, text, int, text[]) is
  'Worker only (0573; 0575: sources waiting for approval are the community''s own only; 0579: the body is app.niva_search_core). Ranked sources for a Niva question: [{id, kind, title, body_md, rank, source_url, updated_at}], at most about 24000 characters in all. statuses: {published} or {published,in_review} (staff test).';

-- ── Cited sources ─────────────────────────────────────────────────────────────
-- May an earlier answer be copied? Every source it cites must still be one Niva answers from, unchanged since then:
-- a content item (a Niva source, or an FAQ item while the community answers from its FAQ) that is published and the
-- community's own or shared for its tradition, or a public Guide section of the community while it answers from its
-- Guide. A live item, a source without an id (old sample rows) or no source at all: never copied.
create or replace function app.niva_cache_sources_ok(p_center uuid, p_tradition app.tradition, p_sources jsonb, p_since timestamptz, p_from text[])
returns boolean language sql stable set search_path = app, public, extensions as $$
  select jsonb_typeof(p_sources) = 'array' and jsonb_array_length(p_sources) > 0 and p_since is not null
     and not exists (
       select 1
         from jsonb_array_elements(p_sources) as s(src)
        cross join lateral (select case when jsonb_typeof(s.src) = 'object' then coalesce(s.src->>'content_item_id', '') else '' end as ref) r
        where not (case
                     when r.ref ~* '^guide_section:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
                       'guide' = any (p_from) and exists (
                         select 1 from app.guide_sections g
                          where g.id = substr(r.ref, 15)::uuid and g.center_id = p_center and g.public and g.updated_at <= p_since)
                     when r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
                       exists (
                         select 1 from app.content_items c
                          where c.id = r.ref::uuid and c.status = 'published' and c.updated_at <= p_since
                            and (c.kind = 'niva_source' or (c.kind = 'faq' and 'faq' = any (p_from)))
                            and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = p_tradition))))
                     else false
                   end))
$$;

-- Is a source an answer cites still current? 0574's test in niva_worker_set_outcome (a published content item, a
-- public Guide section, a live item still on the schedule), for the regenerate that runs here while AI answers are off.
create or replace function app.niva_cites_current(p_center uuid, p_sources jsonb) returns boolean
language sql stable set search_path = app, public, extensions as $$
  select exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end) s(src)
     cross join lateral (
       select coalesce(s.src->>'content_item_id', s.src->>'id') as ref,
              case when s.src->>'content_item_id' is null and s.src->>'kind' in ('event', 'timings', 'center')
                   then s.src->>'kind' end as live_kind,
              substring(coalesce(s.src->>'content_item_id', s.src->>'id')
                        from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$') as ref_id) r
     where case when r.live_kind is not null
                then app.niva_live_ref_current(p_center, r.live_kind, s.src->>'id')
                when r.ref_id is null then false
                when r.ref like 'guide_section:%'
                then exists (select 1 from app.guide_sections g where g.id = r.ref_id::uuid and g.public)
                else exists (select 1 from app.content_items c where c.id = r.ref_id::uuid and c.status = 'published')
           end)
$$;

-- ── Writing the outcome ──────────────────────────────────────────────────────
create or replace function app.niva_store_own_answer(p_id uuid, p_answer text, p_sources jsonb, p_model text) returns void
language sql security definer set search_path = app, public, extensions as $$
  update app.niva_conversations
     set answer = left(btrim(p_answer), 4000), sources = coalesce(p_sources, '[]'::jsonb), unanswered = false,
         answer_status = 'answered', outcome_detail = null, model = p_model, answered_at = now(), attempted_at = now()
   where id = p_id
$$;

-- The plain outcome when the own tiers found nothing and no AI is asked.
create or replace function app.niva_own_outcome_detail(p_reason text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_reason = 'personal'
              then 'Niva does not look up a member''s own details (eligibility, pledges, payments, RSVPs), so the member was offered Send to the team.'
              else 'No approved source answers this, and AI answers are off for this community, so the member was offered Send to the team.' end
$$;

-- Nothing in the community's content answered, and AI answers are off: the question reads no_source at once (the
-- member app then offers Send to the team). On a regenerate (p_clear) a question that still shows an answer keeps it
-- while a source it cited is still current, exactly as the worker's regenerate does (0574); otherwise it is cleared.
create or replace function app.niva_own_no_answer(p_id uuid, p_reason text, p_clear boolean default false)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_detail text := app.niva_own_outcome_detail(p_reason);
begin
  select * into v from app.niva_conversations where id = p_id for update;
  if not found then raise exception 'Niva conversation % was not found (it may have been deleted by the 30-day retention job).', p_id; end if;
  if v.answer is not null and not (coalesce(p_clear, false) and not app.niva_cites_current(v.center_id, v.sources)) then
    update app.niva_conversations
       set answer_status = 'answered',
           outcome_detail = 'Niva found nothing new in the approved content, so the earlier answer was kept.',
           attempted_at = now()
     where id = p_id
    returning * into v;
  else
    update app.niva_conversations
       set answer = null, sources = '[]'::jsonb, unanswered = true,
           answer_status = 'no_source', outcome_detail = v_detail, attempted_at = now()
     where id = p_id
    returning * into v;
  end if;
  return v;
end $$;

-- ── 1. Answering from the community's own content ────────────────────────────
-- Returns {answered: true, model: 'own:cache' | 'own:faq' | 'own:extract'} after writing the answer on the question,
-- or {answered: false, reason: 'personal' | 'no_match' | 'not_found'} and writes nothing.
create or replace function app.niva_own_answer(p_conversation uuid, p_include_in_review boolean default false)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v app.niva_conversations;
  v_statuses text[] := case when coalesce(p_include_in_review, false) then array['published', 'in_review'] else array['published'] end;
  v_tradition app.tradition;
  v_from text[];
  v_norm text;
  v_q text[];
  v_kind text;
  v_cand_kind text;
  v_tsq tsquery;
  v_hit record;
  v_best record;
  v_best_score numeric := 0;
  v_score numeric;
  v_terms text[];
  v_results jsonb;
  v_r jsonb;
  v_src record;
  v_cov numeric;
  v_head text[];
  v_sent text[];
  v_best_cov numeric := 0;
  v_best_ref text;
  v_best_title text;
  v_best_body text;
  v_best_url text;
  v_text text;
  v_answer text;
begin
  select * into v from app.niva_conversations where id = p_conversation for update;
  if not found then return jsonb_build_object('answered', false, 'reason', 'not_found'); end if;
  if app.niva_is_personal(v.question) then return jsonb_build_object('answered', false, 'reason', 'personal'); end if;
  v_norm := app.niva_normalize_question(v.question);
  if v_norm = '' then return jsonb_build_object('answered', false, 'reason', 'no_match'); end if;
  select c.tradition into v_tradition from app.centers c where c.id = v.center_id;
  v_from := app.niva_answer_from(v.center_id);

  -- (a) The same question, answered before, from sources that still stand. Members' answers only: a staff test's
  -- answer may come from a source waiting for approval.
  select c.answer, c.sources into v_hit
    from app.niva_conversations c
   where c.center_id = v.center_id and app.niva_normalize_question(c.question) = v_norm
     and c.answer is not null and not c.is_test and c.id <> v.id and c.answer_status = 'answered'
     and app.niva_cache_sources_ok(v.center_id, v_tradition, c.sources, coalesce(c.answered_at, c.created_at), v_from)
   order by coalesce(c.answered_at, c.created_at) desc, c.id
   limit 1;
  if found then
    perform app.niva_store_own_answer(v.id, v_hit.answer, v_hit.sources, 'own:cache');
    return jsonb_build_object('answered', true, 'model', 'own:cache');
  end if;

  v_tsq := app.niva_search_tsquery(v.center_id, v.question);
  v_q := app.niva_question_terms(v.center_id, v.question);
  if v_tsq is null or cardinality(v_q) = 0 then return jsonb_build_object('answered', false, 'reason', 'no_match'); end if;
  v_kind := app.niva_question_kind(v.question);

  -- (b) A question-and-answer the community approved that asks the same thing.
  for v_hit in
    select x.ref, x.qtext, x.title, x.body, x.url
      from (
        -- FAQ items, while the community answers from its FAQ: the title is the question, the text its answer.
        select c.id::text as ref, c.title as qtext, c.title, c.body_md as body, c.metadata->>'source_url' as url, c.updated_at
          from app.content_items c
         where 'faq' = any (v_from) and c.kind = 'faq'
           and c.status = any (v_statuses) and (c.status = 'published' or c.center_id = v.center_id)
           and (c.center_id = v.center_id or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)))
           and c.niva_tsv @@ v_tsq
        union all
        -- Niva sources whose heading is a question (an imported FAQ page's sections: "<page title>: <question>").
        select c.id::text, h.heading, c.title, c.body_md, c.metadata->>'source_url', c.updated_at
          from app.content_items c
         cross join lateral (
           select case when coalesce(c.metadata->>'page_title', '') <> ''
                            and left(c.title, char_length(c.metadata->>'page_title') + 2) = (c.metadata->>'page_title') || ': '
                       then substr(c.title, char_length(c.metadata->>'page_title') + 3) else c.title end as heading) h
         where c.kind = 'niva_source'
           and c.status = any (v_statuses) and (c.status = 'published' or c.center_id = v.center_id)
           and (c.center_id = v.center_id or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)))
           and h.heading ~ '\?[[:space:]]*$'
           and c.niva_tsv @@ v_tsq
        union all
        -- Public Guide sections titled as a question, while the community answers from its Guide.
        select 'guide_section:' || g.id::text, g.title, g.title, g.body_md, null, g.updated_at
          from app.guide_sections g
         where 'guide' = any (v_from) and g.center_id = v.center_id and g.public
           and g.title ~ '\?[[:space:]]*$'
           and (to_tsvector('english', g.title) || to_tsvector('english', g.body_md)) @@ v_tsq
      ) x
     order by x.updated_at desc, x.ref collate "C"
     limit 200
  loop
    v_cand_kind := app.niva_question_kind(v_hit.qtext);
    continue when v_kind is not null and v_cand_kind is not null and v_kind <> v_cand_kind;
    v_terms := app.niva_question_terms(v.center_id, v_hit.qtext);
    continue when cardinality(v_terms) = 0;
    v_score := 2.0 * (select count(*) from unnest(v_q) as t where t = any (v_terms)) / (cardinality(v_q) + cardinality(v_terms));
    if v_score > v_best_score then
      v_best := v_hit;
      v_best_score := v_score;
    end if;
  end loop;
  if v_best_score >= 0.75 then
    v_answer := left(app.niva_plain_text(v_best.body), 3800);
    if v_answer <> '' then
      if app.niva_is_doctrinal(v.question || ' ' || v_best.title) then
        v_answer := v_answer || E'\n\n' || app.niva_referral_line();
      end if;
      perform app.niva_store_own_answer(v.id, v_answer,
        jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('content_item_id', v_best.ref, 'title', v_best.title, 'url', v_best.url))),
        'own:faq');
      return jsonb_build_object('answered', true, 'model', 'own:faq');
    end if;
  end if;

  -- (c) The sentences of the best matching source that answer it.
  v_results := app.niva_search_core(v.center_id, v.question, 3, v_statuses);
  for v_r in select e from jsonb_array_elements(v_results) as e loop
    continue when coalesce((v_r->>'rank')::numeric, 0) < 0.01;
    if (v_r->>'id') like 'guide_section:%' then
      select g.title, g.title as heading, g.body_md as body, null::text as url, null::text as keywords into v_src
        from app.guide_sections g where g.id = substr(v_r->>'id', 15)::uuid;
    else
      select c.title,
             case when coalesce(c.metadata->>'page_title', '') <> ''
                       and left(c.title, char_length(c.metadata->>'page_title') + 2) = (c.metadata->>'page_title') || ': '
                  then substr(c.title, char_length(c.metadata->>'page_title') + 3) else c.title end as heading,
             coalesce(c.body_md, '') as body, c.metadata->>'source_url' as url, c.metadata->>'keywords' as keywords into v_src
        from app.content_items c where c.id = (v_r->>'id')::uuid;
    end if;
    continue when not found;
    v_terms := app.niva_text_terms(concat_ws(' ', v_src.title, v_src.keywords, v_src.body));
    v_cov := app.niva_terms_covered(v_q, v_terms)::numeric / cardinality(v_q);
    v_head := app.niva_text_terms(concat_ws(' ', v_src.heading, v_src.keywords));
    -- One key word is too little to go on unless the source is about it.
    continue when cardinality(v_q) = 1 and app.niva_terms_covered(v_q, v_head) = 0;
    if v_cov >= 0.6 and v_cov > v_best_cov then
      v_text := app.niva_extract_sentences(v_src.body, v_q, v_kind, 600);
      -- The sentences themselves must hold most of the key words. The heading may lend the rest only when it is
      -- wholly about the question ("Derasar timings" for "When is the derasar open?"), never a heading about
      -- something else ("Is there parking at the derasar?" does not make "Overflow parking opens at 8 AM" the
      -- derasar's opening time).
      if v_text is not null then
        v_sent := app.niva_sentence_terms(v_text, v_q);
        if not (app.niva_terms_covered(v_q, v_sent)::numeric / cardinality(v_q) >= 0.6
                or (v_head <@ v_q and app.niva_terms_covered(v_q, v_sent) >= 1
                    and app.niva_terms_covered(v_q, v_sent || v_head)::numeric / cardinality(v_q) >= 0.6)) then
          v_text := null;
        end if;
      end if;
      if v_text is not null then
        v_best_cov := v_cov;
        v_best_ref := v_r->>'id';
        v_best_title := v_src.title;
        v_best_body := v_text;
        v_best_url := v_src.url;
      end if;
    end if;
  end loop;
  if v_best_ref is not null then
    v_answer := v_best_body || E'\n\n— ' || v_best_title;
    if app.niva_is_doctrinal(v.question || ' ' || v_best_title) then
      v_answer := v_answer || E'\n\n' || app.niva_referral_line();
    end if;
    perform app.niva_store_own_answer(v.id, v_answer,
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('content_item_id', v_best_ref, 'title', v_best_title, 'url', v_best_url))),
      'own:extract');
    return jsonb_build_object('answered', true, 'model', 'own:extract');
  end if;

  return jsonb_build_object('answered', false, 'reason', 'no_match');
end $$;
comment on function app.niva_own_answer(uuid, boolean) is
  'Internal (0579): answer a Niva question from the community''s own approved content, with no AI: an earlier answer to the same question, a matching FAQ, or the sentences of the best matching source. Writes the answer (model own:cache, own:faq or own:extract) and returns {answered, model} or {answered: false, reason}.';

-- The worker's own try (a regenerate, a retry or a paused question's next try may find a source approved since), and
-- the community's AI setting with it.
create or replace function app.niva_worker_own_answer(p_id uuid, p_include_in_review boolean default false) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  perform app.assert_worker();
  select center_id into v_center from app.niva_conversations where id = p_id;
  if not found then return jsonb_build_object('answered', false, 'reason', 'not_found', 'ai', 'off'); end if;
  return app.niva_own_answer(p_id, p_include_in_review) || jsonb_build_object('ai', app.niva_ai_mode(v_center));
end $$;
comment on function app.niva_worker_own_answer(uuid, boolean) is
  'Worker only (0579): app.niva_own_answer for a niva.answer job, plus ai (the community''s setting: ''off'' means do not call the AI).';

-- ── Member: ask a question (0575, answered at once when the own content answers) ──
create or replace function app.niva_ask(p_center uuid, p_question text)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_q text; v_row app.niva_conversations; v_count bigint; v_own jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to ask Niva.' using errcode = 'insufficient_privilege'; end if;
  if not app.is_member_of(p_center) then
    raise exception 'You are not a member of this community.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_q := nullif(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), '');
  if v_q is null then raise exception 'Type a question first.'; end if;
  v_q := left(v_q, 1000);

  -- One writer per center at a time, so two parallel asks near the boundary
  -- cannot both slip in under the cap (same pattern as enforce_people_cap).
  perform pg_advisory_xact_lock(hashtextextended('app.niva_conversations.cap:' || p_center::text, 0));
  select count(*) into v_count from app.niva_conversations
   where center_id = p_center and not is_test and created_at >= date_trunc('month', current_date)::timestamptz;
  perform app.assert_entitlement(p_center, 'niva.monthly_questions', to_jsonb(v_count + 1));

  insert into app.niva_conversations (center_id, user_id, question, unanswered, answer_status)
  values (p_center, auth.uid(), v_q, true, 'pending')
  returning * into v_row;

  -- 0579: the community's own content first, with no AI and no wait.
  v_own := app.niva_own_answer(v_row.id, false);
  if v_own->>'answered' = 'true' then
    select * into v_row from app.niva_conversations where id = v_row.id;
    return v_row;
  end if;
  if app.niva_ai_mode(p_center) = 'haiku' then
    perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_row.id), now(), 3);
    return v_row;
  end if;
  return app.niva_own_no_answer(v_row.id, v_own->>'reason', false);
end $$;

-- ── Staff: test Niva (0575, the same tiers and setting as a member's question) ──
create or replace function app.niva_test_ask(p_center uuid, p_question text, p_include_in_review boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_q text;
  v_row app.niva_conversations;
  v_limit int := app.niva_test_daily_limit();
  v_used int;
  v_review boolean := coalesce(p_include_in_review, false);
  v_own jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to test Niva.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Testing Niva needs content.draft or content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_q := nullif(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), '');
  if v_q is null then raise exception 'Type a question first.'; end if;
  v_q := left(v_q, 1000);

  -- One tester per community at a time, so two tests at once cannot both slip in under the limit.
  perform pg_advisory_xact_lock(hashtextextended('app.niva_conversations.test_cap:' || p_center::text, 0));
  v_used := app.niva_tests_today(p_center);
  if v_used >= v_limit then
    raise exception 'Staff can test Niva % times a day in this community, and today''s tests are used up. Try again tomorrow; members can still ask Niva as usual.', v_limit;
  end if;

  insert into app.niva_conversations (center_id, user_id, question, unanswered, answer_status, is_test)
  values (p_center, auth.uid(), v_q, true, 'pending', true)
  returning * into v_row;

  v_own := app.niva_own_answer(v_row.id, v_review);
  if v_own->>'answered' = 'true' then
    select * into v_row from app.niva_conversations where id = v_row.id;
  elsif app.niva_ai_mode(p_center) = 'haiku' then
    perform app.enqueue_job(p_center, 'niva.answer',
                            jsonb_build_object('conversation_id', v_row.id, 'include_in_review', v_review), now(), 3);
  else
    v_row := app.niva_own_no_answer(v_row.id, v_own->>'reason', false);
  end if;

  return jsonb_build_object('id', v_row.id, 'question', v_row.question, 'created_at', v_row.created_at,
                            'include_in_review', v_review, 'tests_today', v_used + 1, 'daily_limit', v_limit,
                            'answer_status', v_row.answer_status, 'model', v_row.model);
end $$;
comment on function app.niva_test_ask(uuid, text, boolean) is
  'content.draft or content.manage (0575; 0579: answered at once from the community''s own content when it can be, else queued for the AI when AI answers are on). No membership needed and not counted in niva.monthly_questions; at most app.niva_test_daily_limit() tests per community per day. include_in_review: also answer from sources waiting for approval.';

-- ── Staff: regenerate an answer (0572; tried at once from the own content while AI answers are off) ──
create or replace function app.niva_regenerate(p_id uuid)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_job bigint; v_run_after timestamptz; v_own jsonb;
begin
  select * into v from app.niva_conversations where id = p_id;
  if not found then raise exception 'That Niva question was not found.'; end if;
  if not app.has_permission(v.center_id, 'content.manage') then
    raise exception 'Regenerating a Niva answer needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  -- Lock the question first, so two presses at once cannot both queue it.
  select * into v from app.niva_conversations where id = p_id for update;
  if exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status = 'running'
               and j.payload->>'conversation_id' = p_id::text) then
    return v;
  end if;
  -- 0579: no AI for this community: the own content is tried now, and nothing is queued.
  if app.niva_ai_mode(v.center_id) = 'off' then
    v_own := app.niva_own_answer(p_id, false);
    if v_own->>'answered' = 'true' then
      select * into v from app.niva_conversations where id = p_id;
      return v;
    end if;
    return app.niva_own_no_answer(p_id, v_own->>'reason', true);
  end if;
  select j.id, j.run_after into v_job, v_run_after
    from app.jobs j
   where j.kind = 'niva.answer' and j.status = 'queued' and j.payload->>'conversation_id' = p_id::text
   order by j.id desc
   limit 1;
  if v_job is not null then
    if v_run_after <= now() then return v; end if;
    update app.jobs set run_after = now(), payload = payload || '{"regenerate": true}'::jsonb
     where id = v_job and status = 'queued';
    if not found then return v; end if;     -- the worker took it in the meantime: it is running now
  else
    perform app.enqueue_job(v.center_id, 'niva.answer', jsonb_build_object('conversation_id', v.id, 'regenerate', true), now(), 3);
  end if;
  update app.niva_conversations
     set answer_status = case when answer is null then 'pending' else 'answered' end, outcome_detail = null
   where id = p_id
  returning * into v;
  return v;
end $$;

-- ── Staff: try every unanswered question again (0575; at once from the own content while AI answers are off) ──
-- As 0575, except that with AI answers off each question is tried against the community's own content right away
-- (no job; those still unanswered read no_source). Returns how many were tried (off) or queued (on).
create or replace function app.niva_retry_unanswered(p_center uuid, p_since interval default interval '30 days', p_limit int default 100)
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_since interval := coalesce(p_since, interval '30 days');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 150);
  v_soon timestamptz := now() + interval '5 minutes';
  v_off boolean;
  v_own jsonb;
  v_id uuid;
  v_job bigint;
  v_at timestamptz;
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'content.manage') then
    raise exception 'Trying Niva questions again needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  if v_since <= interval '0' then
    raise exception 'Choose a period that goes back in time, for example the last 30 days.';
  end if;
  v_off := app.niva_ai_mode(p_center) = 'off';

  -- One run per center at a time, so two people pressing it together do not queue a question twice.
  perform pg_advisory_xact_lock(hashtextextended('app.niva_retry_unanswered:' || p_center::text, 0));

  for v_id in
    select c.id
      from app.niva_conversations c
     where c.center_id = p_center and c.answer is null and not c.is_test
       and c.created_at >= now() - v_since
       and (c.answer_status <> 'pending' or c.created_at < now() - interval '5 minutes')
       and not exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.payload->>'conversation_id' = c.id::text
                         and (j.status = 'running' or (j.status = 'queued' and j.run_after <= v_soon)))
     order by c.created_at, c.id
     limit v_limit
     for update of c skip locked              -- a question being regenerated right now is left to that
  loop
    -- Checked again now that the row is locked: a regenerate may have queued it in the meantime.
    continue when exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.payload->>'conversation_id' = v_id::text
                            and (j.status = 'running' or (j.status = 'queued' and j.run_after <= v_soon)));
    if v_off then
      v_own := app.niva_own_answer(v_id, false);
      if v_own->>'answered' is distinct from 'true' then
        perform app.niva_own_no_answer(v_id, v_own->>'reason', false);
      end if;
      v_n := v_n + 1;
      continue;
    end if;
    v_at := now() + (v_n * interval '2 seconds');
    select j.id into v_job
      from app.jobs j
     where j.kind = 'niva.answer' and j.status = 'queued' and j.payload->>'conversation_id' = v_id::text
     order by j.id desc
     limit 1;
    if v_job is not null then
      -- A retry queued for later: bring it forward (its payload, deferrals included, is kept).
      update app.jobs set run_after = v_at, payload = payload || '{"retry": true}'::jsonb
       where id = v_job and status = 'queued';
      continue when not found;               -- the worker took it in the meantime: it is on its way
    else
      perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_id, 'retry', true), v_at, 3);
    end if;
    update app.niva_conversations set answer_status = 'pending', outcome_detail = null where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── Worker: read one conversation (0575, plus the community's AI setting) ──────
create or replace function app.niva_worker_get_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_name text; v_tz text; v_local timestamp; v_asked timestamp; v_recent jsonb;
begin
  perform app.assert_worker();
  select * into v from app.niva_conversations where id = p_id;
  if not found then return null; end if;

  select c.name, c.time_zone into v_name, v_tz from app.centers c where c.id = v.center_id;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  begin
    v_local := now() at time zone v_tz;
    v_asked := v.created_at at time zone v_tz;
  exception when others then                -- a time zone Postgres does not know: fall back to UTC
    v_tz := 'UTC';
    v_local := now() at time zone 'UTC';
    v_asked := v.created_at at time zone 'UTC';
  end;

  select coalesce(jsonb_agg(jsonb_build_object('question', r.question, 'answer', r.answer, 'created_at', r.created_at)
                            order by r.created_at), '[]'::jsonb)
    into v_recent
    from (select x.question, x.answer, x.created_at
            from app.niva_conversations x
           where v.user_id is not null and x.user_id = v.user_id and x.center_id = v.center_id and x.id <> v.id
             and x.is_test = v.is_test
             and x.answer is not null
             and x.created_at < v.created_at and x.created_at >= v.created_at - interval '15 minutes'
           order by x.created_at desc
           limit 2) r;

  return jsonb_build_object(
    'id', v.id, 'center_id', v.center_id, 'user_id', v.user_id, 'question', v.question, 'unanswered', v.unanswered,
    'created_at', v.created_at, 'answer_status', v.answer_status, 'has_answer', v.answer is not null,
    'is_test', v.is_test,
    'center_name', v_name, 'time_zone', v_tz,
    'local_now', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'local_today', to_char(v_local, 'FMDay, FMDD FMMonth YYYY'),
    'asked_local', to_char(v_asked, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'asked_today', to_char(v_asked, 'FMDay, FMDD FMMonth YYYY'),
    'recent', v_recent,
    'ai', app.niva_ai_mode(v.center_id));
end $$;

-- ── 3. Staff: how Niva is doing (0575, plus the AI setting and how answers were made) ──
create or replace function app.niva_health(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_last timestamptz; v_live int; v_state text; v_handler jsonb; v_jobs jsonb;
  v_err text; v_err_at timestamptz; v_err_status text;
  v_used bigint; v_limit jsonb; v_by jsonb; v_made jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Seeing how Niva is doing needs content.draft or content.manage.' using errcode = 'insufficient_privilege';
  end if;

  -- The background service, by the same rule as app.background_service_status (0171).
  select max(beat_at), count(*) filter (where stopped_at is null and beat_at >= now() - app.worker_stale_after())
    into v_last, v_live
    from app.worker_heartbeats;
  v_state := case when v_last is null then 'not_configured'
                  when v_live > 0 then 'running'
                  else 'stopped' end;
  -- What niva.answer reports: from the newest live worker that runs it; with none, the newest heartbeat
  -- (a stopped worker, or one that does not run niva.answer, must not hide a live one that does).
  select h.info->'handlers'->'niva.answer' into v_handler
    from app.worker_heartbeats h
   order by (h.stopped_at is null and h.beat_at >= now() - app.worker_stale_after() and 'niva.answer' = any (h.kinds)) desc,
            h.beat_at desc
   limit 1;

  -- This center's niva.answer jobs (tests included: they run on the same service).
  select jsonb_build_object(
           'queued',         count(*) filter (where status = 'queued'),
           'running',        count(*) filter (where status = 'running'),
           'failed_24h',     count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours'),
           'done_24h',       count(*) filter (where status = 'done' and finished_at > now() - interval '24 hours'),
           'next_run_after', min(run_after) filter (where status = 'queued'))
    into v_jobs
    from app.jobs
   where center_id = p_center and kind = 'niva.answer'
     and (status in ('queued','running') or finished_at > now() - interval '24 hours');

  -- The latest error in the last 7 days (a job that will retry, or one that failed), scrubbed.
  select left(app.niva_scrub_text(j.last_error), 500), coalesce(j.finished_at, j.created_at), j.status
    into v_err, v_err_at, v_err_status
    from app.jobs j
   where j.center_id = p_center and j.kind = 'niva.answer' and j.last_error is not null
     and j.created_at > now() - interval '7 days'
   order by j.created_at desc, j.id desc
   limit 1;

  -- Members' questions this month, counted the way niva_ask counts them against niva.monthly_questions.
  select count(*) into v_used
    from app.niva_conversations
   where center_id = p_center and not is_test and created_at >= date_trunc('month', current_date)::timestamptz;
  v_limit := app.entitlement(p_center, 'niva.monthly_questions');
  if v_limit is not null and jsonb_typeof(v_limit) <> 'number' then v_limit := null; end if;

  -- Members' questions of the last 7 days by outcome (every status present, 0 when none).
  select jsonb_object_agg(s.k, coalesce(n.cnt, 0))
    into v_by
    from unnest(array['pending','answered','no_source','unsure','refused','paused','failed']) as s(k)
    left join (select answer_status, count(*) as cnt
                 from app.niva_conversations
                where center_id = p_center and not is_test and created_at >= now() - interval '7 days'
                group by answer_status) n on n.answer_status = s.k;

  -- 0579: members' answers of the last 7 days by how they were made.
  select jsonb_build_object(
           'cache',   count(*) filter (where model = 'own:cache'),
           'faq',     count(*) filter (where model = 'own:faq'),
           'extract', count(*) filter (where model = 'own:extract'),
           'ai',      count(*) filter (where model is not null and model not like 'own:%'))
    into v_made
    from app.niva_conversations
   where center_id = p_center and not is_test and answer is not null and created_at >= now() - interval '7 days';

  return jsonb_build_object(
    'state', v_state,
    'last_beat_at', v_last,
    'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
    'module_on', app.module_enabled(p_center, 'niva'),
    'handler', v_handler,
    'jobs', v_jobs || jsonb_build_object('last_error', v_err, 'last_error_at', v_err_at, 'last_error_status', v_err_status),
    'month', jsonb_build_object('used', v_used, 'limit', v_limit),
    'outcomes_7d', v_by,
    'tests_today', jsonb_build_object('used', app.niva_tests_today(p_center), 'limit', app.niva_test_daily_limit()),
    'ai', app.niva_ai_mode(p_center),
    'answered_by_7d', v_made);
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- niva_ask, niva_test_ask, niva_regenerate, niva_retry_unanswered, niva_worker_get_conversation, niva_health and the
-- 4-argument niva_worker_search_sources keep their grants (same signatures).
revoke execute on function app.niva_ai_mode(uuid), app.niva_rules_with(jsonb, text, jsonb), app.seed_jsh_niva_ai_off(),
  app.niva_normalize_question(text), app.niva_is_personal(text), app.niva_is_doctrinal(text), app.niva_referral_line(),
  app.niva_question_kind(text), app.niva_glossary_stems(), app.niva_text_terms(text), app.niva_question_terms(uuid, text),
  app.niva_terms_covered(text[], text[]), app.niva_plain_text(text), app.niva_sentence_fits(text, text), app.niva_sentence_terms(text, text[]),
  app.niva_extract_sentences(text, text[], text, int), app.niva_search_core(uuid, text, int, text[]),
  app.niva_cache_sources_ok(uuid, app.tradition, jsonb, timestamptz, text[]), app.niva_cites_current(uuid, jsonb),
  app.niva_store_own_answer(uuid, text, jsonb, text), app.niva_own_outcome_detail(text),
  app.niva_own_no_answer(uuid, text, boolean), app.niva_own_answer(uuid, boolean), app.niva_worker_own_answer(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_worker_own_answer(uuid, boolean) to connect_worker;
grant execute on function app.seed_jsh_niva_ai_off() to service_role;

select app.seed_jsh_niva_ai_off();
