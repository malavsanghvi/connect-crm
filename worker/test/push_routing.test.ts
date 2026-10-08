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
  it("lets the payload's own type pick the route (homework, 0587) and forwards its ids and deep link", () => {
    const payload = {
      type: "homework_parent",
      deep_link: "/gyan/homework/8e6b1b3e-5b2a-4c1d-9f0e-2a3b4c5d6e7f?person=3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f",
      assignment_id: "8e6b1b3e-5b2a-4c1d-9f0e-2a3b4c5d6e7f",
      submission_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      learner_id: "3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f",
      person_id: "the recipient, never forwarded",
      note: "nor the note",
    };
    expect(pushRouting({ template_key: "homework.parent_check", payload })).toEqual({
      type: "homework_parent",
      deep_link: payload.deep_link,
      assignment_id: payload.assignment_id,
      submission_id: payload.submission_id,
      learner_id: payload.learner_id,
    });
  });
  it("forwards a boli notice's type, deep link, boli and event (0596), never who it is for", () => {
    expect(
      pushRouting({
        template_key: "boli_outbid",
        payload: { type: "boli_outbid", deep_link: "/boli/b-1", boli_id: "b-1", event_id: "e-1", vars: { boli: "Aarti" }, person_id: "the recipient" },
      }),
    ).toEqual({ type: "boli_outbid", deep_link: "/boli/b-1", boli_id: "b-1", event_id: "e-1" });
  });
  it("falls back to the template key when the payload's type is not a usable string", () => {
    expect(pushRouting({ template_key: "homework.accepted", payload: { type: 7, deep_link: "/gyan/homework/x" } })).toEqual({ type: "homework.accepted", deep_link: "/gyan/homework/x" });
    expect(pushRouting({ template_key: "homework.accepted", payload: { type: "   " } })).toEqual({ type: "homework.accepted" });
    expect(pushRouting({ template_key: "homework.accepted", payload: { type: "t".repeat(81) } })).toEqual({ type: "homework.accepted" });
  });
});
