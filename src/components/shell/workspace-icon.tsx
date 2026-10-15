import { Icon, type IconName } from "@/components/brand/icons";

/** A workspace's icon (one of the kit's icons), drawn in the current text colour. */
export function WorkspaceIcon({ name, className = "h-6 w-6" }: { name: IconName; className?: string }) {
  return <Icon name={name} className={className} />;
}
