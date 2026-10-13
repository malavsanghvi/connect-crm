-- 0765 · CatchTheMatch slice 2, part 1: the SHARED employer-program directory (docs/CATCH_THE_MATCH.md sections 6, 7 and 9;
-- owner answers of 2026-10-13). Builder MATCH2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   One directory of employers' matching-gift and volunteer-grant programs, shared by every community that has CatchTheMatch
--   (module `matching`) on. Public facts only: the company and the other names it goes by, the ratio, the minimum and maximum
--   per gift and per year, the kinds of gift and of organization that qualify (and whether religious organizations do, or
--   only their programs that are not worship), the portal and its link, the deadline, the volunteer-grant rules, where the
--   facts come from, when they were last checked and by whom (Weaver's team or a community). NEVER who works there or who
--   gave: nothing in these two tables names a person or a community, and nothing here counts them.
--     app.match_programs        one row per program (a company may have one per country)
--     app.match_program_names   the company's name and the other names it goes by, each with a key for matching
--     app.employer_name_key(t)  the key: Unicode compatibility form (full-width letters, ligatures), lower case, accents
--                               dropped, spaces and punctuation of every script dropped. Letters and digits of every script
--                               are kept as they are, and no word of any language is treated specially: "ＡＣＭＥ Corp.",
--                               "acme corp" and "ACME-CORP" share a key, and "株式会社日立製作所" contains "日立製作所".
--   The directory starts EMPTY (owner, 2026-10-13): Weaver's team adds entries from the employers' own pages, with the source
--   and the date. A licensed database later would be the source 'partner'; nothing more now.
--
--   WHO READS: Weaver's team (platform admins), and anyone who may read CatchTheMatch data in at least one community where it
--   is on (app.matching_readable_centers, 0758). Everyone else reads nothing.
--   WHO WRITES: nobody directly. Weaver's team through app.save_match_program, app.set_match_program_retired and
--   app.merge_match_programs (a reason each). A community's CatchTheMatch manager by approving a submission (0766).
--   AUDIT: app.audit_shared_row: when, before and after, and who only when it is Weaver's team. A community's manager is never
--   named in this history (no user, address or browser): the reason names the community instead (owner: Weaver sees the
--   submitting community's name, never the person). module = null and no community: the history belongs to Weaver's
--   directory, so platform admins read it (0758's audit_read), and nothing in it is about a person.
--   The organization's own CatchTheMatch data (submissions 0766, links of employers on file to entries 0767) keeps 0757's
--   contract: matching_can only, no platform-admin read, a private audit.
set client_min_messages = warning;

-- ── The lists ────────────────────────────────────────────────────────────────
-- Where the employee asks for the match.
create or replace function app.match_portals() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['benevity', 'yourcause', 'cybergrants', 'bright_funds', 'employer_form', 'other']::text[]
$$;
-- Gifts the employer matches.
create or replace function app.match_gift_types() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['one_time', 'recurring', 'payroll', 'stock', 'donor_advised_fund', 'event']::text[]
$$;
-- Kinds of organization the employer matches gifts to (religious organizations have their own rule below).
create or replace function app.match_org_kinds() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['any_charity', 'education', 'arts_culture', 'health', 'human_services', 'environment_animals',
               'civic_community', 'international']::text[]
$$;
-- Religious organizations: eligible; only their programs that are not worship (a food bank, classes); not eligible.
-- Null on a program: not known yet.
create or replace function app.match_religious_rules() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['eligible', 'non_worship_only', 'excluded']::text[]
$$;
-- When the match must be asked for: by December 31 of the gift's year; within N months of the gift; by a date in the year
-- after the gift; no deadline. Null: not known yet.
create or replace function app.match_deadline_kinds() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['end_of_gift_year', 'months_after_gift', 'date_next_year', 'none']::text[]
$$;
-- Where the facts come from. 'partner': a licensed matching-gift database, later.
create or replace function app.match_sources() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['employer_site', 'employer_document', 'portal_listing', 'submission', 'partner', 'other']::text[]
$$;

-- ── The key a name is matched on ─────────────────────────────────────────────
-- NFKD (full-width and compatibility characters become plain ones, accented letters a letter and its accent), lower case,
-- the combining accents of the Latin, Greek and Cyrillic scripts (U+0300-U+036F) dropped, then white space and punctuation
-- dropped: ASCII and Latin-1 punctuation and symbols, the general and supplemental
-- punctuation blocks, CJK and full-width punctuation, and the punctuation of the Armenian, Hebrew, Arabic, Devanagari and
-- Thai blocks. Every letter, digit and mark of every script stays. Null when nothing is left.
create or replace function app.employer_name_key(p text) returns text
language sql immutable parallel safe set search_path = app, public, extensions as $$
  select nullif(
           regexp_replace(
             regexp_replace(lower(normalize(coalesce(p, ''), nfkd)), '[\u0300-\u036f]', '', 'g'),
             '[[:space:]\u0001-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u055a-\u055f\u0589\u05be\u05c0\u05c3\u05f3\u05f4\u060c\u061b\u061f\u066a-\u066d\u06d4\u0964\u0965\u0970\u0e4f\u0e5a\u0e5b\u2000-\u206f\u2e00-\u2e7f\u3000-\u303f\u30fb\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+',
             '', 'g'),
           '')
$$;
comment on function app.employer_name_key(text) is
  'The key an employer''s name is matched on (0765): compatibility form, lower case, Latin accents and every script''s spaces and punctuation dropped; letters and digits of every script kept; no word of any language treated specially.';

-- ── The tables ───────────────────────────────────────────────────────────────
create table if not exists app.match_programs (
  id                       uuid primary key default gen_random_uuid(),
  company_name             text not null check (char_length(company_name) between 1 and 160),
  country                  text check (country is null or country ~ '^[A-Z]{2}$'),
  gift_match               boolean not null default true,
  volunteer_grant          boolean not null default false,
  -- What the employer gives for each 1 given, in basis points: 10000 = 1:1, 20000 = 2:1, 5000 = 0.5:1.
  match_ratio_bp           integer check (match_ratio_bp is null or match_ratio_bp between 1 and 100000),
  currency                 text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  min_gift_cents           bigint check (min_gift_cents is null or min_gift_cents >= 0),
  max_gift_cents           bigint check (max_gift_cents is null or max_gift_cents > 0),
  max_year_cents           bigint check (max_year_cents is null or max_year_cents > 0),
  gift_types               text[] not null default '{}' check (gift_types <@ app.match_gift_types()),
  org_kinds                text[] not null default '{}' check (org_kinds <@ app.match_org_kinds()),
  religious_orgs           text check (religious_orgs is null or religious_orgs = any (app.match_religious_rules())),
  eligibility_note         text check (eligibility_note is null or char_length(eligibility_note) <= 500),
  portal                   text check (portal is null or portal = any (app.match_portals())),
  portal_url               text check (portal_url is null or (portal_url ~* '^https://[^[:space:]]+$' and char_length(portal_url) <= 500)),
  deadline_kind            text check (deadline_kind is null or deadline_kind = any (app.match_deadline_kinds())),
  deadline_months          integer check (deadline_months is null or deadline_months between 1 and 36),
  deadline_month           integer check (deadline_month is null or deadline_month between 1 and 12),
  deadline_day             integer check (deadline_day is null or deadline_day between 1 and 31),
  deadline_note            text check (deadline_note is null or char_length(deadline_note) <= 300),
  volunteer_cents_per_hour bigint check (volunteer_cents_per_hour is null or volunteer_cents_per_hour > 0),
  volunteer_min_hours      integer check (volunteer_min_hours is null or volunteer_min_hours between 1 and 1000),
  volunteer_max_year_cents bigint check (volunteer_max_year_cents is null or volunteer_max_year_cents > 0),
  volunteer_note           text check (volunteer_note is null or char_length(volunteer_note) <= 300),
  notes                    text check (notes is null or char_length(notes) <= 1000),
  source                   text not null check (source = any (app.match_sources())),
  source_url               text check (source_url is null or (source_url ~* '^https://[^[:space:]]+$' and char_length(source_url) <= 500)),
  last_verified_on         date,
  verified_by_kind         text check (verified_by_kind is null or verified_by_kind in ('weaver', 'community')),
  -- A community's check: the submission it approved (0766 adds the reference). Only that community can open it.
  verified_submission_id   uuid,
  status                   text not null default 'active' check (status in ('active', 'retired', 'merged')),
  merged_into              uuid references app.match_programs(id),
  status_reason            text check (status_reason is null or char_length(status_reason) <= 500),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint match_programs_does_something check (gift_match or volunteer_grant),
  constraint match_programs_gift_range check (min_gift_cents is null or max_gift_cents is null or min_gift_cents <= max_gift_cents),
  constraint match_programs_gift_rules check (gift_match or (match_ratio_bp is null and min_gift_cents is null and max_gift_cents is null
                                                             and max_year_cents is null and cardinality(gift_types) = 0)),
  constraint match_programs_volunteer_rules check (volunteer_grant or (volunteer_cents_per_hour is null and volunteer_min_hours is null
                                                                       and volunteer_max_year_cents is null and volunteer_note is null)),
  constraint match_programs_deadline check (
    case deadline_kind
      when 'months_after_gift' then deadline_months is not null and deadline_month is null and deadline_day is null
      when 'date_next_year' then deadline_months is null and deadline_month is not null and deadline_day is not null
      else deadline_months is null and deadline_month is null and deadline_day is null
    end),
  constraint match_programs_merged check ((status = 'merged') = (merged_into is not null) and merged_into is distinct from id),
  constraint match_programs_verified check ((last_verified_on is null) = (verified_by_kind is null)
                                            and (verified_submission_id is null or verified_by_kind = 'community'))
);
create index if not exists match_programs_status_idx on app.match_programs (status, lower(company_name));
comment on table app.match_programs is
  'The shared employer-program directory (0765, CatchTheMatch): public facts about an employer''s matching-gift and volunteer-grant program, never who works there or who gave. Read by Weaver''s team and by CatchTheMatch readers of any community where it is on; written only by save_match_program / set_match_program_retired / merge_match_programs (Weaver) and decide_match_submission (0766).';
comment on column app.match_programs.religious_orgs is
  'Religious organizations: eligible, non_worship_only (only their programs that are not worship), excluded; null = not known yet.';

create table if not exists app.match_program_names (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references app.match_programs(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 160),
  name_key    text not null check (name_key <> ''),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint match_program_names_once unique (program_id, name_key)
);
create unique index if not exists match_program_names_one_primary on app.match_program_names (program_id) where is_primary;
create index if not exists match_program_names_key_idx on app.match_program_names (name_key);
comment on table app.match_program_names is
  'The names a program''s company goes by (0765): its name (is_primary) and others (an abbreviation, the name in another script), each with app.employer_name_key.';

-- A program's name is trimmed; updated_at moves with every change.
create or replace function app.match_programs_tidy() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.company_name := btrim(regexp_replace(coalesce(new.company_name, ''), '\s+', ' ', 'g'));
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.match_programs_tidy() from public, anon, authenticated;
drop trigger if exists match_programs_tidy on app.match_programs;
create trigger match_programs_tidy before insert or update on app.match_programs
  for each row execute function app.match_programs_tidy();

-- A name is trimmed and keyed; a name with no letter or digit is refused.
create or replace function app.match_program_names_key() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  new.name_key := app.employer_name_key(new.name);
  if new.name_key is null then
    raise exception 'A company''s name needs at least one letter or digit.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.match_program_names_key() from public, anon, authenticated;
drop trigger if exists match_program_names_key on app.match_program_names;
create trigger match_program_names_key before insert or update on app.match_program_names
  for each row execute function app.match_program_names_key();

-- ── The audit of the shared directory ────────────────────────────────────────
-- Like app.audit_row (0102), for tables that belong to no community: the entry has no community and no module, and it names
-- the person who made the change only when that person is on Weaver's team. Anyone else (a community's CatchTheMatch
-- manager approving a submission) is left out, with their address, browser and request id: the reason the function that
-- wrote it set says which community it was.
create or replace function app.audit_shared_row() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_before jsonb; v_after jsonb; c record; v_weaver boolean;
begin
  v_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  select * into c from app.audit_context();
  v_weaver := auth.uid() is not null and app.is_platform_admin();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (null, case when v_weaver then auth.uid() end, auth.jwt()->>'role', tg_table_name || '.' || lower(tg_op),
          tg_table_name, coalesce(v_after, v_before)->>'id', v_before, v_after, c.reason,
          case when v_weaver then c.correlation_id end, case when v_weaver then c.ip end,
          case when v_weaver then c.user_agent end, null, c.client_app, c.client_screen);
  return coalesce(new, old);
end $$;
revoke execute on function app.audit_shared_row() from public, anon, authenticated;

drop trigger if exists audit_match_programs on app.match_programs;
create trigger audit_match_programs after insert or update or delete on app.match_programs
  for each row execute function app.audit_shared_row();
drop trigger if exists audit_match_program_names on app.match_program_names;
create trigger audit_match_program_names after insert or update or delete on app.match_program_names
  for each row execute function app.audit_shared_row();
-- Core platform: the directory is Weaver's, shared by every community (its readers need CatchTheMatch on somewhere).
insert into app.module_tables (table_name, module_key) values ('match_programs', null), ('match_program_names', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Who reads ────────────────────────────────────────────────────────────────
create or replace function app.match_directory_can_read() returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (app.is_platform_admin() or cardinality(app.matching_readable_centers()) > 0)
$$;
comment on function app.match_directory_can_read() is
  'The shared directory''s readers (0765): Weaver''s team, and anyone who may read CatchTheMatch data in at least one community where it is on.';

alter table app.match_programs enable row level security;
alter table app.match_program_names enable row level security;
drop policy if exists match_programs_read on app.match_programs;
create policy match_programs_read on app.match_programs for select to authenticated
  using ((select app.match_directory_can_read()));
drop policy if exists match_program_names_read on app.match_program_names;
create policy match_program_names_read on app.match_program_names for select to authenticated
  using ((select app.match_directory_can_read()));
-- No write policies: only the functions below (and 0766's decide_match_submission) write.
revoke all on app.match_programs, app.match_program_names from public, anon, authenticated;
grant select on app.match_programs, app.match_program_names to authenticated;
grant all on app.match_programs, app.match_program_names to service_role;

-- ── Reading what a caller sends (plain-English errors) ───────────────────────
-- A text value: trimmed (one line: runs of white space become one space), null when empty, at most p_max characters.
create or replace function app._mj_text(p jsonb, p_key text, p_max int, p_label text, p_one_line boolean default true) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p->p_key) not in ('string', 'number') then
    raise exception '% must be text.', p_label using errcode = '22023';
  end if;
  v := case when p_one_line then btrim(regexp_replace(p->>p_key, '\s+', ' ', 'g')) else btrim(p->>p_key) end;
  v := nullif(v, '');
  if v is not null and char_length(v) > p_max then
    raise exception '% can be at most % characters.', p_label, p_max using errcode = '22023';
  end if;
  return v;
end $$;

-- A whole number from p_min to p_max, or null.
create or replace function app._mj_int(p jsonb, p_key text, p_min bigint, p_max bigint, p_label text) returns bigint
language plpgsql immutable set search_path = app, public, extensions as $$
declare t text; v numeric;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p->p_key) not in ('string', 'number') then
    raise exception '% must be a whole number.', p_label using errcode = '22023';
  end if;
  t := btrim(p->>p_key);
  if t = '' then return null; end if;
  if t !~ '^-?[0-9]{1,15}(\.0+)?$' then
    raise exception '% must be a whole number.', p_label using errcode = '22023';
  end if;
  v := t::numeric;
  if v < p_min or v > p_max then
    raise exception '% must be from % to %.', p_label, p_min, p_max using errcode = '22023';
  end if;
  return v::bigint;
end $$;

create or replace function app._mj_bool(p jsonb, p_key text, p_default boolean, p_label text) returns boolean
language plpgsql immutable set search_path = app, public, extensions as $$
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return p_default; end if;
  if jsonb_typeof(p->p_key) = 'boolean' then return (p->>p_key)::boolean; end if;
  if lower(btrim(p->>p_key)) in ('true', 'false') then return lower(btrim(p->>p_key))::boolean; end if;
  raise exception '% must be yes or no.', p_label using errcode = '22023';
end $$;

-- One value of a list, or null.
create or replace function app._mj_choice(p jsonb, p_key text, p_allowed text[], p_label text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := app._mj_text(p, p_key, 60, p_label);
begin
  if v is not null and not (v = any (p_allowed)) then
    raise exception 'Unknown % "%".', p_label, v using errcode = '22023';
  end if;
  return v;
end $$;

-- Several values of a list (each once, sorted), or an empty list.
create or replace function app._mj_list(p jsonb, p_key text, p_allowed text[], p_label text) returns text[]
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text[]; bad text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p->p_key) = 'null' then return '{}'::text[]; end if;
  if jsonb_typeof(p->p_key) <> 'array' then
    raise exception 'The %s must be a list.', p_label using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)), '{}'::text[]) into v
    from jsonb_array_elements_text(p->p_key) x where btrim(x) <> '';
  select x into bad from unnest(v) x where not (x = any (p_allowed)) limit 1;
  if bad is not null then
    raise exception 'Unknown % "%".', p_label, bad using errcode = '22023';
  end if;
  return v;
