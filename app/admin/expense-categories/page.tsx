// app/admin/expense-categories/page.tsx
import { getExpenseCategoriesWithUsage } from "@/lib/actions/payments";
import { ExpenseCategoriesClient }       from "@/components/admin/ExpenseCategoriesClient";

export default async function ExpenseCategoriesPage() {
  const categories = await getExpenseCategoriesWithUsage();
  return <ExpenseCategoriesClient categories={categories} />;
}
