-- 0891 · DonorDelight slice 5, part 1: playbooks (docs/DONORDELIGHT.md sections 5.6, 7, 9 and 13; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A playbook is a set of timed steps for one kind of household: what to do, how many days after the household enters it, why, and a ready
--   draft in the organization's own words. A step is a TOUCH to record (a thank-you, a check-in, a greeting, a welcome, an update, an
--   invitation); it never asks for money (there is no "ask" in a step; asks are their own touches and come only through who-to-approach,
--   after the touch balance). A pledge falling due gets a reminder, never an ask for more.
--   app.care_playbooks / app.care_playbook_steps   the organization's own playbooks (what the portal edits; one row per playbook, steps in order)
--       trigger_key  who enters it: first_gift (first gift ever, within window_days), new_household (added within window_days), steady,
--                    cooling, at_risk, lapsed (the same arithmetic as the engagement signs, 0884 and src/lib/care/health.ts), volunteer_no_gift,
--                    giver_no_part, pledge_due (a pledge falls due in window_days), monthly_giver (an active recurring gift)
--       window_days  first_gift / new_household: how long after the event it still starts; pledge_due: how many days before the due day
--       cooldown_days  a household enters the same sign-based playbook again only after this many days
--       steps        after_days (0 to 365 after entering), title, why, kind, channel (or the household's own), draft (words with {{name}}, {{me}}, {{org}})
--   app.care_starters   the starter playbooks per kind of organization, as DATA (audience faith or civic, picked from the category the community
--                       chose: faith_based). Nothing here names a community, a religion or a language; the organization edits its own copy.
--   app.install_care_starters(center)       care.manage: copy the starters this community has not installed yet (idempotent)
--   app.care_playbooks_list(center)         care.own and up: the playbooks with their steps; not a read of a care record, so not logged
--   app.save_care_playbook(center, playbook)  care.manage: create or change one; removed steps are archived, never deleted (history keeps its words)
--   app.set_care_playbook_enabled(playbook, on)  care.manage: pause or resume one; nothing is deleted
--   Audit: app.audit_private_row (0758): who, when, which columns, never the words.
--   Who: care.own, care.view and care.manage read; care.manage writes; nobody else, platform admins included (no platform-admin branch).
set client_min_messages = warning;

-- ── Playbooks ─────────────────────────────────────────────────────────────────
create table if not exists app.care_playbooks (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  summary       text check (summary is null or char_length(btrim(summary)) between 1 and 300),
  trigger_key   text not null check (trigger_key in ('first_gift', 'new_household', 'steady', 'cooling', 'at_risk', 'lapsed',
                                                     'volunteer_no_gift', 'giver_no_part', 'pledge_due', 'monthly_giver')),
  window_days   integer not null default 60 check (window_days between 1 and 365),
  cooldown_days integer not null default 180 check (cooldown_days between 30 and 1095),
  enabled       boolean not null default true,
  starter_key   text,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  unique (center_id, key)
);
create index if not exists care_playbooks_center_idx on app.care_playbooks (center_id, enabled);
comment on table app.care_playbooks is
  'DonorDelight (0891): the community''s timed relationship playbooks (a trigger, a window and steps). Written only by app.save_care_playbook / app.install_care_starters / app.set_care_playbook_enabled (care.manage). A step is a touch to record; it never asks for money.';

create table if not exists app.care_playbook_steps (
  id          uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references app.care_playbooks(id) on delete cascade,
  center_id   uuid not null references app.centers(id) on delete cascade,
  position    integer not null check (position between 1 and 20),
  after_days  integer not null check (after_days between 0 and 365),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  why         text not null check (char_length(btrim(why)) between 1 and 300),
  kind        text not null check (kind in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'other')),
  channel     text check (channel is null or channel in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other')),
  draft       text check (draft is null or char_length(btrim(draft)) between 1 and 1500),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists care_playbook_steps_playbook_idx on app.care_playbook_steps (playbook_id, position) where archived_at is null;
create index if not exists care_playbook_steps_center_idx on app.care_playbook_steps (center_id);
comment on table app.care_playbook_steps is
  'DonorDelight (0891): the steps of a playbook (days after entering, why, the kind of touch, a draft). A removed step is archived so the history of the touches done for it keeps its words.';

-- A step belongs to its playbook's community.
create or replace function app.care_playbook_step_center() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.center_id is distinct from (select p.center_id from app.care_playbooks p where p.id = new.playbook_id) then
    raise exception 'A playbook step belongs to the same community as its playbook.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists care_playbook_steps_center on app.care_playbook_steps;
create trigger care_playbook_steps_center before insert or update of playbook_id, center_id on app.care_playbook_steps
  for each row execute function app.care_playbook_step_center();

drop trigger if exists audit_care_playbooks on app.care_playbooks;
create trigger audit_care_playbooks after insert or update or delete on app.care_playbooks
  for each row execute function app.audit_private_row('care');
drop trigger if exists audit_care_playbook_steps on app.care_playbook_steps;
create trigger audit_care_playbook_steps after insert or update or delete on app.care_playbook_steps
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_playbooks', 'care'), ('care_playbook_steps', 'care'), ('care_starters', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_playbooks enable row level security;
alter table app.care_playbook_steps enable row level security;
drop policy if exists care_playbooks_read on app.care_playbooks;
create policy care_playbooks_read on app.care_playbooks for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists care_playbook_steps_read on app.care_playbook_steps;
create policy care_playbook_steps_read on app.care_playbook_steps for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists module_switch on app.care_playbooks;
create policy module_switch on app.care_playbooks as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_playbook_steps;
create policy module_switch on app.care_playbook_steps as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_playbooks, app.care_playbook_steps from public, anon, authenticated;
grant select on app.care_playbooks, app.care_playbook_steps to authenticated;
grant all on app.care_playbooks, app.care_playbook_steps to service_role;

-- ── The starters (data, per kind of organization) ─────────────────────────────
-- audience 'faith' (faith-based categories: "Member care") or 'civic' (every other: "Donor care"). Words are plain and neutral: {{name}} the adult
-- to reach, {{me}} the person writing, {{org}} the organization. The organization edits its own copy; the starters never change under it.
create table if not exists app.care_starters (
  key           text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  audience      text not null check (audience in ('faith', 'civic')),
  name          text not null,
  summary       text not null,
  trigger_key   text not null,
  window_days   integer not null default 60,
  cooldown_days integer not null default 180,
  sort          integer not null default 0,
  steps         jsonb not null,
  primary key (key, audience)
);
comment on table app.care_starters is
  'DonorDelight (0891): starter playbooks per kind of organization (faith or civic), as data. Platform-wide, read only through app.install_care_starters; copied into a community''s own playbooks, which it edits.';
drop trigger if exists audit_care_starters on app.care_starters;
create trigger audit_care_starters after insert or update or delete on app.care_starters
  for each row execute function app.audit_row('key', 'audience');
alter table app.care_starters enable row level security;
revoke all on app.care_starters from public, anon, authenticated;
grant all on app.care_starters to service_role;

insert into app.care_starters (key, audience, name, summary, trigger_key, window_days, cooldown_days, sort, steps) values
 ('first_gift', 'faith', 'Thank a first gift', 'A first gift is the start of a relationship: thank them in person in the first days, then show what it did.', 'first_gift', 60, 365, 10, $j$[
   {"after_days":0,"title":"Thank them personally","why":"A personal thank-you in the first days is remembered far longer than a receipt.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, this is {{me}} from {{org}}. I wanted to thank you personally for your first gift. It means a great deal to our community, and I would love to hear how you came to us."},
   {"after_days":14,"title":"Share what the gift is doing","why":"Showing the result builds trust. Say thank you again and do not ask for anything.","kind":"update","channel":"email","draft":"Dear {{name}}, a short note from {{me}} at {{org}}: your gift is already at work, and I wanted you to see it. Thank you for being part of us."},
   {"after_days":45,"title":"Invite them to see the work first-hand","why":"People stay when they feel they belong, not when they are asked.","kind":"invitation","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. We would be glad to have you join us at our next gathering, as our guest, if the time suits you."}]$j$::jsonb),
 ('first_gift', 'civic', 'Thank a first gift', 'A first gift is the start of a relationship: thank them personally in the first days, then show what it did.', 'first_gift', 60, 365, 10, $j$[
   {"after_days":0,"title":"Thank them personally","why":"A personal thank-you in the first days is remembered far longer than a receipt.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, this is {{me}} from {{org}}. I wanted to thank you personally for your first gift. It will make a real difference, and I would love to hear what drew you to us."},
   {"after_days":14,"title":"Share what the gift is doing","why":"Showing the result builds trust. Say thank you again and do not ask for anything.","kind":"update","channel":"email","draft":"Dear {{name}}, a short note from {{me}} at {{org}}: your gift is already at work, and I wanted you to see it. Thank you for standing with us."},
   {"after_days":45,"title":"Invite them to see the work first-hand","why":"Supporters stay when they feel part of the work, not when they are asked.","kind":"invitation","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. We would be glad to show you the work your gift supports, if the time suits you."}]$j$::jsonb),

 ('new_household', 'faith', 'Welcome a new family', 'A warm welcome in the first month decides whether a new family stays.', 'new_household', 60, 365, 20, $j$[
   {"after_days":0,"title":"Welcome them","why":"The first contact sets the tone: a person, not a form.","kind":"welcome","channel":"phone","draft":"Hello {{name}}, this is {{me}} from {{org}}. Welcome. I wanted to say hello and ask if there is anything we can help you with."},
   {"after_days":7,"title":"Introduce them to someone","why":"Belonging starts with one familiar face.","kind":"check_in","channel":"in_person","draft":"Hello {{name}}, {{me}} here. I would like to introduce you to someone from {{org}} who has a lot in common with you. Could we meet at our next gathering?"},
   {"after_days":30,"title":"Check in after the first month","why":"A month in is when a newcomer decides whether this is their place.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. How has the first month been? I would love to know what is working and what is not."}]$j$::jsonb),
 ('new_household', 'civic', 'Welcome a new supporter', 'A warm welcome in the first month decides whether a new supporter stays.', 'new_household', 60, 365, 20, $j$[
   {"after_days":0,"title":"Welcome them","why":"The first contact sets the tone: a person, not a form.","kind":"welcome","channel":"phone","draft":"Hello {{name}}, this is {{me}} from {{org}}. Welcome. I wanted to say hello and ask what interests you most about our work."},
   {"after_days":7,"title":"Introduce them to the work","why":"People care about what they can picture.","kind":"update","channel":"email","draft":"Dear {{name}}, {{me}} from {{org}} here. A short note about the people your support reaches, so you can see where it goes."},
   {"after_days":30,"title":"Check in after the first month","why":"A month in is when a newcomer decides whether this is for them.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. How are we doing so far? I would love to hear what you would like to see from us."}]$j$::jsonb),

 ('steady', 'faith', 'Stay close to a steady giver', 'Households that give steadily are easy to forget: a call with no ask keeps them close.', 'steady', 60, 120, 30, $j$[
   {"after_days":0,"title":"Call just to say thank you","why":"A call with no ask is what makes the next conversation easy.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I am not calling for anything. I just wanted to say thank you for being so faithful to us."},
   {"after_days":45,"title":"Share a story from the community","why":"Show them what their steadiness makes possible.","kind":"update","channel":"email","draft":"Dear {{name}}, a story I wanted you to hear from {{org}}, from {{me}}. Thank you for being part of it."}]$j$::jsonb),
 ('steady', 'civic', 'Stay close to a steady supporter', 'Supporters who give steadily are easy to forget: a call with no ask keeps them close.', 'steady', 60, 120, 30, $j$[
   {"after_days":0,"title":"Call just to say thank you","why":"A call with no ask is what makes the next conversation easy.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I am not calling for anything. I just wanted to say thank you for standing with us year after year."},
   {"after_days":45,"title":"Share a result","why":"Show them what their steadiness makes possible.","kind":"update","channel":"email","draft":"Dear {{name}}, a result I wanted you to see from {{org}}, from {{me}}. Thank you for making it possible."}]$j$::jsonb),

 ('cooling', 'faith', 'Reach out to a household that is cooling', 'Fewer gifts or a long quiet: reach out as a friend, before anything is lost.', 'cooling', 60, 120, 40, $j$[
   {"after_days":0,"title":"Call to say you have missed them","why":"The earliest sign of cooling is the best moment to listen.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I realised I had not heard from you in a while and wanted to see how you and your family are."},
   {"after_days":14,"title":"Send a handwritten note","why":"A note shows that someone thought of them, with nothing to answer.","kind":"greeting","channel":"post","draft":"Dear {{name}}, thinking of you and your family. You are missed at {{org}}. {{me}}"}]$j$::jsonb),
 ('cooling', 'civic', 'Reach out to a supporter who is cooling', 'Fewer gifts or a long quiet: reach out as a friend, before anything is lost.', 'cooling', 60, 120, 40, $j$[
   {"after_days":0,"title":"Call to say you have missed them","why":"The earliest sign of cooling is the best moment to listen.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I realised I had not been in touch for a while and wanted to hear how you are, and what you think of our work."},
   {"after_days":14,"title":"Send a handwritten note","why":"A note shows that someone thought of them, with nothing to answer.","kind":"greeting","channel":"post","draft":"Dear {{name}}, thinking of you. {{org}} is grateful for everything you have done. {{me}}"}]$j$::jsonb),

 ('at_risk', 'faith', 'Reconnect with a household at risk', 'They gave last year and not this year: a personal reconnection, never an ask.', 'at_risk', 60, 180, 50, $j$[
   {"after_days":0,"title":"Call to reconnect","why":"The most likely reason for a gap is that nobody called.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. We have missed seeing you and I wanted to check in. Is there anything we can do for you or your family?"},
   {"after_days":10,"title":"Send a card","why":"A card is a gentle second touch if the call was missed.","kind":"greeting","channel":"post","draft":"Dear {{name}}, you and your family are in our thoughts at {{org}}. We would love to see you. {{me}}"},
   {"after_days":30,"title":"Invite them to a gathering","why":"Coming back is easier with an invitation than with a request.","kind":"invitation","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. We have a gathering coming up and would be glad to have you join us, as our guest."}]$j$::jsonb),
 ('at_risk', 'civic', 'Reconnect with a supporter at risk', 'They gave last year and not this year: a personal reconnection, never an ask.', 'at_risk', 60, 180, 50, $j$[
   {"after_days":0,"title":"Call to reconnect","why":"The most likely reason for a gap is that nobody called.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I wanted to check in and hear how you are, and whether we are still doing what matters to you."},
   {"after_days":10,"title":"Send a card","why":"A card is a gentle second touch if the call was missed.","kind":"greeting","channel":"post","draft":"Dear {{name}}, thank you for what you have done for {{org}}. You are in our thoughts. {{me}}"},
   {"after_days":30,"title":"Invite them to see the work","why":"Coming back is easier with an invitation than with a request.","kind":"invitation","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. We would be glad to show you what has happened since you last visited."}]$j$::jsonb),

 ('lapsed', 'faith', 'Say hello after a long silence', 'A long silence is not the end of a relationship: a kind word may be all it takes.', 'lapsed', 60, 365, 60, $j$[
   {"after_days":0,"title":"Send a card","why":"A card after a long silence is easy to receive.","kind":"greeting","channel":"post","draft":"Dear {{name}}, it has been a while, and you are remembered at {{org}}. We hope you and your family are well. {{me}}"},
   {"after_days":21,"title":"Call","why":"A call, three weeks after the card, closes the loop.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I sent you a card and wanted to hear how you are. There is no reason for the call other than that."}]$j$::jsonb),
 ('lapsed', 'civic', 'Say hello after a long silence', 'A long silence is not the end of a relationship: a kind word may be all it takes.', 'lapsed', 60, 365, 60, $j$[
   {"after_days":0,"title":"Send a card","why":"A card after a long silence is easy to receive.","kind":"greeting","channel":"post","draft":"Dear {{name}}, it has been a while, and {{org}} has not forgotten your generosity. We hope you are well. {{me}}"},
   {"after_days":21,"title":"Call","why":"A call, three weeks after the card, closes the loop.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I sent you a card and wanted to hear how you are. There is no reason for the call other than that."}]$j$::jsonb),

 ('volunteer_no_gift', 'faith', 'Thank a volunteer who does not give', 'Time is a gift too. Thank them for it, and do not ask for money.', 'volunteer_no_gift', 60, 180, 70, $j$[
   {"after_days":0,"title":"Thank them for their time","why":"Giving time is as generous as giving money, and it should feel that way.","kind":"thank_you","channel":"in_person","draft":"{{name}}, I wanted to thank you personally for the time you give to {{org}}. We could not do this without you. {{me}}"},
   {"after_days":30,"title":"Ask how it is going","why":"Listening keeps volunteers. This is a check-in, not a request.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. How is volunteering going? Is there anything we could do to make it better for you?"}]$j$::jsonb),
 ('volunteer_no_gift', 'civic', 'Thank a volunteer who does not give', 'Time is a gift too. Thank them for it, and do not ask for money.', 'volunteer_no_gift', 60, 180, 70, $j$[
   {"after_days":0,"title":"Thank them for their time","why":"Giving time is as generous as giving money, and it should feel that way.","kind":"thank_you","channel":"in_person","draft":"{{name}}, I wanted to thank you personally for the time you give to {{org}}. We could not do this without you. {{me}}"},
   {"after_days":30,"title":"Ask how it is going","why":"Listening keeps volunteers. This is a check-in, not a request.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. How is volunteering going? Is there anything we could do to make it better for you?"}]$j$::jsonb),

 ('giver_no_part', 'faith', 'Invite a giver to take part', 'They support us from a distance: ask how they would like to be involved.', 'giver_no_part', 60, 180, 80, $j$[
   {"after_days":0,"title":"Ask how they would like to be involved","why":"Some givers would take part if somebody asked them.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. Thank you for your support. I wondered how you would like to be involved, if at all, in what we do."},
   {"after_days":20,"title":"Invite them to a gathering","why":"A personal invitation is the easiest way in.","kind":"invitation","channel":"text","draft":"Hello {{name}}, {{me}} from {{org}} here. We have a gathering coming up and would love to see you there."}]$j$::jsonb),
 ('giver_no_part', 'civic', 'Invite a donor to take part', 'They support us from a distance: ask how they would like to be involved.', 'giver_no_part', 60, 180, 80, $j$[
   {"after_days":0,"title":"Ask how they would like to be involved","why":"Some donors would take part if somebody asked them.","kind":"check_in","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. Thank you for your support. I wondered how you would like to be involved, if at all, in what we do."},
   {"after_days":20,"title":"Invite them to an event or a visit","why":"A personal invitation is the easiest way in.","kind":"invitation","channel":"text","draft":"Hello {{name}}, {{me}} from {{org}} here. We have an event coming up and would love to see you there."}]$j$::jsonb),

 ('pledge_due', 'faith', 'A pledge is falling due: a friendly reminder', 'Remind, never ask for more: many people simply forget.', 'pledge_due', 7, 90, 90, $j$[
   {"after_days":0,"title":"Send a friendly reminder","why":"A pledge falling due is a promise they made gladly; a kind reminder helps them keep it. It does not ask for more.","kind":"update","channel":"email","draft":"Dear {{name}}, a friendly note from {{me}} at {{org}}: your pledge falls due soon. Thank you for your generosity, and please tell me if anything has changed."}]$j$::jsonb),
 ('pledge_due', 'civic', 'A pledge is falling due: a friendly reminder', 'Remind, never ask for more: many people simply forget.', 'pledge_due', 7, 90, 90, $j$[
   {"after_days":0,"title":"Send a friendly reminder","why":"A pledge falling due is a promise they made gladly; a kind reminder helps them keep it. It does not ask for more.","kind":"update","channel":"email","draft":"Dear {{name}}, a friendly note from {{me}} at {{org}}: your pledge falls due soon. Thank you for your generosity, and please tell me if anything has changed."}]$j$::jsonb),

 ('monthly_giver', 'faith', 'Appreciate a monthly giver', 'A monthly gift is quiet and easy to take for granted: say thank you for it.', 'monthly_giver', 60, 180, 100, $j$[
   {"after_days":0,"title":"Thank them for their steady gift","why":"Monthly givers are the most loyal and the least thanked.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I wanted to thank you personally for your monthly gift. It is what lets us plan with confidence."},
   {"after_days":90,"title":"Share what it has made possible","why":"Showing the result keeps a monthly giver giving.","kind":"update","channel":"email","draft":"Dear {{name}}, from {{me}} at {{org}}: here is what your steady gift has made possible this season. Thank you."}]$j$::jsonb),
 ('monthly_giver', 'civic', 'Appreciate a monthly donor', 'A monthly gift is quiet and easy to take for granted: say thank you for it.', 'monthly_giver', 60, 180, 100, $j$[
   {"after_days":0,"title":"Thank them for their steady gift","why":"Monthly donors are the most loyal and the least thanked.","kind":"thank_you","channel":"phone","draft":"Hello {{name}}, it is {{me}} from {{org}}. I wanted to thank you personally for your monthly gift. It is what lets us plan with confidence."},
   {"after_days":90,"title":"Share what it has made possible","why":"Showing the result keeps a monthly donor giving.","kind":"update","channel":"email","draft":"Dear {{name}}, from {{me}} at {{org}}: here is what your steady gift has made possible this season. Thank you."}]$j$::jsonb)
on conflict (key, audience) do nothing;

-- ── Which starters fit this community ─────────────────────────────────────────
create or replace function app._care_audience(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when coalesce((select oc.faith_based from app.centers c join app.organization_categories oc on oc.key = c.category_key where c.id = p_center), false)
              then 'faith' else 'civic' end
$$;
revoke execute on function app._care_audience(uuid) from public, anon, authenticated;

-- ── The list (playbooks with their steps) ─────────────────────────────────────
create or replace function app.care_playbooks_list(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_rows jsonb; v_missing integer; v_aud text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  v_aud := app._care_audience(p_center);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'key', p.key, 'name', p.name, 'summary', p.summary, 'trigger_key', p.trigger_key, 'window_days', p.window_days,
           'cooldown_days', p.cooldown_days, 'enabled', p.enabled, 'starter_key', p.starter_key,
           'steps', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'after_days', s.after_days, 'title', s.title,
                                                                    'why', s.why, 'kind', s.kind, 'channel', s.channel, 'draft', s.draft)
                                              order by s.position, s.id), '[]'::jsonb)
                       from app.care_playbook_steps s where s.playbook_id = p.id and s.archived_at is null))
         order by p.sort, p.name, p.id), '[]'::jsonb)
    into v_rows from app.care_playbooks p where p.center_id = p_center;
  select count(*) into v_missing from app.care_starters st
   where st.audience = v_aud and not exists (select 1 from app.care_playbooks p where p.center_id = p_center and p.starter_key = st.key);
  return jsonb_build_object('playbooks', v_rows, 'starters_missing', v_missing, 'audience', v_aud, 'can_manage', app.care_can(p_center, 'manage'),
                            'label', app._module_label(p_center, 'care'));
