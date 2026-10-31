import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { AgentConfigForm, type FormState } from "@/components/personalization/agent-config-form";
import { AgentSandbox } from "@/components/personalization/agent-sandbox";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { agentConfigs } from "@/db/schema";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { withTenant } from "@/lib/db/tenant";
import { DAYS, infoToEntries } from "@/lib/panel/agent-config-schema";
import { requireSession } from "@/lib/session";
import { Gear } from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = { title: "Personalización" };

export default async function Page() {
  const { organizationId, organization } = await requireSession();
  const [config] = await withTenant(organizationId, (tx) =>
    tx.select().from(agentConfigs).where(eq(agentConfigs.organizationId, organizationId)).limit(1),
  );

  if (!config) {
    return (
      <>
        <PageHeader title="Personalización" description="Define cómo atiende tu agente." />
        <EmptyState icon={<Gear size={20} />} title="Falta la configuración" description="No se encontró la configuración del agente de tu negocio. Contacta con soporte." />
      </>
    );
  }

  const initial: FormState = {
    systemPrompt: config.systemPrompt,
    tone: config.tone,
    handoffMessage: config.handoffMessage ?? "",
    timezone: organization.timezone,
    services: config.services.map((s) => ({ name: s.name, duration: String(s.duration_minutes), description: s.description ?? "" })),
    hours: Object.fromEntries(DAYS.map((d) => [d.key, (config.businessHours[d.key] ?? []).map((r) => ({ ...r }))])) as FormState["hours"],
    info: infoToEntries(config.businessInfo),
  };
  const promptPreview = buildSystemPrompt({
    config,
    organizationName: organization.name,
    timeZone: organization.timezone,
    now: new Date(),
    contact: { waPhone: "+10000000000", fullName: null },
  });

  return (
    <>
      <PageHeader title="Personalización" description="Cambia el prompt, el tono, los servicios y los horarios del agente sin tocar código." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <AgentConfigForm initial={initial} timeZones={Intl.supportedValuesOf("timeZone")} promptPreview={promptPreview} />
        <div className="lg:sticky lg:top-6">
          <AgentSandbox />
        </div>
      </div>
    </>
  );
}
