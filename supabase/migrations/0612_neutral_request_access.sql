-- 0612 · Neutral "Request access" (owner direction 2026-10-08, priority 2): Weaver is a free association and
-- community-management platform for everyone, not a Jain platform. What a visitor sees before they are inside an
-- organization says so, and the kinds of organization come from data (the experiences catalog), not from a fixed list.
--
--   A. app.access_requests keeps what the applicant chose, in the catalog's own words:
--        org_type            now the broad group the applicant chose (faith_based, a family key from the catalog,
--                            other), not one of three fixed words. Rows from before keep temple, community_center and
--                            other_nonprofit and stay valid; the old three-value check becomes a format check.
--        experience_key      the more specific choice inside the group (a Jain temple, a church, a chamber ...) or
--                            'other'; null when the group has nothing more specific.
--        org_detail          the applicant's own words ("Tell us more, for example your temple, church, mosque or tradition").
--        org_type_label,     the words the applicant saw, kept so Platform > Requests reads the same next year even if the
--        experience_label    catalog changes. The portal sets them from the catalog, never from the form.
--      Nothing here chooses the organization's category: Community Connect still does that (set_access_request_category).
--   B. app.submit_access_request takes the four new fields as optional last arguments. The 14-argument function is
--      dropped and replaced in the same file, so the API sees one function and a caller that still sends 14 arguments
--      (a portal that is not updated yet) keeps working. The example phone number in its message is a neutral one.
--   C. The platform's own e-mail and text templates (center_id null) say "Weaver" where they said "Community Connect"
--      (0220, 0290, 0594). A plain wording change: no placeholder, key, channel or language changes. An organization's
--      own copies of a template (center_id set) are the organization's and are not touched.
--
-- JSH: nothing JSH members or admins see inside the organization changes. The templates above are the platform's e-mails
-- to people who ask for access, to staff invitations and to sandbox owners; JSH's own messages use its own templates.
set client_min_messages = warning;

-- ── A · what the applicant chose ────────────────────────────────────────────
alter table app.access_requests add column if not exists experience_key text;
alter table app.access_requests add column if not exists org_detail text;
alter table app.access_requests add column if not exists org_type_label text;
alter table app.access_requests add column if not exists experience_label text;

-- The three-word check of 0200 (whatever its name) goes; keys are data now.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'app.access_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%org_type%'
  loop
    execute format('alter table app.access_requests drop constraint %I', c.conname);
  end loop;
end $$;

