import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Monitor } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const goHome = async (userId: string) => {
    const { data: ownerRow } = await supabase
      .from("screen_owners")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    navigate({ to: ownerRow ? "/skarmportal" : "/dashboard" });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goHome(data.session.user.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Inloggad");
    await goHome(data.user.id);
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Konto skapat — du är inloggad");
    navigate({ to: "/dashboard" });
  };

  const onGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      return toast.error("Kunde inte logga in med Google");
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 20%, oklch(0.56 0.19 258 / 0.22), transparent 70%)",
        }}
      />
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div
            className="size-9 rounded-lg flex items-center justify-center"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Monitor className="size-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Skylt CRM</span>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-card)]">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Logga in</TabsTrigger>
              <TabsTrigger value="signup">Skapa konto</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4 space-y-4">
              <form onSubmit={onSignIn} className="space-y-3">
                <div>
                  <Label htmlFor="email">E-post</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password">Lösenord</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin mr-2" />} Logga in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4 space-y-4">
              <form onSubmit={onSignUp} className="space-y-3">
                <div>
                  <Label htmlFor="name">Namn</Label>
                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email2">E-post</Label>
                  <Input
                    id="email2"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password2">Lösenord</Label>
                  <Input
                    id="password2"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin mr-2" />} Skapa konto
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">eller</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
            <svg className="size-4 mr-2" viewBox="0 0 24 24">
              <path
                fill="#fff"
                d="M21.35 11.1H12v3.84h5.34c-.23 1.42-1.69 4.17-5.34 4.17-3.21 0-5.84-2.66-5.84-5.94S8.79 7.23 12 7.23c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.74 4.71 14.57 3.75 12 3.75 6.93 3.75 2.85 7.83 2.85 12.9s4.08 9.15 9.15 9.15c5.28 0 8.78-3.71 8.78-8.93 0-.6-.07-1.05-.18-1.5z"
              />
            </svg>
            Fortsätt med Google
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Första kontot blir admin automatiskt
        </p>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Är du skärmägare?{" "}
          <Link to="/skarmportal" className="underline hover:text-foreground">
            Logga in i skärmägarportalen
          </Link>
        </p>
      </div>
    </div>
  );
}
