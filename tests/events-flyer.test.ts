import { describe, expect, it } from "vitest";

import { buildFlyerPrompt, readFlyerState } from "@/lib/events/flyer";

describe("buildFlyerPrompt", () => {
  it("builds a prompt from the event's own public fields", () => {
    const prompt = buildFlyerPrompt({
      name: "Diwali Mela",
      description: "An evening of lights, food and community.",
      venue: "Main hall",
      startsAtText: "Sat, Nov 8, 2026, 6:00 PM",
      audienceText: "Members and guests",
      centerName: "Jain Society of Houston",
    });
    expect(prompt).toContain('"Diwali Mela"');
    expect(prompt).toContain("Jain Society of Houston");
    expect(prompt).toContain("Sat, Nov 8, 2026, 6:00 PM");
    expect(prompt).toContain("Main hall");
    expect(prompt).toContain("Members and guests");
    expect(prompt).toContain("An evening of lights, food and community.");
  });

  it("leaves out fields the event does not have, and still reads sensibly", () => {
    const prompt = buildFlyerPrompt({ name: "", description: "", venue: "", startsAtText: null, audienceText: "", centerName: "" });
    expect(prompt).toContain("an upcoming event");
    expect(prompt).not.toContain("Date and time:");
    expect(prompt).not.toContain("Venue:");
    expect(prompt).not.toContain("Audience:");
  });

  it("never runs away in length", () => {
    const prompt = buildFlyerPrompt({
      name: "x".repeat(500),
      description: "y".repeat(5000),
      venue: "z".repeat(500),
      startsAtText: "now",
      audienceText: "everyone",
      centerName: "c",
    });
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });
});

describe("readFlyerState", () => {
  it("reads queued and running, carrying the job id", () => {
    expect(readFlyerState({ status: "queued", job_id: "42" })).toEqual({ status: "queued", jobId: "42" });
    expect(readFlyerState({ status: "running" })).toEqual({ status: "running", jobId: undefined });
  });

  it("reads a finished job's image", () => {
    expect(readFlyerState({ status: "done", result: { image_b64: "abc", content_type: "image/jpeg", model: "pollinations-flux", prompt: "a flyer" } })).toEqual({
      status: "done",
      imageB64: "abc",
      contentType: "image/jpeg",
      model: "pollinations-flux",
      prompt: "a flyer",
    });
  });

  it("defaults a finished job's content type to image/png when the result omits it", () => {
    expect(readFlyerState({ status: "done", result: { image_b64: "abc", model: "pollinations-flux", prompt: "a flyer" } })).toEqual({
      status: "done",
      imageB64: "abc",
      contentType: "image/png",
      model: "pollinations-flux",
      prompt: "a flyer",
    });
  });

  it("treats a 'done' job with no image as a failure, never a silent success", () => {
    expect(readFlyerState({ status: "done", result: {} })).toEqual({
      status: "failed",
      reason: "The background service finished but did not return an image.",
    });
  });

  it("reads failed/cancelled with the job's own error, or a plain fallback", () => {
    expect(readFlyerState({ status: "failed", error: "OpenAI refused the prompt." })).toEqual({ status: "failed", reason: "OpenAI refused the prompt." });
    expect(readFlyerState({ status: "cancelled" })).toEqual({ status: "failed", reason: "The flyer generation job failed." });
  });

  it("reads unavailable with its reason, and unknown input as none", () => {
    expect(readFlyerState({ status: "unavailable", reason: "not configured" })).toEqual({ status: "unavailable", reason: "not configured" });
    expect(readFlyerState(null)).toEqual({ status: "none" });
    expect(readFlyerState({})).toEqual({ status: "none" });
  });
});
