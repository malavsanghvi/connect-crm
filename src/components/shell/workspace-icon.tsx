/** A workspace's outline icon, drawn in the current text colour. `path` is the SVG path data from src/lib/workspaces.ts. */
export function WorkspaceIcon({ path, className = "h-6 w-6" }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
