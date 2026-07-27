import React from 'react';
import { Link } from 'react-router';

interface ForbiddenPageProps {
  /** Where the "Go to Home" button points */
  redirectUrl: string;
  /** App base path prefix */
  basePath: string;
}

/**
 * 403 Forbidden page — shown when user doesn't have permission.
 * Infrastructure component (not customizable by agent).
 * Inherits app theme via CSS variables from DynamicTheme.
 */
export function ForbiddenPage({ redirectUrl, basePath }: ForbiddenPageProps) {
  const href = `${basePath}${redirectUrl}`;

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-destructive"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m14.5 9.5-5 5" />
          <path d="m9.5 9.5 5 5" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold">Access Denied</h1>
      <p className="max-w-md text-muted-foreground">
        You do not have permission to view this page.
        Contact your administrator if you believe this is an error.
      </p>
      <Link
        to={href}
        className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Go to Home
      </Link>
    </main>
  );
}
