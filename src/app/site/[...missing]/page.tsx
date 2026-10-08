import { notFound } from "next/navigation";

// Any address under /site that is not a page of the website: the website's own 404 (site/not-found.tsx).
export default function MissingPage() {
  notFound();
}
