-- 0566: the JSH guide's "Your first steps" and "Timings and visiting" pages show their line breaks.
--
-- seed.sql wrote both pages' text as plain SQL strings, so every "\n" was stored as a backslash followed by "n"
-- instead of a line break. The member app then saw one long line: Timings and visiting could not find its
-- | What | When | table, said the center had not published its timings and printed the raw text, and the
-- first-steps checklist became a single item. seed.sql now uses E'' strings; this repairs the rows it already made.
-- Only these two seeded pages of the JSH community are touched, and only while they still hold a literal "\n"
-- (a page the office has since rewritten in the portal has real line breaks and is left alone).
update app.guide_sections
   set body_md = replace(body_md, '\n', E'\n')
 where center_id = '00000000-0000-4000-8000-000000000001'
   and slug in ('first-steps', 'timings')
   and strpos(body_md, '\n') > 0;
