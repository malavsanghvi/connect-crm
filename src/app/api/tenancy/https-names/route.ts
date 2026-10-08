import { NextResponse } from "next/server";

import { platformPublicAddresses } from "@/lib/https-server";
import { normalizeBaseDomain } from "@/lib/tenancy";

// The names the droplet's HTTPS check (deploy/https-confirm.mjs, every minute)
// should look at besides the ones Caddy already has certificates for: the portal
// domain saved in Platform setup and the organizations' base domain, with www in
// front of the base (the public website, src/lib/site.ts). Checking them
// is what makes Caddy fetch their certificate as soon as DNS points here, with no
// redeploy. These are the platform's public addresses, so the list is public.
export const dynamic = "force-dynamic";

export async function GET() {
  const names = new Set<string>();
  const addBase = (base: string) => {
    names.add(base);
    names.add(`www.${base}`);
  };
  const env = normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN);
  if (env) addBase(env);
  const addr = await platformPublicAddresses();
  if (!addr.ok) return NextResponse.json({ names: [...names], error: `could not read the saved addresses: ${addr.error}` }, { status: 200 });
  if (addr.value.portal_domain) names.add(addr.value.portal_domain);
  if (addr.value.wildcard_domain) addBase(addr.value.wildcard_domain);
  return NextResponse.json({ names: [...names] });
}
