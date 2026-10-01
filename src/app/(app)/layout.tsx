import { AppProvider } from "@/components/app-context";
import { CommandPalette } from "@/components/command-palette";
import { LiveRefresh, TimeZoneSync } from "@/components/live";
import { NavProvider, Sidebar } from "@/components/sidebar";
import { getTimeZone, getToday, requireUser } from "@/lib/session";
import { aiEnabled } from "@/server/ai/client";
import { getActivePeople, getSidebarData, getTemplates } from "@/server/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireUser();
  const [sidebar, people, today, timeZone, templates] = await Promise.all([
    getSidebarData(viewer),
    getActivePeople(),
    getToday(),
    getTimeZone(),
    getTemplates(viewer),
  ]);

  return (
    <AppProvider value={{ viewer, today, people, workspaces: sidebar.workspaces, ai: aiEnabled() }}>
      <TimeZoneSync current={timeZone} />
      <LiveRefresh />
      <CommandPalette />
      <NavProvider>
        <div className="flex h-[100dvh] overflow-hidden">
          <Sidebar
            workspaces={sidebar.workspaces}
            unread={sidebar.unread}
            myOpenCount={sidebar.myOpenCount}
            people={people}
            templates={templates}
          />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface lg:my-2 lg:mr-2 lg:rounded-[10px] lg:border lg:border-border lg:shadow-card">
            {children}
          </main>
        </div>
      </NavProvider>
    </AppProvider>
  );
}