alter table app.access_requests drop constraint if exists access_requests_org_type_format;
alter table app.access_requests add constraint access_requests_org_type_format
  check (org_type ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.access_requests drop constraint if exists access_requests_experience_key_format;
alter table app.access_requests add constraint access_requests_experience_key_format
  check (experience_key is null or experience_key ~ '^[a-z][a-z0-9_]{1,59}$');
alter table app.access_requests drop constraint if exists access_requests_org_detail_length;
alter table app.access_requests add constraint access_requests_org_detail_length
  check (org_detail is null or length(org_detail) <= 500);
alter table app.access_requests drop constraint if exists access_requests_kind_labels_length;
alter table app.access_requests add constraint access_requests_kind_labels_length
  check ((org_type_label is null or length(org_type_label) <= 120) and (experience_label is null or length(experience_label) <= 120));

comment on column app.access_requests.org_type is
  'The broad kind of organization the applicant chose: a group key from the experiences catalog (faith_based, a family key, other). Requests from before 0612 hold temple, community_center or other_nonprofit.';
comment on column app.access_requests.experience_key is
  'The more specific choice inside the group (an experience key from the catalog) or other; null when the group has nothing more specific (0612).';
comment on column app.access_requests.org_detail is
  'The applicant''s own words about the organization: the temple, church, mosque or tradition, or what kind of organization it is (0612).';
comment on column app.access_requests.org_type_label is
  'The group label the applicant saw when they chose (0612); kept so the requests list reads the same if the catalog changes.';
comment on column app.access_requests.experience_label is
  'The specific choice''s label the applicant saw when they chose (0612).';

-- ── B · submit_access_request with the new fields ──────────────────────────
drop function if exists app.submit_access_request(text, text, text, text, int, text, text, text, text, text[], text[], text, text, text);

create or replace function app.submit_access_request(
  p_org_legal_name text, p_org_type text, p_city text, p_state text, p_approx_households int,
  p_contact_name text, p_contact_email text, p_contact_phone text default null, p_website text default null,
  p_modules_interested text[] default '{}', p_current_systems text[] default '{}', p_heard_from text default null,
  p_ip text default null, p_user_agent text default null,
  p_experience_key text default null, p_org_detail text default null,
  p_org_type_label text default null, p_experience_label text default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_email text := lower(btrim(coalesce(p_contact_email, ''))); v_phone text; v_ip inet; v_id uuid;
        v_modules text[]; v_systems text[];
        v_type text := lower(btrim(coalesce(p_org_type, '')));
        v_exp text := nullif(lower(btrim(coalesce(p_experience_key, ''))), '');
        v_detail text := nullif(left(btrim(coalesce(p_org_detail, '')), 500), '');
begin
  v_ip := app.caller_ip(p_ip);
  if app.rate_limited('access_request.all', 'all', interval '1 hour', 200) then
    raise exception 'We are receiving a lot of requests right now. Please try again in an hour.' using errcode = 'CCRTE';
  end if;
  if app.rate_limited('access_request.ip', coalesce(host(v_ip), 'unknown'), interval '1 hour', 5) then
    raise exception 'Too many requests were sent from this connection. Please try again in an hour.' using errcode = 'CCRTE';
  end if;
  if app.rate_limited('access_request.email', v_email, interval '1 day', 3) then
    raise exception 'We already have requests from this email today. We will reply to it; there is no need to send another.' using errcode = 'CCRTE';
  end if;

  if length(btrim(coalesce(p_org_legal_name, ''))) < 2 then raise exception 'Enter the organization''s legal name.'; end if;
  if v_type !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Choose the kind of organization.';
  end if;
  if v_exp is not null and v_exp !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'Choose which description fits your organization best, or Other.';
  end if;
  if (v_type = 'other' or v_exp = 'other') and (v_detail is null or length(v_detail) < 3) then
    raise exception 'Tell us a little about your organization so we can set it up.';
  end if;
  if length(btrim(coalesce(p_city, ''))) < 1 or length(btrim(coalesce(p_state, ''))) < 2 then raise exception 'Enter the city and state.'; end if;
  if p_approx_households is not null and (p_approx_households < 0 or p_approx_households > 1000000) then
    raise exception 'Enter roughly how many households, as a number.';
  end if;
  if length(btrim(coalesce(p_contact_name, ''))) < 2 then raise exception 'Enter your name.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  v_phone := nullif(regexp_replace(coalesce(p_contact_phone, ''), '[\s().-]', '', 'g'), '');
  if v_phone is not null and v_phone ~ '^[0-9]{10}$' then v_phone := '+1' || v_phone; end if;
  if v_phone is not null and v_phone ~ '^1[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the mobile number with its area code, for example (212) 555-0123.';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
    from unnest(coalesce(p_modules_interested, '{}')) m where m in (select key from app.modules);
  select coalesce(array_agg(distinct left(btrim(s), 60)), '{}') into v_systems
    from unnest(coalesce(p_current_systems, '{}')) s where btrim(s) <> '';
  if cardinality(v_systems) > 20 then raise exception 'List at most 20 current systems.'; end if;

  perform app.set_audit_context('Access request from ' || btrim(p_org_legal_name));
  insert into app.access_requests (org_legal_name, org_type, experience_key, org_detail, org_type_label, experience_label,
                                   city, state, approx_households, contact_name, contact_email,
                                   contact_phone, website, modules_interested, current_systems, heard_from, ip, user_agent)
  values (btrim(p_org_legal_name), v_type, v_exp, v_detail,
          nullif(left(btrim(coalesce(p_org_type_label, '')), 120), ''), nullif(left(btrim(coalesce(p_experience_label, '')), 120), ''),
          btrim(p_city), btrim(p_state), p_approx_households, btrim(p_contact_name), v_email,
          v_phone, nullif(left(btrim(coalesce(p_website, '')), 300), ''), v_modules, v_systems,
          nullif(left(btrim(coalesce(p_heard_from, '')), 300), ''), v_ip,
          left(nullif(btrim(coalesce(p_user_agent, (select c.user_agent from app.audit_context() c), '')), ''), 500))
  returning id into v_id;
  perform app.rate_note('access_request.all', 'all');
  perform app.rate_note('access_request.ip', coalesce(host(v_ip), 'unknown'));
  perform app.rate_note('access_request.email', v_email);
  return v_id;
end $$;

revoke execute on function app.submit_access_request(text, text, text, text, int, text, text, text, text, text[], text[], text, text, text, text, text, text, text) from public;
grant execute on function app.submit_access_request(text, text, text, text, int, text, text, text, text, text[], text[], text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

-- ── C · the platform's own templates say Weaver ──────────────────────────────
select app.set_audit_context('0612: the platform e-mail and text templates say Weaver, not Community Connect');
update app.message_templates
   set subject = replace(subject, 'Community Connect', 'Weaver'),
       body    = replace(body, 'Community Connect', 'Weaver')
 where center_id is null
   and (subject like '%Community Connect%' or body like '%Community Connect%');
