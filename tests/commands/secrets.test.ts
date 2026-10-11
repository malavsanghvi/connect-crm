import { describe, expect, it } from "vitest";

import { HIDDEN_LINK, HIDDEN_VALUE, isSecretKey, scrubSecretText, stripSecrets } from "@/lib/commands/secrets";

describe("one-time secrets never reach a model", () => {
  it("removes values by the name of the key", () => {
    const { value, removed } = stripSecrets({
      sandbox_code: "ABCD-1234",
      sandboxCode: "x",
      invitation_link: "https://app.example.org/accept/abcdefghijklmnop",
      inviteUrl: "https://app.example.org/i/1",
      api_key: "k",
      token: "t",
      access_token: "t",
      secret: "s",
      client_secret: "s",
      password: "p",
      webhook_secret: "w",
      authorization: "Bearer abc",
      sign_in_code: "123456",
      otp: "1",
      ok: "kept",
    });
    expect(value).toEqual({ ok: "kept" });
    expect(removed).toBe(14);
  });

  it("keeps ordinary keys that only contain the word code or key", () => {
    const keep = { postal_code: "60540", country_code: "US", currency_code: "USD", language_code: "gu", color_code: "red", key_date: "2026-10-10", code_of_conduct: "yes", keyboard: "us" };
    const { value } = stripSecrets(keep);
    expect(Object.keys(value).sort()).toEqual(["code_of_conduct", "color_code", "country_code", "currency_code", "key_date", "keyboard", "language_code", "postal_code"].sort());
    expect(isSecretKey("postal_code")).toBe(false);
    expect(isSecretKey("sandbox_code")).toBe(true);
  });

  it("hides secret-looking parts inside any text, and leaves the rest of the sentence", () => {
    expect(scrubSecretText("Start here: https://app.example.org/start?code=ABC123&x=1 today")).toBe(`Start here: ${HIDDEN_LINK} today`);
    expect(scrubSecretText("Open https://app.example.org/invite/AbCdEfGhIjKlMnOp")).toBe(`Open ${HIDDEN_LINK}`);
    expect(scrubSecretText("Link %PORTAL_URL%/accept/abc")).toBe(`Link ${HIDDEN_LINK}`);
    expect(scrubSecretText("key sk_live_abcdefghijkl1234 here")).toBe(`key ${HIDDEN_VALUE} here`);
    expect(scrubSecretText("whsec_abcdefgh1234")).toBe(HIDDEN_VALUE);
    expect(scrubSecretText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk end")).toBe(`jwt ${HIDDEN_VALUE} end`);
    expect(scrubSecretText("Authorization: Bearer abcdefghijklmnop")).toBe(`Authorization: ${HIDDEN_VALUE}`);
    expect(scrubSecretText("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")).toBe(HIDDEN_VALUE);
  });

  it("leaves ordinary links and text alone", () => {
    const text = "See https://weaver.example.org/events/123 for the Diwali dinner. Receipt R-1004.";
    expect(scrubSecretText(text)).toBe(text);
  });

  it("works through lists and nested records, and does not change its input", () => {
    const input = { rows: [{ title: "x", token: "t", note: "go to https://a.example.org/?token=abcdef" }], date: new Date("2026-01-01T00:00:00Z") };
    const { value } = stripSecrets(input);
    expect(value.rows[0]).toEqual({ title: "x", note: `go to ${HIDDEN_LINK}` });
    expect(value.date).toBeInstanceOf(Date);
    expect(input.rows[0].token).toBe("t");
  });
});
