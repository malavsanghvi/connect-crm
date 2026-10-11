-- 0690: the Store module is called "My Store" (it was "Satvik Store"). Owner request, 2026-10-11.
-- Only a value that is exactly "Satvik Store" changes, so a name a community chose for its own store is never touched.
-- Safe to run twice: the second run finds nothing to change. Nothing but the words changes (no keys, no switches).
--   A  the module's own name (app.modules, which the module-off messages and Settings > Modules read)
--   B  the Jain Center experience's `store` term (app.organization_categories.terms) and any module label that is exactly the old name
--   C  the notification topic's name, and the demo community's description and module label
--   D  the public dashboard's KPI list (app.public_kpi_catalog), which says "My Store orders"
do $$
begin
  perform app.set_audit_context('0690: rename Satvik Store to My Store');

  update app.modules set label = 'My Store' where key = 'store' and label = 'Satvik Store';

  update app.organization_categories set terms = jsonb_set(terms, '{store}', '"My Store"'::jsonb)
   where jsonb_typeof(terms) = 'object' and terms->>'store' = 'Satvik Store';
  update app.category_modules set label = 'My Store' where label = 'Satvik Store';

  update app.notification_topics set name = 'My Store' where key = 'store' and name = 'Satvik Store';

  update app.demo_packs set description = replace(description, 'the Satvik Store,', 'the store,')
   where description like '%the Satvik Store,%';
  update app.demo_packs set contents = replace(contents::text, '"label": "Satvik Store"', '"label": "My Store"')::jsonb
   where contents::text like '%"label": "Satvik Store"%';
end $$;

-- D. The same function as 0104, with one word changed in the label of the store_orders KPI.
create or replace function app.public_kpi_catalog(p_center uuid)
 RETURNS TABLE(kpi_key text, label text, section text, visibility text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select k.key, k.label, k.section, coalesce(s.visibility, 'members')
    from (values
      ('member_families', 'Member families', 'summary', 1), ('community_people', 'Community members', 'summary', 2),
      ('events_held', 'Events held', 'summary', 3), ('attendance', 'Check-ins', 'summary', 4),
      ('volunteer_hours', 'Volunteer hours', 'summary', 5), ('app_adoption', 'Families on the app', 'summary', 6),
      ('samayik', 'Samayiks completed', 'practice', 7), ('pratikraman', 'Pratikramans', 'practice', 8),
      ('navkar_malas', 'Navkar malas', 'practice', 9), ('gyan_levels', 'Gyan Path levels completed', 'practice', 10),
      ('gyan_steps', 'Gyan Path steps completed', 'practice', 11), ('anumodana', 'Anumodanas sent', 'practice', 12),
      ('pathshala_students', 'Pathshala students', 'learning', 13), ('volunteer_teachers', 'Volunteer teachers', 'learning', 14),
      ('class_attendance_rate', 'Class attendance rate', 'learning', 15), ('store_orders', 'My Store orders', 'seva', 16),
      ('attendance_by_month', 'Attendance by month', 'charts', 17), ('families_by_zone', 'Families by zone', 'charts', 18),
      ('campaign', 'Campaign progress', 'charts', 19)
    ) as k(key, label, section, ord)
    left join app.public_kpi_settings s on s.center_id = p_center and s.kpi_key = k.key
   where app.assert_module_enabled(p_center, 'reports')
     and (app.has_permission(p_center, 'reports.view') or app.has_permission(p_center, 'settings.manage'))
   order by k.ord
$function$;
