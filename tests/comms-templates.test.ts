import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  availableChannels,
  campaignMenu,
  channelLabel,
  channelNotSetUpSentence,
  channelsLine,
  copiedMessage,
  copyName,
  COPY_NOTE,
  defaultPickerChannel,
  fromTemplateMessage,
  isCopyableKind,
  matchesQuery,
  mergeTokens,
  missingChannels,
  recentForPicker,
  recentWhen,
  savedTemplateMessage,
  startFromOptions,
  templateChannelNote,
  templateDefaultName,
  templateNameProblem,
  templatesForPicker,
  templateTokens,
  usesAvailableChannel,
  WHATSAPP_TEMPLATE_NOTE,
  type RecentRow,
  type TemplateRow,
} from "@/lib/comms-templates";

// Copy a communication as a new draft, and saved templates (docs/COMMS_HUB_TEMPLATES.md): the rules the screens share. The database
// functions are tested in supabase/tests/800_comms_copy_templates_test.sql; the last describe here keeps the SQL honest from this side.

const ALL = availableChannels({ textingApproved: true, whatsappAccountApproved: true, whatsappProductOn: true });
const EMAIL_ONLY = availableChannels({ textingApproved: false, whatsappAccountApproved: false, whatsappProductOn: false });

describe("the channels a community has", () => {
  it("always has email, the push teaser and the in-app archive", () => {
    expect(EMAIL_ONLY).toEqual(["email", "push", "in_app"]);
  });
  it("has text only when the carriers approved its registration", () => {
    expect(availableChannels({ textingApproved: true, whatsappAccountApproved: false, whatsappProductOn: false })).toEqual(["email", "sms", "push", "in_app"]);
  });
  it("has WhatsApp only when its product is on AND Meta approved the account", () => {
    expect(availableChannels({ textingApproved: false, whatsappAccountApproved: true, whatsappProductOn: false })).not.toContain("whatsapp");
    expect(availableChannels({ textingApproved: false, whatsappAccountApproved: false, whatsappProductOn: true })).not.toContain("whatsapp");
    expect(availableChannels({ textingApproved: false, whatsappAccountApproved: true, whatsappProductOn: true })).toContain("whatsapp");
  });
  it("uses a communication's channels against what the community has", () => {
    expect(usesAvailableChannel(["email", "sms"], EMAIL_ONLY)).toBe(true);
    expect(usesAvailableChannel(["sms"], EMAIL_ONLY)).toBe(false);
    expect(usesAvailableChannel([], ALL)).toBe(false);
    expect(missingChannels(["email", "sms", "whatsapp"], EMAIL_ONLY)).toEqual(["sms", "whatsapp"]);
  });
  it("says in words why a channel is not offered, and says nothing when one is", () => {
    expect(channelNotSetUpSentence(["sms"], EMAIL_ONLY)).toBe("Text (SMS) is not set up or switched on for this community");
    expect(channelNotSetUpSentence(["sms", "whatsapp"], EMAIL_ONLY)).toBe("Text (SMS) and WhatsApp are not set up or switched on for this community");
    expect(channelNotSetUpSentence(["sms", "email"], EMAIL_ONLY)).toBeNull();
    expect(channelNotSetUpSentence([], ALL)).toBe("it has no channel");
  });
  it("labels channels the way people say them", () => {
    expect(channelLabel("sms")).toBe("Text (SMS)");
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
    expect(channelLabel("carrier-pigeon")).toBe("carrier-pigeon");
    expect(channelsLine(["push", "email", "in_app"])).toBe("Email, Push teaser, In-app archive");
  });
});

