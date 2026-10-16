// Whether a person keeps the left section panel open or collapsed (docs/CRM_NAV_REDESIGN_PLAN.md section 2). A choice made on the
// panel's button is remembered in this cookie; "auto" (no choice yet) opens it from 1280px wide and collapses it below.
export const PANEL_COOKIE = "weaver_panel";
export type PanelPref = "open" | "closed" | "auto";
export function parsePanelPref(value: string | undefined | null): PanelPref {
  return value === "open" || value === "closed" ? value : "auto";
}
