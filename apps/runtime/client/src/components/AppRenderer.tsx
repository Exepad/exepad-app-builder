// src/components/AppRenderer.tsx

import React from 'react';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { DynamicRendererList } from './DynamicRenderer';
import { PageTransition } from './PageTransition';
import { getLayoutClasses } from '@/utils/layoutPatterns';
import type { PageProps } from '@/app_runtime/interfaces/apps/page';
import EditModeToolbar from './editable/EditModeToolbar';
import { PageUuidTracker } from './PageUuidTracker';
import PersistentHeader from './PersistentHeader';
import PersistentFooter from './PersistentFooter';
import { CodeFocusSidebarShell } from './CodeFocusSidebarShell';

interface AppRendererProps {
  appConfig: WebAppProps;
  cleanAppId?: string;
  pageId?: string;
}

/**
 * A presentational component that renders a WebApp configuration.
 * It receives all necessary data via props and contains no internal state or data-fetching logic.
 */
const AppRenderer: React.FC<AppRendererProps> = ({ appConfig, cleanAppId, pageId }) => {
  const frontend = appConfig.frontend;

  let currentPage = pageId
    ? frontend?.pages?.find(page => page.uuid === pageId)
    : frontend?.pages?.find(page => page.slug === '/') || frontend?.pages?.[0];

  // If no page found and pages array is empty, create a minimal fallback page
  if (!currentPage && (!frontend?.pages || frontend.pages.length === 0)) {
    currentPage = {
      uuid: 'empty-page-fallback',
      pageType: 'WebPageProps',
      title: appConfig.name || 'Home',
      slug: '/',
      summary: '',
      shortSummary: '',
      lastUpdatedEpoch: Date.now() / 1000,
      content: []
    } as PageProps;
  }

  console.log('AppRenderer Debug:', {
    pageId,
    currentPageUuid: currentPage?.uuid,
    currentPageSlug: currentPage?.slug,
    currentPageTitle: currentPage?.title,
    currentPageType: currentPage?.pageType || 'WebPageProps',
    hasContent: !!currentPage?.content,
    contentLength: currentPage?.content?.length || 0
  });

  if (!currentPage) {
    return (
      <div className="p-4 m-4 border border-yellow-300 bg-yellow-50 text-yellow-700 rounded-lg">
        <p className="font-bold text-lg">Page Not Found</p>
        <p>The requested page &quot;{pageId || 'default'}&quot; was not found within the app config.</p>
      </div>
    );
  }

  const isSidebarLayout = frontend?.menuPosition === 'SidebarMenuLeft';
  const isHeaderLayout = frontend?.menuPosition === 'HeaderMenuTop';

  // Render page content
  const renderPageContent = () => {
    return <DynamicRendererList components={currentPage.content} />;
  };

  const MainContent = (
    <main className={`app-main flex-1 ${currentPage.classes || ''}`}>
      <div className={getLayoutClasses(currentPage.layout, frontend?.layout)}>
        {renderPageContent()}
      </div>
    </main>
  );

  const headerConfig = isHeaderLayout && frontend?.header ? {
    components: frontend.header,
  } : null;

  const footerConfig = frontend?.footer && frontend.footer.length > 0 ? {
    components: frontend.footer
  } : null;

  // Wrap MainContent with page transitions
  const TransitionedMainContent = (
    <PageTransition
      globalConfig={frontend?.transitions}
      pageOverride={currentPage.transitions}
    >
      {MainContent}
    </PageTransition>
  );

  // CodeComponent sidebar (Code Focus mode)
  const hasCodeComponentSidebar = isSidebarLayout
    && frontend?.sidebar && frontend.sidebar.length > 0;

  if (hasCodeComponentSidebar) {
    return (
      <>
        <CodeFocusSidebarShell
          sidebar={frontend!.sidebar}
          footer={footerConfig && <PersistentFooter components={footerConfig.components} />}
          extras={
            <>
              {currentPage && <PageUuidTracker pageUuid={currentPage.uuid} appId={appConfig.uuid} />}
              <EditModeToolbar />
            </>
          }
        >
          <div className={`app-container app-${appConfig.uuid}`}>
            {TransitionedMainContent}
          </div>
        </CodeFocusSidebarShell>
      </>
    );
  }

  // For header layout or no navigation: standard layout
  return (
    <>
      <div>
        {/* Header */}
        {headerConfig && (
            <PersistentHeader components={headerConfig.components} />
        )}

        {/* Main Content with Page Transitions */}
        <div className={`app-container app-${appConfig.uuid}`}>
          {TransitionedMainContent}
        </div>

        {/* Footer */}
        {footerConfig && (
          <PersistentFooter components={footerConfig.components} />
        )}
      </div>

      {/* Page UUID tracker */}
      {currentPage && <PageUuidTracker pageUuid={currentPage.uuid} appId={appConfig.uuid} />}

      {/* Edit mode toolbar */}
      <EditModeToolbar />
    </>
  );
};

export default AppRenderer;