end $$;

-- A web address that starts with https://, or null.
create or replace function app._mj_https(p jsonb, p_key text, p_label text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := app._mj_text(p, p_key, 500, p_label);
begin
  if v is not null and v !~* '^https://[^[:space:]/]+\.[^[:space:]]+$' then
    raise exception '% must be a full web address that starts with https://.', p_label using errcode = '22023';
  end if;
  return v;
end $$;

-- The facts of a program as one clean object, from what Weaver's team or a community sent; every rule in plain English.
-- Facts that do not apply are dropped: the gift rules when it matches no gifts, the volunteer rules when it pays no volunteer
-- grants, the deadline's numbers its kind does not use. p_default_source: the source when none is given (null: required).
create or replace function app._match_program_clean(p jsonb, p_default_source text) returns jsonb
language plpgsql stable set search_path = app, public, extensions as $$
declare
  v_name text; v_names text[] := '{}'; v_keys text[]; x text; k text;
  v_country text; v_gift boolean; v_vol boolean; v_currency text;
  v_ratio bigint; v_min bigint; v_max bigint; v_year bigint; v_types text[];
  v_kinds text[]; v_rel text; v_elig text; v_portal text; v_portal_url text;
  v_dkind text; v_dmonths bigint; v_dmonth bigint; v_dday bigint; v_dnote text;
  v_vrate bigint; v_vhours bigint; v_vyear bigint; v_vnote text; v_notes text;
  v_source text; v_source_url text; v_on_text text; v_on date;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'The program''s facts are missing.' using errcode = '22023';
  end if;

  v_name := app._mj_text(p, 'company_name', 160, 'The company''s name');
  if v_name is null then raise exception 'Enter the company''s name.' using errcode = '22023'; end if;
  if app.employer_name_key(v_name) is null then
    raise exception 'The company''s name needs at least one letter or digit.' using errcode = '22023';
  end if;
  v_keys := array[app.employer_name_key(v_name)];
  if p ? 'names' and jsonb_typeof(p->'names') not in ('array', 'null') then
    raise exception 'The other names must be a list.' using errcode = '22023';
  end if;
  for x in select btrim(regexp_replace(e, '\s+', ' ', 'g'))
             from jsonb_array_elements_text(case when jsonb_typeof(p->'names') = 'array' then p->'names' else '[]'::jsonb end) e
  loop
    continue when x = '';
    if char_length(x) > 160 then
      raise exception 'Each other name can be at most 160 characters.' using errcode = '22023';
    end if;
    k := app.employer_name_key(x);
    if k is null then
      raise exception 'The other name "%" needs at least one letter or digit.', x using errcode = '22023';
    end if;
    continue when k = any (v_keys);
    v_keys := v_keys || k;
    v_names := v_names || x;
  end loop;
  if cardinality(v_names) > 30 then
    raise exception 'A company can have at most 30 other names.' using errcode = '22023';
  end if;

  v_country := app._mj_text(p, 'country', 60, 'The country');
  if v_country is not null then
    if v_country !~ '^[A-Za-z]{2}$' then
      raise exception 'The country is a two-letter code, like US, IN or GB.' using errcode = '22023';
    end if;
    v_country := upper(v_country);
  end if;

  v_gift := app._mj_bool(p, 'gift_match', true, 'Matches gifts');
  v_vol := app._mj_bool(p, 'volunteer_grant', false, 'Pays volunteer grants');
  if not v_gift and not v_vol then
    raise exception 'Say what the program does: it matches gifts, pays volunteer grants, or both.' using errcode = '22023';
  end if;
  v_currency := upper(coalesce(app._mj_text(p, 'currency', 60, 'The currency'), 'USD'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'The currency is a three-letter code, like USD, INR or GBP.' using errcode = '22023';
  end if;

  if v_gift then
    v_ratio := app._mj_int(p, 'match_ratio_bp', 1, 100000, 'The match ratio (in hundredths of a percent)');
    v_min := app._mj_int(p, 'min_gift_cents', 0, 100000000000, 'The minimum gift (in cents)');
    v_max := app._mj_int(p, 'max_gift_cents', 1, 100000000000, 'The maximum matched per gift (in cents)');
    v_year := app._mj_int(p, 'max_year_cents', 1, 100000000000, 'The maximum matched per year (in cents)');
    if v_min is not null and v_max is not null and v_min > v_max then
      raise exception 'The minimum gift is more than the maximum matched per gift.' using errcode = '22023';
    end if;
    v_types := app._mj_list(p, 'gift_types', app.match_gift_types(), 'kind of gift');
  else
    v_types := '{}';
  end if;

  v_kinds := app._mj_list(p, 'org_kinds', app.match_org_kinds(), 'kind of organization');
  v_rel := app._mj_choice(p, 'religious_orgs', app.match_religious_rules(), 'rule for religious organizations');
  v_elig := app._mj_text(p, 'eligibility_note', 500, 'The note on which organizations qualify', false);

  v_portal := app._mj_choice(p, 'portal', app.match_portals(), 'portal');
  v_portal_url := app._mj_https(p, 'portal_url', 'The portal''s link');

  v_dkind := app._mj_choice(p, 'deadline_kind', app.match_deadline_kinds(), 'kind of deadline');
  if v_dkind = 'months_after_gift' then
    v_dmonths := app._mj_int(p, 'deadline_months', 1, 36, 'The months after the gift');
    if v_dmonths is null then
      raise exception 'Say how many months after the gift the match must be asked for.' using errcode = '22023';
    end if;
  elsif v_dkind = 'date_next_year' then
    v_dmonth := app._mj_int(p, 'deadline_month', 1, 12, 'The deadline''s month');
    v_dday := app._mj_int(p, 'deadline_day', 1, 31, 'The deadline''s day');
    if v_dmonth is null or v_dday is null then
      raise exception 'Give the deadline''s month and day in the year after the gift.' using errcode = '22023';
    end if;
    begin
      perform make_date(2000, v_dmonth::int, v_dday::int);
    exception when others then
      raise exception 'The deadline is not a real date (month %, day %).', v_dmonth, v_dday using errcode = '22023';
    end;
  end if;
  v_dnote := app._mj_text(p, 'deadline_note', 300, 'The note on the deadline', false);

  if v_vol then
    v_vrate := app._mj_int(p, 'volunteer_cents_per_hour', 1, 100000000, 'The volunteer grant per hour (in cents)');
    v_vhours := app._mj_int(p, 'volunteer_min_hours', 1, 1000, 'The minimum volunteer hours');
    v_vyear := app._mj_int(p, 'volunteer_max_year_cents', 1, 100000000000, 'The maximum volunteer grant per year (in cents)');
    v_vnote := app._mj_text(p, 'volunteer_note', 300, 'The note on volunteer grants', false);
  end if;

  v_notes := app._mj_text(p, 'notes', 1000, 'The notes', false);
  v_source := coalesce(app._mj_choice(p, 'source', app.match_sources(), 'source'), p_default_source);
  if v_source is null then
    raise exception 'Say where the facts come from.' using errcode = '22023';
  end if;
  v_source_url := app._mj_https(p, 'source_url', 'The source''s link');

  v_on_text := app._mj_text(p, 'verified_on', 10, 'The date the facts were checked');
  if v_on_text is not null then
    if v_on_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'The date the facts were checked must be a date, like 2026-10-13.' using errcode = '22023';
    end if;
    begin
      v_on := v_on_text::date;
    exception when others then
      raise exception 'The date the facts were checked is not a real date.' using errcode = '22023';
    end;
    if v_on > current_date or v_on < date '2000-01-01' then
      raise exception 'The date the facts were checked must be today or earlier.' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'company_name', v_name, 'names', to_jsonb(v_names), 'country', v_country,
    'gift_match', v_gift, 'volunteer_grant', v_vol, 'match_ratio_bp', v_ratio, 'currency', v_currency,
    'min_gift_cents', v_min, 'max_gift_cents', v_max, 'max_year_cents', v_year, 'gift_types', to_jsonb(v_types),
    'org_kinds', to_jsonb(v_kinds), 'religious_orgs', v_rel, 'eligibility_note', v_elig,
    'portal', v_portal, 'portal_url', v_portal_url,
    'deadline_kind', v_dkind, 'deadline_months', v_dmonths, 'deadline_month', v_dmonth, 'deadline_day', v_dday,
    'deadline_note', v_dnote,
    'volunteer_cents_per_hour', v_vrate, 'volunteer_min_hours', v_vhours, 'volunteer_max_year_cents', v_vyear,
    'volunteer_note', v_vnote,
    'notes', v_notes, 'source', v_source, 'source_url', v_source_url, 'verified_on', v_on);
end $$;

-- A list in a clean object as text[].
create or replace function app._mj_array(p jsonb) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}'::text[])
$$;

-- An active program with a name of these keys (other than p_except) for the same country, or where either says no
-- country, or null.
create or replace function app._match_name_clash(p_keys text[], p_country text, p_except uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select g.company_name
    from app.match_program_names n join app.match_programs g on g.id = n.program_id
   where g.status = 'active' and g.id is distinct from p_except and n.name_key = any (p_keys)
     and (g.country is not distinct from p_country or g.country is null or p_country is null)
   order by g.created_at
   limit 1
$$;

-- Writes a clean object (app._match_program_clean) to a new program (p_id null) or to an active one, with its names, and
-- marks it checked by p_kind ('weaver' or 'community') on p_verified_on. One program per name and country: an active
-- program with one of these names, of the same country or with none given on either side, is refused. The caller has checked who may, and set the reason.
create or replace function app._match_program_write(p_id uuid, c jsonb, p_kind text, p_verified_on date, p_submission uuid)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid := p_id; g app.match_programs; v_keys text[]; v_clash text; v_country text := c->>'country'; x text;
begin
  if p_kind not in ('weaver', 'community') then raise exception 'Unknown checker "%".', p_kind; end if;
  select coalesce(array_agg(distinct app.employer_name_key(s.n)), '{}'::text[]) into v_keys
    from (select c->>'company_name' as n union all select unnest(app._mj_array(c->'names'))) s;
  if p_id is not null then
    select * into g from app.match_programs where id = p_id for update;
    if g.id is null then raise exception 'That directory entry was not found.'; end if;
    if g.status = 'merged' then raise exception 'This entry was merged into another one. Change that one instead.'; end if;
    if g.status = 'retired' then raise exception 'This entry is retired. Bring it back first.'; end if;
  end if;
  v_clash := app._match_name_clash(v_keys, v_country, p_id);
  if v_clash is not null then
    raise exception '"%" is already in the directory%. Open it to change it, or mark this one a duplicate of it.',
      v_clash, case when v_country is not null then ' for ' || v_country else '' end using errcode = '23505';
  end if;
  if p_id is null then
    insert into app.match_programs (company_name, country, gift_match, volunteer_grant, match_ratio_bp, currency,
                                    min_gift_cents, max_gift_cents, max_year_cents, gift_types, org_kinds, religious_orgs,
                                    eligibility_note, portal, portal_url, deadline_kind, deadline_months, deadline_month,
                                    deadline_day, deadline_note, volunteer_cents_per_hour, volunteer_min_hours,
                                    volunteer_max_year_cents, volunteer_note, notes, source, source_url, last_verified_on,
                                    verified_by_kind, verified_submission_id)
    values (c->>'company_name', v_country, (c->>'gift_match')::boolean, (c->>'volunteer_grant')::boolean,
            (c->>'match_ratio_bp')::int, c->>'currency', (c->>'min_gift_cents')::bigint, (c->>'max_gift_cents')::bigint,
            (c->>'max_year_cents')::bigint, app._mj_array(c->'gift_types'), app._mj_array(c->'org_kinds'), c->>'religious_orgs',
            c->>'eligibility_note', c->>'portal', c->>'portal_url', c->>'deadline_kind', (c->>'deadline_months')::int,
            (c->>'deadline_month')::int, (c->>'deadline_day')::int, c->>'deadline_note',
            (c->>'volunteer_cents_per_hour')::bigint, (c->>'volunteer_min_hours')::int, (c->>'volunteer_max_year_cents')::bigint,
            c->>'volunteer_note', c->>'notes', c->>'source', c->>'source_url', p_verified_on,
            case when p_verified_on is not null then p_kind end,
            case when p_verified_on is not null and p_kind = 'community' then p_submission end)
    returning id into v_id;
  else
    update app.match_programs
       set company_name = c->>'company_name', country = v_country, gift_match = (c->>'gift_match')::boolean,
           volunteer_grant = (c->>'volunteer_grant')::boolean, match_ratio_bp = (c->>'match_ratio_bp')::int,
           currency = c->>'currency', min_gift_cents = (c->>'min_gift_cents')::bigint,
           max_gift_cents = (c->>'max_gift_cents')::bigint, max_year_cents = (c->>'max_year_cents')::bigint,
           gift_types = app._mj_array(c->'gift_types'), org_kinds = app._mj_array(c->'org_kinds'),
           religious_orgs = c->>'religious_orgs', eligibility_note = c->>'eligibility_note', portal = c->>'portal',
           portal_url = c->>'portal_url', deadline_kind = c->>'deadline_kind', deadline_months = (c->>'deadline_months')::int,
           deadline_month = (c->>'deadline_month')::int, deadline_day = (c->>'deadline_day')::int,
           deadline_note = c->>'deadline_note', volunteer_cents_per_hour = (c->>'volunteer_cents_per_hour')::bigint,
           volunteer_min_hours = (c->>'volunteer_min_hours')::int,
           volunteer_max_year_cents = (c->>'volunteer_max_year_cents')::bigint, volunteer_note = c->>'volunteer_note',
           notes = c->>'notes', source = c->>'source', source_url = c->>'source_url',
           last_verified_on = coalesce(p_verified_on, last_verified_on),
           verified_by_kind = case when p_verified_on is not null then p_kind else verified_by_kind end,
           verified_submission_id = case when p_verified_on is not null
                                         then case when p_kind = 'community' then p_submission end
                                         else verified_submission_id end
     where id = p_id;
  end if;
  -- The names: the company's name first (it may have been one of the other names), then the others; names no longer given go.
  update app.match_program_names set is_primary = false where program_id = v_id and is_primary;
  delete from app.match_program_names where program_id = v_id and name_key <> all (v_keys);
  insert into app.match_program_names (program_id, name, is_primary) values (v_id, c->>'company_name', true)
    on conflict (program_id, name_key) do update set name = excluded.name, is_primary = true;
  foreach x in array app._mj_array(c->'names') loop
    insert into app.match_program_names (program_id, name, is_primary) values (v_id, x, false)
      on conflict (program_id, name_key) do nothing;
  end loop;
  return v_id;
end $$;

-- ── Weaver's team writes ─────────────────────────────────────────────────────
create or replace function app._assert_weaver(p_doing text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only Weaver''s team can %.', p_doing using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Adds an entry (p_id null) or changes one. The facts' verified_on is the day Weaver's team checked them on the source
-- (today when not given). Returns the entry's id.
create or replace function app.save_match_program(p_id uuid, p_program jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c jsonb;
begin
  perform app._assert_weaver('change the gift matching directory');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say what changed and why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  c := app._match_program_clean(p_program, null);
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  return app._match_program_write(p_id, c, 'weaver', coalesce((c->>'verified_on')::date, current_date), null);
end $$;

-- Retires an entry (the program ended: it stays readable, no longer offered for new links) or brings it back.
create or replace function app.set_match_program_retired(p_id uuid, p_retired boolean, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; v_clash text;
begin
  perform app._assert_weaver('retire or bring back a directory entry');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  select * into g from app.match_programs where id = p_id for update;
  if g.id is null then raise exception 'That directory entry was not found.'; end if;
  if g.status = 'merged' then raise exception 'This entry was merged into another one.'; end if;
  if coalesce(p_retired, true) then
    if g.status = 'retired' then return; end if;
  else
    if g.status = 'active' then return; end if;
    v_clash := app._match_name_clash(array(select n.name_key from app.match_program_names n where n.program_id = p_id), g.country, p_id);
    if v_clash is not null then
      raise exception '"%" is in the directory with one of this entry''s names. Merge the two instead.', v_clash using errcode = '23505';
    end if;
  end if;
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  update app.match_programs
     set status = case when coalesce(p_retired, true) then 'retired' else 'active' end,
         status_reason = case when coalesce(p_retired, true) then app.audit_clean_reason(p_reason) end
   where id = p_id;
end $$;

-- Two entries for one program: p_drop's names move to p_keep and p_drop points at it from then on. Links and submissions that
-- name p_drop follow it when read (they are the organizations' own and are not rewritten). Returns p_keep.
create or replace function app.merge_match_programs(p_keep uuid, p_drop uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.match_programs; d app.match_programs; v_clash text;
begin
  perform app._assert_weaver('merge directory entries');
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why. It goes in the directory''s history.' using errcode = '22023';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different entries: the one to keep and its duplicate.' using errcode = '22023';
  end if;
  perform 1 from app.match_programs where id in (p_keep, p_drop) order by id for update;
  select * into k from app.match_programs where id = p_keep;
  select * into d from app.match_programs where id = p_drop;
  if k.id is null or d.id is null then raise exception 'That directory entry was not found.'; end if;
  if k.status <> 'active' then raise exception 'The entry to keep must be active.'; end if;
  if d.status = 'merged' then raise exception 'The duplicate was already merged into another entry.'; end if;
  select g.company_name into v_clash
    from app.match_program_names n join app.match_programs g on g.id = n.program_id
   where g.status = 'active' and g.id not in (p_keep, p_drop)
     and (g.country is not distinct from k.country or g.country is null or k.country is null)
     and n.name_key in (select x.name_key from app.match_program_names x where x.program_id = p_drop)
   limit 1;
  if v_clash is not null then
    raise exception '"%" uses one of the duplicate''s names too. Change one of them first.', v_clash using errcode = '23505';
  end if;
  perform app.set_audit_context('Weaver''s team: ' || app.audit_clean_reason(p_reason));
  delete from app.match_program_names x
   where x.program_id = p_drop
     and exists (select 1 from app.match_program_names y where y.program_id = p_keep and y.name_key = x.name_key);
  update app.match_program_names set is_primary = false, program_id = p_keep where program_id = p_drop;
  update app.match_programs set merged_into = p_keep where merged_into = p_drop;
  update app.match_programs set status = 'merged', merged_into = p_keep, status_reason = app.audit_clean_reason(p_reason)
   where id = p_drop;
  return p_keep;
end $$;

-- ── Finding entries by name ──────────────────────────────────────────────────
-- The entries one of whose names has this key (same_name), contains it, or is contained in it (part_of_name), each once
-- with its closest name. A name found inside a longer key must have 3 characters, or 2 in a script beyond Latin, Greek
-- and Cyrillic (a two-letter Latin name is found inside too many others); a key found inside a longer name needs 2.
create or replace function app._match_find(p_key text) returns table (program_id uuid, matched_name text, how text, gap int)
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct on (n.program_id) n.program_id, n.name,
         case when n.name_key = p_key then 'same_name' else 'part_of_name' end,
         abs(char_length(n.name_key) - char_length(p_key))
    from app.match_program_names n
   where p_key is not null
     and (n.name_key = p_key
          or (char_length(p_key) >= 2 and strpos(n.name_key, p_key) > 0)
          or (strpos(p_key, n.name_key) > 0
              and (char_length(n.name_key) >= 3 or (char_length(n.name_key) >= 2 and n.name_key ~ '[^\u0001-\u052f]'))))
   order by n.program_id, (n.name_key = p_key) desc, abs(char_length(n.name_key) - char_length(p_key)), n.is_primary desc
$$;

-- The directory, or the entries a name finds (same name first, then the closest), for its readers.
--   {"total": 3, "rows": [{"id", "company_name", "country", "gift_match", "volunteer_grant", "match_ratio_bp", "currency",
--     "max_gift_cents", "max_year_cents", "portal", "religious_orgs", "last_verified_on", "verified_by_kind", "status",
--     "matched_name", "how"}]}
-- p_status: active (default), retired, or all (merged entries are never listed; they point at the one they joined).
create or replace function app.match_program_search(p_query text default null, p_status text default 'active',
                                                    p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_key text := app.employer_name_key(p_query); v_status text; v_limit int; v_offset int; v_total int; v_rows jsonb;
begin
  if not app.match_directory_can_read() then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  v_status := case when p_status in ('active', 'retired', 'all') then p_status else 'active' end;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  with f as (select * from app._match_find(v_key)),
       hits as (
         select g.id, g.company_name, g.country, g.gift_match, g.volunteer_grant, g.match_ratio_bp, g.currency,
                g.max_gift_cents, g.max_year_cents, g.portal, g.religious_orgs, g.last_verified_on, g.verified_by_kind,
                g.status, f.matched_name, f.how, coalesce(f.gap, 0) as gap
           from app.match_programs g
           left join f on f.program_id = g.id
          where g.status <> 'merged' and (v_status = 'all' or g.status = v_status)
            and (v_key is null or f.program_id is not null)),
       page as (
         select h.*, row_number() over (order by coalesce(h.how = 'same_name', false) desc, h.gap, lower(h.company_name), h.id) as ord
           from hits h
          order by ord
          limit v_limit offset v_offset)
  select (select count(*) from hits),
         coalesce((select jsonb_agg(to_jsonb(p) - 'gap' - 'ord' order by p.ord) from page p), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._mj_text(jsonb, text, int, text, boolean), app._mj_int(jsonb, text, bigint, bigint, text),
  app._mj_bool(jsonb, text, boolean, text), app._mj_choice(jsonb, text, text[], text), app._mj_list(jsonb, text, text[], text),
  app._mj_https(jsonb, text, text), app._mj_array(jsonb), app._match_program_clean(jsonb, text),
  app._match_name_clash(text[], text, uuid), app._match_program_write(uuid, jsonb, text, date, uuid),
  app._assert_weaver(text), app._match_find(text)
  from public, anon, authenticated;
revoke execute on function app.match_portals(), app.match_gift_types(), app.match_org_kinds(), app.match_religious_rules(),
  app.match_deadline_kinds(), app.match_sources(), app.employer_name_key(text), app.match_directory_can_read(),
  app.save_match_program(uuid, jsonb, text), app.set_match_program_retired(uuid, boolean, text),
  app.merge_match_programs(uuid, uuid, text), app.match_program_search(text, text, int, int)
  from public, anon;
grant execute on function app.match_portals(), app.match_gift_types(), app.match_org_kinds(), app.match_religious_rules(),
  app.match_deadline_kinds(), app.match_sources(), app.employer_name_key(text), app.match_directory_can_read(),
  app.save_match_program(uuid, jsonb, text), app.set_match_program_retired(uuid, boolean, text),
  app.merge_match_programs(uuid, uuid, text), app.match_program_search(text, text, int, int)
  to authenticated;