describe("the menu on a communication", () => {
  const base = { canWrite: true, kind: "newsletter", channels: ["email", "push"], available: ALL };

  it("offers Copy as new draft and Save as template to someone who writes communications", () => {
    expect(campaignMenu(base).map((i) => i.label)).toEqual(["Copy as new draft", "Save as template"]);
    expect(campaignMenu(base).map((i) => i.key)).toEqual(["copy", "template"]);
  });
  it("offers nothing without the permission that writes a communication", () => {
    expect(campaignMenu({ ...base, canWrite: false })).toEqual([]);
  });
  it("offers nothing on an alert or a survey", () => {
    expect(campaignMenu({ ...base, kind: "alert" })).toEqual([]);
    expect(campaignMenu({ ...base, kind: "survey" })).toEqual([]);
    expect(isCopyableKind("announcement")).toBe(true);
    expect(isCopyableKind("alert")).toBe(false);
  });
  it("offers nothing for a channel the community has not set up", () => {
    expect(campaignMenu({ ...base, channels: ["sms"], available: EMAIL_ONLY })).toEqual([]);
    expect(campaignMenu({ ...base, channels: ["whatsapp"], available: EMAIL_ONLY })).toEqual([]);
    expect(campaignMenu({ ...base, channels: ["sms"], available: ALL }).length).toBe(2);
    expect(campaignMenu({ ...base, channels: ["whatsapp"], available: ALL }).length).toBe(2);
  });
  it("still offers a communication that uses a set-up channel and one that is not", () => {
    expect(campaignMenu({ ...base, channels: ["email", "sms"], available: EMAIL_ONLY }).length).toBe(2);
  });
  it("says what each item does without promising a send", () => {
    for (const i of campaignMenu(base)) expect(i.hint.toLowerCase()).not.toMatch(/\bsend\b(?! )/);
    expect(campaignMenu(base)[0]!.hint).toContain("Nothing is sent");
  });
});

describe("names", () => {
  it("names a copy 'Copy of <name>', or of its subject when it has no name", () => {
    expect(copyName("September news", "News")).toBe("Copy of September news");
    expect(copyName("  September news  ", "News")).toBe("Copy of September news");
    expect(copyName(null, "Picnic on Saturday")).toBe("Copy of Picnic on Saturday");
    expect(copyName("", "  Picnic ")).toBe("Copy of Picnic");
    expect(copyName(null, null)).toBe("Copy of communication");
  });
  it("keeps a copy's name within the 200 characters the database keeps", () => {
    expect(copyName("x".repeat(500), "s")).toHaveLength(200);
  });
  it("copies of copies stack plainly and stay editable text", () => {
    expect(copyName(copyName("Garba", "s"), "s")).toBe("Copy of Copy of Garba");
  });
  it("offers a communication's name, else its subject, as the template name, within 120 characters", () => {
    expect(templateDefaultName("September news", "News")).toBe("September news");
    expect(templateDefaultName(null, "Picnic on Saturday")).toBe("Picnic on Saturday");
    expect(templateDefaultName("  ", "")).toBe("");
    expect(templateDefaultName("y".repeat(300), "s")).toHaveLength(120);
  });
  it("refuses an empty or too long template name in words that finish a sentence", () => {
    expect(templateNameProblem("")).toBe("give the template a name");
    expect(templateNameProblem("   ")).toBe("give the template a name");
    expect(templateNameProblem("x".repeat(121))).toBe("the name is too long (120 characters at most)");
    expect(templateNameProblem("x".repeat(120))).toBeNull();
    expect(templateNameProblem("Autumn news")).toBeNull();
  });
  it("says in plain words what happened, and that nothing was sent", () => {
    expect(copiedMessage("Copy of Garba")).toBe('"Copy of Garba" is ready as a draft. Nothing has been sent.');
    expect(fromTemplateMessage("Autumn")).toContain("Nothing has been sent");
    expect(savedTemplateMessage("Autumn")).toBe('Saved as the template "Autumn". Find it under Start from › A saved template.');
  });
});

