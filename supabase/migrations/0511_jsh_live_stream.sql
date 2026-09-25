-- f-jsh-content · 2 of 4: JSH's live stream (live darshan).
--
-- The place already exists: a published content item of kind darshan_stream
-- (Content › Today & darshan, "Live darshan") drives the member app's
-- "Watch live darshan" on Home and the player in Learn › Library. This adds
-- JSH's stream (https://rtsp.me/embed/FR8NYFzs/, owner, 2026-09-25) as that
-- item, and makes the database refuse a darshan stream whose link is not
-- https:// (new and changed rows; NOT VALID leaves any existing row alone).
--
-- JSH data reaches production only through migrations: app.seed_jsh_live_stream
-- does nothing unless the organization exists, adds nothing twice, and is also
-- called at the end of seed.sql (a new database loads its seed after the
-- migrations, so JSH does not exist yet when this file runs there).
set client_min_messages = warning;

do $$ begin
  alter table app.content_items add constraint content_items_darshan_https
    check (kind <> 'darshan_stream' or media_url is null or media_url ~* '^https://[^[:space:]]+$') not valid;
exception when duplicate_object then null;
end $$;

create or replace function app.seed_jsh_live_stream(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_url constant text := 'https://rtsp.me/embed/FR8NYFzs/'; v_id uuid;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then return jsonb_build_object('added', 0); end if;
  if exists (select 1 from app.content_items where center_id = p_center and kind = 'darshan_stream'
               and rtrim(lower(media_url), '/') = rtrim(lower(v_url), '/')) then
    return jsonb_build_object('added', 0);
  end if;
  perform app.set_audit_context('JSH sandbox content: the live stream (owner, 2026-09-25)');
  insert into app.content_items (center_id, kind, slug, title, body_md, media_url, metadata, status, published_at)
  values (p_center, 'darshan_stream', 'jsh-live-stream', 'JSH live stream',
          'Live darshan from the derasar, streamed around the clock.', v_url,
          '{"source":"rtsp.me · embedded player","schedule":"24 hours","stream_status":"live"}'::jsonb, 'published', now())
  on conflict do nothing
  returning id into v_id;
  return jsonb_build_object('added', case when v_id is null then 0 else 1 end);
end $$;
revoke execute on function app.seed_jsh_live_stream(uuid) from public, anon, authenticated;
grant execute on function app.seed_jsh_live_stream(uuid) to service_role;

do $$ begin perform app.seed_jsh_live_stream(id) from app.centers where slug = 'jsh'; end $$;
