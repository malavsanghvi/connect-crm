// Dev-only preview pages (src/app/dev/*): a screen drawn with invented sample data and no database, so its look can be
// checked and screenshotted without signing in. They exist only outside production: each page returns notFound() there,
// and the proxy lets them through without a session only outside production.

export function devPreviewAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export function isDevPreviewPath(pathname: string): boolean {
  return pathname === "/dev" || pathname.startsWith("/dev/");
}
