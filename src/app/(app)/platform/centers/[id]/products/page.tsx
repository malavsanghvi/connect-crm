import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, PageHeader, QueryError } from "@/components/ui";
import { explainError } from "@/lib/errors";
import { loadExperiences } from "@/lib/experiences-db";
import { parseProducts } from "@/lib/marketplace";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../../../platform-no-access";
import { ProductsClient, type AuditLine } from "./products-client";

export const metadata: Metadata = { title: "Products · Platform" };

/**
 * Platform › Communities › [community] › Products (the accepted prototype of 2026-10-13): the community's products with Turn on
 * and Turn off (a reason and a fresh code from the authenticator app every time, a module it needs on first), its open requests,
 * and the product history in words. Enforcement is the database's (app.marketplace_set_product over 0740's grants).
 */
export default async function PlatformProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  if (!session.isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Platform" />
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const centerRes = await db.from("centers").select("id, name, category_key").eq("id", id).maybeSingle();
  if (centerRes.error) {
    return (
      <>
        <PageHeader title="Platform" />
        <QueryError what="the community" error={centerRes.error} retryHref={`/platform/centers/${id}/products`} />
      </>
    );
  }
  if (!centerRes.data) notFound();
  const center = centerRes.data;
  const [statesRes, auditRes, kinds] = await Promise.all([
    db.rpc("marketplace_states", { p_center: id }),
    db.rpc("marketplace_audit", { p_center: id, p_limit: 50 }),
    loadExperiences(db),
  ]);
  const kindLabel = (kinds.status === "ok" ? kinds.experiences.find((k) => k.key === center.category_key)?.label : null) ?? null;
  const tz = session.center.time_zone;

  const header = (
    <PageHeader
      title={`Products for ${center.name}`}
      eyebrow={
        <span>
          <Link href="/platform" className="crm-link">
            Platform
          </Link>{" "}
          ›{" "}
          <Link href={`/platform/centers/${id}`} className="crm-link">
            {center.name}
          </Link>{" "}
          › Products
        </span>
      }
      description={`${kindLabel ? `Kind: ${kindLabel}. ` : ""}Turning a product on or off needs a reason and a fresh code from your authenticator app. Every change goes to the audit log, and the community's admins get a message.`}
    />
  );
  if (statesRes.error) {
    return (
      <>
        {header}
        <QueryError what="the community's products" error={statesRes.error} retryHref={`/platform/centers/${id}/products`} />
      </>
    );
  }
  const products = parseProducts(statesRes.data as unknown[] | null);
  if (!products) {
    console.error("[platform/products] marketplace_states returned an unexpected shape:", statesRes.data);
    return (
      <>
        {header}
        <Alert tone="danger" title="Could not load the community's products">
          The database answered in a shape this screen does not understand (has the latest migration been applied?). Reload to try again.
        </Alert>
      </>
    );
  }
  const audit: AuditLine[] | null = auditRes.error
    ? null
    : (auditRes.data ?? []).map((a) => ({ at: a.at, what: a.what, why: a.why }));
  if (auditRes.error) console.error("[platform/products] could not load the product history:", auditRes.error);

  return (
    <>
      {header}
      <ProductsClient
        centerId={id}
        centerName={center.name}
        products={products}
        audit={audit}
        auditError={auditRes.error ? `Could not load the history — ${explainError(auditRes.error)}. Reload to try again.` : null}
        timeZone={tz}
      />
    </>
  );
}