describe("what a copy and a template keep", () => {
  it("says a copy keeps the words and the audience and starts with no results, schedule or approvals", () => {
    expect(COPY_NOTE).toContain("audience");
    expect(COPY_NOTE).toContain("no results, no schedule and no approvals");
    expect(COPY_NOTE).toContain("nothing is sent until someone sends it for approval");
  });
  it("finds merge fields in a subject, a message and the translations, once each, in order", () => {
    expect(mergeTokens("News for {{recipient_first_name}}", "Dear {{ recipient_first_name }}, {{center_name}}")).toEqual(["recipient_first_name", "center_name"]);
    expect(mergeTokens(null, undefined, "no fields here")).toEqual([]);
    expect(
      templateTokens({
        title: "Hi {{recipient_first_name}}",
        body_md: "Join {{center_name}}",
        translations: { es: { title: "Hola {{recipient_name}}", body_md: "Unase a {{center_name}}" }, fr: "not an object", de: null },
      }),
    ).toEqual(["recipient_first_name", "center_name", "recipient_name"]);
    expect(templateTokens({ title: "", body_md: "", translations: [] })).toEqual([]);
  });
});

describe("the WhatsApp caveat", () => {
  it("is shown for a template that includes WhatsApp, and for no other", () => {
    expect(templateChannelNote(["whatsapp"])).toBe(WHATSAPP_TEMPLATE_NOTE);
    expect(templateChannelNote(["email", "whatsapp"])).toBe(WHATSAPP_TEMPLATE_NOTE);
    expect(templateChannelNote(["email", "sms"])).toBeNull();
  });
  it("says it is a starting point for the words and not approved by WhatsApp, and never claims approval", () => {
    expect(WHATSAPP_TEMPLATE_NOTE).toContain("only a starting point for the words");
    expect(WHATSAPP_TEMPLATE_NOTE).toContain("not a message template approved by WhatsApp");
    expect(WHATSAPP_TEMPLATE_NOTE).toContain("Settings › WhatsApp");
    expect(WHATSAPP_TEMPLATE_NOTE.replace("not a message template approved by WhatsApp", "")).not.toMatch(/\bapproved\b.*\bby WhatsApp\b/);
  });
});

describe("Start from", () => {
  it("offers Blank, A saved template and A recent communication, in that order", () => {
    expect(startFromOptions({ templates: 0, recent: 0 }).map((o) => o.label)).toEqual(["Blank", "A saved template", "A recent communication"]);
    expect(startFromOptions({ templates: 0, recent: 0 }).map((o) => o.key)).toEqual(["blank", "template", "recent"]);
  });
  it("counts the templates in words and says when there are none", () => {
    expect(startFromOptions({ templates: 0, recent: 3 })[1]!.hint).toBe("None saved yet.");
    expect(startFromOptions({ templates: 1, recent: 3 })[1]!.hint).toBe("1 saved template");
    expect(startFromOptions({ templates: 4, recent: 3 })[1]!.hint).toBe("4 saved templates");
    expect(startFromOptions({ templates: 4, recent: 0 })[2]!.hint).toBe("Nothing sent, scheduled or drafted yet.");
  });
  it("opens the picker on email when the community has it, else on the first channel it has", () => {
    expect(defaultPickerChannel(ALL)).toBe("email");
    expect(defaultPickerChannel(["sms", "push"])).toBe("sms");
    expect(defaultPickerChannel([])).toBe("all");
  });
});

const row = (over: Partial<RecentRow>): RecentRow => ({
  id: "c1",
  name: "September news",
  subject: "News for you",
  channels: ["email", "push"],
  audience: "All members",
  statusLabel: "Sent",
  when: "Sent Sep 21",
  by: "Mona Shah",
  ...over,
});

