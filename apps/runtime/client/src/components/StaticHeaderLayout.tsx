import React from 'react';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import ClientWrapper from './ClientWrapper';
import PersistentHeader from './PersistentHeader';
import PersistentFooter from './PersistentFooter';
import { Toaster } from '@/app_runtime/runtime/components/ui/toaster';
import DynamicTheme from './DynamicTheme';
import DynamicFontLoader from './DynamicFontLoader';
import { generateFontVariables } from '@/utils/fontUtils';

interface StaticHeaderLayoutProps {
  children: React.ReactNode;
  appConfig: WebAppProps;
  basePath: string;
  currentPath?: string; // Pass pathname as prop instead of using usePathname
  isPreview?: boolean;
  cleanAppId?: string;
}

// Renders persistent headers and footers around page content
const StaticHeaderLayout = ({ children, appConfig, basePath, currentPath = '/', isPreview = false, cleanAppId }: StaticHeaderLayoutProps) => {
  // Access frontend config
  const frontend = appConfig.frontend;

  // Header configuration
  const isHeaderLayout = frontend?.menuPosition === 'HeaderMenuTop';

  const headerConfig = isHeaderLayout && frontend?.header ? {
    components: frontend.header,
  } : null;

  // Footer configuration
  const footerConfig = frontend?.footer && frontend.footer.length > 0 ? {
    components: frontend.footer
  } : null;

  // Generate font CSS variables on the server for immediate availability
  // Uses shared utility with CSS sanitization to prevent injection via LLM-generated font names
  const fontVariables = generateFontVariables(frontend?.theme?.fonts);

  return (
    <>
      {/* Theme components - rendered on server OUTSIDE ClientWrapper for proper style injection */}
      {frontend?.theme && <DynamicTheme theme={frontend.theme} />}
      {frontend?.theme?.fonts && <DynamicFontLoader fonts={frontend.theme.fonts} />}

      {/* Inject font CSS variables on the server for immediate availability */}
      {fontVariables && (
        <style dangerouslySetInnerHTML={{ __html: fontVariables.trim() }} />
      )}

      <ClientWrapper
        basePath={basePath}
        currentPageSlug={currentPath}
        isPreview={isPreview}
        cleanAppId={cleanAppId}
        appConfig={appConfig}
      >
        <div>
        {/* Static header - rendered on server */}
        {headerConfig && (
            <PersistentHeader components={headerConfig.components} />
        )}

        {/* Page content container */}
        <div>
          {children}
        </div>

        {/* Static footer - rendered on server */}
        {footerConfig && (
          <PersistentFooter components={footerConfig.components} />
        )}
      </div>
      <Toaster />
      </ClientWrapper>
    </>
  );
};


export default StaticHeaderLayout;
