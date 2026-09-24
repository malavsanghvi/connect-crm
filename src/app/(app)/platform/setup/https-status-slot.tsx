// INTEGRATION SLOT (o-https): the orchestrator replaces this with o-https's
// HttpsStatusPanel (src/components/https/https-status-panel.tsx), which shows the
// DNS and certificate status the deploy writes to /srv/connect/https-status.json.
// The setup wizard deliberately does not check DNS or certificates itself.
export function HttpsStatusSlot({ step }: { step: "portal" | "wildcard" }) {
  void step;
  return null;
}
