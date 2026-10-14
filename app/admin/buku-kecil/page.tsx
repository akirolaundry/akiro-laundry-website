// app/admin/buku-kecil/page.tsx
import { getCashRegisterState, getExpenseCategories } from "@/lib/actions/payments";
import { getLedger } from "@/lib/actions/finance";
import { financePeriodRange, FINANCE_PERIODS, formatDateBiz, type FinancePeriod } from "@/lib/utils/business-time";
import { BukuKecilClient } from "@/components/admin/BukuKecilClient";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function BukuKecilPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  // ?from=…&to=… is a custom range; otherwise ?period=… (default: this month).
  const custom = sp.from && sp.to && ISO_DAY.test(sp.from) && ISO_DAY.test(sp.to) && sp.from <= sp.to;
  const period: FinancePeriod | "custom" = custom
    ? "custom"
    : FINANCE_PERIODS.some((p) => p.value === sp.period) ? (sp.period as FinancePeriod) : "this_month";
  const range = custom
    ? {
        from: sp.from!, to: sp.to!,
        label: sp.from === sp.to
          ? formatDateBiz(`${sp.from}T12:00:00Z`)
          : `${formatDateBiz(`${sp.from}T12:00:00Z`)} – ${formatDateBiz(`${sp.to}T12:00:00Z`)}`,
      }
    : financePeriodRange(period as FinancePeriod);

  const [state, categories, ledger] = await Promise.all([
    getCashRegisterState(),
    getExpenseCategories(),
    getLedger(range.from, range.to),
  ]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <BukuKecilClient
        balance={state.balance}
        lastUpdatedAt={state.lastUpdatedAt}
        categories={categories}
        ledger={ledger}
        period={period}
        range={range}
      />
    </div>
  );
}
