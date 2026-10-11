// A community's languages, for every community: one with English and Spanish, one with English, Gujarati and Hindi, one with French
// only, one with Arabic only (right to left). Reminders, campaigns, a person's language, the onboarding questions and the website
// draft all follow the languages the community chose, never a fixed English / Gujarati / Hindi.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { pickSaved } from "@/lib/commands/catalog/messages-draft-reminder";
import { campaignValues, parseTranslationsJson } from "@/lib/commands/catalog/messages/shared";
import { draftReminder, whenText, type ReminderDraft } from "@/lib/commands/catalog/reminder-text";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import type { CommandContext, CommandNeedsConfirmation, CommandRunResult } from "@/lib/commands/types";
import { loadCommunityLocale, localeOf } from "@/lib/community-locale";
import { buildTranslations, languagesNeedingTranslation, translationLanguages, translationsFromFields } from "@/lib/comms";
import { toLanguage } from "@/lib/import/transforms";
import { communityLanguages } from "@/lib/languages";
import { text as onboardingText } from "@/lib/onboarding/resolve/strings";
import { parsePersonForm, personLanguageOptions, languageLabel as personLanguageLabel } from "@/lib/people";
import { generateDraft } from "@/lib/site-draft/generate";
import { clockTime, longDate } from "@/lib/site-draft/text";
import { formatPhone } from "@/lib/site-draft/weaver";
import { dbWithReason } from "@/lib/session";
import { parseProfile } from "@/lib/setup";

