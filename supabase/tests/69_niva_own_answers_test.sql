-- 0579: Niva answers from the community's own content, at no AI cost, inside niva_ask. Each tier (an earlier answer,
-- a matching FAQ / question-shaped source / Guide section, the sentences of the best source) and its thresholds (a
-- near miss stays unanswered); the answer cache is dropped when a cited source is unpublished, changed or no longer
-- answered from, and never copies a staff test or a live item; doctrinal answers end with the referral line; questions
-- about a member's own details are never answered; the AI setting (off: no_source at once and no job; haiku: a job as
-- before), JSH set off; staff tests, regenerate and "Try all" follow the same tiers; communities never see each
-- other's content; the worker's own try and the setting it reads; Niva health; grants and search paths.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- niva.answer jobs of one conversation, or of one community.
create or replace function pg_temp.jobs_of(p_conv uuid) returns bigint language sql as $$
  select count(*) from app.jobs where kind = 'niva.answer' and payload->>'conversation_id' = p_conv::text
$$;
create or replace function pg_temp.center_jobs(p_center uuid) returns bigint language sql as $$
  select count(*) from app.jobs where kind = 'niva.answer' and center_id = p_center
$$;
create or replace function pg_temp.conv(p_id uuid) returns app.niva_conversations language sql as $$
  select * from app.niva_conversations where id = p_id
