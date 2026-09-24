-- Onboarding · stream o-demo · 3 of 4: the "community" demo pack — setup data, records and
-- history for every module, loaded in ten steps by the worker (app.worker_demo_load_next).
--
-- Rules the pack follows:
--   * Clearly fake: every person's e-mail is @demo.communityconnect.test and every phone number
--     is a 555-01xx fiction number. Names are ordinary Jain family names.
--   * Deterministic: the same records every time; dates are relative to the day it is loaded
--     (the center's own time zone), so upcoming events stay upcoming.
--   * Money goes through the existing rules. Every demo payment is HISTORICAL
--     (payments.is_historical, so app.on_offline_payment never queues it for QuickBooks) and is
--     allocated by app.allocate_payment — the donor's chosen pledge, or earliest open pledge
--     first — with app.recompute_pledge_status moving the balances. Store orders go through the
--     store triggers (cart → placed → ready → picked up, prices and stock by the database);
--     lunch seats through app.assign_lunch_for_rsvp. Nothing is charged, sent or posted.
--   * Nothing that needs a real login is invented: demo staff are pending invitations, and
--     records that must name a login (a recorded payment, an approval) name the admin who loaded
--     the pack (p_actor).
--   * The organization's own profile, brand kit and leaders are never touched.
-- Each step is app.demo_community_<step>(center, seed, actor); ids are app.demo_id(seed, ref).
set client_min_messages = warning;

insert into app.demo_packs (key, version, title, description, contents) values
('community', 1, 'Demo community',
 'A small Jain community with a year of activity in every module: 25 families, their memberships, giving and bolis, events with tickets and check-ins, the Satvik Store, a Pathshala term with attendance, Gyan Path and My Jain Way progress, messages, surveys, volunteers and committee work. All names are made up and every e-mail address ends in @demo.communityconnect.test.',
 '[
   {"rows": {"zones": 4, "people": 76, "consents": 55, "households": 25, "external_ids": 37, "special_days": 8, "person_emails": 55, "merge_candidates": 1, "household_members": 76, "staff_invitations": 5, "custom_field_definitions": 3, "household_change_requests": 1}, "label": "Members & families", "module": "people"},
   {"rows": {"memberships": 24, "membership_types": 3, "eligibility_snapshots": 5, "membership_applications": 2}, "label": "Membership", "module": "membership"},
   {"rows": {"rsvps": 37, "events": 5, "actions": 5, "scan_log": 60, "attendees": 128, "lunch_slots": 6, "event_templates": 2, "event_template_items": 9}, "label": "Events & RSVP", "module": "events"},
   {"rows": {"funds": 5, "pledges": 56, "payments": 43, "campaigns": 6, "labh_options": 4, "bank_accounts": 1, "opportunities": 9, "recurring_gifts": 5, "bank_transactions": 4, "labh_fulfillments": 2, "payment_allocations": 50, "center_payment_methods": 6}, "label": "Pledges & donations", "module": "giving"},
   {"rows": {"bolis": 3, "boli_entries": 7}, "label": "Bolis", "module": "bolis"},
   {"rows": {"store_items": 9, "store_orders": 12, "pickup_windows": 3, "store_categories": 3, "store_order_lines": 21, "inventory_movements": 15}, "label": "Satvik Store", "module": "store"},
   {"rows": {"pathshala_terms": 2, "pathshala_levels": 6, "pathshala_tracks": 2, "pathshala_classes": 4, "teacher_positions": 1, "pathshala_sessions": 20, "pathshala_teachers": 4, "class_announcements": 3, "pathshala_attendance": 90, "teacher_applications": 2, "pathshala_enrollments": 19, "pathshala_progress_reports": 12}, "label": "Pathshala", "module": "pathshala"},
   {"rows": {"gyan_goals": 1, "gyan_steps": 9, "gyan_levels": 3, "gyan_progress": 56, "gyan_signoffs": 3}, "label": "Gyan Path (learning)", "module": "gyan_path"},
   {"rows": {"streaks": 10, "anumodana": 6, "practices": 6, "daily_timings": 16, "points_ledger": 456, "practice_logs": 305, "saathi_settings": 10, "practice_selections": 27}, "label": "My Jain Way", "module": "jain_way"},
   {"rows": {"role_roster": 6, "photo_albums": 1, "content_items": 6, "guide_sections": 4}, "label": "Content & library", "module": "content"},
   {"rows": {"tithi_days": 6, "calendar_layers": 2, "calendar_entries": 7}, "label": "Calendar", "module": "calendar"},
   {"rows": {"alerts": 2, "inboxes": 5, "threads": 5, "messages": 123, "channel_optins": 44, "comms_campaigns": 4, "thread_messages": 8, "whatsapp_groups": 3, "whatsapp_join_requests": 3}, "label": "Communications", "module": "comms"},
   {"rows": {"surveys": 3, "saved_segments": 2, "survey_responses": 20}, "label": "Surveys & data", "module": "surveys"},
   {"rows": {"volunteer_groups": 5, "volunteer_shifts": 4, "background_checks": 5, "volunteer_interests": 15, "volunteer_assignments": 10}, "label": "Volunteers", "module": "volunteers"},
   {"rows": {"accounting_periods": 4}, "label": "Accounting & QuickBooks", "module": "accounting"},
   {"rows": {"public_kpi_settings": 6}, "label": "Reports & dashboard", "module": "reports"},
   {"rows": {"niva_conversations": 4}, "label": "Niva assistant", "module": "niva"},
   {"rows": {"concerns": 3, "resolutions": 3}, "label": "Governance", "module": "governance"}
 ]'::jsonb)
on conflict (key) do update set version = excluded.version, title = excluded.title, description = excluded.description, contents = excluded.contents;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function app.demo_today(p_center uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (now() at time zone coalesce((select time_zone from app.centers where id = p_center), 'America/Chicago'))::date
$$;

-- A local date + time in the center's time zone, p_days from today.
create or replace function app.demo_at(p_center uuid, p_days int, p_time time) returns timestamptz
language sql stable security definer set search_path = app, public, extensions as $$
  select ((app.demo_today(p_center) + p_days)::timestamp + p_time) at time zone coalesce((select time_zone from app.centers where id = p_center), 'America/Chicago')
$$;

-- The Sunday p_weeks weeks before the most recent Sunday (0 = the last Sunday, today if Sunday).
create or replace function app.demo_sunday(p_center uuid, p_weeks int) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select app.demo_today(p_center) - extract(dow from app.demo_today(p_center))::int - 7 * p_weeks
$$;

create or replace function app.demo_short(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(short_name), ''), name) from app.centers where id = p_center
$$;

-- A household's / person's id in this load.
create or replace function app.demo_h(p_seed uuid, p_key text) returns uuid
language sql immutable set search_path = app, public, extensions as $$ select app.demo_id(p_seed, 'h:' || p_key) $$;
create or replace function app.demo_p(p_seed uuid, p_key text) returns uuid
language sql immutable set search_path = app, public, extensions as $$ select app.demo_id(p_seed, 'p:' || p_key) $$;

-- Record a historical payment and allocate it by the existing rule. p_pledges: the donor's
-- chosen pledges (in order) or NULL for earliest open pledge first.
create or replace function app.demo_pay(p_center uuid, p_seed uuid, p_actor uuid, p_ref text, p_household text, p_payer text,
                                        p_amount bigint, p_method app.payment_method, p_days_ago int, p_pledges uuid[],
                                        p_check text default null, p_memo text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v uuid := app.demo_id(p_seed, 'pay:' || p_ref);
begin
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, provider, status, check_number,
                            received_on, recorded_by, memo, is_historical, crm_external_id)
  values (v, p_center, app.demo_h(p_seed, p_household), app.demo_p(p_seed, p_payer), p_amount, p_method, 'offline', 'settled',
          p_check, app.demo_today(p_center) - p_days_ago, p_actor, coalesce(p_memo, 'Demo data'), true, 'demo:' || p_ref);
  perform app.allocate_payment(v, p_pledges, true);
  -- A pledge this payment closed was closed on the day it was paid (the recompute stamps "now").
  update app.pledges pl set closed_at = (app.demo_today(p_center) - p_days_ago)::timestamp + time '12:00'
   where pl.id in (select a.pledge_id from app.payment_allocations a where a.payment_id = v) and pl.status = 'paid';
  return v;
end $$;

-- ── Step 1 · setup data ──────────────────────────────────────────────────────
create or replace function app.demo_community_setup(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s text := app.demo_short(p_center); v_trad app.tradition := (select tradition from app.centers where id = p_center);
        v_term uuid := app.demo_id(p_seed, 'term:current'); v_next uuid := app.demo_id(p_seed, 'term:next');
        v_goal uuid := app.demo_id(p_seed, 'gyan:goal'); yr int := extract(year from app.demo_today(p_center))::int;
        v_start date := app.demo_sunday(p_center, 6);
begin
  -- Zones
  insert into app.zones (id, center_id, name, zip_codes) values
    (app.demo_id(p_seed, 'zone:north'), p_center, 'North', '{75001,75002,75003}'),
    (app.demo_id(p_seed, 'zone:south'), p_center, 'South', '{75011,75012,75013}'),
    (app.demo_id(p_seed, 'zone:east'),  p_center, 'East',  '{75021,75022}'),
    (app.demo_id(p_seed, 'zone:west'),  p_center, 'West',  '{75031,75032,75033}');
  -- Inboxes
  insert into app.inboxes (id, center_id, key, name, response_target_hours) values
    (app.demo_id(p_seed, 'inbox:office'), p_center, 'office', s || ' office', 48),
    (app.demo_id(p_seed, 'inbox:membership'), p_center, 'membership', 'Membership', 72),
    (app.demo_id(p_seed, 'inbox:donations'), p_center, 'donations', 'Donations', 48),
    (app.demo_id(p_seed, 'inbox:pathshala'), p_center, 'pathshala', 'Pathshala', 72),
    (app.demo_id(p_seed, 'inbox:events'), p_center, 'events', 'Events', 48);
  -- Funds and campaigns
  insert into app.funds (id, center_id, key, name, restricted) values
    (app.demo_id(p_seed, 'fund:general'), p_center, 'general', 'General fund', false),
    (app.demo_id(p_seed, 'fund:construction'), p_center, 'construction', 'Temple construction', true),
    (app.demo_id(p_seed, 'fund:pathshala'), p_center, 'pathshala', 'Pathshala', false),
    (app.demo_id(p_seed, 'fund:jeevdaya'), p_center, 'jeevdaya', 'Jeevdaya', true),
    (app.demo_id(p_seed, 'fund:bhojanshala'), p_center, 'bhojanshala', 'Bhojanshala', false);
  insert into app.campaigns (id, center_id, fund_id, name, kind, description, goal_cents, starts_on, ends_on, status, created_by) values
    (app.demo_id(p_seed, 'camp:annual'), p_center, app.demo_id(p_seed, 'fund:general'), 'Annual appeal ' || yr, 'general',
     'Keeps the temple open, the lights on and the programs running.', 5000000, make_date(yr, 1, 1), make_date(yr, 12, 31), 'published', p_actor),
    (app.demo_id(p_seed, 'camp:construction'), p_center, app.demo_id(p_seed, 'fund:construction'), 'New temple construction', 'construction',
     'The new derasar and community hall.', 250000000, app.demo_today(p_center) - 400, null, 'published', p_actor),
    (app.demo_id(p_seed, 'camp:paryushan'), p_center, app.demo_id(p_seed, 'fund:general'), 'Paryushan sponsorships', 'sponsorship',
     'Swamivatsalya and prabhavna during Paryushan.', null, app.demo_today(p_center) - 60, app.demo_today(p_center) - 30, 'closed', p_actor),
    (app.demo_id(p_seed, 'camp:diwali'), p_center, app.demo_id(p_seed, 'fund:general'), 'Diwali pujans', 'event',
     'Aarti and pujans on Diwali and the new year.', null, app.demo_today(p_center), app.demo_today(p_center) + 41, 'published', p_actor),
    (app.demo_id(p_seed, 'camp:pathshala'), p_center, app.demo_id(p_seed, 'fund:pathshala'), 'Pathshala fees ' || yr || '–' || (yr + 1), 'pathshala',
     'Fees per child for this Pathshala term.', null, v_start, v_start + 240, 'published', p_actor),
    (app.demo_id(p_seed, 'camp:bhojan'), p_center, app.demo_id(p_seed, 'fund:bhojanshala'), 'Bhojanshala seva', 'general',
     'Sponsor a Sunday meal.', 1200000, make_date(yr, 1, 1), make_date(yr, 12, 31), 'published', p_actor);
  -- Membership types
  insert into app.membership_types (id, center_id, key, tier, name, fee_cents, period_months, includes_spouse, reference_required,
                                    reference_tier_min, ec_approval_required, voting_wait_days) values
    (app.demo_id(p_seed, 'mt:community'), p_center, 'community', 'community', 'Community member', 0, null, false, false, null, false, 0),
    (app.demo_id(p_seed, 'mt:yearly'), p_center, 'yearly', 'yearly', 'Yearly membership', 15100, 12, true, true, 'yearly', false, 0),
    (app.demo_id(p_seed, 'mt:life'), p_center, 'life', 'life', 'Life membership', 110100, null, true, true, 'life', true, 180);
  -- Accepted offline payment methods, with what members are told
  insert into app.center_payment_methods (center_id, method, accepted, instructions, sort, updated_by) values
    (p_center, 'check', true, jsonb_build_object('payee', s || ' (demo)', 'address', '100 Demo Temple Road, Springfield', 'memo_hint', 'Your member number'), 1, p_actor),
    (p_center, 'zelle', true, jsonb_build_object('recipient', 'donations@' || app.demo_email_domain(), 'name', s || ' demo', 'memo_hint', 'Your member number'), 2, p_actor),
    (p_center, 'cash', true, jsonb_build_object('where', 'Bhandar box at the temple office', 'note', 'Ask for a receipt envelope.'), 3, p_actor),
    (p_center, 'ach', true, jsonb_build_object('details', 'Demo Bank · routing 000000000 · account 0000 (not a real account)'), 4, p_actor),
    (p_center, 'daf', true, jsonb_build_object('legal_name', s || ' (demo)', 'ein', '00-0000000', 'address', '100 Demo Temple Road, Springfield'), 5, p_actor),
    (p_center, 'stock', false, '{}'::jsonb, 6, p_actor);
  insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values
    (app.demo_id(p_seed, 'bank:operating'), p_center, 'Operating account (demo)', 'Demo Bank', '0000', 'generic_csv');
  insert into app.labh_options (id, center_id, name, amount_cents, fund_id, sort_order, fulfilled_by) values
    (app.demo_id(p_seed, 'labh:snatra'), p_center, 'Snatra puja at the derasar', 5100, app.demo_id(p_seed, 'fund:general'), 1, 'Pujari'),
    (app.demo_id(p_seed, 'labh:ashtaprakari'), p_center, 'Ashtaprakari puja', 10800, app.demo_id(p_seed, 'fund:general'), 2, 'Pujari'),
    (app.demo_id(p_seed, 'labh:bhojan'), p_center, 'Sponsor Sunday bhojanshala', 25100, app.demo_id(p_seed, 'fund:bhojanshala'), 3, 'Kitchen lead'),
    (app.demo_id(p_seed, 'labh:jeevdaya'), p_center, 'Jeevdaya donation', 5100, app.demo_id(p_seed, 'fund:jeevdaya'), 4, null);
  -- Store: categories, items, pickup windows (the event-day window is added with the events)
  insert into app.store_categories (id, center_id, name, sort_order) values
    (app.demo_id(p_seed, 'cat:mithai'), p_center, 'Mithai', 1), (app.demo_id(p_seed, 'cat:namkeen'), p_center, 'Namkeen', 2),
    (app.demo_id(p_seed, 'cat:meals'), p_center, 'Meals', 3);
  insert into app.store_items (id, center_id, category_id, sku, name, description, price_cents, pack_size, taxable, track_inventory, low_stock_threshold, status, gift_pack)
  select app.demo_id(p_seed, 'item:' || x.sku), p_center, app.demo_id(p_seed, 'cat:' || x.cat), 'DEMO-' || x.sku, x.name, x.descr, x.price, x.pack,
         x.taxable, x.track, case when x.track then 10 end, x.status, x.gift
    from (values ('101', 'mithai', 'Mohanthal', 'Gram-flour fudge with ghee and cardamom', 899, '250 g', true, true, 'active', true),
                 ('102', 'mithai', 'Kaju katli', 'Cashew fudge', 999, '250 g', true, true, 'active', true),
                 ('103', 'mithai', 'Sukhdi', 'Wheat and jaggery squares', 699, '250 g', true, false, 'active', true),
                 ('201', 'namkeen', 'Farsi puri', 'Crisp, flaky puris', 599, '200 g', true, true, 'active', true),
                 ('202', 'namkeen', 'Chakri', 'Rice-flour spirals', 599, '200 g', true, false, 'active', true),
                 ('203', 'namkeen', 'Methi khakhra', 'Roasted fenugreek flatbread', 499, 'pack of 10', true, false, 'active', true),
                 ('301', 'meals', 'Dal dhokli', 'Jain dal dhokli, no root vegetables', 899, 'one meal', false, false, 'active', false),
                 ('302', 'meals', 'Khichdi kadhi', 'Jain khichdi with kadhi', 899, 'one meal', false, false, 'active', false),
                 ('303', 'meals', 'Thepla', 'Methi thepla', 699, 'pack of 10', false, false, 'paused', false)
         ) x(sku, cat, name, descr, price, pack, taxable, track, status, gift);
  -- Opening stock for the items whose stock is tracked (stock follows the movements)
  insert into app.inventory_movements (center_id, item_id, delta, reason, recorded_by, recorded_at)
  select p_center, app.demo_id(p_seed, 'item:' || x.sku), x.qty, 'received', p_actor, app.demo_at(p_center, -20, '09:00')
    from (values ('101', 40), ('102', 30), ('201', 25)) x(sku, qty);
  insert into app.pickup_windows (id, center_id, starts_at, ends_at, order_cutoff_at, capacity, orders_count, location, status) values
    (app.demo_id(p_seed, 'pickup:past'), p_center, app.demo_at(p_center, -13, '11:00'), app.demo_at(p_center, -13, '13:00'),
     app.demo_at(p_center, -15, '20:00'), 40, 0, 'Temple kitchen', 'fulfilled'),
    (app.demo_id(p_seed, 'pickup:next'), p_center, app.demo_at(p_center, 2, '11:00'), app.demo_at(p_center, 2, '13:00'),
     app.demo_at(p_center, 1, '20:00'), 40, 0, 'Temple kitchen', 'open');
  -- Pathshala: tracks, levels, the current term (6 weeks in) and next term's registration
  insert into app.pathshala_tracks (id, center_id, key, name) values
    (app.demo_id(p_seed, 'track:jainism'), p_center, 'jainism', 'Jainism'), (app.demo_id(p_seed, 'track:gujarati'), p_center, 'gujarati', 'Gujarati');
  insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age)
  select app.demo_id(p_seed, 'level:' || x.track || x.k), p_center, app.demo_id(p_seed, 'track:' || x.track), x.k, x.name, x.ord, x.lo, x.hi
    from (values ('jainism', '1', 'Jainism 1', 1, 5, 7), ('jainism', '2', 'Jainism 2', 2, 8, 10), ('jainism', '3', 'Jainism 3', 3, 11, 14),
                 ('jainism', '4', 'Jainism 4', 4, 15, 18), ('gujarati', '1', 'Gujarati 1', 1, 8, 18), ('gujarati', '2', 'Gujarati 2', 2, 10, 18)) x(track, k, name, ord, lo, hi);
  insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, registration_opens_at, registration_closes_at, membership_required,
                                   fee_per_child_cents, fee_per_family_cap_cents, sibling_discount_pct, no_class_dates, status) values
    (v_term, p_center, yr || '–' || (yr + 1) || ' (demo)', v_start, v_start + 238, app.demo_at(p_center, -80, '09:00'), app.demo_at(p_center, -45, '23:59'),
     true, 15000, 40000, 10, array[v_start + 28 * 3, v_start + 28 * 5], 'active'),
    (v_next, p_center, (yr + 1) || '–' || (yr + 2) || ' (demo)', v_start + 364, v_start + 364 + 238, app.demo_at(p_center, 200, '09:00'), app.demo_at(p_center, 250, '23:59'),
     true, 16000, 42000, 10, '{}', 'draft');
  insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time) values
    (app.demo_id(p_seed, 'class:j1'), p_center, v_term, app.demo_id(p_seed, 'level:jainism1'), 'Jainism 1 · Room A', 'A', 12, 'sunday', '10:00', '11:30'),
    (app.demo_id(p_seed, 'class:j2'), p_center, v_term, app.demo_id(p_seed, 'level:jainism2'), 'Jainism 2 · Room B', 'B', 15, 'sunday', '10:00', '11:30'),
    (app.demo_id(p_seed, 'class:j3'), p_center, v_term, app.demo_id(p_seed, 'level:jainism3'), 'Jainism 3 · Room C', 'C', 15, 'sunday', '10:00', '11:30'),
    (app.demo_id(p_seed, 'class:g1'), p_center, v_term, app.demo_id(p_seed, 'level:gujarati1'), 'Gujarati 1 · Library', 'Library', 12, 'sunday', '11:45', '12:45');
  insert into app.teacher_positions (id, center_id, term_id, level_id, title, description, min_qualifications, status, created_by) values
    (app.demo_id(p_seed, 'position:j2'), p_center, v_term, app.demo_id(p_seed, 'level:jainism2'), 'Assistant teacher · Jainism 2',
     'Help the Jainism 2 teacher on Sunday mornings: stories, activities and attendance.', 'Comfortable with children aged 8–10; knows the Navkar and Logassa sutras.', 'open', p_actor);
  -- Gyan Path: one goal of this community's own, three levels of three steps
  insert into app.gyan_goals (id, center_id, tradition, key, name, description, sort_order, recommended, tint, mark) values
    (v_goal, p_center, v_trad, 'demo_uvasaggaharam', 'Learn Uvasaggaharam Stotra', 'The five verses in praise of Parshvanath (demo lessons, about 3 weeks)', 5, true, '#1F6F5C', 'U');
  insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, requires_teacher_signoff, chapter)
  select app.demo_id(p_seed, 'gyan:level' || x.n), v_goal, x.n::text, x.name, x.n, 20, x.treasure, x.signoff, x.chapter
    from (values (1, 'Who is Parshvanath', null, false, 'Chapter 1 · Meaning'), (2, 'Verses 1 to 3', 'First verses badge', false, 'Chapter 2 · Recite'),
                 (3, 'Recite all five verses', 'Uvasaggaharam badge + 50 bonus points', true, 'Chapter 2 · Recite')) x(n, name, treasure, signoff, chapter);
  insert into app.gyan_steps (id, level_id, kind, title, sort_order, points, quiz)
  select app.demo_id(p_seed, 'gyan:step' || x.l || '.' || x.n), app.demo_id(p_seed, 'gyan:level' || x.l), x.kind, x.title, x.n, x.pts,
         case when x.kind = 'quiz' then jsonb_build_array(jsonb_build_object('q', 'Which Tirthankar does the stotra praise?', 'options', jsonb_build_array('Mahavir', 'Parshvanath', 'Rishabhdev'), 'answer', 1)) end
    from (values (1, 1, 'read', 'The story of Parshvanath', 5), (1, 2, 'listen', 'Listen to the stotra', 5), (1, 3, 'quiz', 'Quick quiz', 10),
                 (2, 1, 'listen', 'Verse 1', 5), (2, 2, 'recite', 'Recite verses 1 to 3', 10), (2, 3, 'quiz', 'Meaning quiz', 10),
                 (3, 1, 'listen', 'Verses 4 and 5', 5), (3, 2, 'practice', 'Practise the whole stotra', 10), (3, 3, 'recite', 'Recite for your teacher', 20)) x(l, n, kind, title, pts);
  -- My Jain Way: this community's practices
  insert into app.practices (id, center_id, tradition, category, key, name, description, default_minutes, points, sort_order, default_time)
  select app.demo_id(p_seed, 'practice:' || x.key), p_center, v_trad, x.cat, x.key, x.name, x.descr, x.mins, x.pts, x.ord, x.t::time
    from (values ('demo_navkar', 'mantra_jaap', 'Navkar Mantra on waking', 'Nine times, before getting up', 2, 5, 10, '06:30'),
                 ('demo_darshan', 'darshan_puja', 'Darshan', 'At the derasar or the home shrine', 15, 10, 20, '08:00'),
                 ('demo_navkarsi', 'tapasya_pachchakhan', 'Navkarsi', 'Nothing to eat or drink until 48 minutes after sunrise', null, 10, 30, null),
                 ('demo_samayik', 'samayik_pratikraman', 'Samayik', '48 minutes of equanimity', 48, 20, 40, '18:00'),
                 ('demo_swadhyay', 'swadhyay_learning', 'Swadhyay', 'Read or listen for 20 minutes', 20, 10, 50, '20:00'),
                 ('demo_chauvihar', 'tapasya_pachchakhan', 'Chauvihar', 'Dinner before sunset', null, 15, 60, null)) x(key, cat, name, descr, mins, pts, ord, t);
  -- Guide
  insert into app.guide_sections (center_id, slug, title, body_md, sort_order, is_checklist) values
    (p_center, 'first-steps', 'Your first steps', '1. Add your family\n2. Find your zone\n3. Learn about membership\n4. Share your seva interests\n5. Ask us anything', 1, true),
    (p_center, 'timings', 'Timings and visiting', '| What | When |\n|---|---|\n| Derasar | 7:30 AM – 7:00 PM daily |\n| Snatra puja | Sundays 9:30 AM |\n| Pathshala | Sundays 10:00 AM – 12:45 PM |\n| Bhojanshala | Sundays 12:30 PM |\n\n(Demo timings.)', 2, false),
    (p_center, 'membership', 'Membership', 'Yearly and life memberships include your spouse. Membership is needed to register children for Pathshala. (Demo text.)', 3, false),
    (p_center, 'parking', 'Parking and access', 'Park in the main lot; the overflow lot opens on festival days. Wheelchair access is at the east door. (Demo text.)', 4, false);
  -- Events: checklist templates
  insert into app.event_templates (id, center_id, name, description) values
    (app.demo_id(p_seed, 'tpl:tapasvi'), p_center, 'Tapasvi Bahuman', 'Honoring tapasvis after Paryushan, with swamivatsalya'),
    (app.demo_id(p_seed, 'tpl:annual'), p_center, 'Pathshala annual day', 'Students perform; families bring potluck');
  insert into app.event_template_items (id, center_id, template_id, phase, name, priority, offset_days, sort_order)
  select app.demo_id(p_seed, 'tplitem:' || x.tpl || x.ord), p_center, app.demo_id(p_seed, 'tpl:' || x.tpl), x.phase::app.event_phase, x.name, x.prio, x.off, x.ord
    from (values ('tapasvi', 1, 'pre', 'Book the hall', 'high', -45), ('tapasvi', 2, 'pre', 'Order gifts for tapasvis', 'high', -21),
                 ('tapasvi', 3, 'pre', 'Assign volunteers to stations', 'medium', -7), ('tapasvi', 4, 'during', 'Run check-in stations', 'critical', null),
                 ('tapasvi', 5, 'after', 'Send thank-you and feedback survey', 'medium', 2),
                 ('annual', 1, 'pre', 'Confirm the program with teachers', 'high', -30), ('annual', 2, 'pre', 'Print certificates', 'medium', -7),
                 ('annual', 3, 'during', 'Stage and sound', 'high', null), ('annual', 4, 'after', 'Share photos with families', 'low', 3)) x(tpl, ord, phase, name, prio, off);
  -- Calendar layers, volunteer groups, WhatsApp groups
  insert into app.calendar_layers (id, center_id, key, name, kind, default_on, color) values
    (app.demo_id(p_seed, 'layer:events'), p_center, 'demo_events', s || ' events', 'events', true, '#7A2E1F'),
    (app.demo_id(p_seed, 'layer:pathshala'), p_center, 'demo_pathshala', 'Pathshala', 'pathshala', true, '#5B4B8A');
  insert into app.volunteer_groups (id, center_id, name, requires_background_check) values
    (app.demo_id(p_seed, 'vg:kitchen'), p_center, 'Bhojanshala and kitchen', false),
    (app.demo_id(p_seed, 'vg:teaching'), p_center, 'Pathshala teaching', true),
    (app.demo_id(p_seed, 'vg:events'), p_center, 'Events and decoration', false),
    (app.demo_id(p_seed, 'vg:parking'), p_center, 'Parking and security', false),
    (app.demo_id(p_seed, 'vg:youth'), p_center, 'Youth mentoring', true);
  insert into app.whatsapp_groups (id, center_id, name, description, audience) values
    (app.demo_id(p_seed, 'wa:announce'), p_center, s || ' announcements', 'Official news and timings · admins only post', 'members'),
    (app.demo_id(p_seed, 'wa:pathshala'), p_center, 'Pathshala parents', 'Class updates and schedules', 'pathshala'),
    (app.demo_id(p_seed, 'wa:volunteers'), p_center, 'Volunteers', 'Seva shifts and sign-ups', 'volunteers');
  -- Custom fields (the kind an import creates from extra columns)
  insert into app.custom_field_definitions (center_id, entity, key, label, type, choices, sensitivity, searchable, source, sort, created_by) values
    (p_center, 'people', 'tshirt_size', 'T-shirt size', 'choice', '["S","M","L","XL"]', 'member_self', false, 'manual', 1, p_actor),
    (p_center, 'people', 'senior_citizen', 'Senior citizen', 'boolean', '[]', 'staff', true, 'manual', 2, p_actor),
    (p_center, 'households', 'legacy_account', 'Legacy CRM account', 'text', '[]', 'staff', true, 'manual', 3, p_actor);
  -- Accounting periods, public dashboard, saved segments
  insert into app.accounting_periods (center_id, period_month, status, closed_by, closed_at, checklist)
  select p_center, (date_trunc('month', app.demo_today(p_center)) - make_interval(months => x.m))::date,
         case when x.m >= 2 then 'closed' else 'open' end, case when x.m >= 2 then p_actor end,
         case when x.m >= 2 then (date_trunc('month', app.demo_today(p_center)) - make_interval(months => x.m - 1) + interval '5 days') end,
         case when x.m >= 2 then '{"bank_reconciled":true,"deposits_matched":true,"exceptions_cleared":true}'::jsonb else '{}'::jsonb end
    from generate_series(0, 3) x(m);
  insert into app.public_kpi_settings (center_id, kpi_key, visibility, updated_by)
  select p_center, k, v, p_actor from (values ('member_families', 'public'), ('community_people', 'public'), ('events_held', 'public'),
                                               ('pathshala_students', 'members'), ('samayik', 'members'), ('campaign', 'public')) x(k, v);
  insert into app.saved_segments (id, center_id, name, definition, created_by) values
    (app.demo_id(p_seed, 'seg:life'), p_center, 'Life members', '{"tiers":["life"]}', p_actor),
    (app.demo_id(p_seed, 'seg:pathshala'), p_center, 'Pathshala families', '{"pathshala_families":true}', p_actor);
