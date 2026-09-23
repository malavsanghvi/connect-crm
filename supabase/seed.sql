-- seed.sql
-- Platform catalog (roles, topics, shared tradition pack) + JSH as tenant #1.
-- Sample values from the prototype are marked [sample] and must be confirmed
-- by the JSH office before go-live (docs/DECISIONS.md "Parked and open").

-- ---------------------------------------------------------------------------
-- Role catalog: 25 default roles in four tiers (docs/ROLES.md)
-- ---------------------------------------------------------------------------
insert into app.roles (key, tier, name, default_scope, description, permissions) values
('platform_owner',        'platform',   'Platform owner',          'platform', 'Center creation, billing, global settings', '["*"]'),
('platform_support',      'platform',   'Platform support',        'center',   'Time-limited troubleshooting with center approval; every action audited', '["people.view","events.view","giving.view","audit.view","integrations.view"]'),
('content_curator',       'platform',   'Content curator',         'platform', 'Shared religious content and Gyan Path templates', '["content.manage","content.approve"]'),
('center_admin',          'center',     'Center admin',            'center',   'Configuration, roles, integrations', '["people.view","people.manage","events.view","events.manage","events.confidential","giving.view","bolis.view","store.view","content.view","content.manage","comms.view","comms.send","comms.approve","comms.inbox","pathshala.view","reports.view","settings.manage","roles.manage","audit.view","integrations.view","integrations.manage","volunteers.view","volunteers.manage","safety.view","governance.view"]'),
('executive_viewer',      'center',     'Executive viewer (EC, Board)', 'center', 'Dashboards and reports, read-only', '["reports.view","events.view","bolis.view","store.view","content.view","comms.view","governance.view"]'),
('treasurer',             'center',     'Treasurer',               'center',   'Giving, payments, refunds, statements, store finances', '["people.view","events.view","giving.view","giving.manage","giving.approve","giving.record_offline","bolis.view","store.view","reports.view","accounting.manage","accounting.close","integrations.view","audit.view"]'),
('finance_volunteer',     'center',     'Finance volunteer',       'center',   'Record offline payments, reminders; no refunds', '["giving.record_offline","bolis.view"]'),
('membership_coordinator','center',     'Membership coordinator',  'center',   'Households, memberships, verification, eligibility', '["people.view","people.manage","people.approve","events.view","reports.view"]'),
('religious_coordinator', 'center',     'Religious coordinator',   'center',   'Bolis, pujans, practice catalog, Jain calendar, religious content approval', '["events.view","bolis.view","bolis.manage","content.view","content.manage","content.approve","reports.view"]'),
('communications_officer','center',     'Communications officer',  'center',   'Announcements, templates, WhatsApp queue', '["events.view","content.view","comms.view","comms.send","comms.approve","comms.inbox","reports.view"]'),
('content_editor',        'center',     'Content editor',          'center',   'Guide, pages, photos, translations (draft only)', '["content.view","content.draft"]'),
('privacy_officer',       'center',     'Privacy officer',         'center',   'Data export and deletion requests', '["privacy.manage","people.view","audit.view"]'),
('volunteer_coordinator', 'center',     'Volunteer coordinator',   'center',   'Volunteer groups, shifts, waivers and background checks', '["volunteers.view","volunteers.manage","safety.view","safety.manage","events.view"]'),
('event_lead',            'operational','Event lead',              'event',    'Event setup, attendee list, lunch settings, volunteer assignment', '["events.view","reports.view"]'),
('checkin_volunteer',     'operational','Check-in volunteer',      'event',    'Scan, walk-ins, stations; no giving data', '[]'),
('kitchen_lead',          'operational','Kitchen lead',            'center',   'Headcounts, store prep lists', '["kitchen.view"]'),
('store_lead',            'operational','Store lead',              'store',    'Menu, pickup slots, order issues', '["store.view","store.manage","store.pickup","reports.view"]'),
('store_pickup',          'operational','Store pickup volunteer',  'center',   'Mark orders picked up', '["store.pickup"]'),
('boli_recorder',         'operational','Boli caller and recorder','event',    'Record in-person boli results', '["bolis.record"]'),
('pathshala_principal',   'operational','Pathshala principal',     'pathshala','Classes, levels, teachers, Pathshala calendar', '["pathshala.view","pathshala.manage","pathshala.teach","events.view","reports.view","governance.view","governance.manage","governance.vote","safety.view"]'),
('pathshala_committee',   'operational','Pathshala committee member','pathshala','Plan the Pathshala year, events checklists, resolutions', '["pathshala.view","events.view","events.manage","governance.view","governance.vote"]'),
('teacher',               'operational','Teacher',                 'class',    'Attendance, sign-offs, class announcements', '["pathshala.teach"]'),
('zone_lead',             'operational','Zone lead',               'zone',     'Zone inbox, zone families contact info, zone reports', '[]'),
('community_member',      'family',     'Community member',        'center',   'Account without membership: events, RSVP, giving, store, learning', '[]'),
('membership_reference',  'family',     'Membership reference',    'center',   'Approves or declines applications that name them', '[]'),
('primary_adult',         'family',     'Primary adult',           'center',   'Family details, children''s profiles, payments, RSVPs', '[]'),
('adult_member',          'family',     'Adult member',            'center',   'Own profile, family pledges, RSVPs, payments', '[]'),
('child',                 'family',     'Child (under 18)',        'center',   'View events, learning, My Jain Way; no RSVP, bolis, pledges or payments', '[]')
on conflict (key) do update set permissions = excluded.permissions, description = excluded.description, name = excluded.name;

