/**
 * Test Utilities
 * Custom render function with providers for testing components
 */

import React, { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { AppConfigProvider, AppMode, RouteType } from '@/context/AppConfigContext';
import { EditModeProvider } from '@/context/EditModeContext';
import { TransitionProvider } from '@/context/TransitionContext';
import { mockAppConfig } from '@tests/mocks/mockConfigs';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';

/**
 * Provider configuration options
 */
interface ProviderOptions {
  appConfig?: WebAppProps;
  basePath?: string;
  appId?: string;
  mode?: AppMode;
  routeType?: RouteType;
}

/**
 * Extended render options
 */
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  providerOptions?: ProviderOptions;
}

/**
 * Create a wrapper component with all providers
 */
function createWrapper(options: ProviderOptions = {}) {
  const {
    appConfig = mockAppConfig,
    basePath = '/test',
    appId = 'test-app',
    mode = 'published',
    routeType = 'production',
  } = options;

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AppConfigProvider
        appConfig={appConfig}
        basePath={basePath}
        appId={appId}
        mode={mode}
        routeType={routeType}
      >
        <TransitionProvider>
          <EditModeProvider>
            {children}
          </EditModeProvider>
        </TransitionProvider>
      </AppConfigProvider>
    );
  };
}

/**
 * Custom render function with all providers
 * 
 * @example
 * ```tsx
 * import { renderWithProviders, screen } from '@tests/utils/renderWithProviders';
 * 
 * test('renders component', () => {
 *   renderWithProviders(<MyComponent />);
 *   expect(screen.getByText('Hello')).toBeInTheDocument();
 * });
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult {
  const { providerOptions, ...renderOptions } = options;
  
  return render(ui, {
    wrapper: createWrapper(providerOptions),
    ...renderOptions,
  });
}

/**
 * Custom render function for preview mode
 */
export function renderWithPreviewProviders(
  ui: ReactElement,
  options: Omit<CustomRenderOptions, 'providerOptions'> & { providerOptions?: Omit<ProviderOptions, 'mode' | 'routeType'> } = {}
): RenderResult {
  const { providerOptions, ...renderOptions } = options;
  
  return render(ui, {
    wrapper: createWrapper({
      ...providerOptions,
      mode: 'preview',
      routeType: 'preview',
    }),
    ...renderOptions,
  });
}

/**
 * Re-export everything from testing-library for convenience
 */
export * from '@testing-library/react';
export { renderWithProviders as render };
