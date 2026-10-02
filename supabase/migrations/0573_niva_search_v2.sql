-- 0573_niva_search_v2.sql: Niva finds the source that answers a member's question more often, and hands the
-- model the part of it that matters.
--
-- What went wrong with 0541 (app.niva_worker_search_sources, the only way Niva finds what it may answer from):
--   * A hyphenated word ("Can non-members attend pathshala?", "is it tax-deductible?") made websearch_to_tsquery
--     write a phrase (<->). 0541's guard then kept the AND of every word, so a source that answered the question
--     was missed whenever one word of the question was not in it.
--   * Members say "temple", the source says "Derasar"; "open" against "timings"; "Paryushana" against "Paryushan".
--     A source was offered only if it shared an exact stemmed English word with the question.
--   * An imported section's title is "<page title>: <heading>" (worker/src/web/page_text.ts) and was weighed like
--     the heading, so every section of a page scored on the page's own title and the section that held the answer
--     could be pushed out of the top six. Equal scores came back in no particular order.
--   * Only the first 4000 characters of a source reached the model, although the match used the whole text.
--   * Nothing was indexed; shared rows (center_id null) were offered to every tradition; no page address came back.
--
-- This migration:
--   1. app.niva_glossary(): the platform's groups of words that mean the same thing to a member (derasar / temple /
--      mandir, pathshala / Sunday school, timings / hours / open, relocate / move / new building, dues / fee /
--      membership, sponsor / labh, swamivatsalya / community lunch, and the usual spellings of upashray, Paryushan,
--      Ayambil and Navkarsi). A function, not a table: there is nothing for RLS to guard and nothing for a community
--      to edit yet (per-community words are later work). A few spelling variants were added to the plan's list; the
--      owner may review the list.
--   2. app.niva_search_tsquery(center, question): ANY word of the question, as its English stem and as written
--      ('simple'), each word of four letters or more also as a prefix (Paryushan finds Paryushana), plus the whole
--      glossary group of any word the question uses. English filler words and the community's own name, short name
--      and slug are left out (nearly every source of a community names it). A question with a "quoted phrase" or a
--      -word keeps its exact websearch meaning, as in 0541.
--   3. app.content_items.niva_tsv: a stored, generated search vector for niva_source and faq rows (null for every
--      other kind): the section heading and metadata.keywords weigh most (A), the text next (B), the page title
--      least of the words (C), and the text as written (D, for spellings the English stemmer changes). A partial
--      GIN index covers niva_source rows. app.audit_mask leaves the vector out of the audit log (it is derived).
--   4. What Niva answers from (owner decision 2026-10-01: yes for JSH). centers.rules.niva.answer_from lists it;
--      niva_source is always included, 'guide' adds the community's public Guide sections and 'faq' its published
--      FAQ items. Off by default for every community. app.niva_set_answer_from(center, kinds[]) changes it
--      (content.manage); the portal toggle is PR H. A Guide section comes back with the id 'guide_section:<uuid>'
--      (it is not a content item), so the worker's list of offered ids still decides what may be cited. A FAQ item
--      is a content item and keeps its uuid.
--   5. app.niva_worker_search_sources(center, question, limit, statuses): ranked by ts_rank_cd (normalised for
--      length), then most recently updated, then id, so equal scores always come back in the same order. A source
--      over 4000 characters comes back as its first 1500 characters plus up to three excerpts around the matching
--      words, and the results together stay within about 24000 characters. Each result also carries kind,
--      source_url and updated_at. Shared rows are offered only when they have no tradition or the community's own.
--      statuses is {published} (members) or {published,in_review} (a staff test, PR H); nothing else is accepted.
--      The worker's 3-argument call (worker/src/handlers/niva.answer.ts) keeps its exact signature and grants and
--      now runs the 4-argument search over published sources. It stays a function of its own rather than becoming
--      a default on the new one: with both present a default would make every 3-argument call ambiguous, and
--      dropping it would break the signature test 42 checks.
--   6. app.seed_jsh_niva_answer_from(): turns Guide and FAQ answering on for JSH when JSH exists and has not chosen
--      yet. A brand-new database applies the migrations before seed.sql creates JSH, so there it does nothing; test
--      60 runs it explicitly (as 0567 does for JSH's address and timings).
--
-- 0530 and 0541 are applied and untouched; the 3-argument function is replaced with create or replace.

set client_min_messages = warning;

-- ── 1. Words that mean the same thing ────────────────────────────────────────
-- One array per group. A word with a space is matched as a phrase. Words are stemmed the same way as the
-- question and the sources (English), so "timings", "timing" and "time" are one word here.
create or replace function app.niva_glossary() returns setof text[]
language sql immutable set search_path = app, public, extensions as $$
  values
    (array['derasar', 'temple', 'mandir', 'jinalay', 'jinalaya']),
    (array['upashray', 'upashraya', 'upasray', 'upasraya']),
    (array['pathshala', 'paathshala', 'patshala', 'sunday school']),
    (array['timings', 'hours', 'open']),
    (array['relocate', 'relocation', 'move', 'new building']),
    (array['dues', 'fee', 'membership']),
    (array['sponsor', 'sponsorship', 'labh', 'laabh']),
    (array['swamivatsalya', 'swamivatsalyam', 'swami vatsalya', 'community lunch']),
    (array['paryushan', 'paryushana', 'pajushan', 'pajushana', 'paryusan']),
    (array['ayambil', 'aayambil', 'ayambel', 'aayambel']),
    (array['navkarsi', 'navkarshi', 'navkarasi'])
$$;
comment on function app.niva_glossary() is
  'Groups of words that mean the same thing to a member (platform-wide, 0573). app.niva_search_tsquery adds a whole group when the question uses one of its words.';

-- ── 2. The question as a search ──────────────────────────────────────────────
create or replace function app.niva_search_tsquery(p_center uuid, p_query text)
returns tsquery language plpgsql stable set search_path = app, public, extensions as $$
declare
  v_q text := left(btrim(coalesce(p_query, '')), 2000);
  v_tsq tsquery;
  v_phrases tsquery;
  v_qvec tsvector;
  v_drop text[];
  v_lex text[];
  v_add text[] := '{}';
  v_group text[];
  v_term text;
  v_glex text;
  v_hit boolean;
  v_txt text;
begin
  if v_q = '' then return null; end if;

  -- A "quoted phrase" or a -word: the member used search operators; keep their exact meaning (as 0541 did).
  if position('"' in v_q) > 0 or v_q ~ '(^|\s)-\w' then
    begin
      v_tsq := websearch_to_tsquery('english', v_q);
    exception when others then
      v_tsq := plainto_tsquery('english', v_q);
    end;
    -- Nothing left, or only exclusions (which would match almost everything): no search.
    if v_tsq is null or numnode(v_tsq) = 0 or querytree(v_tsq) = 'T' then return null; end if;
    return v_tsq;
  end if;

  -- The community's own name, short name and slug are in nearly every one of its sources: they rank nothing.
  select coalesce(tsvector_to_array(to_tsvector('english', x.s) || to_tsvector('simple', x.s)), '{}')
    into v_drop
    from (select concat_ws(' ', c.name, c.short_name, c.slug::text) as s from app.centers c where c.id = p_center) x;
  v_drop := coalesce(v_drop, '{}');

  -- Every word of the question, stemmed (english) and as written (simple). The parser splits "non-members" into
  -- the whole word and its parts, so each part is a word of its own here. English filler words (which the
  -- 'simple' configuration keeps) are left out, as are single letters and anything that cannot be quoted safely.
  v_qvec := to_tsvector('english', v_q) || to_tsvector('simple', v_q);
  select coalesce(array_agg(distinct l), '{}')
    into v_lex
    from unnest(tsvector_to_array(v_qvec)) as l
   where l <> all (v_drop)
     and (char_length(l) > 1 or l ~ '^[0-9]$')
     and position('''' in l) = 0 and position(chr(92) in l) = 0
     and cardinality(ts_lexize('english_stem', l)) > 0;

  -- Glossary: a group joins the search when the question uses one of its words (a word of four letters or more
  -- also matches a longer form: "paryushan" is used by "Paryushana").
  for v_group in select g.terms from app.niva_glossary() as g(terms) loop
    v_hit := false;
    foreach v_term in array v_group loop
      if position(' ' in v_term) > 0 then
        v_hit := v_qvec @@ phraseto_tsquery('english', v_term);
      else
        v_glex := (tsvector_to_array(to_tsvector('english', v_term)))[1];
        v_hit := v_glex is not null and exists (
          select 1 from unnest(v_lex) as l
           where l = v_glex or (char_length(v_glex) >= 4 and left(l, char_length(v_glex)) = v_glex));
      end if;
      exit when v_hit;
    end loop;
    if v_hit then
      foreach v_term in array v_group loop
        if position(' ' in v_term) > 0 then
          v_phrases := case when v_phrases is null then phraseto_tsquery('english', v_term)
                            else v_phrases || phraseto_tsquery('english', v_term) end;
        else
          v_glex := (tsvector_to_array(to_tsvector('english', v_term)))[1];
          if v_glex is not null and v_glex <> all (v_drop) then v_add := v_add || v_glex; end if;
        end if;
      end loop;
    end if;
  end loop;

  -- ANY of the words: 'word' | 'longer':* | ... ; a word of four letters or more also matches as a prefix.
  select string_agg('''' || x.l || '''' || case when char_length(x.l) >= 4 then ':*' else '' end, ' | ' order by x.l)
    into v_txt
    from (select distinct unnest(v_lex || v_add) as l) x;
  if v_txt is not null then v_tsq := v_txt::tsquery; end if;
  if v_phrases is not null and numnode(v_phrases) > 0 then
    v_tsq := case when v_tsq is null then v_phrases else v_tsq || v_phrases end;
  end if;
  if v_tsq is null or numnode(v_tsq) = 0 then return null; end if;
  return v_tsq;
end $$;
comment on function app.niva_search_tsquery(uuid, text) is
  'The search for a Niva question (0573): any word (English stem and as written, prefix for 4+ letters), plus glossary groups, without filler words or the community''s own name. A "quoted phrase" or -word keeps exact websearch semantics. Null: nothing to search for.';

-- ── 3. A stored search vector for Niva's sources ─────────────────────────────
-- Heading: an imported section's title is "<page title>: <heading>" (page_text.ts); the page title is weighed on
-- its own, lower, so ten sections of one page do not all score on it.
alter table app.content_items add column if not exists niva_tsv tsvector generated always as (
  case when kind in ('niva_source', 'faq') then
       setweight(to_tsvector('english'::regconfig, coalesce(
         case when coalesce(metadata->>'page_title', '') <> ''
                   and left(title, char_length(metadata->>'page_title') + 2) = (metadata->>'page_title') || ': '
              then substr(title, char_length(metadata->>'page_title') + 3)
              else title end, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, coalesce(metadata->>'keywords', '')), 'A')
    || setweight(to_tsvector('english'::regconfig, coalesce(metadata->>'page_title', '')), 'C')
    || setweight(to_tsvector('english'::regconfig, left(coalesce(body_md, ''), 100000)), 'B')
    || setweight(to_tsvector('simple'::regconfig, left(coalesce(body_md, ''), 100000)), 'D')
  end
) stored;
comment on column app.content_items.niva_tsv is
  'Niva''s search vector (0573), niva_source and faq rows only: heading and metadata.keywords (A), body (B), metadata.page_title (C), body as written (D); the first 100000 characters of the body, which keeps the vector well inside its 1 MB limit. Generated; never written.';
create index if not exists content_items_niva_tsv_idx on app.content_items using gin (niva_tsv) where kind = 'niva_source';

-- The vector is derived from columns the audit log already keeps; it would only make every source's entry
-- larger. Starts from 0548's definition (see the note there) and adds niva_tsv.
-- Anyone who changes app.audit_mask again must start from THIS definition.
--   0102   date_of_birth and the secrets / tokens
--   0546   the emergency contact's name and number, both dietary fields
--   0545   staged_rows (the uploaded rows, personal data) and merge_answers (they grow with the file)
--   0573   niva_tsv (derived search vector, dropped rather than masked)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref' - 'niva_tsv'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
  end
$$;

-- ── 4. What Niva answers from ────────────────────────────────────────────────
-- Always niva_source; plus 'guide' and/or 'faq' when centers.rules.niva.answer_from lists them.
create or replace function app.niva_answer_from(p_center uuid) returns text[]
language sql stable set search_path = app, public, extensions as $$
  select array['niva_source'] || coalesce((
    select array_agg(k order by array_position(array['guide', 'faq'], k))
      from (select distinct e as k
              from app.centers c
             cross join lateral jsonb_array_elements_text(
                     case when jsonb_typeof(c.rules #> '{niva,answer_from}') = 'array' then c.rules #> '{niva,answer_from}'
                          else '[]'::jsonb end) as e
             where c.id = p_center and e in ('guide', 'faq')) x), '{}'::text[])
$$;
comment on function app.niva_answer_from(uuid) is
  'What Niva answers from for a community (0573): niva_source always, plus guide and/or faq from centers.rules.niva.answer_from (default: niva_source only).';

-- ── 5. The search ────────────────────────────────────────────────────────────
-- A long text: up to three excerpts around the matching words. ts_headline marks the words with <b>…</b>, which
-- the model does not need.
create or replace function app.niva_excerpt(p_body text, p_tsq tsquery) returns text
language sql stable set search_path = app, public, extensions as $$
  select replace(replace(ts_headline('english', coalesce(p_body, ''), p_tsq, 'MaxFragments=3, MaxWords=120, MinWords=40'),
                         '<b>', ''), '</b>', '')
$$;
comment on function app.niva_excerpt(text, tsquery) is
  'Up to three excerpts of a long Niva source around the words that matched the question (0573).';

create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int, p_statuses text[])
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
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
  perform app.assert_worker();
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
       and (c.center_id = p_center or (c.center_id is null and (c.tradition is null or c.tradition = v_tradition)))
       and c.niva_tsv @@ v_tsq
    union all
    -- FAQ, when the community answers from it.
    select c.id::text, c.kind, c.title, coalesce(c.body_md, ''), c.metadata->>'source_url',
           c.updated_at, ts_rank_cd(c.niva_tsv, v_tsq, 1 | 32)
      from app.content_items c
     where v_faq and c.kind = 'faq'
       and c.status = any (v_statuses)
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
                     else left(r.body, 1500) || E'\n\n[…]\n\n' || app.niva_excerpt(r.body, v_tsq) end as excerpt
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
comment on function app.niva_worker_search_sources(uuid, text, int, text[]) is
  'Worker only (0573). Ranked sources for a Niva question: [{id, kind, title, body_md, rank, source_url, updated_at}], at most about 24000 characters in all. statuses: {published} or {published,in_review} (staff test).';

-- The worker's call since 0530: same signature, now the 0573 search over published sources.
create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int default 6)
returns jsonb language sql stable security definer set search_path = app, public, extensions as $$
  select app.niva_worker_search_sources(p_center, p_query, p_limit, array['published']::text[])
$$;
comment on function app.niva_worker_search_sources(uuid, text, int) is
  'Worker only. The search over published sources (0573); the same as the 4-argument form with statuses {published}.';

-- ── 6. Staff: choose what Niva also answers from ─────────────────────────────
-- p_kinds: any of 'guide' (public Guide sections) and 'faq' (published FAQ items); 'niva_source' is always on and
-- may be listed. An empty list goes back to niva_source only. Returns what is now stored.
create or replace function app.niva_set_answer_from(p_center uuid, p_kinds text[])
returns text[] language plpgsql security definer set search_path = app, public, extensions as $$
declare v_in text[]; v_bad text; v_kinds text[];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'content.manage') then
    raise exception 'Choosing what Niva answers from needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  v_in := array(select lower(btrim(k)) from unnest(coalesce(p_kinds, '{}'::text[])) k);
  select k into v_bad from unnest(v_in) k where k is null or k not in ('niva_source', 'guide', 'faq') limit 1;
  if found then
    raise exception 'Niva can also answer from "guide" (Guide sections) and "faq" (FAQ); "%" is not one of them.', coalesce(v_bad, '')
      using errcode = '22023';
  end if;
  v_kinds := array['niva_source']
             || array(select t.k from unnest(array['guide', 'faq']) with ordinality as t(k, n) where t.k = any (v_in) order by t.n);
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{niva}',
                           case when jsonb_typeof(rules -> 'niva') = 'object' then rules -> 'niva' else '{}'::jsonb end
                           || jsonb_build_object('answer_from', to_jsonb(v_kinds)))
   where id = p_center;
  if not found then raise exception 'That community was not found.' using errcode = 'P0002'; end if;
  return v_kinds;
end $$;
comment on function app.niva_set_answer_from(uuid, text[]) is
  'content.manage (0573): what Niva also answers from (guide, faq); niva_source is always on. Stored in centers.rules.niva.answer_from.';

-- ── 7. JSH: answer from its Guide and FAQ too (owner decision 2026-10-01) ────
create or replace function app.seed_jsh_niva_answer_from() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_jsh constant uuid := '00000000-0000-4000-8000-000000000001';
  v_n integer;
begin
  if not exists (select 1 from app.centers where id = v_jsh) then
    return jsonb_build_object('skipped', 'no JSH community yet');
  end if;
  -- Only when JSH has not chosen yet: a later choice in the portal is never undone.
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{niva}',
                           case when jsonb_typeof(rules -> 'niva') = 'object' then rules -> 'niva' else '{}'::jsonb end
                           || jsonb_build_object('answer_from', jsonb_build_array('niva_source', 'guide', 'faq')))
   where id = v_jsh and rules #> '{niva,answer_from}' is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n = 1);
end $$;
comment on function app.seed_jsh_niva_answer_from() is
  'One-off (0573): JSH''s Niva also answers from its Guide sections and FAQ, unless JSH has already chosen. Does nothing before seed.sql creates JSH.';

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.niva_glossary(), app.niva_search_tsquery(uuid, text), app.niva_answer_from(uuid),
  app.niva_excerpt(text, tsquery),
  app.niva_worker_search_sources(uuid, text, int, text[]), app.niva_worker_search_sources(uuid, text, int),
  app.niva_set_answer_from(uuid, text[]), app.seed_jsh_niva_answer_from()
  from public, anon, authenticated, service_role;
grant execute on function app.niva_worker_search_sources(uuid, text, int, text[]), app.niva_worker_search_sources(uuid, text, int)
  to connect_worker;
grant execute on function app.niva_set_answer_from(uuid, text[]) to authenticated;
grant execute on function app.seed_jsh_niva_answer_from() to service_role;

select app.seed_jsh_niva_answer_from();
