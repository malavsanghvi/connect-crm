-- Onboarding · stream o-setup · 2 of 5: the Setup checklist (ONBOARDING_PLAN §4).
--
--   app.setup_steps          the catalog: every step and sub-step of stages 0–8, with
--                            plain-English help, what "done" means, the screen where it
--                            is done (route) and the module it belongs to.
--   app.center_setup_steps   one row per step a center has touched: status, owner (a
--                            staff person), due date, notes; completed_by/at stamped.
--   app.setup_auto_status(center)
--                            the steps whose completion the database can see for itself
--                            (profile saved, logo uploaded, leaders added, modules chosen,
--                            rules saved, setup data present, legal documents published).
--   app.setup_checklist(center)
--                            the checklist with the effective status:
--                              module off → skipped; computed done → done; a status set by
--                              a person → that status; else the computed partial status.
--                            Steps marked `manual = false` (non-profit verification) show
--                            only the computed status.
--   app.setup_staff_options(center)
--                            people who hold a staff role, to assign a step to.
--
-- The catalog is seeded here and kept in sync by `on conflict do update`, so a later
-- migration can reword a step without touching the centers' progress.

create table if not exists app.setup_steps (
  key          text primary key check (key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  stage        int not null check (stage between 0 and 8),
  title        text not null,
  description  text not null default '',
  help         text not null default '',
  done_means   text not null default '',
  route        text check (route is null or route ~ '^/[a-z0-9/_#-]*$'),
  owner_role   text,                               -- who usually does it (words, not a role key)
  module_key   text references app.modules(key),   -- null: core, never skipped
  sort         int not null,
  required     boolean not null default true,
  auto         boolean not null default false,     -- the database computes its status
  manual       boolean not null default true       -- a person may set its status
);
comment on table app.setup_steps is 'Onboarding Setup checklist catalog (ONBOARDING_PLAN §4, stages 0–8).';

create table if not exists app.center_setup_steps (
  center_id        uuid not null references app.centers(id) on delete cascade,
  step_key         text not null references app.setup_steps(key) on update cascade,
  status           text not null default 'not_started'
                     check (status in ('not_started','in_progress','waiting_on_provider','needs_review','done','skipped')),
  owner_person_id  uuid references app.people(id) on delete set null,
  due_on           date,
  notes            text check (notes is null or length(notes) <= 2000),
  completed_by     uuid references auth.users(id),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  primary key (center_id, step_key)
);

create or replace function app.center_setup_steps_stamp() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.owner_person_id is not null
     and not exists (select 1 from app.people p where p.id = new.owner_person_id and p.center_id = new.center_id) then
    raise exception 'The step owner must be a person in this community.' using errcode = '23514';
  end if;
  if not (select manual from app.setup_steps where key = new.step_key) and new.status not in ('not_started') then
    raise exception 'This step''s status is worked out automatically and cannot be set by hand.' using errcode = '23514';
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_by := auth.uid(); new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_by := null; new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists center_setup_steps_stamp on app.center_setup_steps;
create trigger center_setup_steps_stamp before insert or update on app.center_setup_steps
  for each row execute function app.center_setup_steps_stamp();

alter table app.setup_steps enable row level security;
drop policy if exists setup_steps_read on app.setup_steps;
create policy setup_steps_read on app.setup_steps for select to authenticated using (true);

alter table app.center_setup_steps enable row level security;
drop policy if exists center_setup_steps_read on app.center_setup_steps;
create policy center_setup_steps_read on app.center_setup_steps for select to authenticated
  using (app.setup_can_manage(center_id));
drop policy if exists center_setup_steps_insert on app.center_setup_steps;
create policy center_setup_steps_insert on app.center_setup_steps for insert to authenticated
  with check (app.setup_can_manage(center_id));
drop policy if exists center_setup_steps_update on app.center_setup_steps;
create policy center_setup_steps_update on app.center_setup_steps for update to authenticated
  using (app.setup_can_manage(center_id)) with check (app.setup_can_manage(center_id));

insert into app.module_tables (table_name, module_key) values ('setup_steps', null), ('center_setup_steps', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_setup_steps on app.setup_steps;
create trigger audit_setup_steps after insert or update or delete on app.setup_steps
  for each row execute function app.audit_row('key');
drop trigger if exists audit_center_setup_steps on app.center_setup_steps;
create trigger audit_center_setup_steps after insert or update or delete on app.center_setup_steps
  for each row execute function app.audit_row('center_id', 'step_key');

-- ── The catalog ──────────────────────────────────────────────────────────────
-- Routes: existing portal screens where they exist; the other streams' screens
-- by the route the contract/plan gives them (the portal shows "Coming soon" for
-- any route that is not built in this deployment).
insert into app.setup_steps (key, stage, sort, title, description, help, done_means, route, owner_role, module_key, required, auto, manual) values
-- Stage 0 · Organization foundation
('org.security', 0, 10, 'Owner and staff account security',
  'Verify email and phone, and turn on two-factor sign-in (an authenticator app) with recovery codes.',
  'Every staff role signs in with a second factor. Sensitive actions such as changing credentials, exports and refunds ask for a fresh check.',
  'The owner and every staff member have verified email and phone and have two-factor sign-in turned on.',
  '/settings/security', 'Owner', null, true, false, true),
('org.legal_identity', 0, 20, 'Legal identity and non-profit proof',
  'Legal name, EIN, entity type, state of incorporation, registered address, fiscal year, authorized signer; W-9 and IRS determination letter.',
  'We check the EIN against the IRS exempt-organization list. Houses of worship without a letter can send a board or attorney letter instead. Community Connect reviews the documents.',
  'Community Connect has verified the organization as a non-profit.',
  '/setup/organization', 'Owner', null, true, true, false),
('org.profile', 0, 30, 'Profile',
  'Mission, about, website, social links, public email and phone, office hours, address with a map pin, languages.',
  'The map pin''s latitude and longitude drive the daily timings (sunrise, navkarsi, chauvihar). Members see the profile in the app.',
  'The mission, a public email or phone, and the map pin are saved.',
  '/setup/profile', 'Owner', null, true, true, true),
('org.brand_kit', 0, 40, 'Brand kit',
  'Upload the logo, square mark, dark variant and email header; choose brand colors.',
  'Logos are uploaded, not linked. Colors get an automatic readability check, and the preview shows the portal, the member app, an email and a statement.',
  'A logo is uploaded and a primary color is chosen.',
  '/setup/profile#brand', 'Owner', null, true, true, true),
('org.leaders', 0, 50, 'Key leaders',
  'President, Secretary, Treasurer, EC members, trustees: names, titles, terms and photos.',
  'Leaders shown publicly appear in the member app''s Guide › Administration. Link each leader to their person record once people are imported.',
  'At least one leader is added.',
  '/setup/leaders', 'Owner', null, true, true, true),
('org.modules', 0, 60, 'Choose modules',
  'Choose which of the 18 modules to use.',
  'Switching a module off hides its setup steps here, its screens in the portal and the member app.',
  'The modules are chosen (at least one switch flipped, or the step marked done).',
  '/settings/modules', 'Owner', null, true, true, true),
('org.team', 0, 70, 'Invite the team',
  'Invite staff by email or mobile with their roles; add a second administrator.',
  'A second administrator is required before go-live, because the two-person rule (role grants, refunds, write-offs) needs two people.',
  'Staff have accepted their invitations and a second administrator is in place.',
  '/settings/team', 'Owner', null, true, false, true),
('org.rules', 0, 80, 'Rules and policies',
  'Walk through the rules with their defaults: membership, giving, bolis and store, lunch and RSVP, points.',
  'Decisions with no safe default are highlighted: membership fees, references, child login age, voting.',
  'The rules have been reviewed and saved at least once.',
  '/settings/rules', 'Owner', null, true, true, true),
('org.onboarding_fields', 0, 81, 'Member onboarding fields',
  'Choose which details the member app asks new members for.',
  'Each field can be required, optional or hidden.',
  'The onboarding fields are saved.',
  '/settings/onboarding', 'Membership coordinator', null, false, true, true),
('org.notifications', 0, 82, 'Notification rules',
  'Quiet hours and which automatic messages are sent.',
  'Messages outside quiet hours only, unless it is an event-day message.',
  'The notification rules are saved.',
  '/settings/notifications', 'Communications officer', null, false, true, true),
('org.security_policy', 0, 83, 'Security policy',
  'Admin session length, idle timeout and printed sign-in codes.',
  'These apply to every staff login.',
  'The security policy is saved.',
  '/settings/security', 'Owner', null, false, true, true),
('org.agreements', 0, 90, 'Accept the agreements',
  'Community Connect terms, the data-processing agreement and the children''s-data addendum.',
  'Each acceptance is stored with who accepted it, which version, when and from what IP address.',
  'All three agreements are accepted by the owner.',
  '/settings/agreements', 'Owner', null, true, false, true),
-- Stage 1 · Connect services
('svc.vault', 1, 10, 'Credential vault',
  'Where provider keys and tokens are stored, encrypted. Nobody can read them.',
  'Changing a credential needs a fresh two-factor check and a reason, and is audited.',
  'The vault is ready and each connection shows its fingerprint.',
  '/settings/integrations', 'Owner', null, true, false, true),
('svc.payments', 1, 20, 'Card and bank payments',
  'Connect your own Stripe or PayPal account, choose the online methods and the statement descriptor.',
  'Verification by the payment provider can take several days, so start on day one. You may go live with offline payments only.',
  'A payment provider is connected (test mode in the sandbox) with a $1 charge and refund, or "offline only" is chosen.',
  '/settings/payments', 'Treasurer', 'giving', true, false, true),
('svc.email', 1, 30, 'Email sending and domain',
  'Add the sending domain, copy the DNS records, set up the senders and the footer.',
  'Until this is done, sign-in codes cannot reach members.',
  'The domain is verified and sign-in codes reach any address.',
  '/settings/email', 'Communications officer', null, true, false, true),
('svc.texting', 1, 40, 'Texting (SMS)',
  'Connect the texting provider and register the brand and campaign (10DLC) or toll-free number.',
  'US registration takes days to weeks, so start early. Gujarati and Hindi texts fit 70 characters per segment.',
  'Texting is registered, or phone sign-in is switched off.',
  '/settings/texting', 'Communications officer', null, true, false, true),
('svc.whatsapp', 1, 50, 'WhatsApp Business',
  'Meta business verification, a WhatsApp number, display name and message templates.',
  'Community messages go over WhatsApp; texts are for codes and time-critical reminders.',
  'The WhatsApp number is approved and its templates are submitted.',
  '/settings/whatsapp', 'Communications officer', 'comms', false, false, true),
('svc.push', 1, 60, 'Push notifications',
  'Notification topics, quiet hours and a test push to your own phone.',
  'The shared app holds the Apple and Google credentials; nothing technical to configure.',
  'A test push reached your phone.',
  '/settings/notifications', 'Communications officer', 'comms', false, false, true),
('svc.quickbooks', 1, 70, 'QuickBooks Online',
  'Connect the company, pull the chart of accounts, choose the basis and the go-live date, map the accounts, test-post.',
  'In the sandbox, connect an Intuit sandbox company or the real company read-only.',
  'QuickBooks is connected, the mapping and a test post are approved, and the go-live date is set.',
  '/accounting/qbo', 'Treasurer', 'accounting', true, false, true),
('svc.bank_accounts', 1, 80, 'Bank accounts',
  'Each account''s name, last 4 digits, QuickBooks account and statement format.',
  'Upload a sample statement to detect its format.',
  'At least one bank account is set up.',
  '/giving/bank', 'Treasurer', 'giving', true, true, true),
('svc.storage', 1, 90, 'File storage',
  'Storage areas for logos, photos, statements, recordings, imports and documents.',
  'Community Connect creates them automatically. You choose only the retention settings marked in the plan.',
  'The storage areas exist and their settings are reviewed.',
  null, 'Community Connect', null, false, false, true),
('svc.other', 1, 100, 'Other providers',
  'A panchang source for tithi days, a background-check provider, a live link to the old CRM.',
  'All optional. File imports come first.',
  'Each provider you need is connected, or not needed.',
  '/settings/integrations', 'Owner', null, false, false, true),
-- Stage 2 · Templates and documents
('tpl.messages', 2, 10, 'Message templates',
  'Email, text, push and WhatsApp templates in each language, from the Community Connect base library.',
  'The brand kit is applied automatically. Preview against a real record and send a test to yourself.',
  'The system messages are customized and approved.',
  '/comms/templates', 'Communications officer', 'comms', true, false, true),
('tpl.statements', 2, 20, 'Statements and receipts',
  'Upload a past statement or receipt; we build the template from it for review.',
  'A compliance check flags any missing element of the IRS written acknowledgment. The treasurer approves.',
  'The receipt and year-end statement templates are approved.',
  '/giving/statements', 'Treasurer', 'giving', true, false, true),
('tpl.legal', 2, 30, 'Member legal documents',
  'Terms of use, privacy policy, photo policy, and volunteer and youth waivers.',
  'Each starts from a Community Connect template and is published as a new version.',
  'The terms of use, privacy policy and photo policy are published, plus the waivers for the modules that are on.',
  '/content/legal', 'Privacy officer', null, true, true, true),
-- Stage 3 · Setup data
('data.numbering', 3, 10, 'Numbering and identifier systems',
  'Member, household, pledge, order and receipt number prefixes; the old systems'' identifiers.',
  'You may adopt your existing member numbers.',
  'The numbering and identifier systems are declared.',
  '/settings/rules', 'Membership coordinator', null, true, false, true),
('data.zones', 3, 20, 'Zones',
  'Zones and their ZIP codes, with zone leads.',
  'Optional; used for zone leads and WhatsApp groups.',
  'The zones are set up, or not used.',
  '/content/guide', 'Membership coordinator', null, false, true, true),
('data.membership_types', 3, 30, 'Membership types',
  'Tiers, fees, periods, reference and EC rules, voting wait.',
  'Membership types are in Settings › Rules › Membership.',
  'At least one active membership type exists.',
  '/settings/rules', 'Membership coordinator', 'membership', true, true, true),
('data.funds_campaigns', 3, 40, 'Funds and campaigns',
  'Funds (restricted or not, QuickBooks class) and campaigns (fund, goal, dates).',
  'Upload them or enter them on screen.',
  'At least one active fund and one campaign exist.',
  '/giving/campaigns', 'Treasurer', 'giving', true, true, true),
('data.payment_methods', 3, 50, 'Accepted payment methods',
  'Check, cash, Zelle, ACH and wire, stock, donor-advised funds: each with instructions for members.',
  'Members see the instructions when they give.',
  'The accepted methods and their instructions are saved.',
  '/settings/payments', 'Treasurer', 'giving', true, false, true),
('data.store', 3, 60, 'Store categories and pickup',
  'Categories, pickup windows, gift-pack price, cancellation rule, tax settings.',
  'Pickup windows can follow events.',
  'At least one category and one pickup window exist.',
  '/store/menu', 'Store lead', 'store', true, true, true),
('data.pathshala', 3, 70, 'Pathshala tracks and terms',
  'Tracks, levels, terms with registration windows and fees.',
  'Fees per child are billed as pledges.',
  'At least one track and one term exist.',
  '/pathshala/terms', 'Pathshala principal', 'pathshala', true, true, true),
('data.gyan_path', 3, 80, 'Gyan Path goals',
  'Goals, levels and steps from the tradition pack.',
  'Shared goals from Community Connect count; add your own if you like.',
  'At least one Gyan Path goal is available.',
  '/content/gyan-path', 'Religious coordinator', 'gyan_path', true, true, true),
('data.practices', 3, 90, 'Practices and points',
  'The practices catalog and the points and streak rules.',
  'Shared practices from Community Connect count.',
  'At least one active practice is available.',
  '/content/practices', 'Religious coordinator', 'jain_way', true, true, true),
('data.inboxes', 3, 100, 'Inboxes',
  'Office, membership, finance and other inboxes members can write to.',
  'Community Connect provides defaults.',
  'At least one inbox exists.',
  '/comms/inbox', 'Communications officer', 'comms', true, true, true),
('data.guide', 3, 110, 'Guide sections',
  'The New-to guide, the administration roster and group listings.',
  'Community Connect provides a starting guide.',
  'At least one guide section exists.',
  '/content/guide', 'Content editor', 'content', true, true, true),
('data.event_templates', 3, 120, 'Event templates',
  'Event templates and their checklists.',
  'Optional.',
  'The templates you need exist.',
  '/events/builder', 'Event lead', 'events', false, true, true),
('data.chart_of_accounts', 3, 130, 'Chart of accounts',
  'Pulled from QuickBooks: accounts, classes, locations, items, tax codes.',
  'Never uploaded by hand; refreshed daily.',
  'The QuickBooks lists are pulled and mapped.',
  '/accounting/qbo', 'Treasurer', 'accounting', true, false, true),
('data.custom_fields', 3, 140, 'Custom fields',
  'Fields for columns we have no field for, created from your uploads.',
  'Staff-only until someone reviews them.',
  'The custom fields are reviewed.',
  '/settings/custom-fields', 'Membership coordinator', null, false, false, true),
-- Stage 4 · Records
('rec.people', 4, 10, 'Households and people',
  'Households, people, relationships, contact details and consents.',
  'Matched on legacy IDs first, then email or mobile; never on a name alone.',
  'Imported and reconciled; duplicates reviewed.',
  '/imports', 'Membership coordinator', null, true, false, true),
('rec.memberships', 4, 20, 'Current memberships',
  'Each household''s current membership, type, start and end.',
  'Import after households and people.',
  'Imported and reconciled.',
  '/imports', 'Membership coordinator', 'membership', true, false, true),
('rec.staff', 4, 30, 'Staff and their roles',
  'Who does what: roles for every staff member.',
  'Invitations are sent in Step 0.',
  'Every staff member has their roles.',
  '/settings/roles', 'Owner', null, true, false, true),
('rec.store_items', 4, 40, 'Store items and stock',
  'SKU, name, price, taxable, stock on hand, photos.',
  'Photos can be uploaded as a ZIP by file name.',
  'Imported, with the opening stock.',
  '/store', 'Store lead', 'store', true, false, true),
('rec.pathshala', 4, 50, 'Classes, teachers and enrollments',
  'Current classes, teachers and enrollments.',
  'Import after people.',
  'Imported and checked by the principal.',
  '/pathshala', 'Pathshala principal', 'pathshala', true, false, true),
-- Stage 5 · History and transactions
('hist.giving', 5, 10, 'Pledges and payments',
  'Open and closed pledges, payments and which pledge each paid; 7 years suggested.',
  'Imported payments are history: they never post to QuickBooks. Balances must match to the cent.',
  'Imported and reconciled, signed off by the treasurer.',
  '/imports', 'Treasurer', 'giving', true, false, true),
('hist.recurring', 5, 20, 'Recurring gifts',
  'Active recurring gifts from the old system.',
  'Card details stay with the old processor: members re-enter their card once, or the processor moves the saved cards.',
  'Every active recurring gift is set up or its member is prompted.',
  '/giving/recurring', 'Treasurer', 'giving', true, false, true),
('hist.statements', 5, 30, 'Past statements',
  'Past receipts and year-end statements as a PDF archive.',
  'Optional; members can see past years.',
  'Imported, or not needed.',
  '/imports', 'Treasurer', 'giving', false, false, true),
('hist.other', 5, 40, 'Other history',
  'Past memberships, boli results, attendance and store orders.',
  'Optional.',
  'Imported, or not needed.',
  '/imports', 'Module owners', null, false, false, true),
-- Stage 6 · Train Niva
('niva.train', 6, 10, 'Train Niva',
  'Choose the sources, set the guardrails, review the question bank, run the evaluation.',
  'Suggested pass mark: 90% answered correctly with a source; every out-of-scope question declined.',
  'Niva passed its evaluation, or Niva is switched off.',
  '/content/niva', 'Religious coordinator', 'niva', true, false, true),
-- Stage 7 · Test, train, pilot
('test.health_check', 7, 10, 'Sandbox health check',
  'Run the automated journeys against your sandbox and see pass or fail per module.',
  'The same checks we run before every release.',
  'Every module that is on passes.',
  '/setup/health-check', 'Owner', null, true, false, true),
('test.training', 7, 20, 'Train the staff',
  'Short videos and sandbox exercises per role; the check-in rehearsal.',
  'Plan design-doc 06, steps 7–9.',
  'Every staff member finished their role''s training.',
  null, 'Owner', null, true, false, true),
('test.pilot', 7, 30, 'Pilot with champion families',
  'A pilot with 30–50 families before inviting everyone.',
  'Login success above 95% is the target.',
  'The pilot is done and its feedback addressed.',
  null, 'Owner', null, true, false, true),
-- Stage 8 · Request go-live
('golive.readiness', 8, 10, 'Go-live readiness',
  'The 13 readiness checks, automatic where possible.',
  'Each check shows its evidence. Community Connect sees the same list.',
  'Every readiness check passes.',
  '/setup/readiness', 'Owner', null, true, true, false),
('golive.request', 8, 20, 'Request go-live',
  'Ask Community Connect to approve going live.',
  'Two different people at Community Connect approve.',
  'Community Connect approved, and the organization is live.',
  '/setup/go-live', 'Owner', null, true, false, true)
on conflict (key) do update set stage = excluded.stage, sort = excluded.sort, title = excluded.title,
  description = excluded.description, help = excluded.help, done_means = excluded.done_means, route = excluded.route,
  owner_role = excluded.owner_role, module_key = excluded.module_key, required = excluded.required,
  auto = excluded.auto, manual = excluded.manual;

-- ── Computed statuses ────────────────────────────────────────────────────────
-- {step_key: {status, detail}} for the steps the database can judge. Only
-- 'done', 'in_progress', 'needs_review' and 'not_started' are produced here.
create or replace function app.setup_auto_status(p_center uuid, p_with_readiness boolean default true) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare p app.org_profiles; c app.centers; v jsonb := '{}'; v_n int; v_m int; v_docs jsonb; v_ready boolean;
begin
  select * into c from app.centers where id = p_center;
  if not found then return v; end if;
  select * into p from app.org_profiles where center_id = p_center;

  -- Legal identity: follows the verification.
  v := v || jsonb_build_object('org.legal_identity', case
    when p.verification_status = 'verified' then jsonb_build_object('status', 'done', 'detail', 'Verified non-profit')
    when p.verification_status = 'submitted' then jsonb_build_object('status', 'needs_review', 'detail', 'Waiting for Community Connect to review')
    when p.verification_status = 'rejected' then jsonb_build_object('status', 'in_progress', 'detail', 'Sent back: ' || coalesce(p.verification_note, 'see the note'))
    when p.legal_name is not null or p.ein is not null then jsonb_build_object('status', 'in_progress', 'detail', coalesce(p.verification_note, 'Legal identity started'))
    else jsonb_build_object('status', 'not_started', 'detail', null) end);

  -- Profile: mission, a public contact and the map pin.
  v := v || jsonb_build_object('org.profile', case
    when nullif(btrim(p.mission), '') is not null and (p.public_email is not null or p.public_phone is not null) and p.latitude is not null
      then jsonb_build_object('status', 'done', 'detail', 'Profile saved')
    when p.center_id is not null and (p.mission is not null or p.about is not null or p.website is not null or p.public_email is not null
                                      or p.public_phone is not null or p.latitude is not null)
      then jsonb_build_object('status', 'in_progress', 'detail', 'Still needed: ' || array_to_string(array_remove(array[
        case when nullif(btrim(p.mission), '') is null then 'mission' end,
        case when p.public_email is null and p.public_phone is null then 'public email or phone' end,
        case when p.latitude is null then 'map pin' end], null), ', '))
    else jsonb_build_object('status', 'not_started', 'detail', null) end);

  -- Brand kit: an uploaded logo and a primary color.
  v := v || jsonb_build_object('org.brand_kit', case
    when coalesce(c.branding->>'logo_path', c.branding->>'mark_path') is not null and c.branding #>> '{colors,primary}' is not null
      then jsonb_build_object('status', 'done', 'detail', 'Logo uploaded, colors chosen')
    when coalesce(c.branding->>'logo_path', c.branding->>'mark_path', c.branding #>> '{colors,primary}') is not null
      then jsonb_build_object('status', 'in_progress', 'detail',
             case when coalesce(c.branding->>'logo_path', c.branding->>'mark_path') is null then 'Upload a logo' else 'Choose a primary color' end)
    else jsonb_build_object('status', 'not_started', 'detail', null) end);

  select count(*) into v_n from app.org_leaders where center_id = p_center;
  v := v || jsonb_build_object('org.leaders', case when v_n > 0
    then jsonb_build_object('status', 'done', 'detail', v_n || ' leader' || case when v_n = 1 then '' else 's' end)
    else jsonb_build_object('status', 'not_started', 'detail', null) end);

  select count(*) into v_n from app.center_modules where center_id = p_center;
  v := v || jsonb_build_object('org.modules', case when v_n > 0
    then jsonb_build_object('status', 'done', 'detail', (select count(*) from app.center_modules where center_id = p_center and not enabled) || ' switched off')
    else jsonb_build_object('status', 'not_started', 'detail', 'Every module is on (the default)') end);

  v := v || jsonb_build_object('org.rules', case when c.rules ? 'version'
      then jsonb_build_object('status', 'done', 'detail', 'Rules saved · version ' || (c.rules->>'version')) else jsonb_build_object('status', 'not_started', 'detail', null) end)
    || jsonb_build_object('org.onboarding_fields', case when c.rules #> '{onboarding,fields}' is not null
      then jsonb_build_object('status', 'done', 'detail', 'Saved') else jsonb_build_object('status', 'not_started', 'detail', null) end)
    || jsonb_build_object('org.notifications', case when c.rules ? 'notifications'
      then jsonb_build_object('status', 'done', 'detail', 'Saved') else jsonb_build_object('status', 'not_started', 'detail', null) end)
    || jsonb_build_object('org.security_policy', case when c.rules ? 'security'
      then jsonb_build_object('status', 'done', 'detail', 'Saved') else jsonb_build_object('status', 'not_started', 'detail', null) end);

  v_docs := app.legal_documents_status(p_center);
  v := v || jsonb_build_object('tpl.legal', jsonb_build_object(
    'status', case when (v_docs->>'ok')::boolean then 'done' when (v_docs->>'published')::int > 0 then 'in_progress' else 'not_started' end,
    'detail', v_docs->>'detail'));

  -- Setup data, one probe each.
  select count(*) into v_n from app.bank_accounts where center_id = p_center and active;
  v := v || app._setup_count_status('svc.bank_accounts', v_n, 'bank account');
  select count(*) into v_n from app.zones where center_id = p_center;
  v := v || app._setup_count_status('data.zones', v_n, 'zone');
  select count(*) into v_n from app.membership_types where center_id = p_center and active;
  v := v || app._setup_count_status('data.membership_types', v_n, 'membership type');
  select count(*) into v_n from app.funds where center_id = p_center and active;
  select count(*) into v_m from app.campaigns where center_id = p_center;
  v := v || jsonb_build_object('data.funds_campaigns', jsonb_build_object(
    'status', case when v_n > 0 and v_m > 0 then 'done' when v_n + v_m > 0 then 'in_progress' else 'not_started' end,
    'detail', v_n || ' active fund' || case when v_n = 1 then '' else 's' end || ', ' || v_m || ' campaign' || case when v_m = 1 then '' else 's' end));
  select count(*) into v_n from app.store_categories where center_id = p_center;
  select count(*) into v_m from app.pickup_windows where center_id = p_center;
  v := v || jsonb_build_object('data.store', jsonb_build_object(
    'status', case when v_n > 0 and v_m > 0 then 'done' when v_n + v_m > 0 then 'in_progress' else 'not_started' end,
    'detail', v_n || ' categor' || case when v_n = 1 then 'y' else 'ies' end || ', ' || v_m || ' pickup window' || case when v_m = 1 then '' else 's' end));
  select count(*) into v_n from app.pathshala_tracks where center_id = p_center;
  select count(*) into v_m from app.pathshala_terms where center_id = p_center;
  v := v || jsonb_build_object('data.pathshala', jsonb_build_object(
    'status', case when v_n > 0 and v_m > 0 then 'done' when v_n + v_m > 0 then 'in_progress' else 'not_started' end,
    'detail', v_n || ' track' || case when v_n = 1 then '' else 's' end || ', ' || v_m || ' term' || case when v_m = 1 then '' else 's' end));
  select count(*) into v_n from app.gyan_goals where center_id = p_center or center_id is null;
  v := v || app._setup_count_status('data.gyan_path', v_n, 'goal');
  select count(*) into v_n from app.practices where (center_id = p_center or center_id is null) and active;
  v := v || app._setup_count_status('data.practices', v_n, 'practice');
  select count(*) into v_n from app.inboxes where center_id = p_center;
  v := v || app._setup_count_status('data.inboxes', v_n, 'inbox');
  select count(*) into v_n from app.guide_sections where center_id = p_center;
  v := v || app._setup_count_status('data.guide', v_n, 'guide section');
  select count(*) into v_n from app.event_templates where center_id = p_center;
  v := v || app._setup_count_status('data.event_templates', v_n, 'event template');

  -- Go-live readiness: every registered check passes (0182 defines app.readiness_all_ok).
  -- Off when a readiness check itself asks (check_setup_data_complete), so the two never recurse.
  if p_with_readiness and to_regprocedure('app.readiness_all_ok(uuid)') is not null then
    execute 'select app.readiness_all_ok($1)' into v_ready using p_center;
    v := v || jsonb_build_object('golive.readiness', jsonb_build_object(
      'status', case when v_ready then 'done' else 'in_progress' end,
      'detail', case when v_ready then 'Every built check passes' else 'Some checks do not pass yet' end));
  end if;
  return v;
end $$;

create or replace function app._setup_count_status(p_key text, p_n int, p_noun text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object(p_key, jsonb_build_object(
    'status', case when p_n > 0 then 'done' else 'not_started' end,
    'detail', case when p_n > 0 then p_n || ' ' || p_noun || case when p_n = 1 then '' when p_noun ~ '(x|s)$' then 'es' else 's' end
                   else 'None yet' end))
$$;

-- Member legal documents: terms, privacy and photo policy always; the volunteer
-- waiver when Volunteers is on, the Pathshala waiver when Pathshala is on. A
-- document counts when this center (or a platform template, center_id null)
-- has a published version of that kind.
create or replace function app.legal_documents_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_need text[] := array['terms','privacy','photo_release']; v_have text[]; v_missing text[];
  v_label constant jsonb := '{"terms":"terms of use","privacy":"privacy policy","photo_release":"photo policy","volunteer_waiver":"volunteer waiver","pathshala_waiver":"youth (Pathshala) waiver"}';
begin
  if app.module_enabled(p_center, 'volunteers') then v_need := v_need || 'volunteer_waiver'::text; end if;
  if app.module_enabled(p_center, 'pathshala') then v_need := v_need || 'pathshala_waiver'::text; end if;
  select coalesce(array_agg(distinct kind), '{}') into v_have from app.legal_documents
   where center_id = p_center and published_at is not null and published_at <= now();
  select coalesce(array_agg(k order by array_position(v_need, k)), '{}') into v_missing from unnest(v_need) k where not (k = any (v_have));
  return jsonb_build_object(
    'ok', cardinality(v_missing) = 0,
    'published', (select count(*) from unnest(v_need) k where k = any (v_have)),
    'needed', cardinality(v_need),
    'detail', case when cardinality(v_missing) = 0
                   then 'Published: ' || (select string_agg(v_label->>k, ', ') from unnest(v_need) k)
                   else 'Not published yet: ' || (select string_agg(v_label->>k, ', ') from unnest(v_missing) k) end);
end $$;

create or replace function app.setup_checklist(p_center uuid)
returns table (step_key text, stage int, sort int, title text, description text, help text, done_means text, route text,
               owner_role text, module_key text, required boolean, auto boolean, manual boolean,
               status text, computed_status text, stored_status text, detail text,
               owner_person_id uuid, owner_name text, due_on date, notes text, completed_by uuid, completed_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_auto jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s setup (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  v_auto := app.setup_auto_status(p_center);
  return query
  select s.key, s.stage, s.sort, s.title, s.description, s.help, s.done_means, s.route, s.owner_role, s.module_key,
         s.required, s.auto, s.manual,
         case
           when s.module_key is not null and not app.module_enabled(p_center, s.module_key) then 'skipped'
           when v_auto->s.key->>'status' = 'done' then 'done'
           when not s.manual then coalesce(v_auto->s.key->>'status', 'not_started')
           when cs.status is not null and cs.status <> 'not_started' then cs.status
           else coalesce(v_auto->s.key->>'status', 'not_started') end,
         v_auto->s.key->>'status',
         cs.status,
         case when s.module_key is not null and not app.module_enabled(p_center, s.module_key)
              then 'The ' || m.label || ' module is switched off.'
              else v_auto->s.key->>'detail' end,
         cs.owner_person_id,
         case when pe.id is null then null else coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name end,
         cs.due_on, cs.notes, cs.completed_by, cs.completed_at, cs.updated_at
    from app.setup_steps s
    left join app.center_setup_steps cs on cs.center_id = p_center and cs.step_key = s.key
    left join app.people pe on pe.id = cs.owner_person_id
    left join app.modules m on m.key = s.module_key
   order by s.stage, s.sort;
end $$;

-- Staff who can own a step: people linked to a login that holds any center or
-- operational role in this center.
create or replace function app.setup_staff_options(p_center uuid)
returns table (person_id uuid, name text, roles text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s setup (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  return query
  select p.id, coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name,
         string_agg(distinct r.name, ', ' order by r.name)
    from app.role_grants g
    join app.roles r on r.key = g.role_key and r.tier in ('center','operational')
    join app.center_users cu on cu.center_id = g.center_id and cu.user_id = g.user_id
    join app.people p on p.id = cu.person_id
   where g.center_id = p_center and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
   group by p.id, p.preferred_name, p.first_name, p.last_name
   order by 2;
end $$;

revoke execute on function app.center_setup_steps_stamp(), app.setup_auto_status(uuid, boolean), app._setup_count_status(text, int, text)
  from public, anon, authenticated;
grant execute on function app.setup_checklist(uuid), app.setup_staff_options(uuid), app.legal_documents_status(uuid) to authenticated;
grant select on app.setup_steps to authenticated;
grant select, insert, update on app.center_setup_steps to authenticated;
grant all on app.setup_steps, app.center_setup_steps to service_role;
grant execute on all functions in schema app to service_role;
