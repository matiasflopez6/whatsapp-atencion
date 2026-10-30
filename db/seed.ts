/**
 * Datos de ejemplo para desarrollo: DOS organizaciones con usuario, configuración del agente,
 * contactos, conversaciones, mensajes y citas, para probar el aislamiento multi-tenant.
 * Idempotente. No corre en producción. No crea credenciales de WhatsApp ni de Google.
 */
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { closePool, db } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";
import { getUserOrganization } from "@/lib/db/system";
import { agentConfigs, appointments, contacts, conversations, messages, user } from "@/db/schema";

if (process.env.NODE_ENV === "production") {
  console.error("db:seed no puede ejecutarse con NODE_ENV=production");
  process.exit(1);
}

const password = process.env.SEED_PASSWORD || "seed-password-123";

const SEEDS = [
  {
    email: "owner@clinica-sonrisa.test",
    name: "Dra. Ana Pérez",
    organizationName: "Clínica Dental Sonrisa",
    timezone: "America/Mexico_City",
    services: [
      { name: "limpieza", duration_minutes: 45, description: "Limpieza dental profesional" },
      { name: "empaste", duration_minutes: 60, description: "Restauración de caries" },
      { name: "blanqueamiento", duration_minutes: 90, description: "Blanqueamiento en consultorio" },
    ],
    tone: "profesional y cálido",
    contact: { waPhone: "+5218112345678", fullName: "Carlos Ramírez" },
    chat: ["Hola, quiero agendar una limpieza", "Con gusto. ¿Qué día te acomoda mejor?"],
  },
  {
    email: "owner@barberia-norte.test",
    name: "Luis Gómez",
    organizationName: "Barbería Norte",
    timezone: "America/Bogota",
    services: [
      { name: "corte", duration_minutes: 30, description: "Corte de cabello" },
      { name: "barba", duration_minutes: 20, description: "Arreglo de barba" },
    ],
    tone: "cercano e informal",
    contact: { waPhone: "+573001234567", fullName: "Andrés Mejía" },
    chat: ["Buenas, ¿tienen turno hoy?", "¡Hola! Déjame revisar la agenda."],
  },
];

async function main() {
  for (const seed of SEEDS) {
    const [existing] = await db.select().from(user).where(eq(user.email, seed.email)).limit(1);
    if (!existing) {
      await auth.api.signUpEmail({
        body: { name: seed.name, email: seed.email, password, organizationName: seed.organizationName } as {
          name: string;
          email: string;
          password: string;
        },
      });
    }
    const [u] = await db.select().from(user).where(eq(user.email, seed.email)).limit(1);
    const membership = u ? await getUserOrganization(u.id) : null;
    if (!u || !membership) throw new Error(`No se pudo preparar ${seed.email}`);
    const orgId = membership.organization.id;

    await withTenant(orgId, async (tx) => {
      await tx.update(agentConfigs).set({ services: seed.services, tone: seed.tone }).where(eq(agentConfigs.organizationId, orgId));
      const [alreadySeeded] = await tx.select({ id: contacts.id }).from(contacts).limit(1);
      if (alreadySeeded) return;

      const [contact] = await tx
        .insert(contacts)
        .values({ organizationId: orgId, ...seed.contact })
        .returning();
      if (!contact) throw new Error("contacto no creado");
      const [conversation] = await tx
        .insert(conversations)
        .values({ organizationId: orgId, contactId: contact.id })
        .returning();
      if (!conversation) throw new Error("conversación no creada");
      await tx.insert(messages).values([
        { organizationId: orgId, conversationId: conversation.id, direction: "inbound", sender: "contact", content: seed.chat[0] },
        { organizationId: orgId, conversationId: conversation.id, direction: "outbound", sender: "bot", content: seed.chat[1] },
      ]);
      const start = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      start.setMinutes(0, 0, 0);
      const service = seed.services[0]!;
      await tx.insert(appointments).values({
        organizationId: orgId,
        contactId: contact.id,
        service: service.name,
        startsAt: start,
        endsAt: new Date(start.getTime() + service.duration_minutes * 60_000),
        fullName: seed.contact.fullName,
        phone: seed.contact.waPhone,
        isNewPatient: true,
      });
    });
    console.log(`✔ ${seed.organizationName} (${seed.email}) → org ${orgId}`);
  }
  console.log(`Contraseña de los usuarios seed: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