$$;
-- A returned or stored question with every field filled (psql's \gset unsets a variable for a null column).
create or replace function pg_temp.v(r app.niva_conversations)
returns table (id uuid, answer_status text, answer text, model text, sources jsonb, unanswered text, outcome_detail text,
               answered text, attempted text)
language sql as $$
  select r.id, r.answer_status, coalesce(r.answer, ''), coalesce(r.model, ''), coalesce(r.sources, '[]'::jsonb), r.unanswered::text,
         coalesce(r.outcome_detail, ''), coalesce(r.answered_at::text, ''), coalesce(r.attempted_at::text, '')
$$;
grant connect_worker to postgres;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''69000000-0000-4000-8000-0000000000c1'''
\set c2 '''69000000-0000-4000-8000-0000000000c2'''
\set ch '''69000000-0000-4000-8000-0000000000c3'''
\set cx '''69000000-0000-4000-8000-0000000000c4'''
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set admin '''69000000-0000-4000-8000-000000000001'''
\set editor '''69000000-0000-4000-8000-000000000002'''
\set member '''69000000-0000-4000-8000-000000000003'''
\set member_b '''69000000-0000-4000-8000-000000000004'''
\set member2 '''69000000-0000-4000-8000-000000000005'''
\set src_time '''69000000-0000-4000-8000-00000000000a'''
\set faq_reg '''69000000-0000-4000-8000-00000000000b'''
\set src_park '''69000000-0000-4000-8000-00000000000c'''
\set guide_nm '''69000000-0000-4000-8000-00000000000d'''
\set src_ahimsa '''69000000-0000-4000-8000-00000000000e'''
\set src_snatra '''69000000-0000-4000-8000-00000000000f'''
\set src_vote '''69000000-0000-4000-8000-000000000010'''
\set src_pary '''69000000-0000-4000-8000-000000000011'''
\set faq_c2 '''69000000-0000-4000-8000-000000000012'''
\set src_c2 '''69000000-0000-4000-8000-000000000013'''
insert into auth.users (id, email) values
  (:admin, 'admin69@example.com'), (:editor, 'editor69@example.com'), (:member, 'member69@example.com'),
  (:member_b, 'member69b@example.com'), (:member2, 'member69c@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:c, 'orbit69', 'Orbit Own Answers Sangh', 'OOA', 'TX', 'active', 'America/Chicago',
   '{"version": 3, "niva": {"answer_from": ["niva_source", "guide", "faq"]}}'),
  (:c2, 'orbit69b', 'Orbit Second Sangh', 'OSS', 'TX', 'active', 'America/Chicago', '{"niva": {"answer_from": ["niva_source", "faq"]}}'),
  (:ch, 'orbit69h', 'Orbit Haiku Sangh', 'OHS', 'TX', 'active', 'America/Chicago', '{"niva": {"ai": "haiku"}}'),
  (:cx, 'orbit69x', 'Orbit Odd Setting Sangh', 'OXS', 'TX', 'active', 'America/Chicago', '{"niva": {"ai": "opus"}}');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c2, :admin, 'center_admin'), (:ch, :admin, 'center_admin'), (:c, :editor, 'content_editor'),
  (:ch, :editor, 'content_editor');
insert into app.households (id, center_id, display_name) values
  ('69000000-0000-4000-8000-0000000000a1', :c, 'Shah household'),
  ('69000000-0000-4000-8000-0000000000a3', :c, 'Mehta household'),
  ('69000000-0000-4000-8000-0000000000a5', :c2, 'Doshi household'),
  ('69000000-0000-4000-8000-0000000000a7', :ch, 'Shah household');
insert into app.people (id, center_id, first_name, last_name) values
  ('69000000-0000-4000-8000-0000000000a2', :c, 'Asha', 'Shah'),
  ('69000000-0000-4000-8000-0000000000a4', :c, 'Neha', 'Mehta'),
  ('69000000-0000-4000-8000-0000000000a6', :c2, 'Ravi', 'Doshi'),
  ('69000000-0000-4000-8000-0000000000a8', :ch, 'Asha', 'Shah');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('69000000-0000-4000-8000-0000000000a1', '69000000-0000-4000-8000-0000000000a2', :c, 'primary', true),
  ('69000000-0000-4000-8000-0000000000a3', '69000000-0000-4000-8000-0000000000a4', :c, 'primary', true),
  ('69000000-0000-4000-8000-0000000000a5', '69000000-0000-4000-8000-0000000000a6', :c2, 'primary', true),
  ('69000000-0000-4000-8000-0000000000a7', '69000000-0000-4000-8000-0000000000a8', :ch, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :member, '69000000-0000-4000-8000-0000000000a2'),
  (:c, :member_b, '69000000-0000-4000-8000-0000000000a4'),
  (:c2, :member2, '69000000-0000-4000-8000-0000000000a6'),
  (:ch, :member, '69000000-0000-4000-8000-0000000000a8');

insert into app.content_items (id, center_id, kind, slug, title, body_md, status, metadata) values
  (:src_time, :c, 'niva_source', 'timings-69', 'Derasar timings',
   E'The derasar is open every day from 6 AM to 12 PM and 4 PM to 8 PM.\n\nPlease remove your shoes before entering the prayer hall. Photography is not allowed inside.',
   'published', '{}'),
  (:faq_reg, :c, 'faq', 'pathshala-register-69', 'How do I register for Pathshala?',
   '**Open the app**, go to *Learn*, and choose Register. Membership is required.', 'published', '{}'),
  (:src_park, :c, 'niva_source', 'web-69-parking', 'Visit us: Is there parking at the derasar?',
   'Yes. Park in the east lot; on festival days volunteers guide you to the overflow lot.', 'published',
   '{"imported": true, "page_title": "Visit us", "source_url": "https://example.org/visit"}'),
  (:src_ahimsa, :c, 'niva_source', 'ahimsa-69', 'Ahimsa',
   'Ahimsa means non-violence in thought, word and deed. It is the first of the five great vows.', 'published', '{}'),
  (:src_snatra, :c, 'niva_source', 'snatra-69', 'Snatra puja', 'Snatra puja is held every Sunday at 9 AM in the main hall.', 'in_review', '{}'),
  (:src_vote, :c, 'niva_source', 'voting-69', 'Voting', 'Members of one year or more are eligible to vote in the annual elections.', 'published', '{}'),
  (:src_pary, :c, 'niva_source', 'paryushan-69', 'Paryushan', 'Paryushan is eight days of reflection, fasting and forgiveness.', 'published', '{}'),
  (:faq_c2, :c2, 'faq', 'pathshala-register-69b', 'How do I register for Pathshala?', 'Call the Orbit Second office to register.', 'published', '{}'),
  (:src_c2, :c2, 'niva_source', 'timings-69b', 'Derasar timings', 'Our derasar opens at 5 AM every day and closes at 9 PM.', 'published', '{}');
insert into app.guide_sections (id, center_id, slug, title, body_md, public) values
  (:guide_nm, :c, 'non-members-69', 'Can non-members attend Pathshala?', 'Yes, Pathshala welcomes every child, whether or not the family is a member.', true);

-- ── The AI setting ───────────────────────────────────────────────────────────
select pg_temp.assert(app.niva_ai_mode(:c::uuid) = 'off' and app.niva_ai_mode(:c2::uuid) = 'off',
  'AI answers are off unless a community turns them on');
select pg_temp.assert(app.niva_ai_mode(:ch::uuid) = 'haiku', 'rules.niva.ai = haiku turns them on');
select pg_temp.assert(app.niva_ai_mode(:cx::uuid) = 'off' and app.niva_ai_mode('69000000-0000-4000-8000-0000000000ff'::uuid) = 'off',
  'any other value, or no community, is off');
select pg_temp.assert(app.seed_jsh_niva_ai_off() ? 'updated', 'the JSH setting runs once JSH exists');
select pg_temp.assert((select rules #>> '{niva,ai}' = 'off' from app.centers where id = :jsh), 'JSH has AI answers off, explicitly');
select pg_temp.assert(app.seed_jsh_niva_ai_off() = '{"updated": false}', 'running it again changes nothing');
select pg_temp.assert(app.niva_rules_with('{"version": 7, "niva": {"answer_from": ["faq"]}, "lunch": {"slot_minutes": 15}}', 'ai', '"haiku"')
                      = '{"version": 8, "niva": {"answer_from": ["faq"], "ai": "haiku"}, "lunch": {"slot_minutes": 15}}'::jsonb
                      and app.niva_rules_with('{}', 'ai', '"off"') = '{"niva": {"ai": "off"}}'::jsonb,
  'setting a Niva rule keeps the others and moves rules.version on only when there is one');

-- ── Reading a question ───────────────────────────────────────────────────────
select pg_temp.assert(app.niva_normalize_question('  When is the Derasar   OPEN?? ') = 'when is the derasar open'
                      and app.niva_normalize_question('when is the derasar open') = 'when is the derasar open',
  'questions are compared in lower case, without punctuation or extra spaces');
select pg_temp.assert(app.niva_is_personal('Am I eligible to vote?') and app.niva_is_personal('Did I pay my pledge?')
                      and app.niva_is_personal('What is my balance?') and app.niva_is_personal('How much do I owe for the boli?')
                      and app.niva_is_personal('Is my RSVP confirmed?') and app.niva_is_personal('Are we registered for the yatra?'),
  'questions about the member''s own eligibility, pledges, balance or RSVPs are personal');
select pg_temp.assert(not app.niva_is_personal('How do I register my son for Pathshala?') and not app.niva_is_personal('Who is eligible to vote?')
                      and not app.niva_is_personal('When is the derasar open?'),
  'general questions are not, even with "my" or "eligible" in them');
select pg_temp.assert(app.niva_is_doctrinal('What does ahimsa mean?') and app.niva_is_doctrinal('Why do Jains not eat after sunset?')
                      and not app.niva_is_doctrinal('Where do I park?'),
  'doctrinal questions are recognised by their words');
select pg_temp.assert(app.niva_question_kind('What time is it open?') = 'when' and app.niva_question_kind('When is Paryushan?') = 'when'
                      and app.niva_question_kind('What is Paryushan?') = 'what' and app.niva_question_kind('Is it open?') = 'yes_no'
                      and app.niva_question_kind('Tell me about parking') is null,
  'a question''s kind comes from how it starts');
select pg_temp.assert(app.niva_question_terms(:c::uuid, 'What are the temple hours at Orbit?') = array['derasar', 'time']
                      and app.niva_question_terms(:c::uuid, 'When is the derasar open?') = array['derasar', 'time'],
  'key words: stems without filler words or the community''s name, the glossary''s synonyms folded together');
select pg_temp.assert(app.niva_plain_text(E'## Timings\n- The **derasar** is _open_ [daily](https://x.org).') = E'Timings\nThe derasar is open daily.',
  'markdown and links are removed from an answer, the words kept');

-- ── (b) FAQ: a matching approved question answers at once, with no job ──────
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'how do i register for pathshala')) \gset f_
commit;
select pg_temp.assert(:'f_answer_status' = 'answered' and :'f_unanswered' = 'false' and :'f_model' = 'own:faq' and :'f_answered' <> '',
  'niva_ask returns the row already answered from the FAQ (model own:faq)');
select pg_temp.assert(:'f_answer' = 'Open the app, go to Learn, and choose Register. Membership is required.',
  'the FAQ''s answer is used as written, without markdown');
select pg_temp.assert(:'f_sources'::jsonb = jsonb_build_array(jsonb_build_object('content_item_id', :faq_reg, 'title', 'How do I register for Pathshala?')),
  'the FAQ item is cited');
select pg_temp.assert(pg_temp.jobs_of(:'f_id'::uuid) = 0, 'no niva.answer job is queued');
select pg_temp.assert((select answer = :'f_answer' and answer_status = 'answered' from app.niva_conversations where id = :'f_id'::uuid),
  'the answer is stored on the question');

-- A Niva source whose heading is a question, and a public Guide section titled as one.
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Is there parking at the derasar?')) \gset p_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Can non-members attend the Pathshala?')) \gset g_
commit;
select pg_temp.assert(:'p_model' = 'own:faq' and :'p_answer' = 'Yes. Park in the east lot; on festival days volunteers guide you to the overflow lot.'
                      and :'p_sources'::jsonb = jsonb_build_array(jsonb_build_object('content_item_id', :src_park,
                                                  'title', 'Visit us: Is there parking at the derasar?', 'url', 'https://example.org/visit')),
  'an imported section whose heading is the question answers it, citing the page''s address');
select pg_temp.assert(:'g_model' = 'own:faq' and :'g_answer' like 'Yes, Pathshala welcomes every child%'
                      and (:'g_sources'::jsonb->0->>'content_item_id') = 'guide_section:' || :guide_nm,
  'a public Guide section titled as the question answers it');

-- Near misses stay unanswered: another question about the same thing is not the FAQ's question.
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'How do I cancel my Pathshala registration?')) \gset nm_
commit;
select pg_temp.assert(:'nm_answer_status' = 'no_source' and :'nm_unanswered' = 'true' and :'nm_answer' = '' and :'nm_model' = '',
  'a near miss is not answered from the FAQ (or anything else)');
select pg_temp.assert(:'nm_outcome_detail' like 'No approved source answers this, and AI answers are off%' and :'nm_attempted' <> '',
  'with AI answers off it reads no_source at once, with a plain outcome');
select pg_temp.assert(pg_temp.jobs_of(:'nm_id'::uuid) = 0, 'and no job is queued: the member is offered Send to the team straight away');

-- ── (c) Extract: the sentences of the best matching source ───────────────────
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'What time does the derasar open?')) \gset x_
commit;
select pg_temp.assert(:'x_model' = 'own:extract' and :'x_answer_status' = 'answered',
  'a question a source answers is answered from it at once (model own:extract)');
select pg_temp.assert(:'x_answer' = E'The derasar is open every day from 6 AM to 12 PM and 4 PM to 8 PM.\n\n— Derasar timings',
  'the answer is the sentence that answers it, then the source''s title; the other sentences are left out');
select pg_temp.assert(:'x_sources'::jsonb = jsonb_build_array(jsonb_build_object('content_item_id', :src_time, 'title', 'Derasar timings')),
  'the source is cited');
select pg_temp.assert(pg_temp.jobs_of(:'x_id'::uuid) = 0, 'no job for an extracted answer either');

-- Thresholds: too few of the question's words, a "when" question the source does not give a time for.
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Is the derasar closed on Diwali?')) \gset m1_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'When is Paryushan?')) \gset m2_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'What is Paryushan?')) \gset m3_
commit;
select pg_temp.assert(:'m1_answer_status' = 'no_source' and :'m1_answer' = '',
  'a source holding one of three key words does not answer the question');
select pg_temp.assert(:'m2_answer_status' = 'no_source' and :'m2_answer' = '',
  'a "when" question is not answered by a source that gives no time');
select pg_temp.assert(:'m3_model' = 'own:extract' and :'m3_answer' like 'Paryushan is eight days of reflection%',
  'the same source answers the "what" question');

-- A timings table (as JSH's Guide writes it): its rows are lines, and a row that gives a time answers "open".
select pg_temp.assert(app.niva_plain_text(E'| What | When |\n|---|---|\n| Derasar | 7:30 AM – 6:00 PM daily |\n| Aarti | 12:30 PM | 4:30 PM |')
                      = E'Derasar: 7:30 AM – 6:00 PM daily\nAarti: 12:30 PM, 4:30 PM',
  'a table''s rows become plain lines and its header row goes');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('69000000-0000-4000-8000-000000000024', :cx, 'niva_source', 'timings-69x', 'Timings and visiting',
   E'| What | When |\n|---|---|\n| Derasar | 7:30 AM – 6:00 PM daily |\n| Aarti | 12:30 PM and 4:30 PM |\n| Snatra puja | Sundays 9:30 AM |\n\nPlease remove leather items before entering the derasar.',
   'published');
insert into app.niva_conversations (id, center_id, question, unanswered) values
  ('69000000-0000-4000-8000-0000000000e5', :cx, 'When does the temple open?', true);
select app.niva_own_answer('69000000-0000-4000-8000-0000000000e5') as tb \gset
select pg_temp.assert((:'tb'::jsonb->>'model') = 'own:extract'
                      and (pg_temp.conv('69000000-0000-4000-8000-0000000000e5')).answer = E'Derasar: 7:30 AM – 6:00 PM daily.\n\n— Timings and visiting',
  'a timings table answers "When does the temple open?" with its derasar row alone');

-- ── Doctrinal answers end with the referral to Pathshala teachers ────────────
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'What does ahimsa mean?')) \gset d_
commit;
select pg_temp.assert(:'d_model' = 'own:extract'
                      and :'d_answer' = E'Ahimsa means non-violence in thought, word and deed.\n\n— Ahimsa\n\n' || app.niva_referral_line(),
  'a doctrinal answer from approved content ends with the fixed referral line');
select pg_temp.assert(:'x_answer' not like '%Pathshala teacher%', 'a timings answer has no referral line');

-- ── Personal questions are never answered from content ───────────────────────
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Am I eligible to vote?')) \gset pe_
commit;
select pg_temp.assert(:'pe_answer_status' = 'no_source' and :'pe_answer' = '' and :'pe_outcome_detail' like 'Niva does not look up a member''s own details%',
  'a question about the member''s own eligibility is not answered, although a source mentions voting eligibility');
select pg_temp.assert(pg_temp.jobs_of(:'pe_id'::uuid) = 0, 'and with AI answers off nothing is queued');
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:ch::uuid, 'Did I pay my pledge?')) \gset ph_
commit;
select pg_temp.assert(:'ph_answer_status' = 'pending' and pg_temp.jobs_of(:'ph_id'::uuid) = 1,
  'with AI answers on, a personal question goes to the AI as before (it answers only the general part, never a guess)');

-- ── (a) Cache: the same question again copies the earlier answer ─────────────
begin;
select pg_temp.sign_in(:member_b);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'what time does the DERASAR open')) \gset k_
commit;
select pg_temp.assert(:'k_model' = 'own:cache' and :'k_answer' = :'x_answer' and :'k_sources'::jsonb = :'x_sources'::jsonb,
  'another member asking the same question gets the earlier answer and its sources (model own:cache)');
-- An AI-written answer is reused too: no second AI call for the same question. (Each earlier answer below was given
-- when its cited source was last changed, so it stands until that source changes again.)
insert into app.niva_conversations (id, center_id, user_id, question, answer, sources, unanswered, answer_status, model, answered_at, created_at) values
  ('69000000-0000-4000-8000-0000000000e1', :c, :member, 'Do I need to cover my head in the derasar?', 'Covering your head is welcome but not required.',
   jsonb_build_array(jsonb_build_object('content_item_id', :src_time, 'title', 'Derasar timings')), false, 'answered',
   'claude-haiku-4-5-20251001', (select updated_at from app.content_items where id = :src_time::uuid), now() - interval '1 hour'),
  -- A live item: never copied (its "today" was another day).
  ('69000000-0000-4000-8000-0000000000e2', :c, :member, 'Is the derasar open today?', 'Yes, until 6 PM today.',
   '[{"kind": "timings", "id": "2026-10-01", "title": "Timings for 1 October"}]', false, 'answered', 'claude-haiku-4-5-20251001',
   now(), now() - interval '1 hour'),
  -- A staff test: never copied for a member.
  ('69000000-0000-4000-8000-0000000000e3', :c, :editor, 'Who leads the Pathshala?', 'Rekhaben leads it.',
   jsonb_build_array(jsonb_build_object('content_item_id', :src_ahimsa, 'title', 'Ahimsa')), false, 'answered', 'claude-haiku-4-5-20251001',
   (select updated_at from app.content_items where id = :src_ahimsa::uuid), now() - interval '1 hour'),
  ('69000000-0000-4000-8000-0000000000e4', :c, :member, 'Is photography allowed?', 'No photography inside.',
   jsonb_build_array(jsonb_build_object('content_item_id', :src_park, 'title', 'Visit us: Is there parking at the derasar?')), false, 'answered',
   'claude-haiku-4-5-20251001', (select updated_at from app.content_items where id = :src_park::uuid), now() - interval '1 hour');
update app.niva_conversations set is_test = true where id = '69000000-0000-4000-8000-0000000000e3';
begin;
select pg_temp.sign_in(:member_b);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Do I need to cover my head in the derasar?')) \gset ka_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Is the derasar open today?')) \gset kl_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Who leads the Pathshala?')) \gset kt_
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Is photography allowed?')) \gset kp_
commit;
-- The source the photography answer cites is edited: from now on that answer is not copied.
update app.content_items set body_md = body_md || ' Overflow parking opens at 8 AM.' where id = :src_park::uuid;
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Is photography allowed?')) \gset ke_
commit;
select pg_temp.assert(:'ka_model' = 'own:cache' and :'ka_answer' = 'Covering your head is welcome but not required.',
  'an earlier AI answer whose source still stands is copied, with no AI call');
select pg_temp.assert(:'kl_model' <> 'own:cache' and :'kl_answer' <> 'Yes, until 6 PM today.',
  'an earlier answer that cited a live item (a day''s timings) is never copied');
select pg_temp.assert(:'kt_answer' = '' and :'kt_answer_status' = 'no_source', 'a staff test''s answer is never copied for a member');
select pg_temp.assert(:'kp_model' = 'own:cache' and :'kp_answer' = 'No photography inside.',
  'an earlier answer is copied while the source it cites is unchanged');
select pg_temp.assert(:'ke_model' <> 'own:cache' and :'ke_answer' <> 'No photography inside.',
  'an earlier answer is not copied once a source it cited has changed since');

-- Unpublishing a cited source ends the cache (and the source no longer answers either).
update app.content_items set status = 'retired' where id = :src_time::uuid;
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'What time does the derasar open?')) \gset ku_
commit;
select pg_temp.assert(:'ku_answer_status' = 'no_source' and :'ku_answer' = '' and :'ku_model' = '',
  'once the cited source is unpublished, the earlier answer is not copied and nothing else answers');
update app.content_items set status = 'published' where id = :src_time::uuid;

-- A Guide answer stops being copied (and answering) once the community no longer answers from its Guide.
update app.centers set rules = jsonb_set(rules, '{niva,answer_from}', '["niva_source", "faq"]') where id = :c::uuid;
begin;
select pg_temp.sign_in(:member_b);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'Can non-members attend the Pathshala?')) \gset kg_
commit;
select pg_temp.assert(:'kg_answer' = '' and :'kg_answer_status' = 'no_source',
  'without the Guide in what Niva answers from, the Guide''s answer is neither copied nor used');
update app.centers set rules = jsonb_set(rules, '{niva,answer_from}', '["niva_source", "guide", "faq"]') where id = :c::uuid;

-- ── Communities never share answers or content ───────────────────────────────
begin;
select pg_temp.sign_in(:member2);
select * from pg_temp.v(app.niva_ask(:c2::uuid, 'How do I register for Pathshala?')) \gset i_
select * from pg_temp.v(app.niva_ask(:c2::uuid, 'Can non-members attend the Pathshala?')) \gset i2_
commit;
select pg_temp.assert(:'i_model' = 'own:faq' and :'i_answer' = 'Call the Orbit Second office to register.'
                      and (:'i_sources'::jsonb->0->>'content_item_id') = :faq_c2,
  'the same question in another community gets that community''s own FAQ, never the first one''s answer');
select pg_temp.assert(:'i2_answer' = '' and :'i2_answer_status' = 'no_source',
  'another community''s Guide is never used');
select pg_temp.assert((select count(*) from app.niva_conversations c, jsonb_array_elements(c.sources) s
                        where c.center_id = :c::uuid and s->>'content_item_id' in (:faq_c2, :src_c2)) = 0,
  'no answer in the first community cites the second''s content');

-- ── AI answers off: no job, ever; on: a job when the own content has nothing ──
select pg_temp.assert(pg_temp.center_jobs(:c::uuid) = 0 and pg_temp.center_jobs(:c2::uuid) = 0,
  'with AI answers off, asking never queued a niva.answer job');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('69000000-0000-4000-8000-000000000020', :ch, 'niva_source', 'timings-69h', 'Derasar timings', 'The derasar is open every day from 7 AM to 7 PM.', 'published');
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:ch::uuid, 'Who leads the youth group?')) \gset h1_
select * from pg_temp.v(app.niva_ask(:ch::uuid, 'When is the derasar open?')) \gset h2_
commit;
select pg_temp.assert(:'h1_answer_status' = 'pending' and pg_temp.jobs_of(:'h1_id'::uuid) = 1,
  'with AI answers on, a question the own content cannot answer is queued for the AI as before');
select pg_temp.assert(:'h2_model' = 'own:extract' and pg_temp.jobs_of(:'h2_id'::uuid) = 0,
  'with AI answers on, the own content still answers first, at no AI cost');

-- ── Staff tests follow the same tiers and setting ────────────────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_test_ask(:c::uuid, 'When is the derasar open?') as t1 \gset
select app.niva_test_ask(:c::uuid, 'When is snatra puja?') as t2 \gset
select app.niva_test_ask(:c::uuid, 'When is snatra puja?', true) as t3 \gset
select app.niva_test_ask(:ch::uuid, 'Who leads the youth group?', true) as t4 \gset
commit;
select pg_temp.assert((:'t1'::jsonb->>'answer_status') = 'answered' and (:'t1'::jsonb->>'model') like 'own:%'
                      and pg_temp.jobs_of((:'t1'::jsonb->>'id')::uuid) = 0,
  'a staff test is answered at once from the own content, and says so in its reply');
select pg_temp.assert((:'t2'::jsonb->>'answer_status') = 'no_source' and pg_temp.jobs_of((:'t2'::jsonb->>'id')::uuid) = 0,
  'a test about a source still waiting for approval finds nothing among published sources (AI off: no job)');
select pg_temp.assert((:'t3'::jsonb->>'answer_status') = 'answered'
                      and (pg_temp.conv((:'t3'::jsonb->>'id')::uuid)).answer like 'Snatra puja is held every Sunday at 9 AM%'
                      and (pg_temp.conv((:'t3'::jsonb->>'id')::uuid)).sources->0->>'content_item_id' = :src_snatra,
  'with "include sources waiting for approval" the test answers from that source');
select pg_temp.assert((:'t4'::jsonb->>'answer_status') = 'pending' and pg_temp.jobs_of((:'t4'::jsonb->>'id')::uuid) = 1
                      and (select payload->'include_in_review' = 'true'::jsonb from app.jobs
                            where kind = 'niva.answer' and payload->>'conversation_id' = (:'t4'::jsonb->>'id')),
  'with AI answers on, a test the own content cannot answer is queued with include_in_review, as before');
begin;
select pg_temp.sign_in(:member);
select * from pg_temp.v(app.niva_ask(:c::uuid, 'When is snatra puja?')) \gset ts_
commit;
select pg_temp.assert(:'ts_answer' = '' and :'ts_answer_status' = 'no_source',
  'a member never gets the test''s answer from a source waiting for approval (not copied, not searched)');

-- ── Regenerate and "Try all" while AI answers are off ─────────────────────────
-- The near miss from above: a FAQ is approved that answers it; Try again answers it at once, with no job.
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('69000000-0000-4000-8000-000000000021', :c, 'faq', 'pathshala-cancel-69', 'How do I cancel my Pathshala registration?',
   'Write to the Pathshala office before the term starts.', 'published');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_regenerate('$$ || :'nm_id' || $$'::uuid)$$, 'content.manage', 'a member cannot regenerate');
commit;
begin;
select pg_temp.sign_in(:admin);
select * from pg_temp.v(app.niva_regenerate(:'nm_id'::uuid)) \gset rg_
commit;
select pg_temp.assert(:'rg_model' = 'own:faq' and :'rg_answer' = 'Write to the Pathshala office before the term starts.'
                      and pg_temp.jobs_of(:'nm_id'::uuid) = 0,
  'regenerate answers from the newly approved FAQ at once, with no job');
-- An earlier (AI) answer the own content cannot improve on: kept while its source stands, cleared once it is gone.
begin;
select pg_temp.sign_in(:admin);
select * from pg_temp.v(app.niva_regenerate('69000000-0000-4000-8000-0000000000e1'::uuid)) \gset rk_
commit;
select pg_temp.assert(:'rk_answer_status' = 'answered' and :'rk_answer' = 'Covering your head is welcome but not required.'
                      and :'rk_outcome_detail' like 'Niva found nothing new%',
  'a regenerate that finds nothing keeps the answer while a source it cites is still published');
update app.content_items set status = 'retired' where id = :src_time::uuid;
begin;
select pg_temp.sign_in(:admin);
select * from pg_temp.v(app.niva_regenerate('69000000-0000-4000-8000-0000000000e1'::uuid)) \gset rc_
commit;
select pg_temp.assert(:'rc_answer_status' = 'no_source' and :'rc_answer' = '' and :'rc_sources' = '[]'
                      and pg_temp.jobs_of('69000000-0000-4000-8000-0000000000e1'::uuid) = 0,
  'once no cited source is published, the stale answer is cleared and the question reads no_source, with no job');
update app.content_items set status = 'published' where id = :src_time::uuid;

-- Try all: the unanswered questions are tried against the own content at once.
update app.niva_conversations set created_at = now() - interval '1 hour' where center_id = :c::uuid and answer is null;
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('69000000-0000-4000-8000-000000000022', :c, 'niva_source', 'diwali-69', 'Diwali at the derasar',
   'On Diwali the derasar is closed in the afternoon and opens again at 6 PM for the evening aarti.', 'published');
select count(*) as unans from app.niva_conversations where center_id = :c::uuid and answer is null and not is_test \gset
begin;
select pg_temp.sign_in(:admin);
select app.niva_retry_unanswered(:c::uuid) as ntry \gset
commit;
select pg_temp.assert(:ntry::int = :unans::int, 'Try all tries every unanswered member question of the last 30 days');
select pg_temp.assert((pg_temp.conv(:'m1_id'::uuid)).model = 'own:extract'
                      and (pg_temp.conv(:'m1_id'::uuid)).answer like 'On Diwali the derasar is closed in the afternoon%',
  'a question a newly published source answers is answered');
select pg_temp.assert((pg_temp.conv(:'pe_id'::uuid)).answer_status = 'no_source'
                      and (pg_temp.conv(:'pe_id'::uuid)).outcome_detail like 'Niva does not look up%',
  'the rest stay no_source, a personal question still with its own reason');
select pg_temp.assert(pg_temp.center_jobs(:c::uuid) = 0, 'Try all queues nothing while AI answers are off');
select pg_temp.assert((select count(*) from app.niva_conversations where is_test and center_id = :c::uuid and answer_status = 'no_source'
                         and id = (:'t2'::jsonb->>'id')::uuid) = 1, 'staff tests are left out of Try all');

-- ── The worker's own try and the setting it reads ────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_own_answer('$$ || :'h1_id' || $$'::uuid)$$, 'permission denied',
  'only the background service runs its own try');
commit;
begin;
set local role connect_worker;
select app.niva_worker_own_answer(:'h1_id'::uuid) as w1 \gset
select app.niva_worker_get_conversation(:'h1_id'::uuid) as wg \gset
select app.niva_worker_get_conversation(:'nm_id'::uuid) as wg2 \gset
commit;
select pg_temp.assert(:'w1'::jsonb = '{"answered": false, "reason": "no_match", "ai": "haiku"}'::jsonb,
  'the worker''s own try says nothing answered, and that the community has AI answers on');
select pg_temp.assert((:'wg'::jsonb->>'ai') = 'haiku' and (:'wg2'::jsonb->>'ai') = 'off',
  'the worker reads the community''s AI setting with the conversation');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('69000000-0000-4000-8000-000000000023', :ch, 'faq', 'youth-69h', 'Who leads the youth group?', 'Karan Shah leads the youth group.', 'published');
update app.centers set rules = jsonb_set(rules, '{niva,answer_from}', '["niva_source", "faq"]') where id = :ch::uuid;
begin;
set local role connect_worker;
select app.niva_worker_own_answer(:'h1_id'::uuid) as w2 \gset
commit;
select pg_temp.assert(:'w2'::jsonb = '{"answered": true, "model": "own:faq", "ai": "haiku"}'::jsonb
                      and (pg_temp.conv(:'h1_id'::uuid)).answer = 'Karan Shah leads the youth group.',
  'a source approved after the question was asked answers it on the worker''s own try, before any AI call');

-- ── Niva health ──────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_health(:c::uuid) as hl \gset
select app.niva_health(:ch::uuid) as hh \gset
commit;
select pg_temp.assert((:'hl'::jsonb->>'ai') = 'off' and (:'hh'::jsonb->>'ai') = 'haiku', 'Niva health says whether AI answers are on');
select pg_temp.assert((:'hl'::jsonb->'answered_by_7d'->>'faq')::int = (select count(*) from app.niva_conversations
                          where center_id = :c::uuid and not is_test and model = 'own:faq' and answer is not null)
                      and (:'hl'::jsonb->'answered_by_7d'->>'cache')::int >= 2
                      and (:'hl'::jsonb->'answered_by_7d'->>'extract')::int >= 3
                      and (:'hl'::jsonb->'answered_by_7d'->>'ai')::int = (select count(*) from app.niva_conversations
                          where center_id = :c::uuid and not is_test and answer is not null and model not like 'own:%'
                            and created_at >= now() - interval '7 days'),
  'Niva health counts members'' answers of the last 7 days by how they were made');
select pg_temp.assert((:'hl'::jsonb->'outcomes_7d') ? 'no_source' and (:'hl'::jsonb->'month') ? 'used',
  'the rest of Niva health is as before');

-- ── The search the worker runs is unchanged ──────────────────────────────────
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'derasar timings parking', 6, array['published']) as ws \gset
select app.niva_worker_search_sources(:c::uuid, 'derasar timings parking', 6) as ws3 \gset
commit;
select pg_temp.assert(:'ws'::jsonb = app.niva_search_core(:c::uuid, 'derasar timings parking', 6, array['published'])
                      and :'ws3'::jsonb = :'ws'::jsonb and jsonb_array_length(:'ws'::jsonb) >= 2,
  'niva_worker_search_sources returns exactly what the shared search does');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_search_sources('69000000-0000-4000-8000-0000000000c1'::uuid, 'derasar', 6, array['published'])$$,
  'permission denied', 'a member still cannot run the worker''s search');
commit;

-- ── Grants and search paths ──────────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_own_answer(uuid,boolean)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.niva_own_answer(uuid,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_search_core(uuid,text,int,text[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_own_no_answer(uuid,text,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_store_own_answer(uuid,text,jsonb,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_ai_mode(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.seed_jsh_niva_ai_off()', 'execute')
                      and not has_function_privilege('anon', 'app.niva_own_answer(uuid,boolean)', 'execute'),
  'the own-answer functions are internal');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.niva_worker_own_answer(uuid,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_worker_own_answer(uuid,boolean)', 'execute'),
  'the worker''s own try is connect_worker only');
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_ask(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_test_ask(uuid,text,boolean)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_regenerate(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_retry_unanswered(uuid,interval,int)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_health(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_ask(uuid,text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_search_sources(uuid,text,int,text[])', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_get_conversation(uuid)', 'execute'),
  'the replaced functions keep their grants');
select pg_temp.assert((select count(*) = 30 and bool_and(exists (select 1 from unnest(p.proconfig) as g(setting)
                                                 where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('niva_ai_mode','niva_rules_with','seed_jsh_niva_ai_off','niva_normalize_question','niva_is_personal',
                                            'niva_is_doctrinal','niva_referral_line','niva_question_kind','niva_glossary_stems','niva_text_terms',
                                            'niva_question_terms','niva_terms_covered','niva_plain_text','niva_sentence_fits','niva_sentence_terms','niva_extract_sentences',
                                            'niva_search_core','niva_cache_sources_ok','niva_cites_current','niva_store_own_answer',
                                            'niva_own_outcome_detail','niva_own_no_answer','niva_own_answer','niva_worker_own_answer',
                                            'niva_ask','niva_test_ask','niva_regenerate','niva_retry_unanswered','niva_worker_get_conversation',
                                            'niva_health')),
  'every new or replaced function pins search_path app, public, extensions');
select pg_temp.assert((select bool_and(p.prosecdef) from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('niva_own_answer','niva_worker_own_answer','niva_own_no_answer','niva_store_own_answer',
                                            'niva_ask','niva_test_ask','niva_regenerate','niva_retry_unanswered','niva_health')),
  'the functions that write for the caller are security definer');
