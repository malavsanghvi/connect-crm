import { describe, expect, it } from "vitest";

import { pushRouting } from "../src/messaging";

describe("pushRouting", () => {
  it("forwards the template as type and only the routing ids of the payload", () => {
    expect(
      pushRouting({ template_key: "event_survey", payload: { survey_id: "s-1", event_id: "e-1", deep_link: "survey/s-1", reward_points: 25, secret: "x", vars: { a: 1 } } }),
    ).toEqual({ type: "event_survey", survey_id: "s-1", event_id: "e-1", deep_link: "survey/s-1", reward_points: 25 });
  });
  it("ignores wrong types and oversized values, and works without a template", () => {
    expect(pushRouting({ template_key: null, payload: { survey_id: { x: 1 }, deep_link: "x".repeat(300), reward_points: "25" } })).toEqual({});
  });
});
