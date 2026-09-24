import { redirect } from "next/navigation";

/** Settings › Center moved to Settings › Rules (the old URL keeps working). */
export default function CenterSettingsRedirect() {
  redirect("/settings/rules");
}
