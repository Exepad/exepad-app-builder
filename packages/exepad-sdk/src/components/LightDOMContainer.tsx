/**
 * LightDOMContainer — Thin wrapper that renders React children in the
 * light DOM with an optional className for layout integration.
 *
 * Replaces ShadowContainer for all app types. CSS isolation is now
 * handled via @layer exepad-app instead of Shadow DOM,
 * keeping content visible to search engine crawlers and browser APIs.
 */

import { React } from '../core';

const { forwardRef } = React;

export interface LightDOMContainerProps {
  /** React children rendered in the light DOM. */
  children: React.ReactNode;
  /** className applied to the outer wrapper div. */
  className?: string;
}

export const LightDOMContainer = forwardRef<HTMLDivElement, LightDOMContainerProps>(
  function LightDOMContainer({ children, className }, ref) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }
);
