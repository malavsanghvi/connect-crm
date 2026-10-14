-- 0791 · What a pledge's PDF says: one read of everything an invoice-style copy of a pledge shows (owner request 2026-10-14: "Print
-- should print the Pledge PDF with all standard details as if its an invoice ... Use Center's branding"). Part 2 of 4 (0790 default on,
-- 0791 this, 0792 the email, 0793 the bulk upload). NEEDS OWNER OK: a new read of a household's pledge, address and payments.
--
-- WHAT IS ADDED, AND ONLY THIS
--   app._pledge_document_core(pledge, majority)   the facts, as one JSON document, with no formatting (the portal and the background
--                                                  service write the PDF from it: src/lib/pledge-pdf/document.ts). Nothing checks who
--                                                  asks here: only the two functions below call it.
--   app.pledge_document(center, pledge, majority)  for a signed-in person of that community with giving.view or giving.manage (the
--                                                  Pledges list's own rule), Giving on. The pledge must be the community's (anything
--                                                  else answers "not found": a pledge of another community is never confirmed to exist).
--   app.worker_pledge_document(message, pledge, majority)
--                                                  for the background service only, to draw the PDF that goes with an email: it answers
--                                                  only for a pledge the message itself names in its payload attachments
--                                                  ({kind: "pledge_pdf", pledge_id}) and that belongs to the message's community.
--
-- THE DOCUMENT HAS: the community (name, currency, time zone, country, languages, the brand: logo files and colours; the legal name,
-- tax id, address, contact and website from its organization profile), the pledge (number, the day it was made in the community's time
-- zone, due date, status, amount, paid to date, instalments, dedication, campaign, fund, opportunity, who pledged when an adult), the
-- household as its card shows it (name, Connect household number, the organization's own household ID, primary member, address) with
-- the first names of the household's children so the writer can keep them out, the payments applied to the pledge, and the community's
-- own pledge-confirmation signer and note. No child's name, birth date or email is in it.
set client_min_messages = warning;

create or replace function app._pledge_document_core(p_pledge uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  pl app.pledges; c app.centers; op app.org_profiles; hh app.households;
  v_maj int := greatest(18, least(coalesce(p_majority, 18), 25));
  v_tz text; v_primary text; v_primary_org text; v_pledger text; v_minors jsonb;
begin
  select * into pl from app.pledges where id = p_pledge;
  if pl.id is null then return null; end if;
  select * into c from app.centers where id = pl.center_id;
  select * into op from app.org_profiles where center_id = pl.center_id;
  select * into hh from app.households where id = pl.household_id;
  v_tz := coalesce(nullif(c.time_zone, ''), 'UTC');
  v_minors := app._email_minor_first_names(pl.household_id, v_maj);

  -- The primary member as the household card names them, when an adult.
  select pe.first_name || ' ' || pe.last_name into v_primary
    from app.household_members hm join app.people pe on pe.id = hm.person_id
   where hm.household_id = pl.household_id and hm.is_primary and hm.left_at is null and pe.merged_into_id is null
     and not coalesce(pe.is_deceased, false) and app._statement_adult(pe.date_of_birth, hm.role, v_maj)
   order by pe.id limit 1;
  select e.value into v_primary_org
    from app.household_members hm join app.external_ids e on e.person_id = hm.person_id and e.kind = 'org_member'
   where hm.household_id = pl.household_id and hm.is_primary and hm.left_at is null and e.valid_to is null
   order by e.created_at limit 1;
  -- Who pledged, only when an adult of the household.
  if pl.pledged_by_person_id is not null then
    select pe.first_name || ' ' || pe.last_name into v_pledger
      from app.household_members hm join app.people pe on pe.id = hm.person_id
     where hm.household_id = pl.household_id and hm.person_id = pl.pledged_by_person_id and hm.left_at is null
       and not coalesce(pe.is_deceased, false) and app._statement_adult(pe.date_of_birth, hm.role, v_maj)
     limit 1;
  end if;

  return jsonb_build_object(
    'center', jsonb_build_object(
      'id', c.id, 'name', c.name, 'short_name', coalesce(nullif(btrim(c.short_name), ''), c.name), 'currency', c.currency,
      'time_zone', c.time_zone, 'country', c.country,
      'languages', to_jsonb(coalesce(nullif(op.languages, '{}'::text[]), array['en']::text[])),
      'household_label', nullif(btrim(c.rules #>> '{identifiers,org_household_label}'), ''),
      'branding', jsonb_build_object(
        'logo_path', nullif(btrim(c.branding->>'logo_path'), ''), 'email_header_path', nullif(btrim(c.branding->>'email_header_path'), ''),
        'mark_path', nullif(btrim(c.branding->>'mark_path'), ''), 'primary', nullif(btrim(c.branding #>> '{colors,primary}'), ''),
        'accent', nullif(btrim(c.branding #>> '{colors,accent}'), ''), 'address', nullif(btrim(c.branding->>'address'), ''))),
    'organization', jsonb_build_object(
      'legal_name', nullif(btrim(op.legal_name), ''), 'dba', nullif(btrim(op.dba), ''), 'ein', nullif(btrim(op.ein), ''),
      'address', op.registered_address, 'public_email', nullif(btrim(op.public_email), ''), 'public_phone', nullif(btrim(op.public_phone), ''),
      'website', nullif(btrim(op.website), ''), 'office_hours', nullif(btrim(op.office_hours), '')),
    'pledge', jsonb_build_object(
      'id', pl.id, 'number', pl.pledge_number, 'status', pl.status::text, 'pledged_at', (pl.pledged_at at time zone v_tz)::date,
      'due_on', pl.due_on, 'amount_cents', pl.amount_cents, 'paid_cents', pl.paid_cents, 'installments', pl.installments,
      'dedication', nullif(btrim(pl.dedication), ''),
      'campaign', (select cp.name from app.campaigns cp where cp.id = pl.campaign_id),
      'fund', (select f.name from app.funds f where f.id = pl.fund_id),
      'opportunity', (select o.name from app.opportunities o where o.id = pl.opportunity_id),
      'opportunity_option', nullif(btrim(pl.opportunity_option), ''),
      'pledged_by', v_pledger),
    'household', jsonb_build_object(
      'id', hh.id, 'name', hh.display_name, 'number', hh.household_number,
      'org_household_id', (select e.value from app.external_ids e where e.household_id = hh.id and e.kind = 'org_household'
                             and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
      'primary_member', v_primary, 'primary_org_member_id', v_primary_org, 'minor_first_names', v_minors,
      'address', jsonb_build_object('line1', nullif(btrim(hh.address_line1), ''), 'line2', nullif(btrim(hh.address_line2), ''),
                                    'city', nullif(btrim(hh.city), ''), 'state_region', nullif(btrim(hh.state_region), ''),
                                    'postal_code', nullif(btrim(hh.postal_code), ''))),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('received_on', x.received_on, 'method', x.method, 'receipt_number', x.receipt_number,
                                          'amount_cents', x.amount_cents) order by x.received_on, x.created_at)
        from (select pay.received_on, pay.method::text as method, pay.receipt_number, al.amount_cents, pay.created_at
                from app.payment_allocations al join app.payments pay on pay.id = al.payment_id
               where al.pledge_id = pl.id and app.statement_counted_status(pay.status)) x), '[]'::jsonb),
    'wording', (select jsonb_build_object('signed_by', t.signed_by, 'personal_note', t.personal_note)
                  from app.receipt_templates t where t.center_id = pl.center_id and t.kind = 'pledge_confirmation'));
end $$;
revoke execute on function app._pledge_document_core(uuid, integer) from public, anon, authenticated;
grant execute on function app._pledge_document_core(uuid, integer) to service_role;
comment on function app._pledge_document_core(uuid, integer) is
  'Everything a pledge''s PDF says, as JSON with no formatting (0791). Checks nothing about who asks: app.pledge_document and app.worker_pledge_document do.';

create or replace function app.pledge_document(p_center uuid, p_pledge uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  select pl.center_id into v_center from app.pledges pl where pl.id = p_pledge;
  -- A pledge of another community is never confirmed to exist.
  if v_center is null or p_center is null or v_center <> p_center then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  if not (app.has_permission(v_center, 'giving.view') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(v_center, 'giving');
  return app._pledge_document_core(p_pledge, p_majority);
end $$;
revoke execute on function app.pledge_document(uuid, uuid, integer) from public, anon;
grant execute on function app.pledge_document(uuid, uuid, integer) to authenticated;
comment on function app.pledge_document(uuid, uuid, integer) is
  'A pledge''s PDF facts for a signed-in person of its community with giving.view or giving.manage, Giving on (0791). Another community''s pledge answers "not found".';

create or replace function app.worker_pledge_document(p_message uuid, p_pledge uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare m app.messages;
begin
  perform app.assert_worker();
  select * into m from app.messages where id = p_message;
  if m.id is null then return null; end if;
  -- Only for a pledge this message names, and only in the message's own community.
  if not exists (select 1
                   from jsonb_array_elements(case when jsonb_typeof(m.payload->'attachments') = 'array' then m.payload->'attachments' else '[]'::jsonb end) a
                  where a->>'kind' = 'pledge_pdf' and a->>'pledge_id' = p_pledge::text) then
    return null;
  end if;
  if not exists (select 1 from app.pledges pl where pl.id = p_pledge and pl.center_id is not distinct from m.center_id) then return null; end if;
  return app._pledge_document_core(p_pledge, p_majority);
end $$;
revoke execute on function app.worker_pledge_document(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_pledge_document(uuid, uuid, integer) to connect_worker;
comment on function app.worker_pledge_document(uuid, uuid, integer) is
  'For the background service: the facts of the pledge a message names as a pledge_pdf attachment, to draw the PDF that goes with the email (0791). Null for any other pledge.';
