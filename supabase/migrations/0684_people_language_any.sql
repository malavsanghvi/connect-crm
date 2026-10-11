-- 0684_people_language_any.sql (a person's language is any language, not only English, Gujarati or Hindi)
--
-- app.people.language was limited to ('en','gu','hi') by a check from the very first migration (0001). A community that
-- speaks Spanish, Arabic or Tagalog could not record what its members speak. The column now holds any language code in the
-- BCP-47 shape ("es", "pt-BR", "zh-Hant", "ar"): a 2-3 letter language, then up to four dash-separated parts of 2-8
-- letters or digits, at most 35 characters. Every value already there ('en', 'gu', 'hi') still passes. The app normalises the
-- case ("PT-br" is saved as "pt-BR") and offers the community's own languages; this check only keeps text that is not a
-- language code out. It is a schema change, not an access change: who can read or write a person is untouched.

alter table app.people drop constraint if exists people_language_check;
alter table app.people drop constraint if exists people_language_bcp47;
alter table app.people add constraint people_language_bcp47
  check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$' and char_length(language) <= 35);

comment on column app.people.language is
  'The language the person prefers, as a BCP-47 code (en, gu, hi, es, pt-BR, ar ...). Any language; the community''s own list is in org_profiles.languages.';
