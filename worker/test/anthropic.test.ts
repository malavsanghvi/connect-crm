import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { apiErrorMessage, CLAUDE_MODEL, classifyAnthropicError, claudeModel, errorLabel, regainAccessAt, staffJobFailure } from "../src/anthropic";

/** The error the SDK throws for a response with this status and API error body. */
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message }, request_id: "req_test" }, undefined, new Headers());

describe("claudeModel", () => {
  it("is the current Opus unless CLAUDE_MODEL says otherwise", () => {
    expect(CLAUDE_MODEL).toBe("claude-opus-5-5");
    expect(claudeModel({})).toBe("claude-opus-5-5");
    expect(claudeModel({ CLAUDE_MODEL: "  " })).toBe("claude-opus-5-5");
    expect(claudeModel({ CLAUDE_MODEL: "claude-opus-5" })).toBe("claude-opus-5");
  });
});

describe("classifyAnthropicError", () => {
  const table: [string, unknown, string][] = [
    ["401 key refused", apiError(401, "authentication_error", "invalid x-api-key"), "auth"],
    ["403 not allowed", apiError(403, "permission_error", "Your API key does not have permission to use the specified resource."), "auth"],
    ["402 billing", apiError(402, "billing_error", "Your account has an outstanding balance."), "quota"],
    ["400 usage limit", apiError(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."), "quota"],
    ["400 workspace usage limit", apiError(400, "invalid_request_error", "You have reached your specified workspace API usage limits."), "quota"],
    ["400 spend limit", apiError(400, "invalid_request_error", "This request would exceed your organization's monthly spend limit."), "quota"],
    ["400 credit balance", apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."), "quota"],
    ["400 beta not enabled", apiError(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header. Please consult our documentation at docs.claude.com or try again without the header."), "config"],
    ["404 model", apiError(404, "not_found_error", "model: claude-opus-5-5"), "config"],
    ["429 rate limit", apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), "transient"],
    ["500 api error", apiError(500, "api_error", "Internal server error"), "transient"],
    ["529 overloaded", apiError(529, "overloaded_error", "Overloaded"), "transient"],
    ["504 timeout", apiError(504, "timeout_error", "Request timed out"), "transient"],
    ["no connection", new Anthropic.APIConnectionError({ message: "Connection error." }), "transient"],
    ["client timeout", new Anthropic.APIConnectionTimeoutError(), "transient"],
    ["400 other", apiError(400, "invalid_request_error", "messages: roles must alternate between \"user\" and \"assistant\""), "bad_request"],
    ["413 too large", apiError(413, "request_too_large", "Request exceeds the maximum allowed number of bytes."), "bad_request"],
    ["not an API error", new TypeError("x is undefined"), "bad_request"],
  ];
  it.each(table)("%s", (_label, err, kind) => {
    expect(classifyAnthropicError(err).kind).toBe(kind);
  });

  it("reads the API's own message and type, not the SDK's '400 {json}' rendering", () => {
    const err = apiError(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.");
    expect((err as Error).message.startsWith("400 {")).toBe(true);
    const c = classifyAnthropicError(err);
    expect(c).toMatchObject({ kind: "quota", status: 400, type: "invalid_request_error" });
    expect(c.message).toBe("You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.");
    expect(c.regainAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(errorLabel(c)).toBe("400 invalid_request_error");
    expect(apiErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("a connection failure has no status, and a timeout says so rather than 'no connection'", () => {
    const c = classifyAnthropicError(new Anthropic.APIConnectionError({ message: "Connection error." }));
    expect(c.status).toBeNull();
    expect(c.timedOut).toBe(false);
    expect(errorLabel(c)).toBe("no connection");

    const t = classifyAnthropicError(new Anthropic.APIConnectionTimeoutError());
    expect(t).toMatchObject({ kind: "transient", status: null, timedOut: true });
    expect(errorLabel(t)).toBe("timed out");
  });
});

describe("regainAccessAt", () => {
  it("reads the date (and time) the API says access returns", () => {
    expect(regainAccessAt("You will regain access on 2026-11-01 at 00:00 UTC.")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(regainAccessAt("You will regain access on 2026-10-05 at 14:30 UTC.")?.toISOString()).toBe("2026-10-05T14:30:00.000Z");
    expect(regainAccessAt("You will regain access on 2026-10-05.")?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
  it("is null when there is no such date, or it is not a real one", () => {
    expect(regainAccessAt("Your credit balance is too low.")).toBeNull();
    expect(regainAccessAt("You will regain access on 2026-13-40 at 00:00 UTC.")).toBeNull();
  });
});

describe("staffJobFailure", () => {
  const model = "claude-opus-5-5";
  it("fails a refused key at once as not configured", () => {
    expect(staffJobFailure(classifyAnthropicError(apiError(401, "authentication_error", "invalid x-api-key")), model, "the mapping suggestions")).toEqual({
      message: "The Anthropic key on the background service was refused (ANTHROPIC_API_KEY; 401 authentication_error).",
      retry: false,
      notConfigured: true,
    });
  });
  it("does not retry a spending limit, a missing model or beta, or a rejected request", () => {
    const quota = staffJobFailure(classifyAnthropicError(apiError(402, "billing_error", "Your credit balance is too low.")), model, "the matching suggestions");
    expect(quota).toMatchObject({ retry: false, notConfigured: false });
    expect(quota.message).toBe(
      "The AI service's spending limit was reached, so the matching suggestions could not be made (402 billing_error: Your credit balance is too low.). Try again once the limit resets or is raised.",
    );
    expect(staffJobFailure(classifyAnthropicError(apiError(404, "not_found_error", "model: claude-opus-5-5")), model, "x").message).toBe(
      "The AI model (claude-opus-5-5) is not available to this Anthropic account (404 not_found_error: model: claude-opus-5-5).",
    );
    expect(staffJobFailure(classifyAnthropicError(apiError(400, "invalid_request_error", "Unexpected value(s) `x` for the `anthropic-beta` header.")), model, "x").message).toMatch(
      /not set up for a feature the request for x uses \(the server-side fallback/,
    );
    expect(staffJobFailure(classifyAnthropicError(apiError(400, "invalid_request_error", "messages: too long")), model, "x")).toMatchObject({ retry: false, notConfigured: false });
  });
  it("retries busy, rate limited, timed out and unreachable", () => {
    expect(staffJobFailure(classifyAnthropicError(apiError(429, "rate_limit_error", "slow down")), model, "x")).toEqual({
      message: "The AI service was busy or could not be reached (429 rate_limit_error: slow down).",
      retry: true,
      notConfigured: false,
    });
    expect(staffJobFailure(classifyAnthropicError(new Anthropic.APIConnectionTimeoutError()), model, "x").message).toMatch(/^The AI service did not answer in time \(timed out/);
  });
});