describe("the recent communications picker", () => {
  const rows = [
    row({ id: "1", name: "Garba text", subject: "Garba tonight", channels: ["sms"], audience: "North zone", by: "Raj Mehta" }),
    row({ id: "2", name: "Lunch reminder", subject: "Lunch at noon", channels: ["whatsapp"], audience: "RSVPs for Diwali" }),
    row({ id: "3", name: "September news", subject: "News for you", channels: ["email", "push"] }),
    row({ id: "4", name: "Picnic", subject: "Picnic on Saturday", channels: ["email"], audience: "North zone", statusLabel: "Draft · not sent for approval" }),
  ];
  it("lists only the chosen channel, newest first as given", () => {
    expect(recentForPicker(rows, { channel: "email", query: "" }).map((r) => r.id)).toEqual(["3", "4"]);
    expect(recentForPicker(rows, { channel: "sms", query: "" }).map((r) => r.id)).toEqual(["1"]);
    expect(recentForPicker(rows, { channel: "whatsapp", query: "" }).map((r) => r.id)).toEqual(["2"]);
    expect(recentForPicker(rows, { channel: "all", query: "" }).map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("searches names, subjects, audiences and who wrote them, every word at once, in any case", () => {
    expect(recentForPicker(rows, { channel: "all", query: "garba" }).map((r) => r.id)).toEqual(["1"]);
    expect(recentForPicker(rows, { channel: "all", query: "news for" }).map((r) => r.id)).toEqual(["3"]);
    expect(recentForPicker(rows, { channel: "all", query: "NORTH zone" }).map((r) => r.id)).toEqual(["1", "4"]);
    expect(recentForPicker(rows, { channel: "all", query: "mehta" }).map((r) => r.id)).toEqual(["1"]);
    expect(recentForPicker(rows, { channel: "all", query: "north picnic" }).map((r) => r.id)).toEqual(["4"]);
    expect(recentForPicker(rows, { channel: "email", query: "garba" })).toEqual([]);
  });
  it("shows the newest few only", () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ id: `r${i}` }));
    expect(recentForPicker(many, { channel: "all", query: "" })).toHaveLength(25);
    expect(recentForPicker(many, { channel: "all", query: "", limit: 5 }).map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });
  it("matches an empty search to everything and a stray space to nothing special", () => {
    expect(matchesQuery(["a"], "")).toBe(true);
    expect(matchesQuery(["a"], "   ")).toBe(true);
    expect(matchesQuery(["Alpha beta", null], "beta alpha")).toBe(true);
    expect(matchesQuery(["Alpha"], "gamma")).toBe(false);
  });
  it("says when a communication went out, goes out, or was last saved", () => {
    const f = (iso: string) => iso.slice(0, 10);
    expect(recentWhen({ status: "sent", sent_at: "2026-09-21T10:00:00Z", scheduled_at: "2026-09-21T10:00:00Z", updated_at: "2026-09-25T10:00:00Z" }, f)).toBe("Sent 2026-09-21");
    expect(recentWhen({ status: "scheduled", sent_at: null, scheduled_at: "2026-10-03T10:00:00Z", updated_at: "2026-09-25T10:00:00Z" }, f)).toBe("Sends 2026-10-03");
    expect(recentWhen({ status: "scheduled", sent_at: null, scheduled_at: null, updated_at: "2026-09-25T10:00:00Z" }, f)).toBe("Scheduled");
    expect(recentWhen({ status: "working_draft", sent_at: null, scheduled_at: null, updated_at: "2026-10-10T10:00:00Z" }, f)).toBe("Saved 2026-10-10");
  });
});

