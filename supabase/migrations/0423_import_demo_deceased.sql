-- 0423 (stream e-people-legal) · the deceased flag in the import engine and the demo pack.
--
-- Import engine: People gain a "Date of death" column (people.deceased_on); a date alone also
-- marks the person deceased (0420's fill trigger). The whole import allow-list is re-seeded
-- below from src/lib/import/registry.ts (tests/import-registry.test.ts checks the latest
-- migration that carries the block).
--
-- Demo pack: one deceased person, "Maniben Doshi" of the Doshi family (her punyatithi was
-- already on the family's special days), added by a new step after the community data. She
-- is in the household, remembered on the punyatithi, and absent from every active list.
set client_min_messages = warning;

-- BEGIN import_entities seed (generated from src/lib/import/registry.ts)
insert into app.import_entities (key, label, tier, sort, target_table, write_perms, module_key, columns, extras, natural_key, money_columns, has_center) values
  ('zones', 'Zones and ZIP codes', 'setup', 30, 'zones', array['settings.manage'], 'people',
   array['name','zip_codes'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('inboxes', 'Inboxes', 'setup', 31, 'inboxes', array['settings.manage'], 'comms',
   array['key','name','response_target_hours'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('bank_accounts', 'Bank accounts', 'setup', 32, 'bank_accounts', array['accounting.manage'], 'giving',
   array['active','institution','last4','name','statement_format'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('funds', 'Funds', 'setup', 33, 'funds', array['giving.manage'], 'giving',
   array['active','key','name','qbo_class_id','restricted'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('membership_types', 'Membership types', 'setup', 34, 'membership_types', array['settings.manage'], 'membership',
   array['active','ec_approval_required','fee_cents','includes_spouse','key','name','period_months','reference_required','tier','voting_wait_days'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('store_categories', 'Store categories', 'setup', 35, 'store_categories', array['store.manage'], 'store',
   array['name','sort_order'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('calendar_layers', 'Calendar layers', 'setup', 36, 'calendar_layers', array['content.manage'], 'calendar',
   array['color','default_on','key','kind','name','source_url'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_tracks', 'Pathshala tracks', 'setup', 37, 'pathshala_tracks', array['pathshala.manage'], 'pathshala',
   array['key','name'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_terms', 'Pathshala terms', 'setup', 38, 'pathshala_terms', array['pathshala.manage'], 'pathshala',
   array['ends_on','fee_per_child_cents','fee_per_family_cap_cents','membership_required','name','registration_closes_at','registration_opens_at','sibling_discount_pct','starts_on','status'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('practices', 'Practices (My Jain Way)', 'setup', 39, 'practices', array['content.manage'], 'jain_way',
   array['active','category','default_minutes','description','key','name','points','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('gyan_goals', 'Gyan Path goals', 'setup', 40, 'gyan_goals', array['content.manage'], 'gyan_path',
   array['description','key','name','recommended','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('campaigns', 'Campaigns', 'setup', 50, 'campaigns', array['giving.manage'], 'giving',
   array['description','ends_on','fund_id','goal_cents','kind','name','starts_on','status'],
   '{}'::text[], array['name'], array['goal_cents'], true),
  ('event_templates', 'Event templates', 'setup', 51, 'event_templates', array['events.manage'], 'events',
   array['description','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('event_template_items', 'Event template checklist items', 'setup', 52, 'event_template_items', array['events.manage'], 'events',
   array['name','offset_days','phase','priority','sort_order','template_id'],
   '{}'::text[], array['template_id','name'], '{}'::text[], true),
  ('volunteer_groups', 'Volunteer groups', 'setup', 53, 'volunteer_groups', array['volunteers.manage'], 'volunteers',
   array['name','requires_background_check','requires_waiver_kind'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('pathshala_levels', 'Pathshala levels', 'setup', 54, 'pathshala_levels', array['pathshala.manage'], 'pathshala',
   array['key','max_age','min_age','name','sort_order','track_id'],
   '{}'::text[], array['track_id','key'], '{}'::text[], true),
  ('gyan_levels', 'Gyan Path levels', 'setup', 55, 'gyan_levels', array['content.manage'], 'gyan_path',
   array['chapter','goal_id','key','name','points','requires_teacher_signoff','sort_order'],
   '{}'::text[], array['goal_id','key'], '{}'::text[], false),
  ('gyan_steps', 'Gyan Path steps', 'setup', 60, 'gyan_steps', array['content.manage'], 'gyan_path',
   array['kind','level_id','points','sort_order','title'],
   '{}'::text[], array['level_id','title'], '{}'::text[], false),
  ('opportunities', 'Opportunities and sponsorships', 'setup', 70, 'opportunities', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','description','kind','min_amount_cents','name','quantity_available','sort_order','status'],
   '{}'::text[], array['campaign_id','name'], array['amount_cents'], true),
  ('labh_options', 'Labh options', 'setup', 71, 'labh_options', array['giving.manage'], 'giving',
   array['active','amount_cents','campaign_id','fund_id','name','sort_order'],
   '{}'::text[], array['name'], array['amount_cents'], true),
  ('pickup_windows', 'Store pickup windows', 'setup', 72, 'pickup_windows', array['store.manage'], 'store',
   array['capacity','ends_at','location','order_cutoff_at','starts_at'],
   '{}'::text[], array['starts_at'], '{}'::text[], true),
  ('pathshala_classes', 'Pathshala classes', 'setup', 73, 'pathshala_classes', array['pathshala.manage'], 'pathshala',
   array['capacity','ends_time','level_id','meets_on','name','room','starts_time','term_id'],
   '{}'::text[], array['term_id','name'], '{}'::text[], true),
  ('whatsapp_groups', 'WhatsApp groups', 'setup', 74, 'whatsapp_groups', array['comms.send'], 'comms',
   array['active','audience','description','name','zone_id'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('households', 'Households', 'records', 100, 'households', array['people.manage'], 'people',
   array['address_line1','address_line2','city','directory_opt_in','display_name','household_number','notes','physical_mail_opt_in','postal_code','state_region','zone_id'],
   array['crm_id','legacy_id'], '{}'::text[], '{}'::text[], true),
  ('people', 'People', 'records', 101, 'people', array['people.manage'], 'people',
   array['date_of_birth','deceased_on','email','employer','first_name','gender','is_deceased','language','last_name','member_number','phone_e164','preferred_name','profession'],
   array['crm_id','email_opt_in','email_opt_in_date','email_opt_in_source','full_name','household_id','is_primary','legacy_id','other_emails','relationship'], '{}'::text[], '{}'::text[], true),
  ('household_members', 'Household members and relationships', 'records', 110, 'household_members', array['people.manage'], 'people',
   array['household_id','is_primary','joined_at','left_at','person_id','role'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('external_ids', 'Identifiers', 'records', 111, 'external_ids', array['people.manage','giving.manage'], 'people',
   array['household_id','kind','label','person_id','system','value'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('channel_optins', 'Consents, opt-ins and opt-outs', 'records', 112, 'channel_optins', array['comms.send'], 'comms',
   array['address','channel','opted_in','person_id','recorded_at','source'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('special_days', 'Special days', 'records', 120, 'special_days', array['people.manage'], 'people',
   array['calendar_date','household_id','kind','label','person_id','tithi','tithi_month'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('memberships', 'Memberships (current and past)', 'records', 121, 'memberships', array['people.manage'], 'membership',
   array['crm_external_id','ends_on','household_id','membership_type_id','notes','person_id','starts_on','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('pathshala_enrollments', 'Pathshala enrollments', 'records', 122, 'pathshala_enrollments', array['pathshala.manage'], 'pathshala',
   array['class_id','household_id','notes','status','student_person_id','term_id'],
   '{}'::text[], array['term_id','student_person_id'], '{}'::text[], true),
  ('pathshala_teachers', 'Pathshala teachers', 'records', 123, 'pathshala_teachers', array['pathshala.manage'], 'pathshala',
   array['class_id','person_id','role'],
   '{}'::text[], array['class_id','person_id'], '{}'::text[], true),
  ('volunteer_interests', 'Volunteer interests', 'records', 124, 'volunteer_interests', array['volunteers.manage'], 'volunteers',
   array['group_id','person_id','status'],
   '{}'::text[], array['person_id','group_id'], '{}'::text[], true),
  ('background_checks', 'Background checks', 'records', 125, 'background_checks', array['safety.manage'], 'volunteers',
   array['cleared_on','expires_on','person_id','provider','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('store_items', 'Store items and opening stock', 'records', 130, 'store_items', array['store.manage'], 'store',
   array['category_id','description','low_stock_threshold','name','pack_size','price_cents','qbo_item_id','sku','status','taxable','track_inventory'],
   array['opening_stock'], array['sku'], array['price_cents'], true),
  ('pledges', 'Pledges', 'history', 200, 'pledges', array['giving.manage'], 'giving',
   array['amount_cents','anonymous','campaign_id','closed_at','crm_external_id','dedication','due_on','fund_id','household_id','pledge_number','pledged_at','pledged_by_person_id','source','status'],
   array['paid_so_far'], '{}'::text[], array['amount_cents','paid_so_far'], true),
  ('payments', 'Payments (history)', 'history', 210, 'payments', array['giving.manage'], 'giving',
   array['amount_cents','check_number','crm_external_id','household_id','memo','method','payer_person_id','provider_ref','receipt_number','received_on','status'],
   array['allocate_to','allocation_cents'], '{}'::text[], array['amount_cents'], true),
  ('payment_allocations', 'Payment allocations', 'history', 220, 'payment_allocations', array['giving.manage'], 'giving',
   array['amount_cents','payment_id','pledge_id'],
   '{}'::text[], array['payment_id','pledge_id'], array['amount_cents'], true),
  ('recurring_gifts', 'Recurring gifts', 'history', 230, 'recurring_gifts', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','frequency','fund_id','household_id','method','next_charge_on','person_id','starts_on'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('bolis', 'Past bolis', 'history', 240, 'bolis', array['bolis.manage'], 'bolis',
   array['campaign_id','closes_at','event_id','kind','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('boli_entries', 'Boli results', 'history', 241, 'boli_entries', array['bolis.manage'], 'bolis',
   array['amount_cents','boli_id','display_name','entered_at','household_id','person_id'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('events', 'Past events', 'history', 242, 'events', array['events.manage'], 'events',
   array['description','ends_at','name','program_year','starts_at','venue'],
   array['legacy_id'], '{}'::text[], '{}'::text[], true),
  ('attendees', 'Event attendance', 'history', 243, 'attendees', array['events.manage'], 'events',
   array['checked_in_at','event_id','person_id'],
   array['household_id'], '{}'::text[], '{}'::text[], true),
  ('pathshala_attendance', 'Pathshala attendance', 'history', 244, 'pathshala_attendance', array['pathshala.manage'], 'pathshala',
   array['note','status'],
   array['class_id','held_on','student_person_id'], '{}'::text[], '{}'::text[], true)
on conflict (key) do update set label = excluded.label, tier = excluded.tier, sort = excluded.sort, target_table = excluded.target_table,
  write_perms = excluded.write_perms, module_key = excluded.module_key, columns = excluded.columns, extras = excluded.extras,
  natural_key = excluded.natural_key, money_columns = excluded.money_columns, has_center = excluded.has_center;
-- END import_entities seed

-- ── Demo pack: step "remembrance" ───────────────────────────────────────────────
create or replace function app.demo_community_remembrance(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_pid uuid := app.demo_p(p_seed, 'h04.maniben'); v_hid uuid := app.demo_h(p_seed, 'h04'); v_on date := app.demo_today(p_center) - 400;
begin
  insert into app.people (id, center_id, first_name, last_name, date_of_birth, gender, language, is_verified, verified_at,
                          is_deceased, deceased_on, deceased_note, deceased_recorded_by, deceased_recorded_at)
  values (v_pid, p_center, 'Maniben', 'Doshi', v_on - make_interval(years => 88), 'female', 'gu', true, now() - interval '900 days',
          true, v_on, 'Hemantbhai''s mother. The family marks her punyatithi each year.', p_actor, now() - interval '395 days');
  insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
  values (v_hid, v_pid, p_center, 'parent', false, app.demo_today(p_center) - 900);
  insert into app.person_deceased_events (center_id, person_id, action, deceased_on, note, reason, recorded_by, recorded_at)
  values (p_center, v_pid, 'marked', v_on, 'Hemantbhai''s mother.', 'Demo data: the family told the office', p_actor, now() - interval '395 days');
  update app.special_days set person_id = v_pid
   where center_id = p_center and household_id = v_hid and kind = 'punyatithi' and person_id is null;
end $$;
revoke execute on function app.demo_community_remembrance(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function app.demo_pack_steps(p_pack text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select case p_pack
    when 'community' then jsonb_build_array(
      jsonb_build_object('key', 'setup',       'label', 'Setup data: zones, funds, membership types, store, Pathshala, practices'),
      jsonb_build_object('key', 'people',      'label', 'Households and people'),
      jsonb_build_object('key', 'membership',  'label', 'Memberships, applications and staff'),
      jsonb_build_object('key', 'giving',      'label', 'Pledges, payments, recurring gifts and bolis'),
      jsonb_build_object('key', 'events',      'label', 'Events, RSVPs, tickets, check-ins and lunch'),
      jsonb_build_object('key', 'store',       'label', 'Store orders'),
      jsonb_build_object('key', 'pathshala',   'label', 'Pathshala enrollments, attendance and progress'),
      jsonb_build_object('key', 'learning',    'label', 'Gyan Path and My Jain Way'),
      jsonb_build_object('key', 'community',   'label', 'Messages, surveys, volunteers, governance and content'),
      jsonb_build_object('key', 'remembrance', 'label', 'A member of a family who has passed away'),
      jsonb_build_object('key', 'logins',      'label', 'Linking demo sign-ins'))
    else '[]'::jsonb end
$$;

-- The pack's contents: one more person and household link, and the history of the mark.
update app.demo_packs
   set contents = (select jsonb_agg(case when m->>'module' = 'people'
                                         then jsonb_set(jsonb_set(jsonb_set(m, '{rows,people}', to_jsonb((m#>>'{rows,people}')::int + 1)),
                                                                  '{rows,household_members}', to_jsonb((m#>>'{rows,household_members}')::int + 1)),
                                                        '{rows,person_deceased_events}', '1'::jsonb)
                                         else m end order by o)
                     from jsonb_array_elements(contents) with ordinality x(m, o)),
       description = replace(description, 'their memberships,', 'their memberships (and one family''s late grandmother, remembered),')
 where key = 'community' and not (contents::text like '%person_deceased_events%');
