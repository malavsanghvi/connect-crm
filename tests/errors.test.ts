import { describe, expect, it } from "vitest";

import { explainError, failure } from "@/lib/errors";

describe("explainError keeps the database's own sentence where it wrote one", () => {
  it("unique violations: Postgres' generic message is translated, a function's plain sentence is shown as it is", () => {
    expect(explainError({ code: "23505", message: 'duplicate key value violates unique constraint "gyan_assignments_center_id_level_id_title_key"' })).toBe(
      "a record with the same key already exists",
    );
    expect(explainError({ code: "23505", message: "duplicate key" })).toBe("a record with the same key already exists");
    expect(explainError({ code: "23505", message: "" })).toBe("a record with the same key already exists");
    expect(explainError({ code: "23505" })).toBe("a record with the same key already exists");
    // 0587's app.save_gyan_assignment re-raises unique_violation with the title in it.
    expect(explainError({ code: "23505", message: 'There is already homework called "Navkar recording" on this lesson level.' })).toBe(
      'There is already homework called "Navkar recording" on this lesson level.',
    );
  });

  it("check violations behave the same way (the branch this mirrors)", () => {
    expect(explainError({ code: "23514", message: 'new row for relation "x" violates check constraint "y"' })).toBe("one of the values is not allowed");
    expect(explainError({ code: "23514", message: "a pledge write-off needs two different approvers" })).toBe("a pledge write-off needs two different approvers");
  });

  it("failure() puts the sentence after what failed, without doubling the full stop", () => {
    const r = failure("Could not add the homework", { code: "23505", message: 'There is already homework called "X" on this lesson level.' });
    expect(r).toEqual({ ok: false, error: 'Could not add the homework — There is already homework called "X" on this lesson level.' });
    expect(failure("Could not add the homework", { code: "23505", message: "duplicate key value violates unique constraint \"k\"" }).error).toBe(
      "Could not add the homework — a record with the same key already exists.",
    );
  });
});
