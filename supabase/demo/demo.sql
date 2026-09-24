-- supabase/demo/demo.sql — LOCAL DEMO DATA ONLY. Never run against staging or production.
-- Sample families, events, Pathshala, giving, bolis and Chase bank lines from the
-- JSH prototype, so every screen has something to show. All data is made up.
-- Apply after `supabase start` (migrations + seed.sql):
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/demo/demo.sql
-- Then give yourself a login with supabase/demo/grant-login.sql (see docs/LOCAL_DEV.md).
\set ON_ERROR_STOP 1
begin;

do $$
declare c uuid := '00000000-0000-4000-8000-000000000001';
  west uuid; sw uuid;
  h_shah uuid := 'd0000000-0000-4000-8000-000000000101'; h_mehta uuid := 'd0000000-0000-4000-8000-000000000102';
  h_rm uuid := 'd0000000-0000-4000-8000-000000000103'; h_staff uuid := 'd0000000-0000-4000-8000-000000000104';
  priya uuid := 'd0000000-0000-4000-8000-000000000201'; rahul uuid := 'd0000000-0000-4000-8000-000000000202';
  dev uuid := 'd0000000-0000-4000-8000-000000000203'; anya uuid := 'd0000000-0000-4000-8000-000000000204';
  kiran uuid := 'd0000000-0000-4000-8000-000000000205'; neha uuid := 'd0000000-0000-4000-8000-000000000206';
  rahul2 uuid := 'd0000000-0000-4000-8000-000000000207'; mira uuid := 'd0000000-0000-4000-8000-000000000208';
  admin uuid := 'd0000000-0000-4000-8000-000000000209'; teacher uuid := 'd0000000-0000-4000-8000-000000000210';
  term uuid := 'd0000000-0000-4000-8000-000000000301'; cls_j3 uuid := 'd0000000-0000-4000-8000-000000000302';
  cls_j1 uuid := 'd0000000-0000-4000-8000-000000000303'; cls_g1 uuid := 'd0000000-0000-4000-8000-000000000304';
  ev_tb uuid := 'd0000000-0000-4000-8000-000000000401'; ev_garba uuid := 'd0000000-0000-4000-8000-000000000402';
  ev_diwali uuid := 'd0000000-0000-4000-8000-000000000403'; tpl uuid := 'd0000000-0000-4000-8000-000000000404';
  camp_sv uuid := 'd0000000-0000-4000-8000-000000000501'; camp_dw uuid := 'd0000000-0000-4000-8000-000000000502';
  camp_con uuid := 'd0000000-0000-4000-8000-000000000503'; boli uuid := 'd0000000-0000-4000-8000-000000000504';
  rsvp uuid := 'd0000000-0000-4000-8000-000000000601'; pay uuid := 'd0000000-0000-4000-8000-000000000701';
  bank uuid := 'd0000000-0000-4000-8000-000000000801';
  gen uuid; con uuid; pw uuid; tb_day timestamptz := date_trunc('day', now()) + interval '4 days' + interval '15 hours';
