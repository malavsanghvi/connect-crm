-- Wave 3 (stream w-events) · Events get a readable reference number, like
-- orders, pledges and receipts: {short_name}-EV-901, -902, … per center.
--
-- The portal's Events table (prototype "ID" column: EV-901…) showed a prefix of
-- the row's uuid, which is not a number anyone can say on the phone, and
-- repeated for rows whose ids share a prefix. The number is issued by the
-- existing app.assign_numbers trigger through app.next_number, so it is unique
-- per center and never reused. Existing events are numbered in creation order.
-- No policy or permission changes.

alter table app.events add column if not exists event_number text not null default '';

alter table app.number_sequences drop constraint if exists number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind = any (array['member', 'household', 'pledge', 'order', 'receipt', 'event']));

create or replace function app.next_number(p_center uuid, p_kind text)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare v_short text; v_prefix text; v_start bigint; v_n bigint;
begin
  select upper(coalesce(nullif(short_name, ''), left(regexp_replace(slug, '[^a-zA-Z0-9]', '', 'g'), 6))) into v_short
    from app.centers where id = p_center;
  v_prefix := v_short || case p_kind when 'member' then '-' when 'household' then '-H-' when 'pledge' then '-PL-'
                                     when 'order' then '-S-' when 'receipt' then '-R-' when 'event' then '-EV-' end;
  v_start := case p_kind when 'member' then 10001 when 'household' then 2001 when 'pledge' then 20001
                         when 'order' then 1001 when 'event' then 901 else 100001 end;
  insert into app.number_sequences as s (center_id, kind, prefix, next_value) values (p_center, p_kind, v_prefix, v_start + 1)
    on conflict (center_id, kind) do update set next_value = s.next_value + 1
    returning s.prefix, s.next_value - 1 into v_prefix, v_n;
  return v_prefix || v_n;
end $$;

create or replace function app.assign_numbers()
returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_table_name = 'people' then
    if coalesce(new.member_number, '') = '' then new.member_number := app.next_number(new.center_id, 'member'); end if;
  elsif tg_table_name = 'households' then
    if coalesce(new.household_number, '') = '' then new.household_number := app.next_number(new.center_id, 'household'); end if;
  elsif tg_table_name = 'pledges' then
    if coalesce(new.pledge_number, '') = '' then new.pledge_number := app.next_number(new.center_id, 'pledge'); end if;
  elsif tg_table_name = 'store_orders' then
    if coalesce(new.order_number, '') = '' then new.order_number := app.next_number(new.center_id, 'order'); end if;
  elsif tg_table_name = 'payments' then
    if coalesce(new.receipt_number, '') = '' then new.receipt_number := app.next_number(new.center_id, 'receipt'); end if;
  elsif tg_table_name = 'events' then
    if coalesce(new.event_number, '') = '' then new.event_number := app.next_number(new.center_id, 'event'); end if;
  end if;
  return new;
end $$;

drop trigger if exists number_events on app.events;
create trigger number_events before insert on app.events for each row execute function app.assign_numbers();

do $$
declare r record;
begin
  for r in select id, center_id from app.events where event_number = '' order by created_at, id loop
    update app.events set event_number = app.next_number(r.center_id, 'event') where id = r.id;
  end loop;
end $$;

create unique index if not exists events_center_id_event_number_key on app.events (center_id, event_number);
