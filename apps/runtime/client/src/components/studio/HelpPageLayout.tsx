import type { ReactNode } from 'react';
import { useOutletContext } from 'react-router';
import type { StudioOutletContext } from '@/components/studio/StudioShell';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shared shell for the Help pages (Terms, Privacy, About) reached from the
 * profile menu. Consumes the outlet context so the StudioShell auth guard
 * applies, and renders the content inside a Card to match the other operator
 * pages (Profile, Settings).
 */
export function HelpPageLayout({
  title,
  description,
  updated,
  children,
}: {
  title: string;
  description: string;
  /** Optional "Last updated" line shown under the description (legal pages). */
  updated?: string;
  children: ReactNode;
}) {
  useOutletContext<StudioOutletContext>(); // shell provides the auth guard

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        {updated && (
          <p className="mt-1 text-xs text-muted-foreground">Last updated: {updated}</p>
        )}
      </div>

      <Card>
        <CardContent className="py-6">
          <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** A titled section within a Help page. */
export function HelpSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  );
}

export default HelpPageLayout;
