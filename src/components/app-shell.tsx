import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Calendar,
  Image as ImageIcon,
  CheckSquare,
  FileBarChart,
  LogOut,
  Monitor,
  Settings,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "saljare" },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, group: "saljare" },
  { to: "/kunder", label: "Kunder", icon: Users, group: "saljare" },
  { to: "/aktiviteter", label: "Aktiviteter", icon: CheckSquare, group: "saljare" },
  { to: "/lon", label: "Lön", icon: Wallet, group: "saljare" },
  { to: "/kampanjer", label: "Kampanjer", icon: Calendar, group: "produktion" },
  { to: "/material", label: "Material", icon: ImageIcon, group: "produktion" },
  { to: "/rapporter", label: "Rapporter", icon: FileBarChart, group: "produktion" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, roles } = useCurrentUser();

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r bg-sidebar flex flex-col">
        <div className="px-4 py-4 border-b">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="size-8 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <Monitor className="size-4 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Skylt CRM</span>
              <span className="text-[10px] text-muted-foreground">DOOH</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
          <NavGroup label="Sälj">
            {nav.filter(n => n.group === "saljare").map(n => (
              <NavLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={pathname.startsWith(n.to)} />
            ))}
          </NavGroup>
          <NavGroup label="Produktion">
            {nav.filter(n => n.group === "produktion").map(n => (
              <NavLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={pathname.startsWith(n.to)} />
            ))}
          </NavGroup>
        </nav>

        <div className="border-t p-3 space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-sidebar-accent/40">
            <div className="size-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
              {(profile?.full_name || profile?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{profile?.full_name || profile?.email}</div>
              <div className="text-[10px] text-muted-foreground truncate">{roles.join(" · ") || "ingen roll"}</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="size-4 mr-2" /> Logga ut
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {children}
      </main>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({ to, label, icon: Icon, active }: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
