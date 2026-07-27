import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { authMe } from '../services/StudioStream';

function ExepadLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="280"
      height="96"
      viewBox="0 0 350 120"
      role="img"
      aria-label="Exepad logo"
      className="h-auto max-w-full"
    >
      <g transform="translate(20,26)">
        <rect x="0" y="0" width="84" height="68" rx="12" className="fill-background stroke-border" />
        <rect x="23" y="15" width="14" height="14" className="fill-foreground" />
        <rect x="47" y="15" width="14" height="14" className="fill-foreground opacity-85" />
        <rect x="23" y="39" width="14" height="14" className="fill-foreground" />
        <rect x="47" y="39" width="14" height="14" className="fill-foreground" />
      </g>
      <text x="124" y="79" fontFamily="'Geist', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fontSize="64" fontWeight="600" letterSpacing="-1.2px">
        <tspan className="fill-foreground">Exe</tspan>
        <tspan className="fill-muted-foreground">pad</tspan>
      </text>
    </svg>
  );
}

/**
 * Self-host entry: redirect to the builder studio (if logged in) or the login /
 * first-run setup screen. Renders the logo while the auth check is in flight.
 */
export default function HomePage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await authMe();
      if (cancelled) return;
      navigate(user ? '/apps' : '/login', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <ExepadLogo />
        <p className="text-muted-foreground mt-2 mb-6">Application cloud</p>
      </div>
    </div>
  );
}