describe("the saved templates picker", () => {
  const t = (over: Partial<TemplateRow>): TemplateRow => ({ id: "t1", name: "Monthly news", subject: "News", channels: ["email"], tokens: [], by: "Mona Shah", when: "Saved Oct 10", ...over });
  const rows = [t({ id: "1" }), t({ id: "2", name: "Lunch", subject: "Lunch at noon", channels: ["whatsapp"] }), t({ id: "3", name: "Garba", channels: ["sms", "email"] })];
  it("filters by channel and by search", () => {
    expect(templatesForPicker(rows, { channel: "email", query: "" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(templatesForPicker(rows, { channel: "whatsapp", query: "" }).map((r) => r.id)).toEqual(["2"]);
    expect(templatesForPicker(rows, { channel: "all", query: "noon" }).map((r) => r.id)).toEqual(["2"]);
    expect(templatesForPicker(rows, { channel: "all", query: "mona" })).toHaveLength(3);
    expect(templatesForPicker(rows, { channel: "sms", query: "monthly" })).toEqual([]);
  });
});

describe("the database function that copies (migration 0800), read from here", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0800_comms_copy_and_templates.sql"), "utf8");
  const fn = (name: string): string => {
    const start = sql.indexOf(`create or replace function app.${name}(`);
    expect(start, `${name} is defined`).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("end $$;", start));
  };
  const insertColumns = (body: string, table: string): string[] => {
    const m = new RegExp(`insert into app\\.${table}\\s*\\(([^)]*)\\)`).exec(body);
    expect(m, `the insert into ${table}`).not.toBeNull();
    return m![1]!.split(",").map((c) => c.trim());
  };

  it("writes the words, channels and audience of the original, and the new draft's own status and author", () => {
    const cols = insertColumns(fn("copy_campaign_as_draft"), "comms_campaigns");
    for (const c of ["center_id", "kind", "name", "title", "body_md", "translations", "channels", "audience", "saved_segment_id", "status", "requires_second_approver", "created_by"]) {
      expect(cols, c).toContain(c);
    }
  });
  it("writes none of the schedule, the sent time, the counts or the approvals", () => {
    const cols = insertColumns(fn("copy_campaign_as_draft"), "comms_campaigns");
    for (const c of ["scheduled_at", "sent_at", "recipients_count", "opened_count", "approved_by", "second_approver", "id", "created_at"]) {
      expect(cols, c).not.toContain(c);
    }
  });
  it("makes a working draft and names it 'Copy of <name>'", () => {
    const body = fn("copy_campaign_as_draft");
    expect(body).toContain("'working_draft'");
    expect(body).toContain("'Copy of '");
    expect(body).not.toMatch(/insert into app\.messages/);
  });
  it("starts a draft from a template with no audience, and as a working draft", () => {
    const body = fn("create_campaign_from_template");
    expect(insertColumns(body, "comms_campaigns")).not.toContain("approved_by");
    expect(body).toContain("'{}'::jsonb");
    expect(body).toContain("'working_draft'");
  });
  it("keeps a template to the words: no audience, schedule, state or statistic column", () => {
    const start = sql.indexOf("create table if not exists app.comms_templates");
    const table = sql.slice(start, sql.indexOf(");", start));
    const cols = table
      .split("\n")
      .map((l) => /^\s{2}([a-z_]+)\s/.exec(l)?.[1])
      .filter((c): c is string => Boolean(c));
    expect(cols).toEqual(["id", "center_id", "name", "channels", "title", "body_md", "translations", "created_by", "created_at", "updated_by", "updated_at"]);
    for (const c of ["audience", "saved_segment_id", "status", "scheduled_at", "sent_at", "recipients_count", "opened_count", "approved_by"]) expect(cols).not.toContain(c);
  });
  it("checks the permission that writes a communication first, in every function", () => {
    for (const name of ["copy_campaign_as_draft", "save_campaign_as_template", "create_campaign_from_template", "rename_comms_template", "delete_comms_template"]) {
      const body = fn(name);
      const run = body.slice(body.indexOf("begin"));
      expect(run, name).toContain("perform app._comms_require_writer(p_center");
      expect(run.indexOf("perform app._comms_require_writer"), `${name} checks the permission before it reads or writes anything`).toBeLessThan(run.search(/(select|delete|update|insert) /));
    }
    expect(sql).toContain("app.has_permission(p_center, 'comms.send')");
    expect(sql).toContain("app.assert_module_enabled(p_center, 'comms')");
  });
});
