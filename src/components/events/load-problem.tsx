import { Alert, buttonClass } from "@/components/ui";

/** A page's data could not be read: say what and why, and offer a retry. Never an empty table. */
export function LoadProblem({ message, retryHref }: { message: string; retryHref?: string }) {
  return (
    <Alert
      tone="danger"
      title="This page could not load everything it needs"
      action={
        retryHref ? (
          <a href={retryHref} className={buttonClass("bad", "xs")}>
            Try again
          </a>
        ) : null
      }
    >
      {message.endsWith(".") ? message : `${message}.`}
    </Alert>
  );
}
