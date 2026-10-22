// app/admin/wa-promo/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getPromoRecipients,
  getPromoCampaigns,
  getPromoTemplates,
} from "@/lib/actions/wa-promo";
import { getWaProvider } from "@/lib/utils/wa-send";
import { getWaTemplateSettings } from "@/lib/actions/wa-templates";
import { WaPromoClient } from "@/components/admin/WaPromoClient";

// The Fonnte send loop runs inside this route's server action — give it room.
// (Vercel caps this at 60s on Hobby, 300s on Pro.)
export const maxDuration = 60;

export default async function WaPromoPage() {
  // ── Auth guard — admin only ───────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) redirect("/login");
  if ((session.user as { role?: string }).role !== "admin") redirect("/dashboard");

  // ── Data ─────────────────────────────────────────────────────────────────
  const [recipients, campaigns, templates, settings] = await Promise.all([
    getPromoRecipients(),
    getPromoCampaigns(),
    getPromoTemplates(),
    getWaTemplateSettings(),
  ]);

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      <div>
        <h1
          className="font-black text-lg tracking-tight"
          style={{ color: "#1e293b" }}
        >
          Promo &amp; WhatsApp Blast
        </h1>
        <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
          Compose a promo message and send it to your registered customers over
          WhatsApp.
        </p>
      </div>

      <WaPromoClient
        recipients={recipients}
        campaigns={campaigns}
        templates={templates}
        provider={getWaProvider()}
        business={{
          name:  settings?.businessName  ?? "Akiro Laundry",
          phone: settings?.businessPhone ?? "",
          url:   settings?.businessUrl   ?? "",
        }}
      />
    </div>
  );
}
