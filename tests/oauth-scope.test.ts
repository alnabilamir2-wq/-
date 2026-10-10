import { describe, expect, it } from "vitest";
import { assertOAuthProjectScope } from "../server/_core/oauth-scope";

describe("OAuth project scope", () => {
  it("accepts identity data returned for the current project", () => {
    expect(() => assertOAuthProjectScope("wasel-project", "wasel-project")).not.toThrow();
  });

  it("rejects identity data returned for a different project", () => {
    expect(() => assertOAuthProjectScope("another-project", "wasel-project")).toThrow(
      "OAuth identity belongs to a different project",
    );
  });

  it("allows omission when the OAuth identity response does not include projectId", () => {
    expect(() => assertOAuthProjectScope(undefined, "wasel-project")).not.toThrow();
  });
});