end $$;

-- ── Installing the starters ───────────────────────────────────────────────────
create or replace function app.install_care_starters(p_center uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare st app.care_starters; v_pb uuid; v_n integer := 0; v_aud text; s jsonb; i integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  v_aud := app._care_audience(p_center);
  perform app.set_audit_context('Care starter playbooks installed');
  for st in select * from app.care_starters x where x.audience = v_aud order by x.sort, x.key loop
    if exists (select 1 from app.care_playbooks p where p.center_id = p_center and p.starter_key = st.key) then continue; end if;
    insert into app.care_playbooks (center_id, key, name, summary, trigger_key, window_days, cooldown_days, enabled, starter_key, sort, updated_by)
    values (p_center, st.key, st.name, st.summary, st.trigger_key, st.window_days, st.cooldown_days, true, st.key, st.sort, auth.uid())
    on conflict (center_id, key) do nothing
    returning id into v_pb;
    if v_pb is null then continue; end if;
    i := 0;
    for s in select e from jsonb_array_elements(st.steps) e loop
      i := i + 1;
      insert into app.care_playbook_steps (playbook_id, center_id, position, after_days, title, why, kind, channel, draft)
      values (v_pb, p_center, i, (s->>'after_days')::int, s->>'title', s->>'why', s->>'kind', nullif(s->>'channel', ''), nullif(s->>'draft', ''));
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── Saving one playbook ───────────────────────────────────────────────────────
-- p_playbook: {id?, name, summary?, trigger_key, window_days?, cooldown_days?, enabled?, steps: [{id?, after_days, title, why, kind, channel?, draft?}]}.
-- Steps in the order given; a step left out of an existing playbook is archived (its history keeps its words). 1 to 12 steps.
create or replace function app.save_care_playbook(p_center uuid, p_playbook jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.care_playbooks; v_id uuid; v_name text; v_summary text; v_trigger text; v_window integer; v_cool integer; v_enabled boolean;
  s jsonb; k text; i integer := 0; v_key text; v_step uuid; v_kept uuid[] := '{}'::uuid[]; v_after integer; v_title text; v_why text; v_kind text;
  v_channel text; v_draft text; v_n integer; v_sort integer;
  v_pkeys constant text[] := array['id', 'name', 'summary', 'trigger_key', 'window_days', 'cooldown_days', 'enabled', 'steps'];
  v_skeys constant text[] := array['id', 'after_days', 'title', 'why', 'kind', 'channel', 'draft'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_playbook is null or jsonb_typeof(p_playbook) <> 'object' then raise exception 'Nothing to save: send the playbook.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_playbook) loop
    if not (k = any (v_pkeys)) then raise exception 'A playbook has no field "%".', k using errcode = '22023'; end if;
  end loop;
  if nullif(p_playbook->>'id', '') is not null then
    select * into p from app.care_playbooks x where x.id = (p_playbook->>'id')::uuid and x.center_id = p_center for update;
    if p.id is null then raise exception 'That playbook was not found.' using errcode = 'P0002'; end if;
  end if;
  v_name := btrim(coalesce(p_playbook->>'name', p.name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then raise exception 'Give the playbook a name of up to 80 characters.' using errcode = '23514'; end if;
  v_summary := nullif(btrim(coalesce(case when p_playbook ? 'summary' then p_playbook->>'summary' else p.summary end, '')), '');
  if v_summary is not null and char_length(v_summary) > 300 then raise exception 'The summary is at most 300 characters.' using errcode = '23514'; end if;
  v_trigger := coalesce(nullif(btrim(coalesce(p_playbook->>'trigger_key', '')), ''), p.trigger_key);
  if v_trigger is null or v_trigger not in ('first_gift', 'new_household', 'steady', 'cooling', 'at_risk', 'lapsed', 'volunteer_no_gift', 'giver_no_part', 'pledge_due', 'monthly_giver') then
    raise exception 'Say who the playbook is for: a first gift, a new household, a steady giver, one who is cooling, at risk or lapsed, a volunteer who does not give, a giver who does not take part, a pledge falling due or a monthly giver.' using errcode = '23514';
  end if;
  v_window := coalesce(case when p_playbook ? 'window_days' then nullif(p_playbook->>'window_days', '')::integer end, p.window_days, 60);
  if v_window < 1 or v_window > 365 then raise exception 'The window is 1 to 365 days.' using errcode = '23514'; end if;
  v_cool := coalesce(case when p_playbook ? 'cooldown_days' then nullif(p_playbook->>'cooldown_days', '')::integer end, p.cooldown_days, 180);
  if v_cool < 30 or v_cool > 1095 then raise exception 'Wait 30 to 1,095 days before a household enters the same playbook again.' using errcode = '23514'; end if;
  if p_playbook ? 'enabled' and jsonb_typeof(p_playbook->'enabled') <> 'boolean' then raise exception 'Enabled is yes or no.' using errcode = '22023'; end if;
  v_enabled := coalesce((p_playbook->>'enabled')::boolean, p.enabled, true);
  if jsonb_typeof(p_playbook->'steps') is distinct from 'array' then raise exception 'A playbook needs its steps.' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_playbook->'steps');
  if v_n < 1 or v_n > 12 then raise exception 'A playbook has 1 to 12 steps.' using errcode = '23514'; end if;

  perform app.set_audit_context('Care playbook saved');
  if p.id is null then
    v_key := left(regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'), 40);
    v_key := 'p_' || trim(both '_' from v_key) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    select coalesce(max(x.sort), 0) + 10 into v_sort from app.care_playbooks x where x.center_id = p_center;
    insert into app.care_playbooks (center_id, key, name, summary, trigger_key, window_days, cooldown_days, enabled, sort, updated_by)
    values (p_center, v_key, v_name, v_summary, v_trigger, v_window, v_cool, v_enabled, v_sort, auth.uid()) returning id into v_id;
  else
    v_id := p.id;
    update app.care_playbooks set name = v_name, summary = v_summary, trigger_key = v_trigger, window_days = v_window, cooldown_days = v_cool,
           enabled = v_enabled, updated_at = now(), updated_by = auth.uid() where id = v_id;
  end if;

  for s in select e from jsonb_array_elements(p_playbook->'steps') e loop
    i := i + 1;
    if jsonb_typeof(s) <> 'object' then raise exception 'Step % was not understood.', i using errcode = '22023'; end if;
    for k in select jsonb_object_keys(s) loop
      if not (k = any (v_skeys)) then raise exception 'A step has no field "%".', k using errcode = '22023'; end if;
    end loop;
    begin v_after := (s->>'after_days')::integer; exception when others then v_after := null; end;
    if v_after is null or v_after < 0 or v_after > 365 then raise exception 'Step %: say how many days after the household enters it (0 to 365).', i using errcode = '23514'; end if;
    v_title := btrim(coalesce(s->>'title', ''));
    if char_length(v_title) < 1 or char_length(v_title) > 120 then raise exception 'Step %: give it a title of up to 120 characters.', i using errcode = '23514'; end if;
    v_why := btrim(coalesce(s->>'why', ''));
    if char_length(v_why) < 1 or char_length(v_why) > 300 then raise exception 'Step %: say why, in up to 300 characters.', i using errcode = '23514'; end if;
    v_kind := btrim(coalesce(s->>'kind', ''));
    if v_kind not in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'other') then
      raise exception 'Step %: say what the touch is: a thank-you, a check-in, a greeting, a welcome, an update, an invitation or something else.', i using errcode = '23514';
    end if;
    v_channel := nullif(btrim(coalesce(s->>'channel', '')), '');
    if v_channel is not null and v_channel not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other') then
      raise exception 'Step %: say how: in person, phone, text, email, WhatsApp, post, video or another way.', i using errcode = '23514';
    end if;
    v_draft := nullif(btrim(coalesce(s->>'draft', '')), '');
    if v_draft is not null and char_length(v_draft) > 1500 then raise exception 'Step %: the draft is at most 1,500 characters.', i using errcode = '23514'; end if;
    v_step := nullif(s->>'id', '')::uuid;
    if v_step is not null and exists (select 1 from app.care_playbook_steps x where x.id = v_step and x.playbook_id = v_id) then
      update app.care_playbook_steps set position = i, after_days = v_after, title = v_title, why = v_why, kind = v_kind, channel = v_channel,
             draft = v_draft, archived_at = null, updated_at = now() where id = v_step;
    else
      insert into app.care_playbook_steps (playbook_id, center_id, position, after_days, title, why, kind, channel, draft)
      values (v_id, p_center, i, v_after, v_title, v_why, v_kind, v_channel, v_draft) returning id into v_step;
    end if;
    v_kept := v_kept || v_step;
  end loop;
  update app.care_playbook_steps set archived_at = now(), updated_at = now() where playbook_id = v_id and archived_at is null and not (id = any (v_kept));
  return v_id;
end $$;

create or replace function app.set_care_playbook_enabled(p_playbook uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.care_playbooks;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into p from app.care_playbooks x where x.id = p_playbook for update;
  if p.id is null or not app.care_can(p.center_id, 'manage') then perform app._care_refuse(p.center_id); end if;
  if p_enabled is null then raise exception 'Say whether the playbook is on or paused.' using errcode = '22023'; end if;
  perform app.set_audit_context(case when p_enabled then 'Care playbook resumed' else 'Care playbook paused' end);
  update app.care_playbooks set enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where id = p.id;
end $$;

revoke execute on function app.care_playbooks_list(uuid), app.install_care_starters(uuid), app.save_care_playbook(uuid, jsonb),
  app.set_care_playbook_enabled(uuid, boolean) from public, anon;
grant execute on function app.care_playbooks_list(uuid), app.install_care_starters(uuid), app.save_care_playbook(uuid, jsonb),
  app.set_care_playbook_enabled(uuid, boolean) to authenticated, service_role;
