import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";
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
  UserCog,
  Package,
  ShoppingCart,
  Target,
  Clock,
  CheckCircle,
  Receipt,
  Contact,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { RecentSalesPanel } from "@/components/recent-sales";
import { GlobalSearch } from "@/components/global-search";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  adminOnly?: boolean;
  adminOrProduktion?: boolean;
}

const nav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "saljare" },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, group: "saljare" },
  { to: "/kunder", label: "Kunder", icon: Users, group: "saljare" },
  { to: "/leads", label: "Leads", icon: Contact, group: "saljare" },
  { to: "/aktiviteter", label: "Aktiviteter", icon: CheckSquare, group: "saljare" },
  { to: "/order", label: "Order", icon: ShoppingCart, group: "saljare" },
  { to: "/lon", label: "Lön", icon: Wallet, group: "saljare" },
  { to: "/produktion", label: "Produktion", icon: Settings, group: "produktion", adminOrProduktion: true },
  { to: "/kampanjer", label: "Kampanjer", icon: Calendar, group: "produktion" },
  { to: "/avslutas-snart", label: "Avslutas snart", icon: Clock, group: "produktion" },
  { to: "/avslutad", label: "Avslutad", icon: CheckCircle, group: "produktion" },
  { to: "/material", label: "Material", icon: ImageIcon, group: "produktion" },
  { to: "/rapporter", label: "Rapporter", icon: FileBarChart, group: "produktion" },
  { to: "/anvandare", label: "Användare", icon: UserCog, group: "admin", adminOnly: true },
  { to: "/produkter", label: "Produkter", icon: Package, group: "admin", adminOnly: true },
  { to: "/budget", label: "Budget", icon: Target, group: "admin", adminOnly: true },
  { to: "/faktura", label: "Faktura", icon: Receipt, group: "admin", adminOnly: true },
  { to: "/rapport-ekonomi", label: "Rapport ekonomi", icon: TrendingUp, group: "admin", adminOnly: true },
];


export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, roles } = useCurrentUser();
  const isAdmin = roles.includes("admin");
  const isProduktion = roles.includes("produktion");

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const visibleNav = nav.filter(n =>
    (!n.adminOnly || isAdmin) && (!n.adminOrProduktion || isAdmin || isProduktion)
  );


  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar/85 backdrop-blur-xl flex flex-col">
        <div className="px-5 py-5">
          <Link to="/dashboard" className="inline-flex bg-white rounded-xl p-2 shadow-[0_1px_2px_0_rgba(0,0,0,0.04),0_1px_1px_0_rgba(0,0,0,0.03)] group">
            <img
              src="/__l5e/assets-v1/e7f7e2a8-7f9d-4e0d-a296-adeeed75e2d1/vega-vista-logo.png"
              alt="Vega Vista"
              className="h-9 w-auto object-contain transition-opacity group-hover:opacity-80"
            />
          </Link>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-6 overflow-y-auto">
          <NavGroup label="Sälj">
            {visibleNav.filter(n => n.group === "saljare").map(n => (
              <NavLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={pathname.startsWith(n.to)} />
            ))}
          </NavGroup>
          <NavGroup label="Produktion">
            {visibleNav.filter(n => n.group === "produktion").map(n => (
              <NavLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={pathname.startsWith(n.to)} />
            ))}
          </NavGroup>
          {isAdmin && (
            <NavGroup label="Admin">
              {visibleNav.filter(n => n.group === "admin").map(n => (
                <NavLink key={n.to} to={n.to} label={n.label} icon={n.icon} active={pathname.startsWith(n.to)} />
              ))}
            </NavGroup>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-2">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-sidebar-accent/50">
            <div
              className="size-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
            >
              {(profile?.full_name || profile?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate tracking-tight">{profile?.full_name || profile?.email}</div>
              <div className="text-[10px] text-muted-foreground truncate uppercase tracking-wider">{roles.join(" · ") || "ingen roll"}</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleSignOut}>
            <LogOut className="size-4 mr-2" /> Logga ut
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 py-3 border-b border-border/70 bg-background/70 backdrop-blur-xl sticky top-0 z-40">
          <div />
          <GlobalSearch />
          <div className="flex justify-end"><RecentSalesPanel /></div>
        </div>
        {children}
      </main>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold" style={{ fontFamily: "var(--font-display)" }}>
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({ to, label, icon: Icon, active }: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary-foreground" : "text-muted-foreground")} />
      {label}
    </Link>
  );
}
