import {
  React,
  useCurrentUser,
  useNavigation,
  useTheme,
  useAppState,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface DemoUser {
  name: string;
  email: string;
  avatar?: string;
  roles: string[];
}

const DEMO_USER: DemoUser = {
  name: "Jane Cooper",
  email: "jane.cooper@example.com",
  avatar: "",
  roles: ["Admin", "Editor"],
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function AuthenticatedView({ user, onLogout }: { user: DemoUser; onLogout: () => void }) {
  const { navigate } = useNavigation();
  const { theme } = useTheme();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="flex flex-col items-center text-center pb-2">
        <Avatar className="h-20 w-20 mb-4">
          {user.avatar ? (
            <AvatarImage src={user.avatar} alt={user.name} />
          ) : null}
          <AvatarFallback className="text-lg font-semibold bg-primary text-primary-foreground">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
        <CardTitle className="text-xl">{user.name}</CardTitle>
        <CardDescription className="text-sm">{user.email}</CardDescription>
        <div className="flex gap-2 mt-3">
          {user.roles.map((role) => (
            <Badge key={role} variant="secondary" className="text-xs">
              {role}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="pt-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Icons.Palette className="h-4 w-4" />
            <span>Theme: {theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => navigate("/settings")}
            >
              <Icons.Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => navigate("/dashboard")}
            >
              <Icons.LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </Button>
          </div>
        </div>
      </CardContent>

      <Separator />

      <CardFooter className="pt-4">
        <Button variant="destructive" className="w-full" onClick={onLogout}>
          <Icons.LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </CardFooter>
    </Card>
  );
}

function UnauthenticatedView({ onLogin }: { onLogin: () => void }) {
  const { navigate } = useNavigation();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Icons.UserCircle className="h-8 w-8 text-muted-foreground" />
        </div>
        <CardTitle className="text-xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to access your profile and settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={onLogin}>
          <Icons.LogIn className="mr-2 h-4 w-4" />
          Sign In
        </Button>
      </CardContent>
    </Card>
  );
}

function UserProfileCard() {
  const [isAuthenticated, setIsAuthenticated] = useAppState<boolean>(
    "profileAuth",
    true
  );

  const currentUser = useCurrentUser();

  const demoUser: DemoUser = currentUser
    ? {
        name: currentUser.name || currentUser.email || "User",
        email: currentUser.email || "",
        avatar: currentUser.avatar || "",
        roles: ["Member"],
      }
    : DEMO_USER;

  return (
    <div className="space-y-4">
      {isAuthenticated ? (
        <AuthenticatedView
          user={demoUser}
          onLogout={() => setIsAuthenticated(false)}
        />
      ) : (
        <UnauthenticatedView onLogin={() => setIsAuthenticated(true)} />
      )}

      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => setIsAuthenticated(!isAuthenticated)}
        >
          <Icons.RefreshCw className="mr-1 h-3 w-3" />
          Toggle auth state (demo)
        </Button>
      </div>
    </div>
  );
}

export default UserProfileCard;
