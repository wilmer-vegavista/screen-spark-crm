import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Monitor } from "lucide-react";

export const Route = createFileRoute("/aterstall-losenord")({
  ssr: false,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Lösenordet är uppdaterat");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{ background: "radial-gradient(60% 50% at 50% 20%, oklch(0.56 0.19 258 / 0.22), transparent 70%)" }}
      />
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="size-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <Monitor className="size-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Skylt CRM</span>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-card)]">
          {ready ? (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label htmlFor="new-password">Nytt lösenord</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin mr-2" />} Spara nytt lösenord
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Länken är ogiltig eller har gått ut. Begär en ny återställningslänk på inloggningssidan.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
