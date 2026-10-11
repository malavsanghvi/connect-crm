import { loadHomeTasks } from "@/lib/data/home-tasks";

import { defineCommand } from "../define";
import { object, type Infer } from "../schema";

export type TaskView = { id: string; area: string; title: string; detail: string; open: { label: string; href: string }[] };
export type TasksMineData = { count: number; tasks: TaskView[]; could_not_load: { area: string; reason: string }[] };

/** The work waiting for the signed-in person, as Home "My tasks" shows it (their role decides which sources they see). */
const input = object({});

export const tasksMine = defineCommand<Infer<typeof input>, TasksMineData>({
  key: "tasks.mine",
  title: "Show my tasks",
  description:
    "List what is waiting for the person you are helping: refunds and payee changes to approve, deposits to match, applications to decide, messages to review, and so on. " +
    "It shows only the work their own role can act on. Each task has a short title, a detail line and where to open it. " +
    "If a part could not be read, it is listed under could_not_load: say so, do not pretend that area is empty.",
  level: "read",
  // Home is open to everyone signed in; each task source applies its own permission.
  permission: "dashboard",
  input,
  async execute(ctx) {
    const { tasks, failures } = await loadHomeTasks(ctx.session);
    return {
      ok: true,
      data: {
        count: tasks.length,
        tasks: tasks.map((t) => ({ id: t.id, area: t.tag, title: t.title, detail: t.meta, open: t.links.map((l) => ({ label: l.label, href: l.href })) })),
        could_not_load: failures.map((x) => ({ area: x.tag, reason: x.message })),
      },
      message: tasks.length === 0 && failures.length === 0 ? "Nothing is waiting." : undefined,
    };
  },
});
