import type { IconName } from "@/components/site/icons";

/**
 * The three Weavers (owner decision 2026-10-08): one platform, named for who it serves. They share the same free plan and
 * the same features; each page of the website names the one that fits. The id is the anchor on the home page.
 */
export type Weaver = {
  id: "faith-weaver" | "community-weaver" | "org-weaver";
  name: string;
  icon: IconName;
  tone: "saffron" | "navy" | "success";
  /** Who it is for, short (menus). */
  menu: string;
  /** Who it is for, one sentence (cards). */
  body: string;
  points: string[];
};

export const WEAVERS: readonly Weaver[] = [
  {
    id: "faith-weaver",
    name: "Faith Weaver",
    icon: "home",
    tone: "saffron",
    menu: "Churches, gurdwaras, mosques, synagogues and temples",
    body: "For congregations and temples: families, pledges, festivals and volunteers in one calm place.",
    points: ["Pledge drives and recurring gifts", "Festivals with lunch slots and check-in", "Volunteer and service sign-ups", "Religious school and learning paths"],
  },
  {
    id: "community-weaver",
    name: "Community Weaver",
    icon: "users",
    tone: "navy",
    menu: "Cultural associations, community centers and heritage schools",
    body: "For cultural associations, community centers and heritage schools: memberships, programs and the big annual event.",
    points: ["Memberships with renewals", "Ticketed programs and galas", "Classes, attendance and homework", "Three languages in the member app"],
  },
  {
    id: "org-weaver",
    name: "Org Weaver",
    icon: "chart",
    tone: "success",
    menu: "Nonprofits, professional societies and alumni groups",
    body: "For nonprofits, professional societies, alumni networks and clubs: dues, meetings and the volunteers who keep it running.",
    points: ["Dues and renewals", "Meetings and RSVPs", "Volunteer opportunities", "Reports and QuickBooks accounting"],
  },
];

/** "Faith Weaver, Community Weaver and Org Weaver". */
export const WEAVER_NAMES = "Faith Weaver, Community Weaver and Org Weaver";
