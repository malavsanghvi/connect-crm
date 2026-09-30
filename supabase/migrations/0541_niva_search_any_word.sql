-- 0541_niva_search_any_word.sql (backlog B14: Niva answering)
--
-- app.niva_worker_search_sources (0530) matched a member's question with websearch_to_tsquery,
-- which ANDs every meaningful word: a source had to contain ALL of them. Members ask in sentences
-- ("why relocation is being done" -> 'reloc' & 'done'), so a source that answers the question was
-- missed whenever one word of the question was not in it. It now matches ANY word and ranks by how
-- well the source matches (more of the question's words, and words in the title, rank higher); the
-- top few go to the model, whose "can I answer this from these sources?" check still decides, so a
-- loose match cannot turn into a made-up answer. A question that uses the search operators
-- (a "quoted phrase" or -exclusion) keeps its exact meaning.
-- Same signature and grants as 0530 (create or replace keeps them).

set client_min_messages = warning;

create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int default 6)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_tsq tsquery; v_limit int := least(greatest(coalesce(p_limit, 6), 1), 20); v_out jsonb; v_txt text;
begin
  perform app.assert_worker();
  begin
    v_tsq := websearch_to_tsquery('english', coalesce(p_query, ''));
  exception when others then
    v_tsq := plainto_tsquery('english', coalesce(p_query, ''));
  end;
  if v_tsq is null or v_tsq = ''::tsquery then return '[]'::jsonb; end if;

  -- websearch_to_tsquery joins the words with & ; turn that into | unless the member used phrase or
  -- exclusion operators (<-> or !), which keep their exact meaning.
  v_txt := v_tsq::text;
  if v_txt !~ '[!<]' then
    v_tsq := replace(v_txt, ' & ', ' | ')::tsquery;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body_md', body, 'rank', rank) order by rank desc), '[]'::jsonb)
    into v_out
  from (
    select c.id, c.title, left(coalesce(c.body_md, ''), 4000) as body,
           ts_rank(setweight(to_tsvector('english', coalesce(c.title, '')), 'A') || setweight(to_tsvector('english', coalesce(c.body_md, '')), 'B'), v_tsq) as rank
    from app.content_items c
    where c.kind = 'niva_source' and c.status = 'published'
      and (c.center_id = p_center or c.center_id is null)
      and to_tsvector('english', coalesce(c.title, '') || ' ' || coalesce(c.body_md, '')) @@ v_tsq
    order by rank desc
    limit v_limit
  ) s;
  return v_out;
end $$;
