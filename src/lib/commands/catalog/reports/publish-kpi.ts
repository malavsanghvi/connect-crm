import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";

const none = object({});

/**
 * Publishing a figure on the public community dashboard (no sign-in) is a public statement, so it is the person's own act:
 * Niva points to the screen. Exports of report tables stay screen actions too.
 */
export const publishKpi = defineCommand<Infer<typeof none>, never>({
  key: "reports.publish_kpi",
  title: "Publish or unpublish a figure on the public dashboard",
  description:
    "Show or hide a community figure on the public community dashboard, which anyone can open without signing in. Publishing is a public statement, so the person does it themselves: " +
    "Niva cannot do this and never asks for it in the chat; it points the person to the place and waits.",
  level: "only_you",
  permission: "publicKpisManage",
  module: "reports",
  input: none,
  pointTo: { label: "Open Reports › Community dashboard and press Publish or Unpublish beside the figure", href: "/reports/community" },
  covers: ["src/app/(app)/reports/community/actions.ts#setKpiVisibilityAction"],
});