insert into app.notification_topics (key, name, default_on, marketing) values
('events', 'Events and reminders', true, false),
('giving', 'Giving opportunities and bolis', true, true),
('pathshala', 'Pathshala updates', true, false),
('timings', 'Daily temple timings', false, false),
('jain_way', 'My Jain Way reminders', true, false),
('family', 'Family celebrations and support', true, false),
('store', 'Satvik Store', false, true),
('newsletter', 'Newsletters', true, true),
('alerts', 'Important alerts', true, false),
('account', 'Account and security', true, false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Shared tradition pack (Shvetambar Murtipujak): practices, Gyan Path goals
-- ---------------------------------------------------------------------------
insert into app.practices (center_id, tradition, category, key, name, default_minutes, points, sort_order) values
(null,'shvetambar_murtipujak','mantra_jaap',         'navkar_waking',  'Navkar Mantra on waking', 2, 5, 10),
(null,'shvetambar_murtipujak','tapasya_pachchakhan', 'navkarsi',       'Navkarsi pachchakhan', null, 10, 20),
(null,'shvetambar_murtipujak','darshan_puja',        'darshan',        'Darshan at derasar', 15, 10, 30),
(null,'shvetambar_murtipujak','darshan_puja',        'ashtaprakari',   'Ashtaprakari puja', 45, 20, 40),
(null,'shvetambar_murtipujak','samayik_pratikraman', 'samayik',        'Samayik (48 min)', 48, 20, 50),
(null,'shvetambar_murtipujak','swadhyay_learning',   'swadhyay',       'Swadhyay reading', 20, 10, 60),
(null,'shvetambar_murtipujak','tapasya_pachchakhan', 'chauvihar',      'Chauvihar', null, 15, 70),
(null,'shvetambar_murtipujak','samayik_pratikraman', 'pratikraman',    'Evening pratikraman', 60, 25, 80),
(null,'shvetambar_murtipujak','mantra_jaap',         'navkarvali',     'Navkarvali (108 mala)', 15, 15, 90),
(null,'shvetambar_murtipujak','swadhyay_learning',   'gyan_path',      'Gyan Path lesson (10 min)', 10, 20, 100);

with g as (
  insert into app.gyan_goals (center_id, tradition, key, name, description, sort_order) values
  (null,'shvetambar_murtipujak','samayik',     'Learn Samayik',       'Foundations, the sutras of Samayik, and performing it with your teacher (~3 weeks)', 10),
  (null,'shvetambar_murtipujak','navkar',      'Learn Navkar Mantra', 'The five Parameshthis and the Chulika (~1 week)', 20),
  (null,'shvetambar_murtipujak','logassa',     'Learn Logassa sutra', 'The 24 Tirthankars and reciting Logassa (~2 weeks)', 30),
  (null,'shvetambar_murtipujak','pratikraman', 'Learn Pratikraman',   'Why Pratikraman, the six Avashyaks, and performing it (~6 weeks)', 40)
  returning id, key
)
insert into app.gyan_levels (goal_id, key, name, sort_order, points, treasure, requires_teacher_signoff)
select g.id, l.key, l.name, l.ord, 20, l.treasure, l.signoff
from g join (values
  ('samayik','1','What is Samayik',1,null,false),('samayik','2','Navkar Mantra',2,null,false),('samayik','3','Panchindiya sutra',3,null,false),
  ('samayik','4','Khamasamana',4,'Foundations badge',false),('samayik','5','Iriyavahiyam sutra',5,null,false),('samayik','6','Tassa Uttari sutra',6,null,false),
  ('samayik','7','Annattha sutra',7,null,false),('samayik','8','Logassa sutra',8,'Logassa badge + 50 bonus points',false),('samayik','9','Karemi Bhante',9,null,false),
  ('samayik','10','Samayik vidhi, step by step',10,null,false),('samayik','11','Completing Samayik (parvani)',11,null,false),('samayik','12','Perform with your teacher',12,null,true),
  ('navkar','1','Arihant',1,null,false),('navkar','2','Siddha',2,null,false),('navkar','3','Acharya',3,null,false),('navkar','4','Upadhyay',4,null,false),
  ('navkar','5','Sadhu and Sadhvi',5,'Panch Parameshthi badge',false),('navkar','6','Eso Panch Namukkaro',6,null,false),('navkar','7','Savva Pavappanasano',7,null,false),
  ('navkar','8','Mangalanam cha Savvesim',8,null,false),('navkar','9','Recite the full Navkar',9,null,true),
  ('logassa','1','Who are the Tirthankars',1,null,false),('logassa','2','Rishabhdev to Chandraprabh',2,null,false),('logassa','3','Suvidhinath to Anantnath',3,null,false),
  ('logassa','4','Dharmanath to Naminath',4,null,false),('logassa','5','Neminath, Parshvanath, Mahavir',5,'Chovisi badge',false),('logassa','6','Meaning of Logassa',6,null,false),
  ('logassa','7','Verses 1 and 2',7,null,false),('logassa','8','Verses 3 and 4',8,null,false),('logassa','9','Verses 5 to 7',9,null,false),('logassa','10','Recite Logassa in kayotsarg',10,null,true),
  ('pratikraman','1','Why we do Pratikraman',1,null,false),('pratikraman','2','Devasi, Raisi, Pakkhi, Chaumasi, Samvatsari',2,null,false),('pratikraman','3','Michchhami Dukkadam',3,null,false),
  ('pratikraman','4','Before you begin',4,null,false),('pratikraman','5','Samayik first',5,'First steps badge',false),('pratikraman','6','Chauvisattho',6,null,false),
  ('pratikraman','7','Vandan',7,null,false),('pratikraman','8','Pratikraman',8,null,false),('pratikraman','9','Kayotsarg',9,null,false),('pratikraman','10','Pachchakhan',10,null,false),
  ('pratikraman','11','Vandittu sutra',11,'Six Avashyaks badge',false),('pratikraman','12','Evening Pratikraman',12,null,false),('pratikraman','13','Morning Pratikraman',13,null,false),
  ('pratikraman','14','Pakkhi Pratikraman',14,null,false),('pratikraman','15','Perform with the Sangh',15,null,true)
) as l(goal, key, name, ord, treasure, signoff) on l.goal = g.key;

insert into app.calendar_layers (center_id, key, name, kind, default_on, color) values
(null, 'tithi_smp', 'Jain tithi', 'tithi', true, '#C9731C'),
(null, 'isd_katy', 'Katy ISD', 'school_district', false, '#1F7A4D'),
(null, 'isd_fortbend', 'Fort Bend ISD', 'school_district', false, '#1B5E9C'),
(null, 'isd_cyfair', 'Cy-Fair ISD', 'school_district', false, '#9C1B5E'),
(null, 'isd_houston', 'Houston ISD', 'school_district', false, '#5E5A52');

-- ---------------------------------------------------------------------------
-- JSH — tenant #1
-- ---------------------------------------------------------------------------
insert into app.centers (id, slug, name, short_name, tradition, time_zone, state_region, branding, feature_flags, rules)
values ('00000000-0000-4000-8000-000000000001', 'jsh', 'Jain Society of Houston', 'JSH', 'shvetambar_murtipujak', 'America/Chicago', 'TX',
  '{"primary":"#1B2C5C","accent":"#C9731C","background":"#FBF7F0","display_font":"Fraunces","body_font":"DM Sans"}',
  '{"store":true,"bolis":true,"pathshala":true,"gyan_path":true,"my_jain_way":true,"saathi":true,"niva":false,"recurring_giving":true,"surveys":true}',
  '{"child_login_age":13,
    "membership":{"reference_required":true,"max_pending_sponsorships_per_year":5,"reference_expiry_days":14,"reference_reminder_days":3},
    "voting":{"life_member_wait_days":180,"requires_maintenance_paid":true,"requires_prior_year_pledges_paid":true},
    "lunch":{"slot_minutes":15,"family_with_child_under_12_at_start":true,"senior_at_start":true,"reminder_minutes_before":5},
    "boli":{"step_cents":2100,"soft_close_minutes":0},
    "fees":{"ask_donor_to_cover":true},
    "points":{"anumodana_daily_cap":5,"anumodana_points":5,"support_points":3,"day_complete_bonus":20},
    "rsvp":{"confirmation_hours_before":24,"nudge_hour_local":18},
    "store":{"gift_pack_cents":299,"cancel_hours_before_pickup":24},
    "accounting":{"basis":"cash"},
    "identifiers":{"org_member_label":"JSH member ID","org_member_system":"jsh_register","org_member_digits":4,
                   "org_household_label":"JSH household ID","org_household_system":"jsh_register"},
    "bank":{"institution":"Chase","statement_format":"chase_csv"}}')
on conflict (id) do nothing;


insert into app.zones (center_id, name, zip_codes) values
('00000000-0000-4000-8000-000000000001', 'North',     '{77379,77380,77381,77382,77388,77389,77373}'),
('00000000-0000-4000-8000-000000000001', 'Northwest', '{77433,77429,77095,77070,77375}'),
('00000000-0000-4000-8000-000000000001', 'West',      '{77494,77450,77493,77441,77084,77079}'),
('00000000-0000-4000-8000-000000000001', 'Southwest', '{77479,77478,77459,77477,77498,77406,77407}'),
('00000000-0000-4000-8000-000000000001', 'South',     '{77584,77581,77546,77573,77598,77062}'),
('00000000-0000-4000-8000-000000000001', 'Northeast', '{77346,77339,77345,77396,77338}'),
('00000000-0000-4000-8000-000000000001', 'Central',   '{77401,77081,77002,77005,77025,77063,77056}');

insert into app.membership_types (center_id, key, tier, name, fee_cents, period_months, includes_spouse, reference_required, reference_tier_min, ec_approval_required, voting_wait_days) values
('00000000-0000-4000-8000-000000000001', 'community', 'community', 'Community member', 0, null, false, false, null, false, 0),
('00000000-0000-4000-8000-000000000001', 'yearly',    'yearly',    'Yearly membership', 0 /* [sample] fee TBD */, 12, true, true, 'yearly', false, 0),
('00000000-0000-4000-8000-000000000001', 'life',      'life',      'Life membership', 50100, null, true, true, 'life', true, 180);

insert into app.funds (center_id, key, name, restricted) values
('00000000-0000-4000-8000-000000000001', 'general', 'General fund', false),
('00000000-0000-4000-8000-000000000001', 'construction', 'New temple construction', true),
('00000000-0000-4000-8000-000000000001', 'pathshala', 'Pathshala', false),
('00000000-0000-4000-8000-000000000001', 'jeevdaya', 'Jeevdaya', true),
('00000000-0000-4000-8000-000000000001', 'bhojanshala', 'Bhojanshala', false),
('00000000-0000-4000-8000-000000000001', 'derasar_upkeep', 'Derasar upkeep', false),
('00000000-0000-4000-8000-000000000001', 'sadharmik', 'Sadharmik bhakti', true);

insert into app.pathshala_tracks (center_id, key, name) values
('00000000-0000-4000-8000-000000000001', 'jainism', 'Jainism'), ('00000000-0000-4000-8000-000000000001', 'gujarati', 'Gujarati'), ('00000000-0000-4000-8000-000000000001', 'hindi', 'Hindi');

insert into app.pathshala_levels (center_id, track_id, key, name, sort_order)
select '00000000-0000-4000-8000-000000000001', t.id, l.key, l.name, l.ord
from app.pathshala_tracks t join (values
  ('jainism','toddler','Toddler',0),('jainism','1','Jainism 1',1),('jainism','2','Jainism 2',2),('jainism','3','Jainism 3',3),
  ('jainism','4','Jainism 4',4),('jainism','5','Jainism 5',5),('jainism','6','Jainism 6',6),('jainism','7','Jainism 7',7),
  ('jainism','adult_dads','Adult class (Dads)',8),('jainism','adult_moms','Adult class (Moms)',9),
  ('gujarati','1','Gujarati 1',1),('gujarati','2','Gujarati 2',2),('gujarati','3','Gujarati 3',3),('gujarati','4','Gujarati 4',4),
  ('hindi','1','Hindi 1',1),('hindi','2','Hindi 2',2),('hindi','3','Hindi 3',3),('hindi','4','Hindi 4',4)
) as l(track, key, name, ord) on l.track = t.key
where t.center_id = '00000000-0000-4000-8000-000000000001';

insert into app.calendar_layers (center_id, key, name, kind, default_on, color) values
('00000000-0000-4000-8000-000000000001', 'pathshala', 'Pathshala', 'pathshala', true, '#5B4B8A'),
('00000000-0000-4000-8000-000000000001', 'events', 'JSH events', 'events', true, '#7A2E1F');

insert into app.volunteer_groups (center_id, name, requires_background_check) values
('00000000-0000-4000-8000-000000000001', 'Bhojanshala and kitchen', false), ('00000000-0000-4000-8000-000000000001', 'Pathshala teaching', true), ('00000000-0000-4000-8000-000000000001', 'Events and decoration', false),
('00000000-0000-4000-8000-000000000001', 'Derasar and puja seva', false), ('00000000-0000-4000-8000-000000000001', 'Tech and media', false), ('00000000-0000-4000-8000-000000000001', 'Youth mentoring', true),
('00000000-0000-4000-8000-000000000001', 'Seniors care', true), ('00000000-0000-4000-8000-000000000001', 'Parking and security', false);

insert into app.inboxes (center_id, key, name, response_target_hours) values
('00000000-0000-4000-8000-000000000001', 'membership', 'Membership', 72), ('00000000-0000-4000-8000-000000000001', 'events', 'Events', 72), ('00000000-0000-4000-8000-000000000001', 'pathshala', 'Pathshala', 72),
('00000000-0000-4000-8000-000000000001', 'donations', 'Donations', 72), ('00000000-0000-4000-8000-000000000001', 'temple', 'Temple and pujas', 72), ('00000000-0000-4000-8000-000000000001', 'office', 'JSH office', 72);
insert into app.inboxes (center_id, key, name, zone_id, role_key, response_target_hours)
select '00000000-0000-4000-8000-000000000001', 'zone_' || lower(z.name), z.name || ' zone', z.id, 'zone_lead', 24 from app.zones z where z.center_id = '00000000-0000-4000-8000-000000000001';

insert into app.whatsapp_groups (center_id, name, description, audience) values
('00000000-0000-4000-8000-000000000001', 'JSH Announcements', 'Official news and timings · admins only post', 'members'),
('00000000-0000-4000-8000-000000000001', 'Pathshala parents', 'Class updates and schedules', 'pathshala'),
('00000000-0000-4000-8000-000000000001', 'Youth (YJA and YJP)', 'Ages 14–30 · events and seva', 'members'),
('00000000-0000-4000-8000-000000000001', 'Seniors', 'Swadhyay, outings and rides', 'members'),
('00000000-0000-4000-8000-000000000001', 'Volunteers', 'Seva shifts and sign-ups', 'volunteers');
insert into app.whatsapp_groups (center_id, name, description, zone_id, audience)
select '00000000-0000-4000-8000-000000000001', z.name || ' zone', 'Local news and carpools', z.id, 'zone' from app.zones z where z.center_id = '00000000-0000-4000-8000-000000000001';

insert into app.labh_options (center_id, name, amount_cents, sort_order) values
('00000000-0000-4000-8000-000000000001', 'Snatra puja at the derasar', 5100, 1), ('00000000-0000-4000-8000-000000000001', 'Ashtaprakari puja', 10800, 2),
('00000000-0000-4000-8000-000000000001', 'Gift for the Pathshala class', 15100, 3), ('00000000-0000-4000-8000-000000000001', 'Jeevdaya donation', 5100, 4),
('00000000-0000-4000-8000-000000000001', 'Sponsor Sunday bhojanshala', 25100, 5), ('00000000-0000-4000-8000-000000000001', 'Sadharmik bhakti', 10800, 6);

insert into app.store_categories (center_id, name, sort_order) values ('00000000-0000-4000-8000-000000000001', 'Mithai', 1), ('00000000-0000-4000-8000-000000000001', 'Namkeen', 2), ('00000000-0000-4000-8000-000000000001', 'Meals', 3);
insert into app.store_items (center_id, category_id, name, price_cents, status)
select '00000000-0000-4000-8000-000000000001', c.id, i.name, i.price, 'active' from app.store_categories c join (values
  ('Mithai','Mohanthal', 899), ('Mithai','Kaju katli', 1299), ('Mithai','Sukhdi', 699),
  ('Namkeen','Farsi puri', 599), ('Namkeen','Chakri', 599), ('Namkeen','Khakhra (methi)', 499),
  ('Meals','Dal dhokli', 899), ('Meals','Khichdi kadhi', 899)
) as i(cat, name, price) on i.cat = c.name where c.center_id = '00000000-0000-4000-8000-000000000001';   -- [sample] menu

insert into app.guide_sections (center_id, slug, title, body_md, sort_order, is_checklist) values
('00000000-0000-4000-8000-000000000001', 'first-steps', 'Your first steps', '1. Join JSH WhatsApp groups\n2. Find your zone and zone lead\n3. Learn about membership\n4. Share your seva interests\n5. Ask us anything', 1, true),
('00000000-0000-4000-8000-000000000001', 'timings', 'Timings and visiting', '| What | When |\n|---|---|\n| Derasar | 7:30 AM – 6:00 PM daily |\n| Aarti | 12:30 PM and 4:30 PM |\n| Snatra puja | Sundays 9:30 AM |\n| Pathshala | Sundays 10:00 AM – 12:00 PM |\n| Bhojanshala | Sundays 12:15 PM · festival days |\n| Swadhyay | Wednesdays 7:30 PM (Zoom) |\n| Office | Sat–Sun 10:00 AM – 2:00 PM |\n\nPlease remove leather items before entering the derasar. [sample — confirm with office]', 2, false),
('00000000-0000-4000-8000-000000000001', 'membership', 'Membership', 'Membership is required to register children for Pathshala. Life members can vote in JSH elections after the waiting period, and their spouse is also a life member. Children roll off a family''s life membership at 18 and can apply on their own.', 3, false);

insert into app.role_roster (center_id, body, title, sort_order) values
('00000000-0000-4000-8000-000000000001', 'executive_committee', 'President', 1), ('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Vice President', 2),
('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Secretary', 3), ('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Treasurer', 4),
('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Religious coordinator', 5), ('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Pathshala coordinator', 6),
('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Technology officer', 7), ('00000000-0000-4000-8000-000000000001', 'executive_committee', 'Membership coordinator', 8),
('00000000-0000-4000-8000-000000000001', 'trustees', 'Chair, Board of Trustees', 1), ('00000000-0000-4000-8000-000000000001', 'trustees', 'Trustee (Temple construction)', 2),
('00000000-0000-4000-8000-000000000001', 'trustees', 'Trustee (Finance and investments)', 3), ('00000000-0000-4000-8000-000000000001', 'trustees', 'Trustee (Facilities)', 4);

insert into app.content_items (center_id, tradition, kind, slug, title, metadata, status, published_at) values
(null, 'shvetambar_murtipujak', 'pachchakhan', 'navkarsi', 'Navkarsi', '{"when":"48 minutes after sunrise"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'porsi', 'Porsi', '{"when":"One prahar after sunrise"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'sadh-porsi', 'Sadh-porsi', '{"when":"One and a half prahar after sunrise"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'purimaddh', 'Purimaddh', '{"when":"Midday"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'ekasana', 'Ekasana', '{"when":"One sitting meal"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'biyasana', 'Biyasana', '{"when":"Two sitting meals"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'ayambil', 'Ayambil', '{"when":"One meal of plain, boiled food"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'upvas', 'Upvas', '{"when":"Full-day fast"}', 'published', now()),
(null, 'shvetambar_murtipujak', 'pachchakhan', 'chauvihar', 'Chauvihar', '{"when":"Before sunset"}', 'published', now());
