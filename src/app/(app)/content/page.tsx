import { redirect } from "next/navigation";

/** Content opens on its first tab, the approval queue. */
export default function ContentIndex() {
  redirect("/content/queue");
}
