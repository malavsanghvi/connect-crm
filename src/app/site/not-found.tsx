import { SiteLink, buttonStyles, container } from "@/components/site/ui";

export default function SiteNotFound() {
  return (
    <section className={`${container} flex flex-col items-center gap-5 py-24 text-center`}>
      <p className="font-display text-[72px] font-semibold leading-none text-saffron">404</p>
      <h1 className="font-display text-[34px] font-semibold text-navy">We could not find that page</h1>
      <p className="max-w-[460px] text-lg text-muted">The address may be mistyped, or the page may have moved. The home page is a good place to start.</p>
      <SiteLink to="/" className={buttonStyles.primary}>
        Back to the home page
      </SiteLink>
    </section>
  );
}
