// app/admin/daily-cash/page.tsx
import { getCashBook, getOrderBook } from "@/lib/actions/finance";
import { resolveCashBookPeriod, type CashBookSearchParams } from "@/lib/utils/cash-book-period";
import { DailyCashClient } from "@/components/admin/DailyCashClient";

export default async function DailyCashPage({
  searchParams,
}: {
  searchParams: Promise<CashBookSearchParams>;
}) {
  // Defaults to today; ?view=weekly|monthly&date=… or ?view=custom&from=…&to=…
  // ?basis=orders switches revenue from "cash in" to "orders by order date".
  const period = resolveCashBookPeriod(await searchParams);
  const [book, orderBook] = await Promise.all([
    period.basis === "cash"   ? getCashBook(period.from, period.to)  : null,
    period.basis === "orders" ? getOrderBook(period.from, period.to) : null,
  ]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <DailyCashClient period={period} book={book} orderBook={orderBook} />
    </div>
  );
}
