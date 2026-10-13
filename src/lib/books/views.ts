// Books' own views in the New look (docs/GIVING_REDESIGN.md section 4, owner decision 2): month-end close first, then QuickBooks
// sync and exceptions, donor matching, setup. Any other Accounting tab keeps its place after them. Pure.

const ORDER = ["/accounting/close", "/accounting/qbo", "/accounting/qbo/matching", "/accounting/qbo/setup"];

export function booksViewOrder<T extends { href: string }>(tabs: readonly T[]): T[] {
  const rank = (href: string) => {
    const i = ORDER.indexOf(href);
    return i === -1 ? ORDER.length : i;
  };
  return [...tabs].sort((a, b) => rank(a.href) - rank(b.href));
}
