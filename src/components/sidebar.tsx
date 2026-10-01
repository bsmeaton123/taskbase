"use client";

import {
  ArchiveIcon,
  ChatCircleDotsIcon,
  CheckSquareOffsetIcon,
  CopySimpleIcon,
  DesktopIcon,
  GearSixIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  SignOutIcon,
  SparkleIcon,
  SquaresFourIcon,
  SunIcon,
  TrayIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { QuickAddDialog } from "@/components/ai/quick-add";
import { useApp } from "@/components/app-context";
import { Brand } from "@/components/brand";
import { CreateWorkspaceDialog } from "@/components/create-workspace";
import { WorkspaceMark } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { applyTheme, readThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { TemplateSummary } from "@/server/queries";

/* -------------------------------------------------------------------------- */
/* Mobile nav state                                                            */
/* -------------------------------------------------------------------------- */

const NavContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <NavContext.Provider value={{ open, setOpen }}>{children}</NavContext.Provider>;
}

/** The drawer's id, for the opener's aria-controls. */
const SIDEBAR_ID = "app-sidebar";

export function MobileNavButton() {
  const { open, setOpen } = useContext(NavContext);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={open}
      aria-controls={SIDEBAR_ID}
      className="-ml-1 mr-1 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:hidden"
      aria-label="Open navigation"
    >
      <ListIcon size={18} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                     */
/* -------------------------------------------------------------------------- */

type SidebarWorkspace = { id: string; name: string; color: string };

export function Sidebar({
  workspaces,
  unread,
  myOpenCount,
  people,
  templates,
}: {
  workspaces: SidebarWorkspace[];
  unread: number;
  myOpenCount: number;
  people: { id: string; name: string; email: string; image: string | null }[];
  templates: TemplateSummary[];
}) {
  const { open, setOpen } = useContext(NavContext);
  const { ai } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Close the mobile drawer on navigation.
  useEffect(() => setOpen(false), [pathname, setOpen]);
  // Move focus into the drawer when it opens, and hand it back to the menu button on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A frame later, once the drawer is no longer visibility: hidden.
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    const panel = drawer.current;
    return () => {
      cancelAnimationFrame(frame);
      if (opener?.isConnected && panel?.contains(document.activeElement)) opener.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // "/" jumps to search from anywhere that isn't a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target instanceof Element ? e.target : null;
      const typing = Boolean(el?.closest("input, textarea, [contenteditable=true]"));
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        router.push("/search");
      } else if (e.key === "q" && ai) {
        e.preventDefault();
        setQuickAdd(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, ai]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-overlay animate-fade-in lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        ref={drawer}
        id={SIDEBAR_ID}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-bg transition-[transform,visibility] duration-200 ease-[var(--ease-out-quint)] lg:static lg:z-auto lg:w-[248px] lg:translate-x-0",
          // Hidden (not just off-screen) when closed on small screens, so it can't be tabbed into.
          open ? "translate-x-0 shadow-pop" : "-translate-x-full max-lg:invisible",
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/my-tasks" className="rounded-md">
            <Brand />
          </Link>
          <button
            ref={closeButton}
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:hidden"
            aria-label="Close navigation"
          >
            <XIcon size={16} />
          </button>
        </div>

        {ai && (
          <div className="px-2.5 pb-2">
            <button
              type="button"
              onClick={() => setQuickAdd(true)}
              className="flex h-8 w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 text-[13.5px] text-muted shadow-card hover:border-border-strong hover:text-text"
            >
              <SparkleIcon size={15} weight="fill" className="text-accent" />
              Quick add
              <kbd className="ml-auto hidden rounded border border-border px-1 font-mono text-[11px] text-subtle lg:inline">
                Q
              </kbd>
            </button>
          </div>
        )}
        <nav aria-label="Main" className="grid gap-px px-2.5">
          <NavLink href="/search" icon={<MagnifyingGlassIcon size={17} />} active={pathname === "/search"}>
            Search
            <kbd className="ml-auto hidden rounded border border-border px-1 font-mono text-[11px] text-subtle lg:inline">
              /
            </kbd>
          </NavLink>
          <NavLink
            href="/my-tasks"
            icon={<CheckSquareOffsetIcon size={17} />}
            active={pathname === "/my-tasks"}
          >
            My tasks
            {myOpenCount > 0 && (
              <span className="tabular ml-auto text-[12px] text-subtle">
                {myOpenCount}
                <span className="sr-only"> open</span>
              </span>
            )}
          </NavLink>
          {ai && (
            <NavLink href="/ask" icon={<ChatCircleDotsIcon size={17} />} active={pathname === "/ask"}>
              Ask
            </NavLink>
          )}
          <NavLink
            href="/team"
            icon={<UsersThreeIcon size={17} />}
            active={pathname === "/team" || pathname.startsWith("/team/")}
          >
            Team
          </NavLink>
          <NavLink href="/inbox" icon={<TrayIcon size={17} />} active={pathname === "/inbox"}>
            Inbox
            {unread > 0 && (
              <span className="tabular ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                {unread > 99 ? "99+" : unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </NavLink>
        </nav>

        <div className="mt-6 flex items-center justify-between px-5 pb-1">
          <span id="sidebar-workspaces" className="text-[12px] font-medium text-subtle">
            Workspaces
          </span>
          <Tooltip content="New workspace" side="right">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="-mr-1.5 inline-flex size-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-text"
              aria-label="New workspace"
            >
              <PlusIcon size={14} weight="bold" />
            </button>
          </Tooltip>
        </div>

        <nav
          aria-labelledby="sidebar-workspaces"
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-4"
        >
          {workspaces.length === 0 ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mx-0.5 mt-1 w-[calc(100%-4px)] rounded-[10px] border border-dashed border-border-strong px-3 py-3 text-left text-[13px] text-muted hover:border-accent hover:text-text"
            >
              Create your first workspace to start adding tasks.
            </button>
          ) : (
            <ul className="grid gap-px">
              {workspaces.map((ws) => {
                const href = `/w/${ws.id}`;
                // Its settings and trash pages count as being in the workspace too.
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={ws.id}>
                    <Link
                      href={href}
                      aria-current={pathname === href ? "page" : active ? "true" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px]",
                        active
                          ? "bg-surface-3 font-medium text-text"
                          : "text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      <WorkspaceMark color={ws.color} />
                      <span className="truncate">{ws.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <UserMenu />
      </aside>

      {quickAdd && <QuickAddDialog open onOpenChange={setQuickAdd} />}
      <CreateWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        people={people}
        templates={templates}
      />
    </>
  );
}

function NavLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px]",
        active ? "bg-surface-3 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className={cn("inline-flex", active ? "text-text" : "text-muted")}>{icon}</span>
      {children}
    </Link>
  );
}

function UserMenu() {
  const { viewer } = useApp();
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePreference>("system");

  return (
    <div className="border-t border-border p-2.5">
      <Menu onOpenChange={(open) => open && setTheme(readThemePreference())}>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
          >
            <Avatar person={viewer} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{viewer.name}</span>
              <span className="block truncate text-[12px] text-muted">{viewer.email}</span>
            </span>
          </button>
        </MenuTrigger>
        <MenuContent side="top" align="start" className="w-56">
          <MenuItem onSelect={() => router.push("/settings")}>
            <GearSixIcon size={16} />
            Your profile
          </MenuItem>
          <MenuItem onSelect={() => router.push("/workspaces")}>
            <SquaresFourIcon size={16} />
            All workspaces
          </MenuItem>
          <MenuItem onSelect={() => router.push("/workspaces?tab=templates")}>
            <CopySimpleIcon size={16} />
            Templates
          </MenuItem>
          <MenuItem onSelect={() => router.push("/workspaces?tab=archived")}>
            <ArchiveIcon size={16} />
            Archived workspaces
          </MenuItem>
          {viewer.isAdmin && (
            <MenuItem onSelect={() => router.push("/people")}>
              <UsersThreeIcon size={16} />
              People
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          <MenuRadioGroup
            value={theme}
            onValueChange={(v) => {
              setTheme(v as ThemePreference);
              applyTheme(v as ThemePreference);
            }}
          >
            <MenuRadioItem value="system">
              <DesktopIcon size={16} />
              System
            </MenuRadioItem>
            <MenuRadioItem value="light">
              <SunIcon size={16} />
              Light
            </MenuRadioItem>
            <MenuRadioItem value="dark">
              <MoonIcon size={16} />
              Dark
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem
            onSelect={async () => {
              const { error } = await authClient.signOut();
              if (error) {
                toast.error("Couldn't sign you out. Check your connection and try again.");
                return;
              }
              router.replace("/sign-in");
              router.refresh();
            }}
          >
            <SignOutIcon size={16} />
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
