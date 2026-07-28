
import React from 'react';
import { DynamicRendererList } from '@/components/DynamicRenderer';
import type { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

interface CodeFocusSidebarShellProps {
  sidebar: ComponentProps[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Extra elements rendered outside the layout flow (toasters, trackers, etc.) */
  extras?: React.ReactNode;
}

/**
 * Minimal layout shell for Code Focus sidebar apps.
 *
 * Provides a flex row so the sidebar component determines its own width
 * and the content area fills the remaining space. All positioning, mobile
 * responsiveness, scroll behavior, and visual styling are owned by the
 * sidebar component itself.
 */
export function CodeFocusSidebarShell({
  sidebar,
  children,
  footer,
  extras,
}: CodeFocusSidebarShellProps) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar wrapper: on mobile (< lg) the sidebar is fixed off-screen
          so this wrapper collapses to 0. On lg+ we give it an explicit w-64
          (matching the sidebar component's width) so it reserves space in
          the flex row — the sidebar itself uses fixed/sticky positioning
          which takes it out of flow, hence the explicit width. */}
      <div className="shrink-0 w-0 lg:w-64">
        <DynamicRendererList components={sidebar} />
      </div>

      {/* pt-14 on mobile reserves space for the sidebar's fixed toggle button.
          On lg+ the sidebar is visible so no top padding is needed. */}
      <div className="flex-1 flex flex-col min-w-0 pt-14 lg:pt-0">
        {children}
        {footer}
      </div>

      {extras}
    </div>
  );
}
