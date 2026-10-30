import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        organizationName={session.organization.name}
        userName={session.user.name}
        userEmail={session.user.email}
        logoutAction={logoutAction}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl space-y-6">{children}</div>
      </main>
    </div>
  );
}
