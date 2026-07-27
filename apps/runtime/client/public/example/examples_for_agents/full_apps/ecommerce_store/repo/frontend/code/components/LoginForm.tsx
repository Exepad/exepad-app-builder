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
 * Custom branded login page for the e-commerce store.
 * Shows a split layout with a promotional sidebar and login form.
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
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 rounded-lg overflow-hidden border border-border shadow-lg">
        {/* Promotional sidebar */}
        <div className="hidden md:flex flex-col justify-center bg-primary p-10 text-primary-foreground">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Icons.ShoppingBag className="h-8 w-8" />
              <span className="text-2xl font-bold">ShopHub</span>
            </div>
            <h2 className="text-3xl font-bold leading-tight">
              Discover amazing products at unbeatable prices
            </h2>
            <div className="space-y-3 text-primary-foreground/80">
              <div className="flex items-center gap-2">
                <Icons.Check className="h-5 w-5" />
                <span>Free shipping on orders over $50</span>
              </div>
              <div className="flex items-center gap-2">
                <Icons.Check className="h-5 w-5" />
                <span>30-day easy returns</span>
              </div>
              <div className="flex items-center gap-2">
                <Icons.Check className="h-5 w-5" />
                <span>Exclusive member-only deals</span>
              </div>
            </div>
          </div>
        </div>

        {/* Login form */}
        <div className="bg-card p-8 flex flex-col justify-center">
          <div className="md:hidden flex items-center gap-2 mb-6">
            <Icons.ShoppingBag className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">ShopHub</span>
          </div>

          <h1 className="text-2xl font-semibold text-card-foreground mb-1">
            {mode === "login" ? "Welcome back" : "Join ShopHub"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login"
              ? "Sign in to your account to continue shopping"
              : "Create an account for exclusive deals and faster checkout"}
          </p>

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
                placeholder="you@example.com"
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
              {loading ? <Icons.Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {mode === "login" ? "Sign In" : "Create Account"}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  New to ShopHub?{" "}
                  <button type="button" onClick={() => setMode("signup")} className="text-primary hover:underline font-medium">
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => setMode("login")} className="text-primary hover:underline font-medium">
                    Sign in
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginForm;