begin
  select id into west from app.zones where center_id = c and name = 'West';
  select id into sw from app.zones where center_id = c and name = 'Southwest';
  select id into gen from app.funds where center_id = c and key = 'general';
  select id into con from app.funds where center_id = c and key = 'construction';

  -- Households and people (Connect numbers fixed so grant-login.sql can find them)
  insert into app.households (id, center_id, display_name, city, state_region, postal_code, zone_id, household_number, directory_opt_in, physical_mail_opt_in) values
    (h_shah, c, 'Shah family', 'Katy', 'TX', '77494', west, 'JSH-H-9001', true, false),
    (h_mehta, c, 'Mehta family', 'Sugar Land', 'TX', '77479', sw, 'JSH-H-9002', false, true),
    (h_rm, c, 'Rahul & Mira Shah Household', 'Sugar Land', 'TX', '77478', sw, 'JSH-H-9003', false, null),
    (h_staff, c, 'Demo staff household', 'Houston', 'TX', '77063', null, 'JSH-H-9004', false, false);
  insert into app.people (id, center_id, first_name, last_name, email, phone_e164, date_of_birth, gender, profession, member_number, is_verified, expertise_opt_in, expertise_headline, new_member_contact_opt_in) values
    (priya, c, 'Priya', 'Shah', 'priya.shah@example.com', '+17135550142', '1985-03-14', 'female', 'Software engineer', 'JSH-90001', true, true, 'Software engineer · happy to guide students on tech careers', true),
    (rahul, c, 'Rahul', 'Shah', 'rahul.shah@example.com', '+17135550188', '1983-07-02', 'male', 'Physician', 'JSH-90002', true, true, 'Physician · general health questions', false),
    (dev, c, 'Dev', 'Shah', null, null, (current_date - interval '14 years')::date, 'male', null, 'JSH-90003', true, false, null, false),
    (anya, c, 'Anya', 'Shah', null, null, (current_date - interval '9 years')::date, 'female', null, 'JSH-90004', true, false, null, false),
    (kiran, c, 'Kiran', 'Mehta', 'kiran.mehta@example.com', '+12815550111', '1970-05-01', 'male', 'Engineer', 'JSH-90005', true, false, null, false),
    (neha, c, 'Neha', 'Mehta', 'neha.mehta@example.com', '+12815550112', '1974-09-12', 'female', 'Teacher', 'JSH-90006', true, false, null, false),
    (rahul2, c, 'Rahul', 'Shah', 'rahul.m.shah@example.com', '+12815550133', '1979-11-20', 'male', 'Accountant', 'JSH-90007', true, false, null, false),
    (mira, c, 'Mira', 'Shah', 'mira.shah@example.com', null, '1981-02-03', 'female', null, 'JSH-90008', true, false, null, false),
    (admin, c, 'Demo', 'Admin', 'admin@jsh.test', null, '1978-01-01', null, null, 'JSH-90009', true, false, null, false),
    (teacher, c, 'Tejal', 'Teacher', 'teacher@jsh.test', null, '1982-01-01', 'female', null, 'JSH-90010', true, false, null, false);
  insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
    (h_shah, priya, c, 'primary', true), (h_shah, rahul, c, 'spouse', false), (h_shah, dev, c, 'child', false), (h_shah, anya, c, 'child', false),
    (h_mehta, kiran, c, 'primary', true), (h_mehta, neha, c, 'spouse', false),
    (h_rm, rahul2, c, 'primary', true), (h_rm, mira, c, 'spouse', false),
    (h_staff, admin, c, 'primary', true), (h_staff, teacher, c, 'other', false);

  -- Every identifier kind
  insert into app.external_ids (center_id, person_id, kind, system, value, label, source) values
    (c, priya, 'org_member', 'jsh_register', '0417', 'JSH member ID', 'import'),
    (c, rahul, 'org_member', 'jsh_register', '0418', 'JSH member ID', 'import'),
    (c, kiran, 'org_member', 'jsh_register', '1102', 'JSH member ID', 'import'),
    (c, rahul2, 'org_member', 'jsh_register', '1188', 'JSH member ID', 'import'),
    (c, priya, 'crm', 'neon', '4374', 'Neon ID (JSH Connect family QR)', 'import'),
    (c, kiran, 'crm', 'namocrm', '88213', 'NamoCRM contact ID', 'import');
  insert into app.external_ids (center_id, household_id, kind, system, value, label, source) values
    (c, h_shah, 'org_household', 'jsh_register', '0212', 'JSH household ID', 'import'),
    (c, h_mehta, 'org_household', 'jsh_register', '0305', 'JSH household ID', 'import'),
    (c, h_rm, 'org_household', 'jsh_register', '0417', 'JSH household ID', 'import'),
    (c, h_shah, 'accounting', 'quickbooks', '1187', 'QuickBooks customer', 'sync'),
    (c, h_shah, 'bank_payer', 'chase', 'PRIYA S SHAH', 'Zelle payer name', 'learned');

  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
  select c, x.h, x.p, t.id, x.tier::app.membership_tier, 'active', x.since
    from (values (h_shah, priya, 'life', date '2015-04-01'), (h_mehta, kiran, 'yearly', date '2026-01-01'), (h_rm, rahul2, 'community', date '2026-06-01')) x(h, p, tier, since)
    join app.membership_types t on t.center_id = c and t.tier = x.tier::app.membership_tier;
  insert into app.eligibility_snapshots (center_id, person_id, can_vote, reasons) values
    (c, priya, true, '["Life membership over 180 days","Maintenance fees paid through 2025","No prior-year pledges outstanding"]'),
    (c, rahul, true, '["Life membership (spouse)"]');

  -- Pathshala
  insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status, fee_per_child_cents, sibling_discount_pct)
    values (term, c, '2026-2027', date '2026-08-30', date '2027-05-30', 'active', 15000, 10);
  insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, starts_time, ends_time)
  select x.id, c, term, l.id, x.name, x.room, 25, time '10:00', time '12:00'
    from (values (cls_j3, 'jainism', '3', 'Jainism 3 – Room B', 'B'), (cls_j1, 'jainism', '1', 'Jainism 1 – Room A', 'A'), (cls_g1, 'gujarati', '1', 'Gujarati 1 – Room C', 'C')) x(id, track, lvl, name, room)
    join app.pathshala_tracks t on t.center_id = c and t.key = x.track
    join app.pathshala_levels l on l.track_id = t.id and l.key = x.lvl;
  insert into app.pathshala_teachers (center_id, class_id, person_id) values (c, cls_j3, teacher), (c, cls_j1, neha);
  insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values
    (c, term, dev, h_shah, cls_j3, 'active'), (c, term, anya, h_shah, cls_j1, 'active');
  insert into app.pathshala_sessions (center_id, class_id, held_on, topic) values
    (c, cls_j3, current_date - 7, 'Logassa sutra, verses 1–2'), (c, cls_j1, current_date - 7, 'Navkar Mantra meaning');

  -- Events, checklist template, RSVP with tickets
  insert into app.event_templates (id, center_id, name, description) values (tpl, c, 'Tapasvi Bahuman', 'Honoring tapasvis after Paryushan');
  insert into app.event_template_items (center_id, template_id, phase, name, offset_days, sort_order) values
    (c, tpl, 'pre', 'Book Stafford Center', -45, 1), (c, tpl, 'pre', 'Order gifts for tapasvis', -21, 2),
    (c, tpl, 'pre', 'Assign volunteers to stations', -7, 3), (c, tpl, 'during', 'Run check-in stations', null, 1),
    (c, tpl, 'after', 'Send thank-you and feedback survey', 2, 1);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into app.events (id, center_id, template_id, name, description, venue, starts_at, ends_at, status, capacity, audience,
                          lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot, rsvp_closes_at)
  values (ev_tb, c, tpl, 'Tapasvi Bahuman & Swamivatsalya', 'Honoring this year''s tapasvis, followed by Swamivatsalya.', 'Stafford Center',
          tb_day, tb_day + interval '4 hours', 'published', 800, 'members_and_guests',
          true, tb_day + interval '2 hours', 15, 120, tb_day - interval '1 day'),
         (ev_garba, c, null, 'Youth garba night', 'YJA and YJP garba', 'Jain Center', now() + interval '18 days', now() + interval '18 days 4 hours', 'published', 300, 'public', false, null, 15, null, null),
         (ev_diwali, c, null, 'Diwali puja & new year', 'Diwali puja at the derasar', 'Derasar', now() + interval '47 days', now() + interval '47 days 3 hours', 'published', null, 'members_and_guests', false, null, 15, null, null);
  insert into app.actions (center_id, event_id, phase, name, due_on, priority, state, owner_person_id) values
    (c, ev_tb, 'pre', 'Book Stafford Center', current_date - 30, 'high', 'completed', admin),
    (c, ev_tb, 'pre', 'Order gifts for tapasvis', current_date - 2, 'high', 'in_progress', admin),
    (c, ev_tb, 'pre', 'Assign volunteers to stations', current_date + 1, 'medium', 'not_started', null),
    (c, ev_tb, 'during', 'Run check-in stations', null, 'critical', 'not_started', admin);
  insert into app.volunteer_shifts (center_id, event_id, station, starts_at, ends_at, capacity) values
    (c, ev_tb, 'entry', tb_day - interval '1 hour', tb_day + interval '2 hours', 6),
    (c, ev_tb, 'food', tb_day + interval '2 hours', tb_day + interval '4 hours', 8);
  insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source) values
    (rsvp, c, ev_tb, h_shah, priya, 'confirmed', 'app');
  insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, ticket_token) values
    (c, ev_tb, rsvp, priya, 'Priya Shah', false, 'demo-ticket-priya'),
    (c, ev_tb, rsvp, rahul, 'Rahul Shah', false, 'demo-ticket-rahul'),
    (c, ev_tb, rsvp, anya, 'Anya Shah', true, 'demo-ticket-anya');
  insert into app.rsvps (center_id, event_id, household_id, submitted_by_person_id, status, source) values
    (c, ev_tb, h_mehta, kiran, 'rsvpd', 'app');
  insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_senior, ticket_token)
  select c, ev_tb, r.id, kiran, 'Kiran Mehta', false, 'demo-ticket-kiran' from app.rsvps r where r.household_id = h_mehta and r.event_id = ev_tb;

  -- Giving: campaigns, opportunities, a digital boli, pledges + a payment
  insert into app.campaigns (id, center_id, fund_id, name, kind, status, goal_cents) values
    (camp_sv, c, gen, 'Swamivatsalya sponsorship', 'sponsorship', 'published', null),
    (camp_dw, c, gen, 'Diwali aarti & pujans', 'event', 'published', null),
    (camp_con, c, con, 'New temple construction', 'construction', 'published', 1000000000);
  insert into app.opportunities (center_id, campaign_id, event_id, name, amount_cents, quantity_available, sort_order) values
    (c, camp_sv, ev_tb, 'Platinum sponsor', 500000, null, 1), (c, camp_sv, ev_tb, 'Gold sponsor', 250000, null, 2),
    (c, camp_sv, ev_tb, 'Silver sponsor', 100000, null, 3),
    (c, camp_dw, ev_diwali, 'Pehli aarti', 25100, 1, 1), (c, camp_dw, ev_diwali, 'Mangal divo', 15100, 1, 2),
    (c, camp_dw, ev_diwali, 'Gautam Swami pujan', 25100, 1, 3), (c, camp_dw, ev_diwali, 'Sharda (chopda) pujan', 10800, 1, 4),
    (c, camp_con, null, 'Founders Circle', 1000000, null, 1), (c, camp_con, null, 'Your amount', null, null, 2);
  insert into app.bolis (id, center_id, event_id, campaign_id, name, kind, floor_cents, step_cents, status, opens_at, closes_at, explainer_md)
    values (boli, c, ev_tb, camp_sv, 'Swamivatsalya labh', 'digital', 50100, 2100, 'open', now() - interval '1 day', tb_day - interval '15 hours',
            'The family that takes this labh hosts the community meal after the Tapasvi Bahuman.'),
           ('d0000000-0000-4000-8000-000000000505', c, ev_tb, camp_sv, 'Snatra puja kalash', 'in_person', 25100, 1100, 'open', null, null,
            'Called live in the hall at about 11:30 AM.');
  insert into app.boli_entries (center_id, boli_id, household_id, person_id, amount_cents) values
    (c, boli, h_mehta, kiran, 50100), (c, boli, h_rm, rahul2, 75100);
  insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, source, amount_cents, pledged_at) values
    (c, h_shah, priya, camp_sv, 'boli', 15100, now() - interval '12 days'),
    (c, h_shah, rahul, camp_con, 'construction', 50000, now() - interval '150 days'),
    (c, h_shah, priya, null, 'general', 10100, now() - interval '160 days'),
    (c, h_mehta, kiran, camp_con, 'construction', 100000, now() - interval '40 days');
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, provider, status, check_number, received_on)
    values (pay, c, h_shah, priya, 10100, 'check', 'offline', 'captured', '2217', current_date - 150);
  perform app.allocate_payment(pay, null, true);
  insert into app.recurring_gifts (center_id, household_id, person_id, fund_id, amount_cents, frequency, status, next_charge_on)
  select c, h_shah, priya, f.id, 2100, 'monthly', 'active', (date_trunc('month', current_date) + interval '1 month')::date
    from app.funds f where f.center_id = c and f.key = 'derasar_upkeep';

  -- Chase bank lines to reconcile
  insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values (bank, c, 'Chase operating (demo)', 'Chase', '0000', 'chase_csv');
  insert into app.payments (center_id, household_id, amount_cents, method, provider, status, check_number, envelope_number, received_on) values
    (c, h_mehta, 25100, 'check', 'offline', 'captured', '5530', 'E-13', current_date - 1),
    (c, h_rm, 10100, 'check', 'offline', 'captured', '1044', 'E-14', current_date - 1);
  insert into app.bank_transactions (center_id, bank_account_id, posted_on, amount_cents, description, bank_type, bank_details) values
    (c, bank, current_date - 2, 15100, 'Zelle Payment From PRIYA S SHAH Jpm99bxk2q1v', 'QUICKPAY_CREDIT', 'CREDIT'),
    (c, bank, current_date - 2, 5100, 'Zelle Payment From Rahul Shah Bacw8k3x9p2q', 'QUICKPAY_CREDIT', 'CREDIT'),
    (c, bank, current_date - 1, 35200, 'REMOTE ONLINE DEPOSIT #          1', 'CHECK_DEPOSIT', 'DSLIP'),
    (c, bank, current_date - 1, 50000, 'ORIG CO NAME:FIDELITY CHARITABLE ORIG ID:1234567890 DESC DATE:260915 CO ENTRY DESCR:GRANT SEC:CCD TRACE#:021000021234567', 'ACH_CREDIT', 'CREDIT'),
    (c, bank, current_date - 1, 128433, 'ORIG CO NAME:STRIPE ORIG ID:1800948598 DESC DATE:260915 CO ENTRY DESCR:TRANSFER SEC:CCD TRACE#:091000019999999', 'ACH_CREDIT', 'CREDIT');

  -- Membership application awaiting the coordinator
  insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id,
                                           reference_note, reference_decision, status)
  select c, rahul2, h_rm, t.id, 'yearly', kiran, 'Neighbors in Sugar Land for 6 years', 'approved', 'awaiting_center'
    from app.membership_types t where t.center_id = c and t.key = 'yearly';

  -- Store pickup window
  insert into app.pickup_windows (id, center_id, event_id, starts_at, ends_at, order_cutoff_at, capacity, location)
    values (gen_random_uuid(), c, ev_tb, tb_day - interval '1 day' + interval '2 hours', tb_day - interval '1 day' + interval '4 hours', tb_day - interval '3 days', 60, 'Jain Center kitchen');

  -- My Jain Way, special days, alerts, survey, timings, tithi
  insert into app.practice_selections (center_id, person_id, practice_id)
  select c, priya, p.id from app.practices p where p.key in ('navkar_waking','navkarsi','darshan','samayik','swadhyay','chauvihar','gyan_path');
  insert into app.special_days (center_id, household_id, person_id, kind, label, calendar_date) values
    (c, h_shah, anya, 'birthday', 'Anya''s birthday', (current_date + 14)),
    (c, h_shah, null, 'anniversary', 'Priya & Rahul''s anniversary', (current_date + 74));
  insert into app.alerts (center_id, severity, title, body, ends_at) values
    (c, 'important', 'Parking at Stafford Center', 'Use the overflow lot across the street for the Tapasvi Bahuman.', tb_day + interval '1 day');
  insert into app.surveys (center_id, title, description, questions, audience, status, kind) values
    (c, 'Pathshala Sunday timings', 'Would a 9:30 AM start work for your family?',
     '[{"id":"q1","type":"single","label":"A 9:30 AM start works for us","options":["Yes","No","Not sure"],"required":true}]',
     '{"all_members":true}', 'open', 'poll');
  insert into app.daily_timings (center_id, on_date, sunrise, sunset, navkarsi, chauvihar, aarti, temple_open, temple_close) values
    (c, current_date, '07:14', '19:21', '08:02', '19:21', '16:30', '07:30', '18:00')
    on conflict (center_id, on_date) do nothing;
  insert into app.tithi_days (center_id, tradition, gregorian, tithi, month_name, paksha) values
    (c, 'shvetambar_murtipujak', current_date, 'Sud 11', 'Bhadarva', 'sud')
    on conflict do nothing;
end $$;

commit;
\echo 'Demo data loaded: Shah family (JSH-90001..4), Mehta family, Rahul & Mira Shah Household, Demo Admin (JSH-90009), teacher (JSH-90010).'
