import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { authMe, authStatus, login, setup } from '../services/StudioStream';
import { Logo } from '@/components/studio/Logo';
import { ThemeToggle } from '@/components/studio/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await authMe();
      if (!cancelled && user) {
        navigate('/apps', { replace: true });
        return;
      }
      const { needsSetup, setupTokenRequired: tokenRequired } = await authStatus();
      if (!cancelled) {
        setMode(needsSetup ? 'setup' : 'login');
        setSetupTokenRequired(tokenRequired);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result =
      mode === 'setup'
        ? await setup(email.trim(), password, setupToken.trim() || undefined)
        : await login(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      navigate('/apps', { replace: true });
    } else {
      setError(result.error || 'Something went wrong');
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>

        <Card className="shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)]">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              {mode === 'setup' ? 'Welcome to Exepad' : 'Sign in'}
            </CardTitle>
            <CardDescription>
              {mode === 'setup'
                ? 'Create your operator account to get started.'
                : 'Sign in to build and publish apps.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'setup' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === 'setup' && (
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                )}
              </div>

              {mode === 'setup' && setupTokenRequired && (
                <div className="space-y-1.5">
                  <Label htmlFor="setupToken">Setup token</Label>
                  <Input
                    id="setupToken"
                    type="text"
                    autoComplete="off"
                    required
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Printed in the server logs on first boot. Required to create the first operator
                    account on this instance.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Please wait…' : mode === 'setup' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
