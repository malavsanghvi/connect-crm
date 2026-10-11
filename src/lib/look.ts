export const LOOK_COOKIE = "weaver_look";

export type Look = "classic" | "v2";

export function parseLook(value: string | undefined | null): Look {
  return value === "v2" ? "v2" : "classic";
}