end $$;

-- ── Step 2 · households and people ───────────────────────────────────────────
-- 25 families. Members: first|last|gender|age|role|profession ; adults get an e-mail and phone.
create or replace function app.demo_community_people(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare h record; m text; f text[]; v_age int; v_email text; v_phone int := 0; v_hid uuid; v_pid uuid; v_state text;
        v_n int := 0; v_primary uuid; v_emails text[] := '{}'; v_short text := app.demo_short(p_center);
begin
  v_state := coalesce((select state_region from app.centers where id = p_center), 'TX');
  for h in
    select * from (values
      ('h01', 'Shah family',            'Maple Grove', 'North', '101 Lotus Lane', '75001', true,  false, 'Priya|Shah|f|41|primary|Software engineer;Rahul|Shah|m|43|spouse|Physician;Dev|Shah|m|14|child|;Anya|Shah|f|9|child|'),
      ('h02', 'Mehta family',           'Cedar Falls', 'South', '22 Banyan Court', '75011', true,  true,  'Kiran|Mehta|m|56|primary|Engineer;Neha|Mehta|f|52|spouse|Teacher;Arjun|Mehta|m|24|child|Analyst'),
      ('h03', 'Jain family',            'Lakeview',    'East',  '7 Neem Street', '75021', true,  false, 'Amit|Jain|m|45|primary|Accountant;Sonal|Jain|f|42|spouse|Pharmacist;Riya|Jain|f|12|child|;Vihaan|Jain|m|7|child|'),
      ('h04', 'Doshi family',           'Oak Ridge',   'West',  '48 Peepal Drive', '75031', false, true,  'Hemant|Doshi|m|68|primary|Retired;Kusum|Doshi|f|66|spouse|Retired'),
      ('h05', 'Parikh family',          'Maple Grove', 'North', '15 Jasmine Way', '75002', true,  false, 'Nikhil|Parikh|m|38|primary|Product manager;Mansi|Parikh|f|36|spouse|Designer;Aarav|Parikh|m|8|child|;Kiara|Parikh|f|5|child|'),
      ('h06', 'Kothari family',         'Cedar Falls', 'South', '3 Marigold Place', '75012', true,  false, 'Sanjay|Kothari|m|50|primary|Business owner;Rupal|Kothari|f|48|spouse|;Isha|Kothari|f|16|child|;Pranav|Kothari|m|13|child|'),
      ('h07', 'Sheth family',           'Lakeview',    'East',  '90 Tulsi Lane', '75022', false, false, 'Vikram|Sheth|m|34|primary|Data scientist;Anjali|Sheth|f|33|spouse|Dentist;Myra|Sheth|f|4|child|'),
      ('h08', 'Vora family',            'Oak Ridge',   'West',  '12 Ashoka Road', '75032', true,  true,  'Bharat|Vora|m|72|primary|Retired;Sarla|Vora|f|70|spouse|Retired;Tejas|Vora|m|44|child|Lawyer;Pooja|Vora|f|42|other|Physiotherapist;Nisha|Vora|f|10|other|'),
      ('h09', 'Sanghvi family',         'Maple Grove', 'North', '5 Kesar Street', '75003', true,  false, 'Rakesh|Sanghvi|m|47|primary|Cardiologist;Hetal|Sanghvi|f|45|spouse|Marketing lead;Jay|Sanghvi|m|17|child|;Diya|Sanghvi|f|11|child|'),
      ('h10', 'Dalal family',           'Cedar Falls', 'South', '61 Champa Avenue', '75013', false, true,  'Paresh|Dalal|m|52|primary|Civil engineer;Bina|Dalal|f|50|spouse|'),
      ('h11', 'Desai family',           'Lakeview',    'East',  '19 Kamal Court', '75021', true,  false, 'Mitesh|Desai|m|39|primary|IT consultant;Krupa|Desai|f|37|spouse|Nurse;Aanya|Desai|f|10|child|;Reyansh|Desai|m|6|child|'),
      ('h12', 'Modi household',         'Oak Ridge',   'West',  '8 Chandan Lane', '75033', false, false, 'Chirag|Modi|m|31|primary|Software engineer;Khushi|Modi|f|29|spouse|Architect'),
      ('h13', 'Bhansali family',        'Maple Grove', 'North', '77 Gulmohar Road', '75001', true,  true,  'Ramesh|Bhansali|m|61|primary|Jeweler;Usha|Bhansali|f|59|spouse|;Karan|Bhansali|m|27|child|Consultant'),
      ('h14', 'Zaveri family',          'Cedar Falls', 'South', '4 Moti Street', '75011', false, false, 'Ashok|Zaveri|m|58|primary|Diamond trader;Meena|Zaveri|f|55|spouse|'),
      ('h15', 'Chheda family',          'Lakeview',    'East',  '33 Parijat Way', '75022', true,  false, 'Deepak|Chheda|m|44|primary|Pharmacist;Falguni|Chheda|f|41|spouse|;Ved|Chheda|m|15|child|;Tara|Chheda|f|12|child|'),
      ('h16', 'Gala family',            'Oak Ridge',   'West',  '10 Anand Avenue', '75031', false, false, 'Jignesh|Gala|m|40|primary|Restaurant owner;Bhavna|Gala|f|39|spouse|;Om|Gala|m|9|child|'),
      ('h17', 'Nagda family',           'Maple Grove', 'North', '28 Vidya Lane', '75002', true,  true,  'Sunil|Nagda|m|49|primary|Professor;Rekha|Nagda|f|47|spouse|Professor;Avni|Nagda|f|19|child|Student'),
      ('h18', 'Lodha family',           'Cedar Falls', 'South', '2 Shanti Road', '75012', true,  true,  'Prakash|Lodha|m|63|primary|Chartered accountant;Sushila|Lodha|f|60|spouse|'),
      ('h19', 'Bafna family',           'Lakeview',    'East',  '45 Sagar Street', '75021', false, false, 'Anil|Bafna|m|42|primary|Surgeon;Ritu|Bafna|f|40|spouse|;Neel|Bafna|m|11|child|;Siya|Bafna|f|8|child|'),
      ('h20', 'Sethia household',       'Oak Ridge',   'West',  '16 Pushpa Court', '75032', false, false, 'Manoj|Sethia|m|36|primary|Financial analyst;Shweta|Sethia|f|35|spouse|;Kabir|Sethia|m|3|child|'),
      ('h21', 'Golechha family',        'Maple Grove', 'North', '51 Nandan Road', '75003', false, true,  'Vinod|Golechha|m|55|primary|Textile importer;Sangeeta|Golechha|f|53|spouse|;Rohan|Golechha|m|22|child|Student'),
      ('h22', 'Hitesh Oswal household', 'Cedar Falls', 'South', '9 Vishal Apartments', '75013', false, false, 'Hitesh|Oswal|m|29|primary|Teacher'),
      ('h23', 'Bothra family',          'Lakeview',    'East',  '70 Sundar Lane', '75022', false, false, 'Lalit|Bothra|m|46|primary|Pharmacist;Kavita|Bothra|f|44|spouse|;Mahi|Bothra|f|14|child|'),
      ('h24', 'Rahul & Mira Mehta household', 'Oak Ridge', 'West', '14 Dhruv Street', '75033', false, false, 'Rahul|Mehta|m|37|primary|Sales manager;Mira|Mehta|f|35|spouse|'),
      ('h25', 'Rahul & Mira Shah household',  'Maple Grove', 'North', '63 Lotus Lane', '75001', true, false, 'Rahul|Shah|m|48|primary|Accountant;Mira|Shah|f|46|spouse|')
    ) x(key, name, city, zone, street, zip, directory, mail, members)
  loop
    v_hid := app.demo_h(p_seed, h.key);
    insert into app.households (id, center_id, display_name, address_line1, city, state_region, postal_code, zone_id, directory_opt_in, physical_mail_opt_in, custom)
    values (v_hid, p_center, h.name, h.street, h.city, v_state, h.zip, app.demo_id(p_seed, 'zone:' || lower(h.zone)), h.directory, h.mail,
            case when h.key in ('h02','h06','h09','h13') then jsonb_build_object('legacy_account', 'NEON-' || (4000 + substr(h.key, 2)::int)) else '{}'::jsonb end);
    foreach m in array string_to_array(h.members, ';') loop
      f := string_to_array(m, '|');
      v_age := f[4]::int;
      v_pid := app.demo_p(p_seed, h.key || '.' || lower(f[1]));
      v_email := null;
      if v_age >= 18 then
        v_email := lower(f[1]) || '.' || lower(f[2]) || '@' || app.demo_email_domain();
        if v_email = any (v_emails) then v_email := lower(f[1]) || '.' || lower(f[2]) || '.' || h.key || '@' || app.demo_email_domain(); end if;
        v_emails := v_emails || v_email;
        v_phone := v_phone + 1;
      end if;
      insert into app.people (id, center_id, first_name, last_name, date_of_birth, gender, email, phone_e164, language, profession,
                              is_verified, verified_at, photo_opt_in, expertise_opt_in, expertise_headline, interests, custom)
      values (v_pid, p_center, f[1], f[2],
              (app.demo_today(p_center) - make_interval(years => v_age, days => (abs(hashtext(h.key || f[1])) % 300)))::date,
              case f[3] when 'f' then 'female' else 'male' end, v_email,
              case when v_age >= 18 then '+1' || (array['214','469','972'])[1 + v_phone % 3] || '5550' || lpad((100 + v_phone)::text, 3, '0') end,
              case when v_age >= 60 and v_phone % 2 = 0 then 'gu' else 'en' end, nullif(f[6], ''),
              v_age >= 18, case when v_age >= 18 then now() - interval '200 days' end, v_age >= 18 and v_phone % 3 <> 0,
              f[6] in ('Physician', 'Cardiologist', 'Surgeon', 'Chartered accountant', 'Software engineer'),
              case when f[6] in ('Physician', 'Cardiologist', 'Surgeon', 'Chartered accountant', 'Software engineer') then f[6] || ' · happy to guide students' end,
              case when v_age >= 18 then array['seva', 'pathshala'] else '{}'::text[] end,
              case when v_age >= 65 then jsonb_build_object('senior_citizen', true)
                   when v_age >= 18 and v_phone % 4 = 0 then jsonb_build_object('tshirt_size', (array['S','M','L','XL'])[1 + v_phone % 4])
                   else '{}'::jsonb end);
      insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (v_hid, v_pid, p_center, f[5]::app.person_role_in_household, f[5] = 'primary', app.demo_today(p_center) - 900);
      if v_email is not null then
        insert into app.person_emails (center_id, person_id, email, label, verified) values (p_center, v_pid, v_email, 'primary', true);
        -- Explicit e-mail opt-in (only explicit opt-ins count): most adults, from the old CRM.
        if v_phone % 5 <> 0 then
          insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source, recorded_at)
          values (p_center, v_pid, 'email', v_email, true, 'import: demo CRM export', now() - interval '300 days');
        end if;
        insert into app.consents (center_id, person_id, kind, granted, source, recorded_at)
        values (p_center, v_pid, 'photo', v_phone % 3 <> 0, 'import', now() - interval '300 days');
      end if;
      v_n := v_n + 1;
    end loop;
    -- The legacy household id every import carries.
    insert into app.external_ids (center_id, household_id, kind, system, value, label, source)
    values (p_center, v_hid, 'org_household', 'demo_register', lpad((200 + substr(h.key, 2)::int)::text, 4, '0'), v_short || ' household ID', 'import');
  end loop;
  -- Legacy member ids for the primary members, and a bank payer name learned from Zelle.
  insert into app.external_ids (center_id, person_id, kind, system, value, label, source)
  select p_center, hm.person_id, 'org_member', 'demo_register', lpad((400 + row_number() over (order by h2.display_name))::text, 4, '0'), v_short || ' member ID', 'import'
    from app.household_members hm join app.households h2 on h2.id = hm.household_id where hm.center_id = p_center and hm.is_primary
     and hm.household_id in (select app.demo_h(p_seed, k) from unnest(array['h01','h02','h03','h04','h05','h06','h08','h09','h13','h18']) k);
  insert into app.external_ids (center_id, household_id, kind, system, value, label, source) values
    (p_center, app.demo_h(p_seed, 'h01'), 'bank_payer', 'zelle', 'PRIYA S SHAH', 'Zelle payer name', 'learned'),
    (p_center, app.demo_h(p_seed, 'h03'), 'bank_payer', 'zelle', 'SONAL A JAIN', 'Zelle payer name', 'learned');
  -- Special days
  insert into app.special_days (center_id, household_id, person_id, kind, label, calendar_date, show_on_home) values
    (p_center, app.demo_h(p_seed, 'h01'), app.demo_p(p_seed, 'h01.anya'), 'birthday', 'Anya''s birthday', app.demo_today(p_center) + 12, true),
    (p_center, app.demo_h(p_seed, 'h01'), null, 'anniversary', 'Priya & Rahul''s anniversary', app.demo_today(p_center) + 70, false),
    (p_center, app.demo_h(p_seed, 'h02'), app.demo_p(p_seed, 'h02.kiran'), 'birthday', 'Kiran''s birthday', app.demo_today(p_center) + 5, true),
    (p_center, app.demo_h(p_seed, 'h04'), null, 'punyatithi', 'Punyatithi of Maniben Doshi', app.demo_today(p_center) + 30, false),
    (p_center, app.demo_h(p_seed, 'h08'), app.demo_p(p_seed, 'h08.bharat'), 'birthday', 'Bharatbhai''s 73rd birthday', app.demo_today(p_center) + 21, true),
    (p_center, app.demo_h(p_seed, 'h11'), null, 'anniversary', 'Mitesh & Krupa''s anniversary', app.demo_today(p_center) + 3, true),
    (p_center, app.demo_h(p_seed, 'h17'), app.demo_p(p_seed, 'h17.avni'), 'birthday', 'Avni''s birthday', app.demo_today(p_center) + 44, false),
    (p_center, app.demo_h(p_seed, 'h18'), null, 'diksha', 'Diksha anniversary of Sadhvi Shri (family)', app.demo_today(p_center) + 90, false);
  -- Two "Rahul Shah"s in different households: a likely duplicate for the merge queue (never merged on a name alone).
  insert into app.merge_candidates (center_id, kind, left_id, right_id, score, status)
  values (p_center, 'person', app.demo_p(p_seed, 'h01.rahul'), app.demo_p(p_seed, 'h25.rahul'), 0.62, 'open');
  -- The committee roster in the guide (the organization's own leaders are never touched).
  insert into app.role_roster (center_id, body, title, person_id, display_name, term_starts_on, term_ends_on, sort_order)
  select p_center, x.body, x.title, app.demo_p(p_seed, x.p), x.name, make_date(extract(year from app.demo_today(p_center))::int, 1, 1),
         make_date(extract(year from app.demo_today(p_center))::int + 1, 12, 31), x.ord
    from (values ('executive_committee', 'President', 'h02.kiran', 'Kiran Mehta', 1), ('executive_committee', 'Secretary', 'h17.sunil', 'Sunil Nagda', 2),
                 ('executive_committee', 'Treasurer', 'h03.amit', 'Amit Jain', 3), ('executive_committee', 'Religious coordinator', 'h13.ramesh', 'Ramesh Bhansali', 4),
                 ('trustees', 'Chair, Board of Trustees', 'h18.prakash', 'Prakash Lodha', 1), ('trustees', 'Trustee', 'h08.bharat', 'Bharat Vora', 2)) x(body, title, p, name, ord);
end $$;

-- ── Step 3 · memberships, applications and staff ─────────────────────────────
create or replace function app.demo_community_membership(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_pl uuid; yr int := extract(year from app.demo_today(p_center))::int; v_mid uuid; v_tok text;
begin
  for r in select * from (values
      ('h01','h01.priya','life',   make_date(yr - 11, 4, 1)), ('h02','h02.kiran','life', make_date(yr - 19, 1, 15)),
      ('h04','h04.hemant','life',  make_date(yr - 25, 8, 1)), ('h06','h06.sanjay','life', make_date(yr - 8, 3, 10)),
      ('h08','h08.bharat','life',  make_date(yr - 30, 5, 5)), ('h09','h09.rakesh','life', make_date(yr - 6, 9, 1)),
      ('h13','h13.ramesh','life',  make_date(yr - 14, 2, 1)), ('h18','h18.prakash','life', app.demo_today(p_center) - 120),
      ('h03','h03.amit','yearly',  make_date(yr, 1, 1)), ('h05','h05.nikhil','yearly', make_date(yr, 1, 1)),
      ('h10','h10.paresh','yearly',make_date(yr, 1, 1)), ('h11','h11.mitesh','yearly', make_date(yr, 1, 1)),
      ('h14','h14.ashok','yearly', make_date(yr, 1, 1)), ('h15','h15.deepak','yearly', make_date(yr, 1, 1)),
      ('h17','h17.sunil','yearly', make_date(yr, 1, 1)), ('h19','h19.anil','yearly', make_date(yr, 1, 1)),
      ('h07','h07.vikram','community', app.demo_today(p_center) - 300), ('h12','h12.chirag','community', app.demo_today(p_center) - 200),
      ('h16','h16.jignesh','community', app.demo_today(p_center) - 500), ('h20','h20.manoj','community', app.demo_today(p_center) - 90),
      ('h22','h22.hitesh','community', app.demo_today(p_center) - 60), ('h25','h25.rahul','community', app.demo_today(p_center) - 700)
    ) x(h, p, tier, since)
  loop
    v_pl := null;
    v_mid := app.demo_id(p_seed, 'membership:' || r.h);
    if r.tier = 'yearly' then
      -- The yearly fee is billed as a pledge (paid or not, in the giving step).
      v_pl := app.demo_id(p_seed, 'pledge:fee.' || r.h);
      insert into app.pledges (id, center_id, household_id, pledged_by_person_id, fund_id, source, source_ref_id, amount_cents, pledged_at, due_on, created_by)
      values (v_pl, p_center, app.demo_h(p_seed, r.h), app.demo_p(p_seed, r.p), app.demo_id(p_seed, 'fund:general'), 'membership_fee', v_mid, 15100,
              make_date(yr, 1, 1)::timestamptz, make_date(yr, 3, 31), p_actor);
    end if;
    insert into app.memberships (id, center_id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, fee_pledge_id, granted_by, notes)
    values (v_mid, p_center, app.demo_h(p_seed, r.h), app.demo_p(p_seed, r.p), app.demo_id(p_seed, 'mt:' || r.tier), r.tier::app.membership_tier, 'active',
            r.since, case when r.tier = 'yearly' then make_date(yr, 12, 31) end, v_pl, p_actor, 'Demo data');
  end loop;
  -- History: the Golechha family's yearly membership lapsed last year; the Jains were yearly before.
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, granted_by, notes) values
    (p_center, app.demo_h(p_seed, 'h21'), app.demo_p(p_seed, 'h21.vinod'), app.demo_id(p_seed, 'mt:yearly'), 'yearly', 'lapsed', make_date(yr - 1, 1, 1), make_date(yr - 1, 12, 31), p_actor, 'Demo data · not renewed'),
    (p_center, app.demo_h(p_seed, 'h03'), app.demo_p(p_seed, 'h03.amit'), app.demo_id(p_seed, 'mt:yearly'), 'yearly', 'ended', make_date(yr - 1, 1, 1), make_date(yr - 1, 12, 31), p_actor, 'Demo data · renewed');
  -- Applications: one waiting for its reference, one waiting for the membership coordinator.
  insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id, reference_note,
                                           reference_requested_at, reference_expires_at, fee_cents, status) values
    (p_center, app.demo_p(p_seed, 'h24.rahul'), app.demo_h(p_seed, 'h24'), app.demo_id(p_seed, 'mt:yearly'), 'yearly', app.demo_p(p_seed, 'h02.kiran'),
     'We met at the Paryushan pratikraman; our families know each other from Maple Grove.', now() - interval '2 days', now() + interval '12 days', 15100, 'awaiting_reference');
  insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id, reference_note,
                                           reference_decision, reference_decided_at, reference_requested_at, fee_cents, status) values
    (p_center, app.demo_p(p_seed, 'h23.lalit'), app.demo_h(p_seed, 'h23'), app.demo_id(p_seed, 'mt:yearly'), 'yearly', app.demo_p(p_seed, 'h03.amit'),
     'Colleagues for eight years; the Bothras volunteer at the kitchen.', 'approved', now() - interval '3 days', now() - interval '6 days', 15100, 'awaiting_center');
  -- Voting eligibility for the life members' primaries.
  insert into app.eligibility_snapshots (center_id, person_id, can_vote, reasons)
  select p_center, app.demo_p(p_seed, x.p), x.ok, x.why::jsonb from (values
    ('h01.priya', true, '["Life membership over 180 days","No prior-year pledges outstanding"]'),
    ('h02.kiran', true, '["Life membership over 180 days","No prior-year pledges outstanding"]'),
    ('h06.sanjay', true, '["Life membership over 180 days"]'),
    ('h09.rakesh', true, '["Life membership over 180 days"]'),
    ('h18.prakash', false, '["Life membership for 120 days: the wait is 180 days"]')) x(p, ok, why);
  -- Staff: invitations waiting to be accepted (demo people have no logins of their own).
  for r in select * from (values ('h03.amit', 'Amit', 'Jain', array['treasurer']), ('h02.neha', 'Neha', 'Mehta', array['teacher']),
                                 ('h17.sunil', 'Sunil', 'Nagda', array['pathshala_principal']), ('h11.krupa', 'Krupa', 'Desai', array['volunteer_coordinator']),
                                 ('h09.hetal', 'Hetal', 'Sanghvi', array['communications_officer'])) x(p, first, last, roles)
  loop
    v_tok := encode(gen_random_bytes(24), 'hex');
    insert into app.staff_invitations (center_id, email, person_id, first_name, last_name, role_keys, invited_by, token_hash, expires_at, last_sent_at)
    values (p_center, lower(r.first) || '.' || lower(r.last) || '@' || app.demo_email_domain(), app.demo_p(p_seed, r.p), r.first, r.last, r.roles,
            p_actor, encode(digest(v_tok, 'sha256'), 'hex'), now() + interval '7 days', now() - interval '1 day');
  end loop;
  -- Teachers and their background checks
  insert into app.background_checks (id, center_id, person_id, provider, status, cleared_on, expires_on, recorded_by)
  select app.demo_id(p_seed, 'bgc:' || x.p), p_center, app.demo_p(p_seed, x.p), 'Demo checks', x.st, x.cleared, x.expires, p_actor
    from (values ('h02.neha', 'clear', app.demo_today(p_center) - 200, app.demo_today(p_center) + 530),
                 ('h17.rekha', 'clear', app.demo_today(p_center) - 100, app.demo_today(p_center) + 630),
                 ('h03.sonal', 'clear', app.demo_today(p_center) - 400, app.demo_today(p_center) + 330),
                 ('h17.sunil', 'clear', app.demo_today(p_center) - 50, app.demo_today(p_center) + 680),
                 ('h13.karan', 'expired', app.demo_today(p_center) - 800, app.demo_today(p_center) - 70)) x(p, st, cleared, expires);
  insert into app.pathshala_teachers (center_id, class_id, person_id, role, background_check_id) values
    (p_center, app.demo_id(p_seed, 'class:j1'), app.demo_p(p_seed, 'h02.neha'), 'teacher', app.demo_id(p_seed, 'bgc:h02.neha')),
    (p_center, app.demo_id(p_seed, 'class:j2'), app.demo_p(p_seed, 'h17.sunil'), 'teacher', app.demo_id(p_seed, 'bgc:h17.sunil')),
    (p_center, app.demo_id(p_seed, 'class:j3'), app.demo_p(p_seed, 'h17.rekha'), 'teacher', app.demo_id(p_seed, 'bgc:h17.rekha')),
    (p_center, app.demo_id(p_seed, 'class:g1'), app.demo_p(p_seed, 'h03.sonal'), 'teacher', app.demo_id(p_seed, 'bgc:h03.sonal'));
  -- A family change waiting for the office.
  insert into app.household_change_requests (center_id, household_id, requested_by, kind, details, status)
  select p_center, app.demo_h(p_seed, 'h07'), p_actor, 'add_member',
         jsonb_build_object('first_name', 'Rohit', 'last_name', 'Sheth', 'relationship', 'parent', 'note', 'Vikram''s father moved in (demo request)'), 'open'
   where p_actor is not null;
