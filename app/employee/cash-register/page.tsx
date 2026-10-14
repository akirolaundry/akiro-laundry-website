// app/employee/cash-register/page.tsx
// Server component that renders the cash register dashboard
import { getCashDrawerToday, getCashRegisterState, getEmployeeExpenseCategories } from "@/lib/actions/payments";
import { CashRegisterClient } from "@/components/employee/CashRegisterClient";

export default async function CashRegisterPage() {
  const [state, today, categories] = await Promise.all([
    getCashRegisterState(60),
    getCashDrawerToday(),
    getEmployeeExpenseCategories(),
  ]);
  return <CashRegisterClient state={state} today={today} now={new Date().toISOString()} categories={categories} />;
}
