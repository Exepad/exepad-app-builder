import {
  React,
  useNavigation,
  useCurrentUser,
  Card,
  CardContent,
  Button,
  Input,
  Icons,
  toast,
} from "@exepad/sdk";

/**
 * Custom login page for the fitness tracker app.
 * Features a motivational fitness-themed design with stats highlights.
 */
function LoginForm() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [mode, setMode] = React.useState<"login" | "signup">("login");

  React.useEffect(() => {
    if (currentUser?.isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get("returnUrl");
      if (returnUrl) {
        const basePath = navigation.basePath || "";
        const slug = returnUrl.startsWith(basePath) ? returnUrl.slice(basePath.length) || "/" : "/";
        navigation.navigate(slug);
      } else {
        navigation.navigate("/");
      }
    }
  }, [currentUser?.isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const method = mode === "login" ? "auth_signin" : "auth_signup";
      const basePath = navigation.basePath || "";
      const platform = (window as any).ExepadPlatform;
      const segments = basePath.split("/").filter(Boolean);
      const apiAppId = platform?.getAppId?.() || segments[segments.length - 1] || "app";
      const response = await fetch(`/api/${apiAppId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          method,
          params: { email, password, ...(mode === "signup" ? { name: email.split("@")[0] } : {}) },
        }),
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: mode === "login" ? "Welcome back!" : "Account created!", description: `Signed in as ${email}` });
        window.dispatchEvent(new CustomEvent("exepad:auth:changed", { detail: { user: result.data.user } }));
        const params = new URLSearchParams(window.location.search);
        const returnUrl = params.get("returnUrl");
        if (returnUrl) {
          const slug = returnUrl.startsWith(basePath) ? returnUrl.slice(basePath.length) || "/" : "/";
          navigation.navigate(slug);
        } else {
          navigation.navigate("/");
        }
      } else {
        setError(result.error?.message || "Authentication failed");
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Fitness-themed header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Icons.Activity className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">FitTracker</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "login" ? "Ready to crush your goals?" : "Start your fitness journey today"}
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="text-center p-3 rounded-lg bg-accent">
            <div className="text-lg font-bold text-primary">10K+</div>
            <div className="text-xs text-muted-foreground">Active Users</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-accent">
            <div className="text-lg font-bold text-primary">500K</div>
            <div className="text-xs text-muted-foreground">Workouts Logged</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-accent">
            <div className="text-lg font-bold text-primary">98%</div>
            <div className="text-xs text-muted-foreground">Goal Success</div>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {error && (
              <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                <Icons.AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="athlete@example.com"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Icons.Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Icons.Activity className="h-4 w-4 mr-2" />}
                {mode === "login" ? "Let's Go!" : "Join the Team"}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                {mode === "login" ? (
                  <>
                    New to FitTracker?{" "}
                    <button type="button" onClick={() => setMode("signup")} className="text-primary hover:underline font-medium">
                      Sign up free
                    </button>
                  </>
                ) : (
                  <>
                    Already a member?{" "}
                    <button type="button" onClick={() => setMode("login")} className="text-primary hover:underline font-medium">
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default LoginForm;