end $$;

-- ── Step 4 · giving: pledges, payments, recurring gifts, bolis, labh ─────────
create or replace function app.demo_community_giving(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; yr int := extract(year from app.demo_today(p_center))::int; v_boli uuid; v_entry uuid; v_ev uuid;
        pl uuid;
begin
  -- Money follows the Giving rules (app.allocate_payment refuses while Giving is switched off):
  -- a community that switched Giving off gets no demo money at all.
  if not app.module_enabled(p_center, 'giving') then return; end if;
  -- Opportunities (Diwali pujans point at the Diwali event once it exists; see the events step)
  insert into app.opportunities (id, center_id, campaign_id, name, description, amount_cents, quantity_available, sort_order, kind, status) values
    (app.demo_id(p_seed, 'opp:founders'), p_center, app.demo_id(p_seed, 'camp:construction'), 'Founders circle', 'Name on the founders wall', 1000000, null, 1, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:pillar'), p_center, app.demo_id(p_seed, 'camp:construction'), 'Pillar sponsor', 'One of twelve pillars', 250000, 12, 2, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:construction_any'), p_center, app.demo_id(p_seed, 'camp:construction'), 'Any amount', null, null, null, 3, 'amount', 'open'),
    (app.demo_id(p_seed, 'opp:swamivatsalya'), p_center, app.demo_id(p_seed, 'camp:paryushan'), 'Swamivatsalya sponsor', 'Host the community meal', 500000, 2, 1, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:prabhavna'), p_center, app.demo_id(p_seed, 'camp:paryushan'), 'Prabhavna sponsor', null, 100000, null, 2, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:pehli_aarti'), p_center, app.demo_id(p_seed, 'camp:diwali'), 'Pehli aarti', 'The first aarti of the new year', 25100, 1, 1, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:mangal_divo'), p_center, app.demo_id(p_seed, 'camp:diwali'), 'Mangal divo', null, 15100, 1, 2, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:sharda'), p_center, app.demo_id(p_seed, 'camp:diwali'), 'Sharda (chopda) pujan', null, 10800, 1, 3, 'fixed', 'open'),
    (app.demo_id(p_seed, 'opp:bhojan'), p_center, app.demo_id(p_seed, 'camp:bhojan'), 'Sponsor a Sunday meal', null, 25100, null, 1, 'fixed', 'open');

  -- Pledges: (ref, household, pledger, campaign, opportunity, source, amount, days ago)
  for r in select * from (values
      ('c01', 'h01', 'h01.rahul',  'construction', null,             'construction', 500000,  380),
      ('c02', 'h02', 'h02.kiran',  'construction', 'founders',       'construction', 1000000, 370),
      ('c06', 'h06', 'h06.sanjay', 'construction', null,             'construction', 2500000, 360),
      ('c09', 'h09', 'h09.rakesh', 'construction', null,             'construction', 1500000, 300),
      ('c13', 'h13', 'h13.ramesh', 'construction', 'pillar',         'construction', 250000,  250),
      ('c18', 'h18', 'h18.prakash','construction', 'pillar',         'construction', 250000,  240),
      ('c04', 'h04', 'h04.hemant', 'construction', 'pillar',         'construction', 250000,  200),
      ('c08', 'h08', 'h08.tejas',  'construction', 'founders',       'construction', 1000000, 150),
      ('a01', 'h01', 'h01.priya',  'annual',       null,             'general',      50000,   200),
      ('a03', 'h03', 'h03.amit',   'annual',       null,             'general',      25100,   190),
      ('a05', 'h05', 'h05.nikhil', 'annual',       null,             'general',      15100,   180),
      ('a10', 'h10', 'h10.paresh', 'annual',       null,             'general',      10100,   170),
      ('a11', 'h11', 'h11.mitesh', 'annual',       null,             'general',      25000,   160),
      ('a12', 'h12', 'h12.chirag', 'annual',       null,             'general',      5100,    150),
      ('a14', 'h14', 'h14.ashok',  'annual',       null,             'general',      50100,   140),
      ('a15', 'h15', 'h15.deepak', 'annual',       null,             'general',      20000,   130),
      ('a17', 'h17', 'h17.sunil',  'annual',       null,             'general',      15000,   120),
      ('a19', 'h19', 'h19.anil',   'annual',       null,             'general',      50000,   110),
      ('a21', 'h21', 'h21.vinod',  'annual',       null,             'general',      10000,   400),
      ('s02', 'h02', 'h02.kiran',  'paryushan',    'swamivatsalya',  'sponsorship',  500000,  55),
      ('s09', 'h09', 'h09.hetal',  'paryushan',    'swamivatsalya',  'sponsorship',  500000,  54),
      ('s06', 'h06', 'h06.rupal',  'paryushan',    'prabhavna',      'sponsorship',  100000,  52),
      ('d13', 'h13', 'h13.ramesh', 'diwali',       'pehli_aarti',    'pujan',        25100,   6),
      ('d04', 'h04', 'h04.kusum',  'diwali',       'mangal_divo',    'pujan',        15100,   4),
      ('b16', 'h16', 'h16.jignesh','bhojan',       'bhojan',         'sponsorship',  25100,   20),
      ('g25', 'h25', 'h25.rahul',  null,           null,             'general',      10100,   90),
      ('g07', 'h07', 'h07.anjali', null,           null,             'general',      5100,    40)
    ) x(ref, h, p, camp, opp, src, amount, ago)
  loop
    insert into app.pledges (id, center_id, household_id, pledged_by_person_id, campaign_id, opportunity_id, fund_id, source, amount_cents, pledged_at, created_by, dedication)
    values (app.demo_id(p_seed, 'pledge:' || r.ref), p_center, app.demo_h(p_seed, r.h), app.demo_p(p_seed, r.p),
            case when r.camp is not null then app.demo_id(p_seed, 'camp:' || r.camp) end,
            case when r.opp is not null then app.demo_id(p_seed, 'opp:' || r.opp) end,
            case when r.camp is null then app.demo_id(p_seed, 'fund:general') end,
            r.src::app.pledge_source, r.amount, now() - make_interval(days => r.ago), p_actor,
            case r.ref when 'c04' then 'In memory of Maniben Doshi' when 'd13' then 'For the family''s health and happiness' end);
  end loop;
  -- Labh pledges and their fulfillment
  insert into app.pledges (id, center_id, household_id, pledged_by_person_id, fund_id, source, source_ref_id, amount_cents, pledged_at, created_by, dedication) values
    (app.demo_id(p_seed, 'pledge:l01'), p_center, app.demo_h(p_seed, 'h01'), app.demo_p(p_seed, 'h01.priya'), app.demo_id(p_seed, 'fund:general'), 'labh',
     app.demo_id(p_seed, 'labh:ashtaprakari'), 10800, now() - interval '30 days', p_actor, 'For Anya''s birthday'),
    (app.demo_id(p_seed, 'pledge:l11'), p_center, app.demo_h(p_seed, 'h11'), app.demo_p(p_seed, 'h11.krupa'), app.demo_id(p_seed, 'fund:general'), 'labh',
     app.demo_id(p_seed, 'labh:snatra'), 5100, now() - interval '8 days', p_actor, 'On our anniversary');
  insert into app.labh_fulfillments (center_id, pledge_id, labh_option_id, occasion, status, note, updated_by) values
    (p_center, app.demo_id(p_seed, 'pledge:l01'), app.demo_id(p_seed, 'labh:ashtaprakari'), 'Anya''s birthday', 'scheduled', 'Sunday after the birthday, 9:00 AM', p_actor),
    (p_center, app.demo_id(p_seed, 'pledge:l11'), app.demo_id(p_seed, 'labh:snatra'), 'Anniversary', 'to_schedule', null, p_actor);

  -- A settled digital boli from Paryushan: every entry kept, the winning entry became a pledge.
  v_boli := app.demo_id(p_seed, 'boli:kalpasutra');
  insert into app.bolis (id, center_id, campaign_id, name, description, kind, floor_cents, step_cents, opens_at, closes_at, status, explainer_md, created_by, closed_reason)
  values (v_boli, p_center, app.demo_id(p_seed, 'camp:paryushan'), 'Kalpasutra vahorana', 'The labh of bringing the Kalpasutra to the Maharaj Saheb', 'digital',
          51000, 5000, now() - interval '62 days', now() - interval '57 days', 'draft', 'The family with the highest pledge takes the labh.', p_actor, null);
  insert into app.boli_entries (id, center_id, boli_id, household_id, person_id, amount_cents, entered_at) values
    (app.demo_id(p_seed, 'entry:k1'), p_center, v_boli, app.demo_h(p_seed, 'h01'), app.demo_p(p_seed, 'h01.priya'), 51000, now() - interval '61 days'),
    (app.demo_id(p_seed, 'entry:k2'), p_center, v_boli, app.demo_h(p_seed, 'h13'), app.demo_p(p_seed, 'h13.ramesh'), 101000, now() - interval '60 days'),
    (app.demo_id(p_seed, 'entry:k3'), p_center, v_boli, app.demo_h(p_seed, 'h01'), app.demo_p(p_seed, 'h01.rahul'), 111000, now() - interval '59 days'),
    (app.demo_id(p_seed, 'entry:k4'), p_center, v_boli, app.demo_h(p_seed, 'h06'), app.demo_p(p_seed, 'h06.sanjay'), 151000, now() - interval '58 days');
  pl := app.demo_id(p_seed, 'pledge:boli.k4');
  insert into app.pledges (id, center_id, household_id, pledged_by_person_id, campaign_id, source, source_ref_id, amount_cents, pledged_at, created_by)
  values (pl, p_center, app.demo_h(p_seed, 'h06'), app.demo_p(p_seed, 'h06.sanjay'), app.demo_id(p_seed, 'camp:paryushan'), 'boli', v_boli, 151000, now() - interval '57 days', p_actor);
  update app.boli_entries set pledge_id = pl where id = app.demo_id(p_seed, 'entry:k4');
  update app.bolis set status = 'settled', winner_entry_id = app.demo_id(p_seed, 'entry:k4'), winner_pledge_id = pl,
         closed_reason = 'Closed at the published time; highest pledge wins (demo)' where id = v_boli;

  -- Payments: historical, allocated by the existing rule (chosen pledge, or earliest open first)
  perform app.demo_pay(p_center, p_seed, p_actor, 'c01a', 'h01', 'h01.rahul', 150000, 'check', 350, array[app.demo_id(p_seed, 'pledge:c01')], '2217', 'Construction pledge');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c01b', 'h01', 'h01.rahul', 100000, 'check', 170, array[app.demo_id(p_seed, 'pledge:c01')], '2290', 'Construction pledge');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c02a', 'h02', 'h02.kiran', 250000, 'ach', 340, array[app.demo_id(p_seed, 'pledge:c02')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'c02b', 'h02', 'h02.kiran', 250000, 'ach', 250, array[app.demo_id(p_seed, 'pledge:c02')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'c02c', 'h02', 'h02.kiran', 250000, 'ach', 160, array[app.demo_id(p_seed, 'pledge:c02')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'c02d', 'h02', 'h02.kiran', 250000, 'ach', 70, array[app.demo_id(p_seed, 'pledge:c02')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'c06a', 'h06', 'h06.sanjay', 1000000, 'stock', 330, array[app.demo_id(p_seed, 'pledge:c06')], null, '40 shares, demo transfer');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c09a', 'h09', 'h09.rakesh', 500000, 'daf', 280, array[app.demo_id(p_seed, 'pledge:c09')], null, 'Grant from a donor-advised fund');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c13a', 'h13', 'h13.ramesh', 250000, 'check', 240, array[app.demo_id(p_seed, 'pledge:c13')], '1180');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c18a', 'h18', 'h18.prakash', 250000, 'check', 230, array[app.demo_id(p_seed, 'pledge:c18')], '5530');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c04a', 'h04', 'h04.hemant', 100000, 'check', 190, array[app.demo_id(p_seed, 'pledge:c04')], '0412');
  perform app.demo_pay(p_center, p_seed, p_actor, 'c08a', 'h08', 'h08.tejas', 400000, 'zelle', 140, array[app.demo_id(p_seed, 'pledge:c08')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a01', 'h01', 'h01.priya', 50000, 'zelle', 195, array[app.demo_id(p_seed, 'pledge:a01')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a03', 'h03', 'h03.sonal', 25100, 'zelle', 185, array[app.demo_id(p_seed, 'pledge:a03')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a05', 'h05', 'h05.nikhil', 10000, 'zelle', 170, array[app.demo_id(p_seed, 'pledge:a05')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a10', 'h10', 'h10.paresh', 10100, 'check', 165, array[app.demo_id(p_seed, 'pledge:a10')], '3301');
  perform app.demo_pay(p_center, p_seed, p_actor, 'a11', 'h11', 'h11.mitesh', 25000, 'ach', 150, array[app.demo_id(p_seed, 'pledge:a11')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a12', 'h12', 'h12.chirag', 5100, 'cash', 140, array[app.demo_id(p_seed, 'pledge:a12')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a14', 'h14', 'h14.ashok', 50100, 'daf', 130, array[app.demo_id(p_seed, 'pledge:a14')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a15', 'h15', 'h15.deepak', 20000, 'check', 120, array[app.demo_id(p_seed, 'pledge:a15')], '7781');
  perform app.demo_pay(p_center, p_seed, p_actor, 'a17', 'h17', 'h17.rekha', 15000, 'zelle', 110, array[app.demo_id(p_seed, 'pledge:a17')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'a19', 'h19', 'h19.anil', 25000, 'check', 100, array[app.demo_id(p_seed, 'pledge:a19')], '1009');
  perform app.demo_pay(p_center, p_seed, p_actor, 's02', 'h02', 'h02.kiran', 500000, 'check', 50, array[app.demo_id(p_seed, 'pledge:s02')], '5102');
  perform app.demo_pay(p_center, p_seed, p_actor, 's09', 'h09', 'h09.hetal', 500000, 'ach', 48, array[app.demo_id(p_seed, 'pledge:s09')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 's06', 'h06', 'h06.rupal', 100000, 'check', 45, array[app.demo_id(p_seed, 'pledge:s06')], '8840');
  perform app.demo_pay(p_center, p_seed, p_actor, 'boli', 'h06', 'h06.sanjay', 151000, 'check', 40, array[pl], '8851', 'Kalpasutra vahorana boli');
  perform app.demo_pay(p_center, p_seed, p_actor, 'l01', 'h01', 'h01.priya', 10800, 'zelle', 28, array[app.demo_id(p_seed, 'pledge:l01')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'b16', 'h16', 'h16.jignesh', 25100, 'cash', 18, array[app.demo_id(p_seed, 'pledge:b16')]);
  perform app.demo_pay(p_center, p_seed, p_actor, 'g25', 'h25', 'h25.rahul', 10100, 'check', 80, null, '2201');
  -- Yearly membership fees (six of eight paid; earliest open pledge first, which is the fee)
  for r in select * from (values ('h03', 'h03.amit', 'check', 320), ('h05', 'h05.mansi', 'zelle', 300), ('h10', 'h10.paresh', 'check', 290),
                                 ('h11', 'h11.mitesh', 'zelle', 280), ('h15', 'h15.deepak', 'check', 260), ('h17', 'h17.sunil', 'cash', 250)) x(h, p, m, ago)
  loop
    perform app.demo_pay(p_center, p_seed, p_actor, 'fee.' || r.h, r.h, r.p, 15100, r.m::app.payment_method,
                         greatest(0, least(r.ago, (app.demo_today(p_center) - make_date(yr, 1, 1)) - 1)), array[app.demo_id(p_seed, 'pledge:fee.' || r.h)]);
  end loop;

  -- Recurring gifts: set up in the app, waiting for online payment (never charged: owner decision 0026)
  insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency, method, next_charge_on, status, starts_on, end_kind, end_count) values
    (p_center, app.demo_h(p_seed, 'h05'), app.demo_p(p_seed, 'h05.nikhil'), null, app.demo_id(p_seed, 'fund:general'), 2100, 'monthly', 'card',
     (date_trunc('month', app.demo_today(p_center)) + interval '1 month')::date, 'pending_payment_method', app.demo_today(p_center) - 20, 'until_stopped', null),
    (p_center, app.demo_h(p_seed, 'h11'), app.demo_p(p_seed, 'h11.mitesh'), app.demo_id(p_seed, 'camp:construction'), null, 5100, 'monthly', 'ach',
     (date_trunc('month', app.demo_today(p_center)) + interval '1 month')::date, 'pending_payment_method', app.demo_today(p_center) - 45, 'count', 24),
    (p_center, app.demo_h(p_seed, 'h19'), app.demo_p(p_seed, 'h19.anil'), app.demo_id(p_seed, 'camp:construction'), null, 25000, 'quarterly', 'card',
     (date_trunc('quarter', app.demo_today(p_center)) + interval '3 months')::date, 'pending_payment_method', app.demo_today(p_center) - 60, 'until_stopped', null),
    (p_center, app.demo_h(p_seed, 'h01'), app.demo_p(p_seed, 'h01.priya'), null, app.demo_id(p_seed, 'fund:jeevdaya'), 2100, 'monthly', 'card',
     null, 'paused', app.demo_today(p_center) - 200, 'until_stopped', null);
  insert into app.recurring_gifts (center_id, household_id, person_id, fund_id, amount_cents, frequency, special_day_id, method, status, starts_on)
  select p_center, app.demo_h(p_seed, 'h17'), app.demo_p(p_seed, 'h17.sunil'), app.demo_id(p_seed, 'fund:bhojanshala'), 10800, 'special_day', d.id, 'card',
         'pending_payment_method', app.demo_today(p_center) - 10
    from app.special_days d where d.center_id = p_center and d.household_id = app.demo_h(p_seed, 'h17') limit 1;

  -- Bank lines waiting to be matched (Giving › Bank)
  insert into app.bank_transactions (center_id, bank_account_id, posted_on, amount_cents, description, channel, payer_name, bank_type, bank_details)
  select p_center, app.demo_id(p_seed, 'bank:operating'), app.demo_today(p_center) - x.ago, x.amt, x.descr, x.ch, x.payer, x.bt, 'CREDIT'
    from (values (2, 15100, 'Zelle payment from PRIYA S SHAH ref DEMO01', 'zelle', 'PRIYA S SHAH', 'QUICKPAY_CREDIT'),
                 (2, 5000, 'Zelle payment from SONAL A JAIN ref DEMO02', 'zelle', 'SONAL A JAIN', 'QUICKPAY_CREDIT'),
                 (1, 25000, 'ORIG CO NAME:DEMO CHARITABLE GRANT', 'ach', 'DEMO CHARITABLE', 'ACH_CREDIT'),
                 (1, 30200, 'REMOTE ONLINE DEPOSIT 2 CHECKS', 'check', null, 'CHECK_DEPOSIT')) x(ago, amt, descr, ch, payer, bt);
end $$;

-- ── Step 5 · events, RSVPs, tickets, check-ins, lunch, volunteers ────────────
create or replace function app.demo_community_events(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s text := app.demo_short(p_center); e_mj uuid := app.demo_id(p_seed, 'ev:mahavir'); e_py uuid := app.demo_id(p_seed, 'ev:paryushan');
        e_tb uuid := app.demo_id(p_seed, 'ev:tapasvi'); e_dw uuid := app.demo_id(p_seed, 'ev:diwali'); e_yp uuid := app.demo_id(p_seed, 'ev:picnic');
        r record; hm record; v_rsvp uuid; i int := 0; v_att uuid; a record;
begin
  insert into app.events (id, center_id, template_id, name, description, venue, starts_at, ends_at, program_year, capacity, audience,
                          rsvp_opens_at, rsvp_closes_at, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot,
                          owner_person_id, status, created_by, waitlist_enabled) values
    (e_mj, p_center, null, 'Mahavir Janma Kalyanak', 'Snatra puja, a talk for families and lunch.', 'Main hall',
     app.demo_at(p_center, -150, '10:00'), app.demo_at(p_center, -150, '14:00'), null, 300, 'members_and_guests',
     app.demo_at(p_center, -180, '09:00'), app.demo_at(p_center, -151, '20:00'), true, app.demo_at(p_center, -150, '12:30'), 15, 20,
     app.demo_p(p_seed, 'h13.ramesh'), 'completed', p_actor, false),
    (e_py, p_center, null, 'Paryushan · Samvatsari pratikraman', 'Samvatsari pratikraman together; michchhami dukkadam.', 'Main hall',
     app.demo_at(p_center, -34, '18:00'), app.demo_at(p_center, -34, '21:30'), null, 400, 'members_and_guests',
     app.demo_at(p_center, -60, '09:00'), app.demo_at(p_center, -35, '20:00'), false, null, 15, null,
     app.demo_p(p_seed, 'h13.ramesh'), 'completed', p_actor, false),
    (e_tb, p_center, app.demo_id(p_seed, 'tpl:tapasvi'), 'Tapasvi Bahuman & Swamivatsalya', 'Honoring this year''s tapasvis, followed by swamivatsalya.', 'Main hall',
     app.demo_at(p_center, 9, '10:00'), app.demo_at(p_center, 9, '14:00'), null, 350, 'members_and_guests',
     app.demo_at(p_center, -14, '09:00'), app.demo_at(p_center, 8, '20:00'), true, app.demo_at(p_center, 9, '12:00'), 15, 40,
     app.demo_p(p_seed, 'h02.kiran'), 'published', p_actor, true),
    (e_dw, p_center, null, 'Diwali puja & new year', 'Diwali puja at the derasar, then the new year''s darshan and aarti.', 'Derasar',
     app.demo_at(p_center, 40, '18:00'), app.demo_at(p_center, 40, '21:00'), null, null, 'public',
     app.demo_at(p_center, -5, '09:00'), app.demo_at(p_center, 39, '20:00'), false, null, 15, null,
     app.demo_p(p_seed, 'h13.ramesh'), 'published', p_actor, false),
    (e_yp, p_center, null, 'Youth picnic', 'A picnic for the youth group (being planned).', 'Lakeview park',
     app.demo_at(p_center, 60, '11:00'), app.demo_at(p_center, 60, '16:00'), null, 60, 'members_only',
     null, null, false, null, 15, null, app.demo_p(p_seed, 'h09.hetal'), 'draft', p_actor, false);
  update app.opportunities set event_id = e_dw where center_id = p_center and campaign_id = app.demo_id(p_seed, 'camp:diwali');
  update app.opportunities set event_id = e_py where center_id = p_center and campaign_id = app.demo_id(p_seed, 'camp:paryushan');
  update app.bolis set event_id = e_py where id = app.demo_id(p_seed, 'boli:kalpasutra');
  -- The event checklist from its template
  insert into app.actions (center_id, event_id, phase, template_item_id, name, owner_person_id, due_on, priority, state, created_by)
  select p_center, e_tb, i.phase, i.id, i.name, case when i.sort_order <= 3 then app.demo_p(p_seed, 'h02.kiran') end,
         case when i.offset_days is not null then app.demo_today(p_center) + 9 + i.offset_days end, i.priority,
         (case when i.sort_order = 1 then 'completed' when i.sort_order = 2 then 'in_progress' else 'not_started' end)::app.action_state, p_actor
    from app.event_template_items i where i.template_id = app.demo_id(p_seed, 'tpl:tapasvi');
  -- A live boli for the upcoming event, and an in-person one being prepared
  insert into app.bolis (id, center_id, event_id, campaign_id, name, kind, floor_cents, step_cents, opens_at, closes_at, status, explainer_md, created_by) values
    (app.demo_id(p_seed, 'boli:swamivatsalya'), p_center, e_tb, app.demo_id(p_seed, 'camp:bhojan'), 'Swamivatsalya labh', 'digital', 50100, 2100,
     now() - interval '2 days', app.demo_at(p_center, 8, '20:00'), 'open', 'The family that takes this labh hosts the community meal after the Tapasvi Bahuman.', p_actor),
    (app.demo_id(p_seed, 'boli:kalash'), p_center, e_tb, app.demo_id(p_seed, 'camp:bhojan'), 'Snatra puja kalash', 'in_person', 25100, 1100,
     null, null, 'draft', 'Called live in the hall at about 11:30 AM.', p_actor);
  insert into app.boli_entries (center_id, boli_id, household_id, person_id, amount_cents, entered_at) values
    (p_center, app.demo_id(p_seed, 'boli:swamivatsalya'), app.demo_h(p_seed, 'h13'), app.demo_p(p_seed, 'h13.ramesh'), 50100, now() - interval '40 hours'),
    (p_center, app.demo_id(p_seed, 'boli:swamivatsalya'), app.demo_h(p_seed, 'h02'), app.demo_p(p_seed, 'h02.kiran'), 52200, now() - interval '30 hours'),
    (p_center, app.demo_id(p_seed, 'boli:swamivatsalya'), app.demo_h(p_seed, 'h09'), app.demo_p(p_seed, 'h09.rakesh'), 60600, now() - interval '6 hours');

  -- RSVPs with a ticket per person: past events (checked in) and the Tapasvi Bahuman (upcoming)
  for r in select * from (values
      (e_mj, 'h01', 'attended'), (e_mj, 'h02', 'attended'), (e_mj, 'h03', 'attended'), (e_mj, 'h05', 'attended'), (e_mj, 'h06', 'attended'),
      (e_mj, 'h08', 'attended'), (e_mj, 'h11', 'attended'), (e_mj, 'h13', 'attended'), (e_mj, 'h15', 'no_show'), (e_mj, 'h19', 'attended'),
      (e_py, 'h01', 'attended'), (e_py, 'h02', 'attended'), (e_py, 'h04', 'attended'), (e_py, 'h06', 'attended'), (e_py, 'h09', 'attended'),
      (e_py, 'h13', 'attended'), (e_py, 'h17', 'attended'), (e_py, 'h18', 'attended'), (e_py, 'h21', 'no_show'),
      (e_tb, 'h01', 'confirmed'), (e_tb, 'h02', 'confirmed'), (e_tb, 'h03', 'rsvpd'), (e_tb, 'h04', 'rsvpd'), (e_tb, 'h05', 'rsvpd'),
      (e_tb, 'h06', 'confirmed'), (e_tb, 'h08', 'rsvpd'), (e_tb, 'h09', 'confirmed'), (e_tb, 'h11', 'rsvpd'), (e_tb, 'h13', 'confirmed'),
      (e_tb, 'h15', 'rsvpd'), (e_tb, 'h17', 'rsvpd'), (e_tb, 'h19', 'cancelled'),
      (e_dw, 'h01', 'rsvpd'), (e_dw, 'h07', 'rsvpd'), (e_dw, 'h12', 'rsvpd'), (e_dw, 'h16', 'rsvpd')
    ) x(ev, h, st)
  loop
    i := i + 1;
    v_rsvp := app.demo_id(p_seed, 'rsvp:' || r.ev || r.h);
    insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source, commitment_mode, confirmed_at, cancelled_at)
    select v_rsvp, p_center, r.ev, app.demo_h(p_seed, r.h), hmm.person_id,
           (case r.st when 'attended' then 'confirmed' when 'no_show' then 'confirmed' else r.st end)::app.rsvp_status,
           case when i % 4 = 0 then 'admin' else 'app' end, 'none',
           case when r.st in ('confirmed','attended','no_show') then now() - interval '1 day' end,
           case when r.st = 'cancelled' then now() - interval '3 days' end
      from app.household_members hmm where hmm.household_id = app.demo_h(p_seed, r.h) and hmm.is_primary;
    for hm in
      select p.id, p.first_name || ' ' || p.last_name as name, p.date_of_birth
        from app.household_members m join app.people p on p.id = m.person_id
       where m.household_id = app.demo_h(p_seed, r.h) order by m.is_primary desc, p.date_of_birth
    loop
      insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, is_senior, status, ticket_revoked,
                                 checked_in_at, checked_in_station)
      values (p_center, r.ev, v_rsvp, hm.id, hm.name, hm.date_of_birth > app.demo_today(p_center) - interval '12 years',
              hm.date_of_birth < app.demo_today(p_center) - interval '65 years',
              (case r.st when 'attended' then 'attended' when 'no_show' then 'no_show' when 'cancelled' then 'cancelled' else r.st end)::app.rsvp_status,
              r.st = 'cancelled',
              case when r.st = 'attended' then (select starts_at from app.events where id = r.ev) - interval '20 minutes' + make_interval(mins => i) end,
              case when r.st = 'attended' then 'entry' end)
      returning id into v_att;
      if r.st = 'attended' then
        insert into app.scan_log (center_id, event_id, attendee_id, token, station, result, device_id, scanned_at, matched_via)
        select p_center, r.ev, v_att, a2.ticket_token, 'entry', 'ok', 'demo-kiosk-1', a2.checked_in_at, 'ticket'
          from app.attendees a2 where a2.id = v_att;
      end if;
    end loop;
    -- Lunch seats for the families who came, by the lunch rule
    if r.ev = e_mj and r.st = 'attended' and app.module_enabled(p_center, 'events') then
      perform app.assign_lunch_for_rsvp(v_rsvp);
    end if;
  end loop;
  -- A walk-in guest at Mahavir Janma Kalyanak
  insert into app.rsvps (id, center_id, event_id, guest_name, guest_phone_e164, status, source, confirmed_at)
  values (app.demo_id(p_seed, 'rsvp:guest'), p_center, e_mj, 'Visiting family (Patel)', '+12145550199', 'confirmed', 'walk_in', app.demo_at(p_center, -150, '10:05'));
  insert into app.attendees (center_id, event_id, rsvp_id, display_name, status, checked_in_at, checked_in_station)
  values (p_center, e_mj, app.demo_id(p_seed, 'rsvp:guest'), 'Visiting family (Patel) · 3 people', 'attended', app.demo_at(p_center, -150, '10:05'), 'entry');
  -- Lunch was served; the 5-minute reminders of a past event were never sent.
  update app.attendees set served_food_at = (select s2.starts_at from app.lunch_slots s2 where s2.id = lunch_slot_id) + interval '3 minutes'
   where center_id = p_center and event_id = e_mj and lunch_slot_id is not null;
  update app.lunch_slots set status = 'done', served = assigned where center_id = p_center and event_id = e_mj;
  update app.messages set status = 'cancelled', failure_reason = 'Demo data: a past event''s reminder, never sent', sandbox = true
   where center_id = p_center and template_key = 'lunch_reminder' and status = 'queued' and payload->>'event_id' = e_mj::text;
  -- Volunteer shifts
  insert into app.volunteer_shifts (id, center_id, event_id, station, starts_at, ends_at, capacity, notes) values
    (app.demo_id(p_seed, 'shift:tb_entry'), p_center, e_tb, 'entry', app.demo_at(p_center, 9, '09:00'), app.demo_at(p_center, 9, '12:00'), 6, 'Scan tickets at the door'),
    (app.demo_id(p_seed, 'shift:tb_food'), p_center, e_tb, 'food', app.demo_at(p_center, 9, '11:30'), app.demo_at(p_center, 9, '14:00'), 8, null),
    (app.demo_id(p_seed, 'shift:tb_parking'), p_center, e_tb, 'parking', app.demo_at(p_center, 9, '09:00'), app.demo_at(p_center, 9, '11:00'), 4, null),
    (app.demo_id(p_seed, 'shift:mj_entry'), p_center, e_mj, 'entry', app.demo_at(p_center, -150, '09:00'), app.demo_at(p_center, -150, '12:00'), 4, null);
  insert into app.volunteer_assignments (center_id, shift_id, person_id, status)
  select p_center, app.demo_id(p_seed, 'shift:' || x.sh), app.demo_p(p_seed, x.p), x.st
    from (values ('tb_entry', 'h02.arjun', 'confirmed'), ('tb_entry', 'h13.karan', 'assigned'), ('tb_entry', 'h17.avni', 'confirmed'),
                 ('tb_food', 'h06.rupal', 'confirmed'), ('tb_food', 'h11.krupa', 'assigned'), ('tb_food', 'h15.falguni', 'assigned'),
                 ('tb_parking', 'h21.rohan', 'assigned'), ('mj_entry', 'h02.arjun', 'completed'), ('mj_entry', 'h09.jay', 'completed'),
                 ('mj_entry', 'h13.karan', 'no_show')) x(sh, p, st);
  -- The store's event-day pickup
  insert into app.pickup_windows (id, center_id, event_id, starts_at, ends_at, order_cutoff_at, capacity, location, status)
  values (app.demo_id(p_seed, 'pickup:event'), p_center, e_tb, app.demo_at(p_center, 9, '13:00'), app.demo_at(p_center, 9, '14:30'),
          app.demo_at(p_center, 7, '20:00'), 60, 'Kitchen window', 'open');
  -- The calendar
  insert into app.calendar_entries (center_id, layer_id, title, starts_on, all_day, starts_at, ends_at, event_id)
  select p_center, app.demo_id(p_seed, 'layer:events'), e.name, (e.starts_at at time zone c.time_zone)::date, false, e.starts_at, e.ends_at, e.id
    from app.events e join app.centers c on c.id = e.center_id where e.center_id = p_center and e.status in ('published','completed');
  insert into app.calendar_entries (center_id, layer_id, title, starts_on, all_day) values
    (p_center, app.demo_id(p_seed, 'layer:pathshala'), 'No Pathshala · long weekend', app.demo_sunday(p_center, -2), true),
    (p_center, app.demo_id(p_seed, 'layer:pathshala'), 'Pathshala mid-term progress reports', app.demo_sunday(p_center, 1), true),
    (p_center, app.demo_id(p_seed, 'layer:pathshala'), 'Pathshala annual day', app.demo_sunday(p_center, -20), true);
  -- An event photo album (a link; photos are uploaded by staff)
  insert into app.photo_albums (center_id, event_id, title, external_url, visibility, created_by)
  values (p_center, e_mj, 'Mahavir Janma Kalyanak · photos', 'https://photos.example.com/demo-album', 'members', p_actor);
end $$;

-- ── Step 6 · store orders ────────────────────────────────────────────────────
create or replace function app.demo_community_store(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_o uuid; l text; f text[];
begin
  -- (ref, household, person, window, final status, lines "sku:qty[:gift]")
  for r in select * from (values
      ('o01', 'h01', 'h01.priya',  'past',  'picked_up', '101:2;201:1'),
      ('o02', 'h02', 'h02.neha',   'past',  'picked_up', '102:1;301:4'),
      ('o03', 'h06', 'h06.rupal',  'past',  'picked_up', '101:1;102:2:gift'),
      ('o04', 'h09', 'h09.hetal',  'past',  'picked_up', '203:2;202:1'),
      ('o05', 'h13', 'h13.usha',   'past',  'picked_up', '302:3'),
      ('o06', 'h15', 'h15.falguni','past',  'cancelled', '101:1'),
      ('o07', 'h03', 'h03.sonal',  'next',  'ready',     '201:2;203:1'),
      ('o08', 'h05', 'h05.mansi',  'next',  'preparing', '301:2;302:2'),
      ('o09', 'h11', 'h11.krupa',  'next',  'placed',    '102:1:gift;103:2'),
      ('o10', 'h17', 'h17.rekha',  'event', 'placed',    '101:1;102:1;201:1'),
      ('o11', 'h19', 'h19.ritu',   'event', 'placed',    '302:4')
    ) x(ref, h, p, win, st, lines)
  loop
    v_o := app.demo_id(p_seed, 'order:' || r.ref);
    insert into app.store_orders (id, center_id, household_id, person_id, pickup_window_id, status, notes)
    values (v_o, p_center, app.demo_h(p_seed, r.h), app.demo_p(p_seed, r.p), app.demo_id(p_seed, 'pickup:' || r.win), 'cart', null);
    foreach l in array string_to_array(r.lines, ';') loop
      f := string_to_array(l, ':');
      insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents, is_gift)
      select p_center, v_o, i.id, f[2]::int, i.price_cents, coalesce(f[3], '') = 'gift' from app.store_items i where i.id = app.demo_id(p_seed, 'item:' || f[1]);
    end loop;
    -- Leaving the cart: the database prices the order, counts the pickup and takes the stock.
    update app.store_orders set status = 'placed',
           placed_at = case r.win when 'past' then app.demo_at(p_center, -16, '19:00') else now() - interval '1 day' end
     where id = v_o;
    if r.st in ('preparing','ready','picked_up') then update app.store_orders set status = 'preparing' where id = v_o; end if;
    if r.st in ('ready','picked_up') then update app.store_orders set status = 'ready', ready_at = coalesce(ready_at, now() - interval '2 hours') where id = v_o; end if;
    if r.st = 'picked_up' then
      update app.store_orders set status = 'picked_up', ready_at = app.demo_at(p_center, -13, '10:45'), picked_up_at = app.demo_at(p_center, -13, '11:30'),
             picked_up_by = p_actor where id = v_o;
    end if;
    if r.st = 'cancelled' then update app.store_orders set status = 'cancelled', notes = 'Family travelling (demo)' where id = v_o; end if;
  end loop;
  update app.pickup_windows set status = 'fulfilled' where id = app.demo_id(p_seed, 'pickup:past');
  -- A guest order at the counter
  v_o := app.demo_id(p_seed, 'order:guest');
  insert into app.store_orders (id, center_id, guest_name, guest_phone_e164, pickup_window_id, status)
  values (v_o, p_center, 'Guest (demo)', '+14695550198', app.demo_id(p_seed, 'pickup:next'), 'cart');
  insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents)
  values (p_center, v_o, app.demo_id(p_seed, 'item:203'), 3, 499);
  update app.store_orders set status = 'placed' where id = v_o;
end $$;

-- ── Step 7 · Pathshala: enrollments, fees, attendance, progress ──────────────
create or replace function app.demo_community_pathshala(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_term uuid := app.demo_id(p_seed, 'term:current'); r record; v_en uuid; v_fee uuid; w int; c text; e record; v_sess uuid;
        n int := 0; v_first boolean; v_prev text := '';
begin
  for r in select * from (values
      ('h03', 'h03.vihaan', 'j1', 'active'), ('h05', 'h05.kiara', 'j1', 'active'), ('h11', 'h11.reyansh', 'j1', 'active'),
      ('h01', 'h01.anya', 'j2', 'active'), ('h05', 'h05.aarav', 'j2', 'active'), ('h08', 'h08.nisha', 'j2', 'active'),
      ('h11', 'h11.aanya', 'j2', 'active'), ('h16', 'h16.om', 'j2', 'active'), ('h19', 'h19.siya', 'j2', 'active'),
      ('h01', 'h01.dev', 'j3', 'active'), ('h03', 'h03.riya', 'j3', 'active'), ('h06', 'h06.pranav', 'j3', 'active'),
      ('h09', 'h09.diya', 'j3', 'active'), ('h15', 'h15.tara', 'j3', 'active'), ('h19', 'h19.neel', 'j3', 'active'),
      ('h23', 'h23.mahi', null, 'requested'),
      ('h06', 'h06.isha', 'g1', 'active'), ('h15', 'h15.ved', 'g1', 'active'), ('h09', 'h09.jay', 'g1', 'active')
    ) x(h, p, cls, st) order by 1, 2
  loop
    v_en := app.demo_id(p_seed, 'enroll:' || r.p);
    v_fee := null;
    v_first := r.h <> v_prev;
    v_prev := r.h;
    if r.st = 'active' and app.module_enabled(p_center, 'giving') then
      -- The fee per child is billed as a pledge; the second child gets the sibling discount.
      v_fee := app.demo_id(p_seed, 'pledge:pfee.' || r.p);
      insert into app.pledges (id, center_id, household_id, pledged_by_person_id, campaign_id, fund_id, source, source_ref_id, amount_cents, pledged_at, due_on, created_by)
      select v_fee, p_center, app.demo_h(p_seed, r.h), hm.person_id, app.demo_id(p_seed, 'camp:pathshala'), app.demo_id(p_seed, 'fund:pathshala'),
             'pathshala_fee', v_en, case when v_first then 15000 else 13500 end, now() - interval '70 days', app.demo_sunday(p_center, 2), p_actor
        from app.household_members hm where hm.household_id = app.demo_h(p_seed, r.h) and hm.is_primary;
    end if;
    insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, class_id, status, fee_pledge_id,
                                           registered_by, registered_at, placed_at, notes)
    values (v_en, p_center, v_term, app.demo_p(p_seed, r.p), app.demo_h(p_seed, r.h),
            app.demo_id(p_seed, 'level:' || case coalesce(r.cls, 'j3') when 'g1' then 'gujarati1' else 'jainism' || substr(coalesce(r.cls, 'j3'), 2) end),
            case when r.cls is not null then app.demo_id(p_seed, 'class:' || r.cls) end, r.st, v_fee, p_actor, now() - interval '70 days',
            case when r.st = 'active' then now() - interval '50 days' end,
            case when r.st = 'requested' then 'Waiting for the family''s membership (demo)' end);
  end loop;
  -- Most families paid the fees (one payment each, for their children's fee pledges).
  for r in select * from (values ('h01', 'h01.priya', 'zelle'), ('h03', 'h03.sonal', 'check'), ('h05', 'h05.mansi', 'zelle'), ('h06', 'h06.rupal', 'check'),
                                 ('h08', 'h08.pooja', 'check'), ('h09', 'h09.hetal', 'ach'), ('h11', 'h11.krupa', 'zelle'), ('h15', 'h15.falguni', 'check')) y(h, p, m)
            where app.module_enabled(p_center, 'giving')
  loop
    perform app.demo_pay(p_center, p_seed, p_actor, 'pfee.' || r.h, r.h, r.p,
                         (select sum(pl.amount_cents) from app.pledges pl where pl.center_id = p_center and pl.household_id = app.demo_h(p_seed, r.h) and pl.source = 'pathshala_fee')::bigint,
                         r.m::app.payment_method, 60,
                         (select array_agg(pl.id order by pl.pledge_number) from app.pledges pl where pl.center_id = p_center and pl.household_id = app.demo_h(p_seed, r.h) and pl.source = 'pathshala_fee'),
                         null, 'Pathshala fees');
  end loop;
  -- The last five Sundays of class, with attendance
  foreach c in array array['j1','j2','j3','g1'] loop
    for w in 0 .. 4 loop
      v_sess := app.demo_id(p_seed, 'session:' || c || w);
      insert into app.pathshala_sessions (id, center_id, class_id, held_on, topic, opened_by)
      values (v_sess, p_center, app.demo_id(p_seed, 'class:' || c), app.demo_sunday(p_center, w + case when extract(dow from app.demo_today(p_center)) = 0 then 1 else 0 end),
              (array['Navkar Mantra: meaning', 'The 24 Tirthankars', 'Stories of Mahavir', 'Ahimsa at home', 'Review and games'])[w + 1], p_actor);
      for e in select en.id from app.pathshala_enrollments en join app.people sp on sp.id = en.student_person_id
                where en.class_id = app.demo_id(p_seed, 'class:' || c) and en.status = 'active' order by sp.first_name, sp.last_name loop
        n := n + 1;
        insert into app.pathshala_attendance (center_id, session_id, enrollment_id, status, marked_by, marked_via, marked_at)
        values (p_center, v_sess, e.id, case when n % 11 = 0 then 'absent' when n % 7 = 0 then 'late' when n % 17 = 0 then 'excused' else 'present' end,
                p_actor, case when n % 3 = 0 then 'qr' else 'teacher' end, now() - make_interval(days => 7 * w + 1));
      end loop;
    end loop;
  end loop;
  -- Mid-term progress reports for Jainism 3 (published) and Jainism 2 (drafts)
  insert into app.pathshala_progress_reports (center_id, enrollment_id, term_id, period, attendance_present, attendance_total, attendance_late,
                                              teacher_comments, gyan_path_summary, recommended_next_level_id, published_at, authored_by)
  select p_center, en.id, v_term, 'Mid-term',
         (select count(*) from app.pathshala_attendance a where a.enrollment_id = en.id and a.status in ('present','late')),
         (select count(*) from app.pathshala_attendance a where a.enrollment_id = en.id),
         (select count(*) from app.pathshala_attendance a where a.enrollment_id = en.id and a.status = 'late'),
         'Participates well and is learning the sutras steadily. (Demo report.)', '{"levels_completed":1}'::jsonb,
         case when en.class_id = app.demo_id(p_seed, 'class:j3') then app.demo_id(p_seed, 'level:jainism4') end,
         case when en.class_id = app.demo_id(p_seed, 'class:j3') then now() - interval '2 days' end, p_actor
    from app.pathshala_enrollments en where en.center_id = p_center and en.status = 'active'
     and en.class_id in (app.demo_id(p_seed, 'class:j3'), app.demo_id(p_seed, 'class:j2'));
  insert into app.class_announcements (center_id, class_id, term_id, title, body_md, author_user, published_at) values
    (p_center, null, v_term, 'Welcome to the new Pathshala term', 'Classes are on Sundays at 10:00 AM. Please bring a notebook. (Demo.)', p_actor, now() - interval '45 days'),
    (p_center, app.demo_id(p_seed, 'class:j2'), v_term, 'Jainism 2: story week', 'This Sunday we act out the story of Chandanbala. Costumes welcome! (Demo.)', p_actor, now() - interval '5 days'),
    (p_center, app.demo_id(p_seed, 'class:j3'), v_term, 'Jainism 3: progress reports', 'Mid-term reports are published in the app. (Demo.)', p_actor, now() - interval '2 days');
  insert into app.teacher_applications (center_id, position_id, person_id, name, email, qualifications, motivation, outcome, submitted_at) values
    (p_center, app.demo_id(p_seed, 'position:j2'), app.demo_p(p_seed, 'h12.khushi'), 'Khushi Modi', 'khushi.modi@' || app.demo_email_domain(),
     'Taught Sunday school for three years', 'I loved Pathshala as a child.', 'pending', now() - interval '4 days'),
    (p_center, app.demo_id(p_seed, 'position:j2'), app.demo_p(p_seed, 'h22.hitesh'), 'Hitesh Oswal', 'hitesh.oswal@' || app.demo_email_domain(),
     'Middle-school teacher', 'I would like to give back to the community.', 'pending', now() - interval '2 days');
end $$;

-- ── Step 8 · Gyan Path and My Jain Way ───────────────────────────────────────
create or replace function app.demo_community_learning(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; d int; pr record; v_person uuid; v_sel int; v_done int; v_bonus int;
        v_cur int; v_long int; v_last date; v_n int := 0; st record;
begin
  -- Gyan Path: steps completed (points follow from the step trigger), sign-offs
  for r in select * from (values ('h01.anya', 7), ('h01.dev', 9), ('h03.riya', 9), ('h05.aarav', 4), ('h06.pranav', 6), ('h09.diya', 5),
                                 ('h11.aanya', 3), ('h15.tara', 8), ('h19.neel', 2), ('h01.priya', 3)) x(p, steps)
  loop
    insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at)
    select p_center, app.demo_p(p_seed, r.p), s.id, 1 + (abs(hashtext(r.p || s.title)) % 3), now() - make_interval(days => (30 - s.rn * 3)::int)
      from (select st2.id, st2.title, row_number() over (order by l.sort_order, st2.sort_order) as rn
              from app.gyan_steps st2 join app.gyan_levels l on l.id = st2.level_id where l.goal_id = app.demo_id(p_seed, 'gyan:goal')) s
     where s.rn <= r.steps;
  end loop;
  insert into app.gyan_signoffs (center_id, person_id, level_id, status, teacher_user, note, requested_at, decided_at) values
    (p_center, app.demo_p(p_seed, 'h01.dev'), app.demo_id(p_seed, 'gyan:level3'), 'requested', null, null, now() - interval '1 day', null),
    (p_center, app.demo_p(p_seed, 'h03.riya'), app.demo_id(p_seed, 'gyan:level3'), 'requested', null, null, now() - interval '3 days', null),
    (p_center, app.demo_p(p_seed, 'h15.tara'), app.demo_id(p_seed, 'gyan:level3'), 'requested', null, null, now() - interval '5 days', null);
  -- One approved by the teacher (the approval awards the level's points)
  update app.gyan_signoffs set status = 'approved', teacher_user = p_actor, note = 'Recited all five verses clearly (demo).', decided_at = now() - interval '2 days'
   where center_id = p_center and person_id = app.demo_p(p_seed, 'h15.tara');

  -- My Jain Way: choices, two weeks of logs, points and streaks (the rule of app.log_practice)
  for r in select * from (values ('h01.priya', 'demo_navkar,demo_darshan,demo_navkarsi,demo_swadhyay', 90), ('h01.anya', 'demo_navkar,demo_darshan', 70),
                                 ('h02.neha', 'demo_navkar,demo_samayik,demo_chauvihar', 95), ('h04.kusum', 'demo_navkar,demo_darshan,demo_samayik,demo_chauvihar', 100),
                                 ('h04.hemant', 'demo_navkar,demo_samayik', 80), ('h09.hetal', 'demo_navkar,demo_navkarsi', 60),
                                 ('h13.usha', 'demo_navkar,demo_darshan,demo_chauvihar', 85), ('h17.rekha', 'demo_navkar,demo_swadhyay', 75),
                                 ('h03.riya', 'demo_navkar,demo_swadhyay', 65), ('h08.sarla', 'demo_navkar,demo_darshan,demo_samayik', 90)) x(p, keys, pct)
  loop
    v_person := app.demo_p(p_seed, r.p);
    insert into app.practice_selections (center_id, person_id, practice_id, selected_at)
    select p_center, v_person, app.demo_id(p_seed, 'practice:' || k), now() - interval '20 days' from unnest(string_to_array(r.keys, ',')) k;
    insert into app.saathi_settings (center_id, person_id, opted_in, share_with_family) values (p_center, v_person, true, true);
    insert into app.streaks (center_id, person_id) values (p_center, v_person);
    v_sel := cardinality(string_to_array(r.keys, ','));
    v_cur := 0; v_long := 0; v_last := null;
    for d in reverse 13 .. 0 loop
      v_done := 0;
      for pr in select pp.id, pp.points, k as key from unnest(string_to_array(r.keys, ',')) k join app.practices pp on pp.id = app.demo_id(p_seed, 'practice:' || k) loop
        v_n := v_n + 1;
        continue when (abs(hashtext(r.p || pr.key || d)) % 100) >= r.pct;
        insert into app.practice_logs (center_id, person_id, practice_id, logged_on, created_at)
        values (p_center, v_person, pr.id, app.demo_today(p_center) - d, now() - make_interval(days => d));
        insert into app.points_ledger (center_id, person_id, points, reason, ref_id, occurred_at)
        values (p_center, v_person, pr.points, 'practice', pr.id, now() - make_interval(days => d));
        v_done := v_done + 1;
      end loop;
      if v_done >= v_sel then
        v_bonus := coalesce((select (rules->'points'->>'day_complete_bonus')::int from app.centers where id = p_center), 20);
        insert into app.points_ledger (center_id, person_id, points, reason, note, occurred_at)
        values (p_center, v_person, v_bonus, 'practice', 'day complete bonus: ' || (app.demo_today(p_center) - d), now() - make_interval(days => d));
        v_cur := case when v_last = app.demo_today(p_center) - d - 1 then v_cur + 1 else 1 end;
        v_long := greatest(v_long, v_cur);
        v_last := app.demo_today(p_center) - d;
      end if;
    end loop;
    update app.streaks set current_days = case when v_last >= app.demo_today(p_center) - 1 then v_cur else 0 end, longest_days = v_long, last_logged_on = v_last
     where center_id = p_center and person_id = v_person;
  end loop;
  -- Anumodana between saathis (points to both, as app.send_anumodana does)
  for r in select * from (values ('h01.priya', 'h04.kusum', 'celebrate', 'Anumodana on your samayik streak!'), ('h04.kusum', 'h01.anya', 'celebrate', 'So proud of you, beta'),
                                 ('h02.neha', 'h17.rekha', 'support', 'You can do it, keep going'), ('h13.usha', 'h08.sarla', 'celebrate', 'Anumodana!'),
                                 ('h09.hetal', 'h01.priya', 'celebrate', 'Great navkarsi week'), ('h17.rekha', 'h03.riya', 'celebrate', 'Well done on Gyan Path')) x(f, t, k, msg)
  loop
    insert into app.anumodana (center_id, from_person_id, to_person_id, kind, message, created_at)
    values (p_center, app.demo_p(p_seed, r.f), app.demo_p(p_seed, r.t), r.k, r.msg, now() - interval '3 days');
    insert into app.points_ledger (center_id, person_id, points, reason, note) values
      (p_center, app.demo_p(p_seed, r.f), case r.k when 'support' then 3 else 5 end, 'anumodana_sent', 'to a saathi'),
      (p_center, app.demo_p(p_seed, r.t), case r.k when 'support' then 3 else 5 end, 'anumodana_received', 'from a saathi');
  end loop;
  -- Timings for the next two weeks, and the parva days (demo values; a panchang source replaces them)
  insert into app.daily_timings (center_id, on_date, sunrise, sunset, navkarsi, chauvihar, aarti, temple_open, temple_close)
  select p_center, app.demo_today(p_center) + g.n, time '07:10' + make_interval(mins => g.n), time '19:05' - make_interval(mins => g.n),
         time '07:58' + make_interval(mins => g.n), time '19:05' - make_interval(mins => g.n), '19:30', '07:30', '19:00'
    from generate_series(-1, 14) g(n)
  on conflict (center_id, on_date) do nothing;
  insert into app.tithi_days (center_id, tradition, gregorian, tithi, month_name, paksha, is_parva, notes)
  select p_center, (select tradition from app.centers where id = p_center), app.demo_today(p_center) + x.dd, x.tithi, x.month, x.paksha, x.parva, 'Demo tithi'
    from (values (0, 'Sud 5', 'Aso', 'sud', false), (3, 'Sud 8', 'Aso', 'sud', true), (6, 'Sud 11', 'Aso', 'sud', false),
                 (10, 'Sud 14', 'Aso', 'sud', true), (11, 'Sud 15', 'Aso', 'sud', true), (18, 'Vad 8', 'Aso', 'vad', true)) x(dd, tithi, month, paksha, parva)
  on conflict do nothing;
end $$;

-- ── Step 9 · communications, surveys, volunteers, governance, content ───────
create or replace function app.demo_community_community(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s text := app.demo_short(p_center); v_news uuid := app.demo_id(p_seed, 'comms:newsletter'); v_ann uuid := app.demo_id(p_seed, 'comms:announce');
        r record; v_t uuid; v_survey uuid; m text; i int := 0;
begin
  -- Campaigns: two sent (with their deliveries), one waiting for approval, one draft
  insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, channels, audience, sent_at, status, approved_by, recipients_count, opened_count, created_by, created_at) values
    (v_news, p_center, 'newsletter', 'Monthly newsletter', s || ' newsletter · ' || to_char(app.demo_today(p_center) - 20, 'FMMonth YYYY'),
     '## This month\n\n- Paryushan: thank you to every tapasvi\n- Pathshala term is under way\n- Temple construction update\n\n(Demo newsletter.)',
     '{email}', '{"all_members": true}', now() - interval '20 days', 'sent', p_actor, null, null, p_actor, now() - interval '22 days'),
    (v_ann, p_center, 'event', 'Tapasvi Bahuman invitation', 'You''re invited: Tapasvi Bahuman & Swamivatsalya',
     'Join us to honor this year''s tapasvis. RSVP in the app. (Demo.)', '{push,email}', '{"all_members": true}', now() - interval '5 days', 'sent', p_actor, null, null, p_actor, now() - interval '6 days'),
    (app.demo_id(p_seed, 'comms:appeal'), p_center, 'appeal', 'Construction appeal', 'Help us finish the new derasar',
     'We are 60% of the way there. (Demo appeal.)', '{email,push}', '{"all_members": true}', null, 'pending_approval', null, null, null, p_actor, now() - interval '1 day'),
    (app.demo_id(p_seed, 'comms:pathshala'), p_center, 'pathshala_update', 'Pathshala annual day', 'Save the date: Pathshala annual day',
     'Students will perform; families bring potluck. (Demo draft.)', '{push}', '{"pathshala_families": true}', null, 'draft', null, null, null, p_actor, now());
  insert into app.messages (center_id, campaign_id, person_id, to_address, channel, topic_key, subject, body, scheduled_at, sent_at, delivered_at, opened_at,
                            status, purpose, sandbox, provider)
  select p_center, x.cid, p.id, p.email, 'email', 'newsletter', x.subject, 'Demo message', x.at, x.at, x.at + interval '1 minute',
         case when abs(hashtext(p.email::text)) % 3 <> 0 then x.at + interval '3 hours' end, 'delivered', 'campaign', true, 'demo'
    from app.people p join app.channel_optins o on o.person_id = p.id and o.channel = 'email' and o.opted_in
    cross join (values (v_news, s || ' newsletter', now() - interval '20 days'), (v_ann, 'Tapasvi Bahuman invitation', now() - interval '5 days')) x(cid, subject, at)
   where p.center_id = p_center;
  update app.comms_campaigns c set recipients_count = (select count(*) from app.messages m2 where m2.campaign_id = c.id),
         opened_count = (select count(*) from app.messages m2 where m2.campaign_id = c.id and m2.opened_at is not null)
   where c.id in (v_news, v_ann);
  insert into app.alerts (center_id, severity, title, body, starts_at, ends_at, created_by) values
    (p_center, 'important', 'Parking for the Tapasvi Bahuman', 'Use the overflow lot; volunteers will guide you. (Demo alert.)', now() - interval '1 day', app.demo_at(p_center, 10, '00:00'), p_actor),
    (p_center, 'info', 'Derasar closes early on Friday', 'For maintenance. (Demo alert.)', now() - interval '40 days', now() - interval '35 days', p_actor);
  -- Inbox threads: members write in, staff answer
  for r in select * from (values
      ('t1', 'membership', 'h01.priya', 'Update our address', 'closed', 'We moved to 101 Lotus Lane. Please update our family record.', 'Updated. Thank you, Priyaben!'),
      ('t2', 'donations',  'h14.ashok', 'Receipt for last year', 'open', 'Could you send the year-end receipt for our donor-advised fund grant?', null),
      ('t3', 'pathshala',  'h05.mansi', 'Can Kiara move to the later class?', 'waiting', 'Kiara has swim class at 10. Is there a later Jainism 1 class?', 'Not this term, but we will note it for next term. Would a mid-term check-in help?'),
      ('t4', 'events',     'h04.hemant','Wheelchair access at the Tapasvi Bahuman', 'assigned', 'Kusumben uses a wheelchair. Is the east door open?', 'Yes, the east door will be open with a volunteer.'),
      ('t5', 'office',     'h24.rahul', 'How do we become members?', 'open', 'We are new to the area and would like to join.', null)) x(k, inbox, p, subj, st, q, a)
  loop
    v_t := app.demo_id(p_seed, 'thread:' || r.k);
    insert into app.threads (id, center_id, inbox_id, from_person_id, subject, status, assignee_user, first_response_at, closed_at, created_at)
    values (v_t, p_center, app.demo_id(p_seed, 'inbox:' || r.inbox), app.demo_p(p_seed, r.p), r.subj, r.st,
            case when r.st in ('assigned','waiting','closed') then p_actor end, case when r.a is not null then now() - interval '1 day' end,
            case when r.st = 'closed' then now() - interval '12 hours' end, now() - interval '3 days');
    insert into app.thread_messages (center_id, thread_id, author_user, from_role, body, created_at) values (p_center, v_t, null, false, r.q, now() - interval '3 days');
    if r.a is not null then
      insert into app.thread_messages (center_id, thread_id, author_user, from_role, body, created_at) values (p_center, v_t, p_actor, true, r.a, now() - interval '1 day');
    end if;
  end loop;
  insert into app.whatsapp_join_requests (center_id, group_id, person_id, phone_e164, status, created_at)
  select p_center, app.demo_id(p_seed, 'wa:' || x.g), p.id, p.phone_e164, 'pending', now() - interval '2 days'
    from (values ('announce', 'h07.vikram'), ('pathshala', 'h19.ritu'), ('volunteers', 'h21.rohan')) x(g, pk)
    join app.people p on p.id = app.demo_p(p_seed, x.pk);
  -- Surveys: event feedback (closed, answered), a poll (open), a draft
  v_survey := app.demo_id(p_seed, 'survey:feedback');
  insert into app.surveys (id, center_id, title, description, questions, audience, status, kind, event_id, opens_at, closes_at, created_by) values
    (v_survey, p_center, 'How was the Samvatsari pratikraman?', 'Two quick questions (demo).',
     '[{"id":"q1","type":"rating","label":"How was the evening?","required":true},{"id":"q2","type":"text","label":"What should we change?","required":false}]',
     '{"all_members": true}', 'closed', 'event_feedback', app.demo_id(p_seed, 'ev:paryushan'), now() - interval '33 days', now() - interval '20 days', p_actor),
    (app.demo_id(p_seed, 'survey:poll'), p_center, 'Pathshala start time', 'Would a 9:30 AM start work for your family? (Demo poll.)',
     '[{"id":"q1","type":"single","label":"A 9:30 AM start works for us","options":["Yes","No","Not sure"],"required":true}]',
     '{"all_members": true}', 'open', 'poll', null, now() - interval '4 days', now() + interval '10 days', p_actor),
    (app.demo_id(p_seed, 'survey:seva'), p_center, 'Seva interests', 'Tell us how you would like to help (demo draft).',
     '[{"id":"q1","type":"multi","label":"Where would you like to help?","options":["Kitchen","Pathshala","Events","Parking"],"required":true}]',
     '{"all_members": true}', 'draft', 'general', null, null, null, p_actor);
  for r in select p.id, (row_number() over (order by p.email))::int as n from app.people p
            where p.center_id = p_center and p.email is not null order by p.email limit 12 loop
    insert into app.survey_responses (center_id, survey_id, person_id, answers, submitted_at)
    values (p_center, v_survey, r.id, jsonb_build_object('q1', 3 + (r.n % 3), 'q2', case when r.n % 3 = 0 then 'More seating near the front' when r.n % 4 = 0 then 'Start 15 minutes earlier' else '' end),
            now() - interval '30 days' + make_interval(hours => r.n::int));
    if r.n <= 8 then
      insert into app.survey_responses (center_id, survey_id, person_id, answers, submitted_at)
      values (p_center, app.demo_id(p_seed, 'survey:poll'), r.id, jsonb_build_object('q1', (array['Yes','No','Not sure'])[1 + r.n % 3]), now() - make_interval(hours => r.n::int));
    end if;
  end loop;
  -- Volunteer interests
  insert into app.volunteer_interests (center_id, person_id, group_id, status)
  select p_center, app.demo_p(p_seed, x.p), app.demo_id(p_seed, 'vg:' || x.g), x.st
    from (values ('h02.arjun', 'events', 'active'), ('h13.karan', 'parking', 'active'), ('h17.avni', 'youth', 'interested'),
                 ('h06.rupal', 'kitchen', 'active'), ('h11.krupa', 'kitchen', 'active'), ('h15.falguni', 'kitchen', 'interested'),
                 ('h21.rohan', 'parking', 'active'), ('h02.neha', 'teaching', 'active'), ('h17.rekha', 'teaching', 'active'),
                 ('h03.sonal', 'teaching', 'active'), ('h12.khushi', 'teaching', 'interested'), ('h09.jay', 'events', 'active'),
                 ('h07.anjali', 'youth', 'interested'), ('h20.shweta', 'events', 'interested'), ('h24.mira', 'kitchen', 'interested')) x(p, g, st);
  -- Governance: the Pathshala committee's resolutions and concerns raised
  insert into app.resolutions (center_id, body, title, description, rationale, comment_status, comment_period, voting_status, voting_period, quorum, outcome_note, created_by, created_at) values
    (p_center, 'pathshala_committee', 'Adopt the Pathshala code of conduct', 'A one-page code for students, parents and teachers.', 'Clear expectations for everyone.',
     'started', daterange(app.demo_today(p_center) - 3, app.demo_today(p_center) + 11), 'not_started', null, 4, null, p_actor, now() - interval '3 days'),
    (p_center, 'pathshala_committee', 'Approve the annual day budget', 'Up to $1,500 for the annual day.', 'Stage, sound and certificates.',
     'completed', daterange(app.demo_today(p_center) - 40, app.demo_today(p_center) - 26), 'completed', daterange(app.demo_today(p_center) - 25, app.demo_today(p_center) - 18),
     4, 'Approved 5–0 (demo).', p_actor, now() - interval '40 days'),
    (p_center, 'pathshala_committee', 'Add a Gujarati 2 class', 'Open Gujarati 2 next term if eight students register.', null,
     'not_started', null, 'not_started', null, 4, null, p_actor, now() - interval '1 day');
  insert into app.concerns (center_id, source, submitter_name, submitter_person_id, class_id, title, description, suggestions, status, status_updates, created_at) values
    (p_center, 'parent', 'Mansi Parikh', app.demo_p(p_seed, 'h05.mansi'), app.demo_id(p_seed, 'class:j1'), 'Room A is cold in the morning',
     'The children are wearing jackets in class.', 'Turn the heating on at 9:30.', 'in_progress', '[{"at":"demo","note":"Asked facilities to adjust the schedule"}]', now() - interval '9 days'),
    (p_center, 'teacher', 'Rekha Nagda', app.demo_p(p_seed, 'h17.rekha'), app.demo_id(p_seed, 'class:j3'), 'Need more copies of the sutra book',
     'Six students share books.', null, 'reported', '[]', now() - interval '2 days'),
    (p_center, 'member', 'Hemant Doshi', app.demo_p(p_seed, 'h04.hemant'), null, 'Pickup line blocks the driveway',
     'Cars wait in the driveway at 11:30.', 'A volunteer at the gate.', 'closed', '[{"at":"demo","note":"Parking volunteers added"}]', now() - interval '30 days');
  -- Content: library items in different states, and a few questions members asked Niva
  insert into app.content_items (center_id, tradition, kind, slug, title, body_md, status, published_at, approved_by, created_by, metadata) values
    (p_center, null, 'explainer', 'demo-what-is-paryushan', 'What is Paryushan?', 'Eight days of reflection, fasting and forgiveness, ending with Samvatsari. (Demo text.)', 'published', now() - interval '60 days', p_actor, p_actor, '{}'),
    (p_center, null, 'faq', 'demo-pathshala-registration', 'How do I register for Pathshala?', 'Open the app, go to Learn, and choose Register. Membership is required. (Demo text.)', 'published', now() - interval '90 days', p_actor, p_actor, '{}'),
    (p_center, null, 'sutra', 'demo-uvasaggaharam', 'Uvasaggaharam Stotra', 'Five verses in praise of Parshvanath. (Demo lesson text.)', 'published', now() - interval '30 days', p_actor, p_actor, '{"verses":5}'),
    (p_center, null, 'audio_lesson', 'demo-navkar-audio', 'Navkar Mantra, slowly', 'Audio lesson for young children. (Demo.)', 'in_review', null, null, p_actor, '{"minutes":4}'),
    (p_center, null, 'guide_page', 'demo-visiting-the-derasar', 'Visiting the derasar', 'What to wear, what to bring, and how to do darshan. (Demo draft.)', 'draft', null, null, p_actor, '{}'),
    (p_center, null, 'niva_source', 'demo-bylaws-summary', 'Bylaws summary', 'Membership tiers, voting and elections in brief. (Demo.)', 'approved', null, p_actor, p_actor, '{}');
  update app.gyan_steps set content_item_id = (select id from app.content_items where center_id = p_center and slug = 'demo-uvasaggaharam')
   where id = app.demo_id(p_seed, 'gyan:step1.1');
  insert into app.niva_conversations (center_id, user_id, question, answer, sources, unanswered, created_at) values
    (p_center, null, 'What time does the derasar open on Sunday?', 'The derasar opens at 7:30 AM every day. (Demo answer.)', '[{"title":"Timings and visiting"}]', false, now() - interval '6 days'),
    (p_center, null, 'How do I register my son for Pathshala?', 'Open Learn in the app and choose Register; membership is required. (Demo answer.)', '[{"title":"How do I register for Pathshala?"}]', false, now() - interval '4 days'),
    (p_center, null, 'Can I pay my pledge with Zelle?', null, '[]', true, now() - interval '2 days'),
    (p_center, null, 'When is the next Tapasvi Bahuman?', 'On ' || to_char(app.demo_today(p_center) + 9, 'FMMonth FMDD') || ' at 10:00 AM in the main hall. (Demo answer.)', '[{"title":"Events"}]', false, now() - interval '1 day');
end $$;

-- ── Step 10 · link demo sign-ins ─────────────────────────────────────────────
-- Anyone who already signed in with a demo person's e-mail (for example the person testing the
-- member app) is linked to that person again, so a reset does not lock them out.
create or replace function app.demo_community_logins(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.accounts (user_id)
  select u.id from auth.users u join app.people p on lower(p.email::text) = lower(u.email) and p.center_id = p_center
   where lower(u.email) like '%@' || app.demo_email_domain()
  on conflict do nothing;
  insert into app.center_users (center_id, user_id, person_id)
  select distinct on (u.id) p_center, u.id, p.id
    from auth.users u join app.people p on lower(p.email::text) = lower(u.email) and p.center_id = p_center
   where lower(u.email) like '%@' || app.demo_email_domain()
     and not exists (select 1 from app.center_users cu where cu.center_id = p_center and (cu.user_id = u.id or cu.person_id = p.id))
   order by u.id, p.created_at
  on conflict do nothing;
end $$;

revoke execute on function app.demo_pay(uuid, uuid, uuid, text, text, text, bigint, app.payment_method, int, uuid[], text, text),
  app.demo_community_setup(uuid, uuid, uuid), app.demo_community_people(uuid, uuid, uuid), app.demo_community_membership(uuid, uuid, uuid),
  app.demo_community_giving(uuid, uuid, uuid), app.demo_community_events(uuid, uuid, uuid), app.demo_community_store(uuid, uuid, uuid),
  app.demo_community_pathshala(uuid, uuid, uuid), app.demo_community_learning(uuid, uuid, uuid), app.demo_community_community(uuid, uuid, uuid),
  app.demo_community_logins(uuid, uuid, uuid), app.demo_today(uuid), app.demo_at(uuid, int, time), app.demo_sunday(uuid, int),
  app.demo_short(uuid), app.demo_h(uuid, text), app.demo_p(uuid, text) from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
