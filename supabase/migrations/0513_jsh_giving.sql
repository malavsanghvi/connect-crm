-- f-jsh-content · 4 of 4: general Jain donation opportunities for JSH.
--
-- Funds, campaigns and open opportunities that fit a Jain temple's practice
-- (owner, 2026-09-25). Money rules are unchanged: a fund's `restricted` flag is
-- the giving model's existing marker for money that may only be used for its
-- purpose, and every campaign names its fund, so gifts land where the donor
-- meant. Dev Dravya, Gyan Dravya, Jiv Daya, Sadhu-Sadhvi Vaiyavach and Anukampa
-- are restricted; Sadharan (general upkeep) is not.
--
-- Nothing is added twice: an existing fund of the same purpose is reused (by
-- key, or by name, e.g. "Jeevdaya" for Jiv Daya, the general fund for Sadharan)
-- and its settings are left as they are; a campaign or opportunity whose name
-- already exists in the organization is not added again.
--
-- app.seed_jsh_giving does nothing unless the organization exists; it is also
-- called at the end of seed.sql (see 0511).
set client_min_messages = warning;

create or replace function app.seed_jsh_giving(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  f record; c record; o record; v_fund uuid; v_camp uuid; v_funds jsonb := '{}'::jsonb;
  n_funds int := 0; n_camps int := 0; n_opps int := 0; v_sort int;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    return jsonb_build_object('funds', 0, 'campaigns', 0, 'opportunities', 0);
  end if;
  perform app.set_audit_context('JSH sandbox content: Jain donation opportunities (owner, 2026-09-25)');

  -- Funds: key, name, restricted, how an existing fund of the same purpose is recognised (key list, name pattern).
  for f in select * from (values
      ('jiv_daya',     'Jiv Daya',               true,  array['jiv_daya','jivdaya','jeevdaya','jeev_daya','jiva_daya'], '^\s*j(ee|i)va?\s*-?\s*daya'),
      ('sadharan',     'Sadharan',               false, array['sadharan','general'],                                   '^\s*(sadharan|general fund)'),
      ('dev_dravya',   'Dev Dravya',             true,  array['dev_dravya','devdravya','dev_dravy'],                   '^\s*dev\s*-?\s*dravya'),
      ('gyan_dravya',  'Gyan Dravya',            true,  array['gyan_dravya','gnan_dravya','gyandravya','jnan_dravya'], '^\s*(gyan|gnan|jnan|gyaan)\s*-?\s*dravya'),
      ('vaiyavach',    'Sadhu-Sadhvi Vaiyavach', true,  array['vaiyavach','veyavach','vaiyavacch'],                    '(vaiyav|veyav)'),
      ('anukampa',     'Anukampa',               true,  array['anukampa'],                                              '^\s*anukampa')
    ) as x(key, name, restricted, keys, pattern)
  loop
    select id into v_fund from app.funds
     where center_id = p_center and (key = any (f.keys) or name ~* f.pattern)
     order by (key = f.key) desc, (key = any (f.keys)) desc, active desc, name limit 1;
    if v_fund is null then
      insert into app.funds (center_id, key, name, restricted, active) values (p_center, f.key, f.name, f.restricted, true)
      on conflict (center_id, key) do nothing returning id into v_fund;
      if v_fund is null then select id into v_fund from app.funds where center_id = p_center and key = f.key; end if;
      n_funds := n_funds + 1;
    end if;
    v_funds := v_funds || jsonb_build_object(f.key, v_fund);
  end loop;

  -- Sponsorships use the organization's own fund for them when it has one.
  v_funds := v_funds || jsonb_build_object('swamivatsalya', coalesce(
    (select id from app.funds where center_id = p_center and (key = 'sadharmik' or name ~* 'sadharmik') order by active desc, name limit 1),
    (v_funds->>'sadharan')::uuid));
  v_funds := v_funds || jsonb_build_object('pathshala', coalesce(
    (select id from app.funds where center_id = p_center and (key = 'pathshala' or name ~* '^\s*pathshala') order by active desc, name limit 1),
    (v_funds->>'gyan_dravya')::uuid));

  -- Campaigns (published) and their open opportunities. Amounts in cents; Jain gifts often end in 1 (21, 51, 108, 251 ...).
  v_sort := 0;
  for c in select * from (values
      (1,  'Jiv Daya', 'jiv_daya', 'general',
       'Compassion for every living being: feed, shelter and medical care for animals through panjrapoles and animal rescues. Given only for Jiv Daya.',
       'Jiv Daya gift', 'Care for animals and all living beings', 'amount',
       '[{"amount_cents":2100},{"amount_cents":5100},{"amount_cents":10800},{"amount_cents":25100}]'),
      (2,  'Sadharan', 'sadharan', 'general',
       'Sadharan dravya keeps the Jain center open: utilities, upkeep and the everyday needs of the sangh.',
       'Sadharan gift', 'General upkeep of the Jain center', 'amount',
       '[{"amount_cents":5100},{"amount_cents":10800},{"amount_cents":25100},{"amount_cents":50100}]'),
      (3,  'Dev Dravya', 'dev_dravya', 'general',
       'Offered to Bhagwan and used only for the derasar, its care and its sacred needs, as Jain practice requires.',
       'Dev Dravya gift', 'For the derasar only · restricted', 'amount',
       '[{"amount_cents":5100},{"amount_cents":10800},{"amount_cents":25100},{"amount_cents":110100}]'),
      (4,  'Gyan Dravya', 'gyan_dravya', 'general',
       'Gyan dravya supports right knowledge: scriptures, books, the library and the teaching of Jain principles. Used only for knowledge.',
       'Gyan Dravya gift', 'Books, scriptures and Pathshala learning', 'amount',
       '[{"amount_cents":2100},{"amount_cents":5100},{"amount_cents":10800},{"amount_cents":25100}]'),
      (5,  'Sadhu-Sadhvi Vaiyavach', 'vaiyavach', 'general',
       'Seva of our Sadhu and Sadhvi Bhagwants when they visit: travel, stay and care. Used only for their vaiyavach.',
       'Sadhu-Sadhvi Vaiyavach gift', 'Seva of visiting Sadhu and Sadhvi Bhagwants', 'amount',
       '[{"amount_cents":5100},{"amount_cents":10800},{"amount_cents":25100}]'),
      (6,  'Ayambil Oli sponsorship', 'sadharan', 'sponsorship',
       'Sponsor the Ayambil meals during the nine days of Ayambil Oli (Chaitra and Aso) and support everyone keeping the tapasya.',
       'Sponsor Ayambil Oli', 'Ayambil meals for the tapasvis', 'tier',
       '[{"key":"one-day","label":"One day","amount_cents":25100,"recognition":null},{"key":"three-days","label":"Three days","amount_cents":75100,"recognition":null},{"key":"all-nine-days","label":"All nine days","amount_cents":225100,"recognition":null}]'),
      (7,  'Paryushan Swamivatsalya sponsorship', 'swamivatsalya', 'sponsorship',
       'Host the sangh meal during Paryushan Mahaparva: sadharmik bhakti for everyone who gathers.',
       'Sponsor the Paryushan Swamivatsalya', 'The sangh meal during Paryushan', 'tier',
       '[{"key":"contribute","label":"Contribute","amount_cents":25100,"recognition":null},{"key":"co-sponsor","label":"Co-sponsor","amount_cents":110100,"recognition":null},{"key":"full-sponsor","label":"Full sponsor","amount_cents":510100,"recognition":null}]'),
      (8,  'Pathshala sponsorship', 'pathshala', 'sponsorship',
       'Support Pathshala: books, supplies and activities for the children and adults learning Jain dharma every week.',
       'Sponsor Pathshala', 'Books, supplies and activities for Pathshala', 'tier',
       '[{"key":"one-sunday","label":"One Sunday of classes","amount_cents":25100,"recognition":null},{"key":"books-and-supplies","label":"Books and supplies for a class","amount_cents":50100,"recognition":null},{"key":"the-year","label":"The whole year","amount_cents":250100,"recognition":null}]'),
      (9,  'Aangi and pooja sponsorship', 'dev_dravya', 'sponsorship',
       'Sponsor the aangi (adornment of Bhagwan) or the samagri for daily pooja at the derasar. Offered as Dev Dravya.',
       'Sponsor an aangi or pooja', 'Offered as Dev Dravya · restricted', 'tier',
       '[{"key":"pooja-samagri","label":"Pooja samagri for a week","amount_cents":10800,"recognition":null},{"key":"aangi","label":"Aangi for one day","amount_cents":25100,"recognition":null},{"key":"aangi-parva","label":"Aangi on a parva day","amount_cents":50100,"recognition":null}]'),
      (10, 'Anukampa (humanitarian aid)', 'anukampa', 'general',
       'Compassion for people in need: disaster relief, food and medical help, given without distinction.',
       'Anukampa gift', 'Humanitarian aid for people in need', 'amount',
       '[{"amount_cents":2500},{"amount_cents":5100},{"amount_cents":10100}]')
    ) as x(sort, campaign, fund, kind, description, opportunity, subtitle, opp_kind, options)
    order by 1
  loop
    select id into v_camp from app.campaigns where center_id = p_center and lower(btrim(name)) = lower(c.campaign) order by created_at limit 1;
    if v_camp is null then
      insert into app.campaigns (center_id, fund_id, name, kind, description, status)
      values (p_center, (v_funds->>c.fund)::uuid, c.campaign, c.kind, c.description, 'published')
      returning id into v_camp;
      n_camps := n_camps + 1;
    end if;
    if not exists (select 1 from app.opportunities where center_id = p_center and lower(btrim(name)) = lower(c.opportunity)) then
      insert into app.opportunities (center_id, campaign_id, name, subtitle, description, kind, options, amount_cents, allow_anonymous, sort_order, status)
      values (p_center, v_camp, c.opportunity, c.subtitle, c.description, c.opp_kind, c.options::jsonb, null, true, 100 + c.sort, 'open');
      n_opps := n_opps + 1;
    end if;
  end loop;
  return jsonb_build_object('funds', n_funds, 'campaigns', n_camps, 'opportunities', n_opps);
end $$;
revoke execute on function app.seed_jsh_giving(uuid) from public, anon, authenticated;
grant execute on function app.seed_jsh_giving(uuid) to service_role;

do $$ begin perform app.seed_jsh_giving(id) from app.centers where slug = 'jsh'; end $$;
