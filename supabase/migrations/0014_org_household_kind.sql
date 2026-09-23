-- 0014_org_household_kind.sql
-- Organizations assign a person ID AND a separate household ID (JSH does both,
-- and the two number spaces can overlap: person 0417 and household 0417 may be
-- different records). They must be different identifier kinds.
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
alter type app.identifier_kind add value if not exists 'org_household' after 'org_member';
