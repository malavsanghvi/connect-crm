import { describe, expect, it } from "vitest";

import { backlogItems, BACKLOG_SORTS, nextDirection, parseBacklogSort, sortBacklog, type BacklogRow } from "@/lib/activity/backlog";

const r = (over: Partial<BacklogRow>): BacklogRow => ({
  item_key: "giving.record_payment",
  label: "Record a payment",
  surface: "portal",
  communities: 2,
  ideas: 3,
  times: 100,
  minutes_per_month: 60,
  last_seen: "2026-10-09T10:00:00Z",
  ...over,
});

const rows: BacklogRow[] = [
  r({}),
  r({ item_key: "comms.send", label: "Send a newsletter or message", communities: 4, ideas: 2, times: 50, minutes_per_month: 120, last_seen: "2026-10-01T10:00:00Z" }),
  r({ item_key: "people.add_person", label: "Add a person", communities: 1, ideas: 9, times: 400, minutes_per_month: 30, last_seen: "2026-10-10T10:00:00Z" }),
  r({ item_key: "rsvp_completed", label: "RSVP completed", surface: "member", communities: 3, ideas: 1, times: 70, minutes_per_month: 60, last_seen: null }),
];
const items = backlogItems(rows);
const keys = (sorted: ReturnType<typeof sortBacklog>) => sorted.map((i) => i.key);

describe("the rows of the automation backlog", () => {
  it("keeps keys and counts only", () => {
    expect(Object.keys(items[0]).sort()).toEqual(["communities", "ideas", "key", "label", "lastSeen", "minutesPerMonth", "surface", "times"]);
  });
  it("drops a row without a key, says a key with no label in words, and reads missing counts as 0", () => {
    const got = backlogItems([r({ item_key: null }), r({ item_key: "giving.write_off_pledge", label: null, communities: null, ideas: null, times: null, minutes_per_month: null })]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ key: "giving.write_off_pledge", label: "Write off pledge", communities: 0, ideas: 0, times: 0, minutesPerMonth: 0 });
    expect(backlogItems(null)).toEqual([]);
  });
});

describe("sorting the backlog", () => {
  it("starts with the most minutes a month", () => {
    const { sort, dir } = parseBacklogSort(undefined, undefined);
    expect(keys(sortBacklog(items, sort, dir))).toEqual(["comms.send", "giving.record_payment", "rsvp_completed", "people.add_person"]);
  });
  it("sorts every column both ways", () => {
    expect(keys(sortBacklog(items, "communities", "desc"))).toEqual(["comms.send", "rsvp_completed", "giving.record_payment", "people.add_person"]);
    expect(keys(sortBacklog(items, "communities", "asc"))).toEqual(["people.add_person", "giving.record_payment", "rsvp_completed", "comms.send"]);
    expect(keys(sortBacklog(items, "ideas", "desc"))[0]).toBe("people.add_person");
    expect(keys(sortBacklog(items, "times", "desc"))[0]).toBe("people.add_person");
    expect(keys(sortBacklog(items, "name", "asc"))).toEqual(["people.add_person", "giving.record_payment", "rsvp_completed", "comms.send"]);
    expect(keys(sortBacklog(items, "name", "desc"))[0]).toBe("comms.send");
  });
  it("sorts by the date last seen, with 'never' last when newest first", () => {
    expect(keys(sortBacklog(items, "seen", "desc"))).toEqual(["people.add_person", "giving.record_payment", "comms.send", "rsvp_completed"]);
  });
  it("breaks a tie by minutes, then by name, so the order never jumps about", () => {
    const tie = backlogItems([r({ item_key: "b.second", label: "Second", times: 5, minutes_per_month: 10 }), r({ item_key: "a.first", label: "First", times: 5, minutes_per_month: 10 }), r({ item_key: "c.big", label: "Big", times: 5, minutes_per_month: 99 })]);
    expect(keys(sortBacklog(tie, "times", "desc"))).toEqual(["c.big", "a.first", "b.second"]);
    expect(keys(sortBacklog(tie, "times", "asc"))).toEqual(["c.big", "a.first", "b.second"]);
  });
  it("does not change the list it was given", () => {
    const before = keys(items);
    sortBacklog(items, "name", "asc");
    expect(keys(items)).toEqual(before);
  });
});

describe("the sort in the address", () => {
  it("accepts the known columns and directions", () => {
    for (const s of BACKLOG_SORTS) expect(parseBacklogSort(s, "asc")).toEqual({ sort: s, dir: "asc" });
  });
  it("falls back to the default for anything else", () => {
    expect(parseBacklogSort("secrets", "sideways")).toEqual({ sort: "minutes", dir: "desc" });
    expect(parseBacklogSort("name", undefined)).toEqual({ sort: "name", dir: "asc" });
    expect(parseBacklogSort("times", undefined)).toEqual({ sort: "times", dir: "desc" });
  });
  it("flips the direction on the column already sorted, and starts a new column in its natural direction", () => {
    expect(nextDirection({ sort: "minutes", dir: "desc" }, "minutes")).toBe("asc");
    expect(nextDirection({ sort: "minutes", dir: "asc" }, "minutes")).toBe("desc");
    expect(nextDirection({ sort: "minutes", dir: "desc" }, "name")).toBe("asc");
    expect(nextDirection({ sort: "name", dir: "asc" }, "times")).toBe("desc");
  });
});
