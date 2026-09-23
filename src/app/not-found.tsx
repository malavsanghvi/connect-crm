import Link from "next/link";

import { CenteredPanel } from "@/components/setup-screen";

export default function NotFound() {
  return (
    <CenteredPanel title="Not found">
      <p>
        That record or page does not exist, or your roles do not let you see it (the database only returns what you are
        allowed to read).
      </p>
      <p className="mt-4">
        <Link href="/" className="crm-link font-semibold">
          Back to the dashboard
        </Link>
      </p>
    </CenteredPanel>
  );
}
