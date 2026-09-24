-- Onboarding · stream o-setup · 4 of 5: non-profit verification and the brand kit.
--
--   app.submit_org_verification(center)
--       The organization (settings.manage or the owner) submits its legal identity and
--       documents. Needs legal name, EIN and entity type, a W-9, and a determination
--       letter / group exemption — or, for a house of worship, a board or attorney letter.
--       Records the IRS lookup at the time of submitting on the audit entry.
--   app.decide_org_verification(center, verified, note)
--       A platform admin verifies or sends back (a note is required to send back). The
--       person who submitted cannot also verify. Audited with the note as the reason.
--   app.org_verification_queue()
--       Platform › Verification: every organization that has started, with its documents
--       count and the IRS lookup, submitted ones first. Platform admins only.
--   app.set_center_branding(center, patch)
--       Merges brand-kit keys into centers.branding (contract keys logo_path, mark_path,
--       logo_dark_path, email_header_path, colors {primary, accent}; plus the public URL
--       of each file and the contact keys the member app already reads). A null value
--       removes the key. Only settings.manage, the owner or a platform admin.

create or replace function app.submit_org_verification(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.org_profiles; v_kinds text[]; v_missing text[] := '{}'; v_irs jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'Only the owner or someone with settings.manage can submit the organization for verification.' using errcode = '42501';
  end if;
  select * into p from app.org_profiles where center_id = p_center for update;
  if not found then raise exception 'Save the legal identity first (legal name, EIN and entity type).' using errcode = '23514'; end if;
  if p.verification_status = 'verified' then raise exception 'This organization is already verified.' using errcode = '23514'; end if;
  if p.verification_status = 'submitted' then raise exception 'This organization is already waiting for review.' using errcode = '23514'; end if;
  if p.legal_name is null then v_missing := v_missing || 'the legal name'::text; end if;
  if p.ein is null then v_missing := v_missing || 'the EIN'::text; end if;
  if p.entity_type is null then v_missing := v_missing || 'the entity type'::text; end if;
  select coalesce(array_agg(distinct kind), '{}') into v_kinds from app.org_documents where center_id = p_center;
  if not ('w9' = any (v_kinds)) then v_missing := v_missing || 'a signed W-9'::text; end if;
  if not (v_kinds && array['determination_letter','group_exemption']
          or (v_kinds && array['board_letter','attorney_letter'] and p.entity_type = 'house_of_worship')) then
    v_missing := v_missing || case when p.entity_type = 'house_of_worship'
      then 'an IRS determination letter, group exemption letter, or a board or attorney letter'
      else 'an IRS determination letter or proof of a group exemption' end;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Before submitting, add %.', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  v_irs := app.irs_lookup(p.ein, p.legal_name);
  perform set_config('app.org_verification', 'on', true);
  update app.org_profiles set verification_status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         verification_note = null, verified_by = null, verified_at = null
   where center_id = p_center;
  perform set_config('app.org_verification', '', true);
  perform app.log_audit(p_center, 'org_profiles.submit_verification', 'org_profiles', p_center::text, null,
                        jsonb_build_object('irs_lookup', v_irs, 'documents', v_kinds));
  return jsonb_build_object('status', 'submitted', 'irs', v_irs);
end $$;

create or replace function app.decide_org_verification(p_center uuid, p_verified boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.org_profiles; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.is_platform_admin() then
    raise exception 'Only Community Connect platform admins can verify an organization.' using errcode = '42501';
  end if;
  select * into p from app.org_profiles where center_id = p_center for update;
  if not found or p.verification_status not in ('submitted','verified') then
    raise exception 'This organization has not been submitted for verification.' using errcode = '23514';
  end if;
  if p_verified and p.verification_status = 'verified' then
    raise exception 'This organization is already verified.' using errcode = '23514';
  end if;
  if not p_verified and v_note is null then
    raise exception 'Say what is missing or wrong, so the organization knows what to fix.' using errcode = '23514';
  end if;
  if p.submitted_by is not null and p.submitted_by = auth.uid() then
    raise exception 'You submitted this organization, so a different platform admin must review it.' using errcode = '23514';
  end if;
  perform app.set_audit_context(coalesce(v_note, case when p_verified then 'Verified non-profit' end));
  perform set_config('app.org_verification', 'on', true);
  update app.org_profiles set
      verification_status = case when p_verified then 'verified' else 'rejected' end,
      verified_by = case when p_verified then auth.uid() end,
      verified_at = case when p_verified then now() end,
      verification_note = v_note
   where center_id = p_center;
  perform set_config('app.org_verification', '', true);
  perform app.log_audit(p_center, case when p_verified then 'org_profiles.verify' else 'org_profiles.reject_verification' end,
                        'org_profiles', p_center::text, jsonb_build_object('verification_status', p.verification_status),
                        jsonb_build_object('verification_status', case when p_verified then 'verified' else 'rejected' end,
                                           'irs_lookup', app.irs_lookup(p.ein, p.legal_name)), v_note);
  return jsonb_build_object('status', case when p_verified then 'verified' else 'rejected' end);
end $$;

create or replace function app.org_verification_queue()
returns table (center_id uuid, center_name text, center_slug text, center_status text, legal_name text, dba text, ein text,
               entity_type text, incorporation_state text, verification_status text, verification_note text,
               submitted_at timestamptz, verified_at timestamptz, documents int, irs jsonb)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only Community Connect platform admins can see the verification queue.' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, c.slug::text, c.status, p.legal_name, p.dba, p.ein, p.entity_type, p.incorporation_state,
         p.verification_status, p.verification_note, p.submitted_at, p.verified_at,
         (select count(*)::int from app.org_documents d where d.center_id = c.id),
         case when p.ein is null then null else app.irs_lookup(p.ein, p.legal_name) end
    from app.org_profiles p join app.centers c on c.id = p.center_id
   order by (p.verification_status = 'submitted') desc, p.submitted_at nulls last, c.name;
end $$;

-- ── Brand kit ────────────────────────────────────────────────────────────────
create or replace function app.set_center_branding(p_center uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_paths constant text[] := array['logo_path','mark_path','logo_dark_path','email_header_path'];
  v_urls  constant text[] := array['logo_url','mark_url','logo_dark_url','email_header_url','website','map_url'];
  v_texts constant text[] := array['address','place_name','phone'];
  v_branding jsonb; k text; val jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'Only the owner or someone with settings.manage can change the brand kit.' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'The brand kit change must be a set of keys.' using errcode = '22023';
  end if;
  select branding into v_branding from app.centers where id = p_center for update;
  if not found then raise exception 'That community was not found.' using errcode = '23503'; end if;
  for k, val in select * from jsonb_each(p_patch) loop
    if jsonb_typeof(val) = 'null' then
      v_branding := v_branding - k;
      continue;
    end if;
    if k = any (v_paths) then
      if jsonb_typeof(val) <> 'string' or split_part(val #>> '{}', '/', 1) <> p_center::text or (val #>> '{}') ~ '\.\.'
         or length(val #>> '{}') > 300 then
        raise exception 'The % must be a file of this community in the branding area.', replace(k, '_', ' ') using errcode = '22023';
      end if;
    elsif k = any (v_urls) then
      if jsonb_typeof(val) <> 'string' or (val #>> '{}') !~* '^https?://[^\s]+$' or length(val #>> '{}') > 1000 then
        raise exception 'The % must be a web address starting with https://.', replace(k, '_', ' ') using errcode = '22023';
      end if;
    elsif k = any (v_texts) then
      if jsonb_typeof(val) <> 'string' or length(val #>> '{}') > 300 then
        raise exception 'The % is too long (300 characters at most).', replace(k, '_', ' ') using errcode = '22023';
      end if;
    elsif k = 'colors' then
      if jsonb_typeof(val) <> 'object' or exists (select 1 from jsonb_each(val) c
            where c.key not in ('primary','accent') or jsonb_typeof(c.value) <> 'string' or (c.value #>> '{}') !~* '^#[0-9a-f]{6}$') then
        raise exception 'Brand colors are a primary and an accent color, each like #1B2C5C.' using errcode = '22023';
      end if;
    else
      raise exception 'The brand kit has no setting called "%".', k using errcode = '22023';
    end if;
    v_branding := jsonb_set(v_branding, array[k], val, true);
  end loop;
  update app.centers set branding = v_branding where id = p_center;
  return v_branding;
end $$;

grant execute on function app.submit_org_verification(uuid), app.decide_org_verification(uuid, boolean, text),
  app.org_verification_queue(), app.set_center_branding(uuid, jsonb) to authenticated;
grant execute on all functions in schema app to service_role;