import { CHILDREN, communityWithChildren, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./commands/helpers";
import { COMMS_STAFF, M, messagesContext, messagesDb, switchedOn as messagesSwitchedOn, CONFIRM_KEYS } from "./commands/messages-world";
import { ID, peopleContext, peopleDb, switchedOn as peopleSwitchedOn } from "./commands/people-fixture";
import { FAITH, JAIN, weaver } from "./fixtures/site-draft";

const DIWALI = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";
const FSI = "⁨";
const PDI = "⁩";

// The four communities of this file.
const ENGLISH_SPANISH = ["en", "es"];
const GUJARATI_HINDI = ["en", "gu", "hi"];
const FRENCH_ONLY = ["fr"];
const ARABIC_ONLY = ["ar"];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Reminders: the wording, one language at a time ───────────────────────────────────────────────────────────────────
describe("reminder drafts follow the community's languages", () => {
  const event = { name: "Harvest Supper", starts_at: "2026-10-24T23:30:00Z", venue: "Main Hall" };
  const center = { name: "Maple Hall Community", short_name: "Maple Hall" };
  const draft = (language: string, extra: Partial<Parameters<typeof draftReminder>[0]> = {}): ReminderDraft =>
    draftReminder({ kind: "event_reminder", language, event, tz: "America/Chicago", center, ...extra });

  it("English and Spanish: built-in English, and the English text marked 'needs translation' for Spanish", () => {
    const [en, es] = ENGLISH_SPANISH.map((l) => draft(l));
    expect(en).toMatchObject({ language: "en", source: "built_in", needs_translation: false });
    expect(es).toMatchObject({ language: "es", language_name: "Spanish (español)", source: "needs_translation", needs_translation: true, direction: "ltr", text_direction: "ltr" });
    expect(es.subject).toBe(en.subject);
    expect(es.body).toBe(en.body);
    expect(es.body).toBe("This is a reminder that Harvest Supper is on Saturday, October 24 at 6:30 PM. It will be at Main Hall. We look forward to seeing you.");
  });

  it("English, Gujarati and Hindi: the wording Weaver has built in, for all three", () => {
    const drafts = GUJARATI_HINDI.map((l) => draft(l));
    expect(drafts.map((d) => d.source)).toEqual(["built_in", "built_in", "built_in"]);
    expect(drafts.map((d) => d.needs_translation)).toEqual([false, false, false]);
    expect(drafts[1].body).toMatch(/[઀-૿]/);
    expect(drafts[2].body).toMatch(/[ऀ-ॿ]/);
    expect(drafts[1].language_name).toBe("Gujarati (ગુજરાતી)");
  });

  it("French only: there is no English in the list, and French still gets a draft to translate", () => {
    const [fr] = FRENCH_ONLY.map((l) => draft(l));
    expect(fr).toMatchObject({ language: "fr", source: "needs_translation", needs_translation: true });
    expect(fr.body).toContain("Harvest Supper");
  });

  it("a saved template for the language is used before anything else, filled in the language's own date style", () => {
    const es = draft("es", { saved: { subject: "Recordatorio: {{event}}", body: "{{event}} es el {{when}} en {{venue}}." }, country: "MX" });
    expect(es).toMatchObject({ source: "community_template", needs_translation: false, subject: "Recordatorio: Harvest Supper" });
    expect(es.body).toMatch(/^Harvest Supper es el .*octubre.*(18:30|6:30).* en Main Hall\.$/);
    // The saved English template is what a language without wording is made from.
    const fr = draft("fr", { savedEnglish: { subject: "Hello: {{event}}", body: "Come to {{event}}." } });
    expect(fr).toMatchObject({ source: "needs_translation", needs_translation: true, subject: "Hello: Harvest Supper", body: "Come to Harvest Supper." });
  });

  it("a region of the language is served by the language's template ('es-MX' by 'es'), and the date follows the country", () => {
    const saved = pickSaved([{ language: "es", subject: "s", body: "{{when}}", center_id: "c1", version: 1 }], "c1");
    expect([...saved.keys()]).toEqual(["es"]);
    expect(whenText("2026-10-24T23:30:00Z", "America/Chicago", "en", "GB")).toBe("Saturday 24 October at 18:30");
    expect(whenText("2026-10-24T23:30:00Z", "America/Chicago", "en")).toBe("Saturday, October 24 at 6:30 PM");
    expect(whenText(null, "America/Chicago", "fr")).toBe("a date to be announced");
  });

  it("Arabic: right-to-left wording stays whole, with the English event name kept in place", () => {
    const body = "تذكير: {{event}} يوم {{when}} في {{venue}}. نتطلع لرؤيتكم.";
    const ar = draft("ar", { saved: { subject: "تذكير: {{event}}", body }, country: "AE" });
    expect(ar).toMatchObject({ language: "ar", source: "community_template", direction: "rtl", text_direction: "rtl" });
    // The Arabic words are exactly as saved; the Latin event and venue names are isolated so they do not flip the sentence.
    expect(ar.body.startsWith("تذكير: ")).toBe(true);
    expect(ar.body.endsWith(" نتطلع لرؤيتكم.")).toBe(true);
    expect(ar.body).toContain(`${FSI}Harvest Supper${PDI}`);
    expect(ar.body).toContain(`${FSI}Main Hall${PDI}`);
    expect(ar.subject).toBe(`تذكير: ${FSI}Harvest Supper${PDI}`);
    expect(ar.body.replaceAll(FSI, "").replaceAll(PDI, "")).toMatch(/^تذكير: Harvest Supper يوم .+ في Main Hall\. نتطلع لرؤيتكم\.$/);
    // With no Arabic wording at all, the draft is the English text, still left to right, and says the language reads right to left.
    const stand = draft("ar");
    expect(stand).toMatchObject({ source: "needs_translation", direction: "rtl", text_direction: "ltr" });
    expect(stand.body).not.toContain(FSI);
  });
});

// ── Reminders: the command ──────────────────────────────────────────────────────────────────────────────────────────
describe("messages.draft_reminder", () => {
  function setup(languages: string[] | null, world: FakeDbOptions = communityWithChildren(), center: Record<string, unknown> = {}) {
    const w = { ...world, rpc: { ...world.rpc, ...(languages ? { community_languages: languages } : {}) } };
    const db = fakeDb(w);
    const registry = new CommandRegistry();
    for (const c of CATALOG) registry.register(c);
    const session = fakeSession({ db, permissions: ["comms.send", "events.view"], center: { ...fakeSession().center, ...center } });
    const ctx = testContext({ session, registry, via: "screen", minorNames: CHILDREN.full });
    return { ctx, db };
  }
  const draftsOf = async (ctx: CommandContext, input: Record<string, unknown> = {}) => {
    const r = await runCommand(ctx, "messages.draft_reminder", { event_id: DIWALI, ...input });
    if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
    return r.data as { drafts: ReminderDraft[]; notes: string[]; sent: boolean };
  };

  it("drafts a version for each language an English and Spanish community uses", async () => {
    const { ctx, db } = setup(ENGLISH_SPANISH);
    const data = await draftsOf(ctx);
    expect(data.drafts.map((d) => [d.language, d.source])).toEqual([["en", "built_in"], ["es", "needs_translation"]]);
    expect(data.notes.join(" ")).toContain('Weaver has no Spanish wording for this yet');
    expect(data.notes.join(" ")).toContain('marked "needs translation"');
    expect(data.notes.join(" ")).not.toContain("Gujarati");
    expect(data.sent).toBe(false);
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(["community_languages"]);
  });

  it("drafts English, Gujarati and Hindi for a community that uses those three, and asks for the built-in wording to be checked", async () => {
    const { ctx } = setup(GUJARATI_HINDI);
    const data = await draftsOf(ctx);
    expect(data.drafts.map((d) => d.language)).toEqual(["en", "gu", "hi"]);
    expect(data.notes.join(" ")).toContain("The Gujarati and Hindi wording is built into Weaver. Ask someone who reads the language");
  });

  it("drafts French only for a French community, and Arabic only for an Arabic one (right to left)", async () => {
    const fr = await draftsOf(setup(FRENCH_ONLY).ctx);
    expect(fr.drafts.map((d) => [d.language, d.needs_translation])).toEqual([["fr", true]]);
    const ar = await draftsOf(setup(ARABIC_ONLY).ctx);
    expect(ar.drafts.map((d) => [d.language, d.direction, d.text_direction])).toEqual([["ar", "rtl", "ltr"]]);
  });

  it("uses the community's saved template in a language, and writes the date in the community's country style", async () => {
    const world = communityWithChildren();
    world.tables.message_templates = [
      { key: "rsvp_confirmation", channel: "push", language: "es", subject: "Confirme: {{event}}", body: "{{event}}: {{when}}", center_id: "center-1", version: 1 },
      { key: "rsvp_confirmation", channel: "push", language: "ar", subject: "تأكيد: {{event}}", body: "{{event}} {{when}}", center_id: "center-1", version: 1 },
    ];
    const { ctx } = setup(["es", "en", "ar"], world, { country: "MX" });
    const data = await draftsOf(ctx, { kind: "rsvp_confirmation" });
    expect(data.drafts.map((d) => [d.language, d.source])).toEqual([["es", "community_template"], ["en", "built_in"], ["ar", "community_template"]]);
    expect(data.drafts[0].subject).toBe("Confirme: Diwali Dinner");
    expect(data.drafts[2].direction).toBe("rtl");
    expect(data.drafts[2].subject).toContain("تأكيد: ");
  });

  it("drafts a language that is not on the community's list only when asked, and says so", async () => {
    const { ctx } = setup(["en", "gu"]);
    const data = await draftsOf(ctx, { language: "es" });
    expect(data.drafts.map((d) => d.language)).toEqual(["es"]);
    expect(data.notes.join(" ")).toContain("Spanish is not one of this community's languages (English and Gujarati)");
    const byName = await draftsOf(ctx, { language: "Gujarati" });
    expect(byName.drafts.map((d) => d.language)).toEqual(["gu"]);
  });

  it("refuses something that is not a language, in plain words", async () => {
    const { ctx } = setup(ENGLISH_SPANISH);
    const r = await runCommand(ctx, "messages.draft_reminder", { event_id: DIWALI, language: "klingon" });
    expect(r).toMatchObject({ ok: false, error: '"klingon" is not a language this can draft. Use a language code such as en, es or pt-BR, or all.' });
  });

  it("says so, and drafts English, when the community's languages cannot be read", async () => {
    const world = { ...communityWithChildren(), failRpc: { community_languages: { code: "42501", message: "permission denied" } } };
    const { ctx } = setup(null, world);
    const data = await draftsOf(ctx);
    expect(data.drafts.map((d) => d.language)).toEqual(["en"]);
    expect(data.notes[0]).toBe("Weaver could not read which languages this community uses just now, so it is using English only. Try again in a moment.");
  });

  it("is English when the community has not chosen a language yet", async () => {
    const { ctx } = setup(null);
    expect((await draftsOf(ctx)).drafts.map((d) => d.language)).toEqual(["en"]);
  });
});

// ── The community's languages, read ──────────────────────────────────────────────────────────────────────────────────
describe("loadCommunityLocale", () => {
  it("reads the list and builds the locale from the language and the country", async () => {
    const db = fakeDb({ tables: {}, rpc: { community_languages: ["es", "en"] } });
    expect(await loadCommunityLocale(db, { id: "c1", country: "mx" })).toEqual({ languages: ["es", "en"], known: true, note: null, country: "MX", locale: "es-MX" });
    expect(localeOf(["fr"], "CA").locale).toBe("fr-CA");
    expect(localeOf(null, null)).toMatchObject({ languages: ["en"], locale: "en-US", known: true });
  });

  it("is English with a note when the answer is an error, nothing, or not a list", async () => {
    const failing = fakeDb({ tables: {}, failRpc: { community_languages: { code: "XX000", message: "boom" } } });
    expect(await loadCommunityLocale(failing, { id: "c1" })).toMatchObject({ languages: ["en"], known: false, locale: "en-US" });
    const nobody = fakeDb({ tables: {}, rpc: { community_languages: () => null } });
    expect(await loadCommunityLocale(nobody, { id: "c1" })).toMatchObject({ languages: ["en"], known: false });
    const odd = fakeDb({ tables: {}, rpc: { community_languages: () => "es" } });
    expect(await loadCommunityLocale(odd, { id: "c1" })).toMatchObject({ languages: ["en"], known: false });
  });
});

// ── Campaigns: a version for each language ───────────────────────────────────────────────────────────────────────────
describe("campaign translations", () => {
  it("keeps a translation in any language, in the standard code, and nothing that is empty or not a language", () => {
    expect(buildTranslations({ es: { title: " Hola ", body_md: "Texto" }, "PT_br": { title: "Oi", body_md: "" }, fr: { title: "", body_md: "" }, nonsense: { title: "x", body_md: "y" } })).toEqual({
      es: { title: "Hola", body_md: "Texto" },
      "pt-BR": { title: "Oi", body_md: "" },
    });
    expect(translationLanguages({ es: { title: "x" }, "pt-BR": null, nonsense: { title: "x" } })).toEqual(["es"]);
    expect(translationLanguages(null)).toEqual([]);
  });

  it("reads title_<code> and body_<code> fields, and leaves the message's own body_md alone", () => {
    const fields: Record<string, string> = { title: "Subject", body_md: "Message", title_es: "Asunto", body_es: "Mensaje", "title_pt-BR": "Assunto", title_gu: "", body_nope: "x" };
    const found = translationsFromFields(Object.keys(fields), (k) => fields[k]!);
    expect(Object.keys(found).sort()).toEqual(["gu", "pt-BR"].concat("es").sort());
    expect(found.es).toEqual({ title: "Asunto", body_md: "Mensaje" });
    expect(buildTranslations(found)).toEqual({ es: { title: "Asunto", body_md: "Mensaje" }, "pt-BR": { title: "Assunto", body_md: "" } });
    expect(found).not.toHaveProperty("md");
  });

  it("lists the languages still needing a translation, for each community", () => {
    expect(languagesNeedingTranslation(ENGLISH_SPANISH, {})).toEqual(["es"]);
    expect(languagesNeedingTranslation(ENGLISH_SPANISH, { es: { title: "Hola", body_md: "x" } })).toEqual([]);
    expect(languagesNeedingTranslation(GUJARATI_HINDI, { gu: { title: "x", body_md: "y" } })).toEqual(["hi"]);
    expect(languagesNeedingTranslation(FRENCH_ONLY, {})).toEqual([]);
    expect(languagesNeedingTranslation(ARABIC_ONLY, null)).toEqual([]);
    expect(languagesNeedingTranslation(["es", "en"], {})).toEqual(["en"]);
    expect(languagesNeedingTranslation(["en", "es-MX"], { es: { title: "x", body_md: "y" } })).toEqual([]);
  });

  it("takes translations as JSON for any language, and tells the person plainly when they cannot be read", () => {
    const base = { name: "n", title: "t", body: "b", channels: "email" };
    const ok = campaignValues({ ...base, translations_json: JSON.stringify({ es: { title: "Hola", body: "Cuerpo" }, ar: { title: "مرحبا", body_md: "نص" } }), title_gu: "ગુજરાતી", body_gu: "સંદેશ" }, "America/Chicago");
    expect(ok.ok && ok.values.translations).toEqual({
      gu: { title: "ગુજરાતી", body_md: "સંદેશ" },
      es: { title: "Hola", body_md: "Cuerpo" },
      ar: { title: "مرحبا", body_md: "نص" },
    });
    expect(parseTranslationsJson("not json")).toMatchObject({ ok: false, error: expect.stringContaining("could not be read") });
    expect(parseTranslationsJson("[]")).toMatchObject({ ok: false });
    expect(parseTranslationsJson(JSON.stringify({ nonsense: { title: "x" } }))).toMatchObject({ ok: false, error: expect.stringContaining('"nonsense"') });
    expect(parseTranslationsJson(undefined)).toEqual({ ok: true, value: {} });
    expect(campaignValues({ ...base, translations_json: "{" }, "America/Chicago")).toMatchObject({ ok: false });
  });

  function messages(languages: string[]) {
    const { db } = messagesDb({ rpc: { community_languages: languages } });
    const ctx = messagesContext({ via: "assistant", db, rules: messagesSwitchedOn(CONFIRM_KEYS), permissions: COMMS_STAFF });
    return ctx;
  }
  const NEWSLETTER = { name: "Harvest news", title: "Harvest news", body: "Join us on Saturday.", channels: "email,push", zone_ids: M.zone };
  const ticket = (r: CommandRunResult): CommandNeedsConfirmation => {
    if (!r.ok || !r.needsConfirmation) throw new Error(`expected a confirmation, got ${JSON.stringify(r)}`);
    return r;
  };
  const lines = (t: CommandNeedsConfirmation) => Object.fromEntries(t.preview.lines.map((l) => [l.label, l.value]));

  it("the preview names the languages written and the ones that still need a translation", async () => {
    const es = ticket(await runCommand(messages(ENGLISH_SPANISH), "messages.schedule_campaign", NEWSLETTER));
    expect(lines(es)).toMatchObject({ Languages: "English", "Needs translation": "Spanish" });
    expect(es.preview.warnings?.join(" ")).toContain("No Spanish text yet, so families who read it get the English message. It is marked as needing translation.");

    const done = ticket(await runCommand(messages(ENGLISH_SPANISH), "messages.schedule_campaign", { ...NEWSLETTER, translations_json: JSON.stringify({ es: { title: "Noticias", body: "Únase a nosotros." } }) }));
    expect(lines(done)).toMatchObject({ Languages: "English, Spanish" });
    expect(lines(done)).not.toHaveProperty("Needs translation");

    const gh = ticket(await runCommand(messages(GUJARATI_HINDI), "messages.schedule_campaign", { ...NEWSLETTER, title_gu: "સમાચાર", body_gu: "સંદેશ" }));
    expect(lines(gh)).toMatchObject({ Languages: "English, Gujarati", "Needs translation": "Hindi" });
  });

  it("a French community writes in French first, and an Arabic one in Arabic", async () => {
    const fr = ticket(await runCommand(messages(FRENCH_ONLY), "messages.schedule_campaign", NEWSLETTER));
    expect(lines(fr)).toMatchObject({ Languages: "French" });
    expect(lines(fr)).not.toHaveProperty("Needs translation");
    const ar = ticket(await runCommand(messages(ARABIC_ONLY), "messages.schedule_campaign", { ...NEWSLETTER, title: "أخبار الحصاد", body: "انضموا إلينا يوم السبت." }));
    expect(lines(ar)).toMatchObject({ Languages: "Arabic", Subject: "أخبار الحصاد" });
  });

  it("the list of messages names the main language and what still needs a translation", async () => {
    const r = await runCommand(messages(ENGLISH_SPANISH), "messages.campaigns", { which: "all", limit: 30 });
    if (!r.ok || r.needsConfirmation) throw new Error("expected data");
    const list = (r.data as { campaigns: { campaign_id: string; languages: string[]; needs_translation: string[] }[] }).campaigns;
    const pending = list.find((c) => c.campaign_id === M.cpPending)!;
    expect(pending.languages[0]).toBe("English");
    expect(pending.needs_translation).toEqual(expect.arrayContaining(["Spanish"]));
  });
});

// ── People: a person's language ──────────────────────────────────────────────────────────────────────────────────────
describe("a person's language", () => {
  const today = "2026-10-11";

  it("takes any language in the community's list, in the standard code", () => {
    expect(parsePersonForm({ language: "es" }, today, ENGLISH_SPANISH)).toEqual({ ok: true, value: { language: "es" } });
    expect(parsePersonForm({ language: "Spanish" }, today, ENGLISH_SPANISH)).toEqual({ ok: true, value: { language: "es" } });
    expect(parsePersonForm({ language: "gu" }, today, GUJARATI_HINDI)).toEqual({ ok: true, value: { language: "gu" } });
    expect(parsePersonForm({ language: "fr" }, today, FRENCH_ONLY)).toEqual({ ok: true, value: { language: "fr" } });
    expect(parsePersonForm({ language: "AR" }, today, ARABIC_ONLY)).toEqual({ ok: true, value: { language: "ar" } });
    expect(parsePersonForm({ language: "pt_br" }, today, ["pt-BR", "en"])).toEqual({ ok: true, value: { language: "pt-BR" } });
  });

  it("refuses a language the community does not use, and something that is not a language, in plain words", () => {
    expect(parsePersonForm({ language: "fr" }, today, ENGLISH_SPANISH)).toEqual({
      ok: false,
      error: "French is not one of this community's languages (English and Spanish). Add it in Setup > Profile first",
    });
    expect(parsePersonForm({ language: "gu" }, today, ["en"])).toMatchObject({ ok: false });
    expect(parsePersonForm({ language: "klingon" }, today, ENGLISH_SPANISH)).toEqual({ ok: false, error: "Choose a language from the list (or give its code, like es or pt-BR)" });
    expect(parsePersonForm({ language: "" }, today, ENGLISH_SPANISH).ok).toBe(false);
  });

  it("takes any valid language code when no list is given (imports)", () => {
    expect(parsePersonForm({ language: "sw" }, today)).toEqual({ ok: true, value: { language: "sw" } });
    expect(parsePersonForm({ language: "english" }, today)).toEqual({ ok: true, value: { language: "en" } });
  });

  it("offers the community's languages, and the person's own when it is not among them", () => {
    expect(personLanguageOptions(ENGLISH_SPANISH, "en")).toEqual([{ value: "en", label: "English" }, { value: "es", label: "Spanish" }]);
    expect(personLanguageOptions(FRENCH_ONLY, "gu")).toEqual([{ value: "fr", label: "French" }, { value: "gu", label: "Gujarati" }]);
    expect(personLanguageOptions([], null)).toEqual([{ value: "en", label: "English" }]);
    expect(personLanguageLabel("ar")).toBe("Arabic");
    expect(personLanguageLabel(null)).toBe("—");
  });

  it("reads a language in an import as a name or a code, any language", () => {
    expect(toLanguage("Spanish")).toEqual({ ok: true, value: "es" });
    expect(toLanguage("pt_BR")).toEqual({ ok: true, value: "pt-BR" });
    expect(toLanguage("العربية")).toEqual({ ok: true, value: "ar" });
    expect(toLanguage("Gujarati")).toEqual({ ok: true, value: "gu" });
    expect(toLanguage("")).toMatchObject({ ok: false });
    expect(toLanguage("Klingon")).toMatchObject({ ok: false, error: expect.stringContaining("is not a language") });
  });

  function people(languages: string[] | null, personLanguage = "en") {
    const { db, tables } = peopleDb(languages ? { rpc: { community_languages: languages } } : { failRpc: { community_languages: { code: "XX000", message: "boom" } } });
    tables.people.find((p) => p.id === ID.priya)!.language = personLanguage;
    vi.mocked(dbWithReason).mockResolvedValue(db as never);
    const ctx = peopleContext({ via: "screen", db, permissions: undefined, session: { center: { ...fakeSession().center, rules: peopleSwitchedOn(["people.update_person"]) } } });
    return { ctx, tables };
  }
  const update = async (ctx: CommandContext, input: Record<string, unknown>) => {
    const { updatePerson } = await import("@/lib/commands/catalog/people/update-person");
    return updatePerson.execute!(ctx, { id: ID.priya, ...input } as never);
  };

  it("the update command saves a language the community uses", async () => {
    const { ctx, tables } = people(ENGLISH_SPANISH);
    expect(await update(ctx, { language: "es" })).toMatchObject({ ok: true });
    expect(tables.people.find((p) => p.id === ID.priya)?.language).toBe("es");
  });

  it("the update command refuses a language the community does not use, and says which ones it does", async () => {
    const { ctx, tables } = people(ENGLISH_SPANISH);
    await expect(update(ctx, { language: "fr" })).rejects.toThrow("Could not save the profile — French is not one of this community's languages (English and Spanish). Add it in Setup > Profile first.");
    expect(tables.people.find((p) => p.id === ID.priya)?.language).toBe("en");
  });

  it("keeps the language a person already has, even if the community no longer lists it, and takes any code when the list cannot be read", async () => {
    const kept = people(["en"], "gu");
    expect(await update(kept.ctx, { language: "gu", profession: "Chef" })).toMatchObject({ ok: true });
    const unread = people(null);
    expect(await update(unread.ctx, { language: "fr" })).toMatchObject({ ok: true });
    expect(unread.tables.people.find((p) => p.id === ID.priya)?.language).toBe("fr");
  });
});

// ── Onboarding: the questions read in any language, English when there is no wording ───────────────────────────────
describe("onboarding wording", () => {
  it("takes any language as a locale and reads English where Weaver has no wording of its own", () => {
    const en = onboardingText("q.skip");
    for (const locale of ["en", "es", "fr", "ar", "pt-BR", "gu", "hi", "gu-IN", "not a code"]) expect(onboardingText("q.skip", locale)).toBe(en);
    expect(onboardingText("q.same_for_rest", "es", { n: 3 })).toBe("Use the same answer for the other 3");
  });
});

// ── The community's profile: any language, the main one first ─────────────────────────────────────────────────────────
describe("the profile's languages", () => {
  const base = { name: "Maple Hall Community", time_zone: "America/Chicago" };
  const parse = (fields: Record<string, string>, ticked: string[]) =>
    parseProfile((n) => ({ ...base, ...fields })[n] ?? null, (n) => (n === "languages" ? ticked : []), ["America/Chicago"]);

  it("keeps the ticked languages in order, the main one first", () => {
    const r = parse({ main_language: "es" }, ["en", "es"]);
    expect(r.ok && r.value.languages).toEqual(["es", "en"]);
    expect(communityLanguages({ languages: r.ok ? r.value.languages : [] })).toEqual(["es", "en"]);
  });

  it("takes other languages typed by code, and says which one it does not know", () => {
    const r = parse({ other_languages: "sw, pt-BR" }, ["en"]);
    expect(r.ok && r.value.languages).toEqual(["en", "sw", "pt-BR"]);
    const bad = parse({ other_languages: "xx" }, ["en"]);
    expect(bad).toEqual({ ok: false, error: '"xx" is not a language code Weaver knows. Use a code like es, pt-BR or ar.' });
  });

  it("works for a community with a single language of any kind", () => {
    for (const only of ["fr", "ar"]) {
      const r = parse({}, [only]);
      expect(r.ok && r.value.languages).toEqual([only]);
    }
    expect(parse({}, [])).toMatchObject({ ok: false, error: expect.stringContaining("Choose at least one language") });
  });
});

// ── The website draft: dates, times and phone numbers the way the community writes them ───────────────────────────
describe("the website draft's formatting", () => {
  it("writes a date and a time in the community's locale (US by default)", () => {
    expect(longDate("2026-09-13")).toBe("September 13, 2026");
    expect(longDate("2026-09-13", "en-US")).toBe("September 13, 2026");
    expect(longDate("2026-09-13", "en-GB")).toBe("13 September 2026");
    expect(longDate("2026-09-13", "es-MX")).toMatch(/^13 de septiembre de 2026$/);
    expect(longDate("2026-09-13", "ar-AE")).toContain("سبتمبر");
    expect(longDate("2026-09-13", "not a locale")).toBe("September 13, 2026");
    expect(longDate("2026-13-01")).toBe("2026-13-01");
    expect(longDate("2026-02-31")).toBe("2026-02-31");
    expect(clockTime("18:30")).toBe("6:30 PM");
    expect(clockTime("18:30", "en-GB")).toBe("18:30");
    expect(clockTime("18:30", "fr-CA")).toMatch(/^18\s?h\s?30$/);
    expect(clockTime("00:30", "en-US")).toBe("12:30 AM");
    expect(clockTime("25:00")).toBe("25:00");
    expect(clockTime("soon", "es")).toBe("soon");
  });

  it("writes a phone number the way its country does, and never makes up how a country groups digits", () => {
    expect(formatPhone("+12815550142")).toBe("(281) 555-0142");
    expect(formatPhone("+12815550142", "US")).toBe("(281) 555-0142");
    expect(formatPhone("+12815550142", "ca")).toBe("(281) 555-0142");
    expect(formatPhone("+12815550142", "GB")).toBe("+1 281 555 0142");
    expect(formatPhone("+919876543210", "IN")).toBe("+91 98765 43210");
    expect(formatPhone("+442071234567", "GB")).toBe("+442071234567");
    expect(formatPhone(" 020 7123 4567 ", "GB")).toBe("020 7123 4567");
  });

  const text = (locale: string, country: string, phone: string, kind = JAIN): string => {
    const w = weaver({ profile: { public_phone: phone, public_email: "hello@maplehall.example.org", address: "1 Main Street", social: {} } });
    return JSON.stringify(generateDraft({ own: null, references: [], weaver: { ...w, locale, country }, kind }));
  };

  it("a British community's draft has British dates, 24-hour times and its own phone format", () => {
    const gb = text("en-GB", "GB", "+442071234567");
    expect(gb).toMatch(/Open 0?6:00 to 20:00 on 11 October 2026/);
    expect(gb).toContain("+442071234567");
    expect(gb).not.toContain("6:00 AM");
    expect(gb).not.toContain("October 11, 2026");
  });

  it("an American community's draft is as it always was", () => {
    const us = text("en-US", "US", "+12815550199");
    expect(us).toContain("Open 6:00 AM to 8:00 PM on October 11, 2026");
    expect(us).toContain("(281) 555-0199");
  });

  it("a Spanish-speaking community's draft writes the term dates in Spanish, for a non-Jain community too", () => {
    const es = text("es-MX", "MX", "+525512345678", FAITH);
    expect(es).toContain("13 de septiembre de 2026 to 2 de mayo de 2027");
    expect(es).not.toContain("September 13, 2026");
    expect(es).toContain("+525512345678");
  });

  it("a draft with no locale given is written for English, US, as before", () => {
    const w = weaver();
    const draft = JSON.stringify(generateDraft({ own: null, references: [], weaver: w, kind: FAITH }));
    expect(draft).toContain("September 13, 2026 to May 2, 2027");
    expect(draft).toContain("(281) 555-0199");
  });
});
