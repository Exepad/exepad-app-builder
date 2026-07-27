/**
 * Mock Configurations for Tests
 * Sample WebAppProps, PageProps, and ComponentProps for testing
 */

import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { PageProps } from '@/app_runtime/interfaces/apps/page';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

/**
 * Mock Page
 */
export const mockPage: PageProps = {
  uuid: 'page-1',
  pageType: 'WebPageProps',
  title: 'Test Page',
  slug: '/',
  summary: 'Test page summary for testing purposes',
  shortSummary: 'Test page',
  lastUpdatedEpoch: Math.floor(Date.now() / 1000),
  content: [],
};

/**
 * Mock About Page
 */
export const mockAboutPage: PageProps = {
  uuid: 'page-2',
  pageType: 'WebPageProps',
  title: 'About Us',
  slug: '/about',
  summary: 'About us page summary',
  shortSummary: 'About us',
  lastUpdatedEpoch: Math.floor(Date.now() / 1000),
  content: [],
};

/**
 * Mock Blog Main Page
 */
export const mockBlogPage: PageProps = {
  uuid: 'page-3',
  pageType: 'BlogMainPageProps',
  title: 'Blog',
  slug: '/blog',
  summary: 'Our blog',
  shortSummary: 'Blog',
  lastUpdatedEpoch: Math.floor(Date.now() / 1000),
  content: [],
};

/**
 * Mock Code Component
 */
export const mockCodeComponent: ComponentProps = {
  uuid: 'code-1',
  componentType: 'CodeComponentProps',
} as any;

/**
 * Mock Code Component 2
 */
export const mockCodeComponent2: ComponentProps = {
  uuid: 'code-2',
  componentType: 'CodeComponentProps',
} as any;

/**
 * Mock Code Component 3
 */
export const mockCodeComponent3: ComponentProps = {
  uuid: 'code-3',
  componentType: 'CodeComponentProps',
} as any;

/**
 * Mock Section Component with children
 */
/**
 * Mock Header Component
 */
export const mockHeader: ComponentProps = {
  uuid: 'header-1',
  componentType: 'CodeComponentProps',
} as any;

/**
 * Mock Footer Component
 */
export const mockFooter: ComponentProps = {
  uuid: 'footer-1',
  componentType: 'CodeComponentProps',
} as any;

/**
 * Mock App Configuration
 */
export const mockAppConfig: WebAppProps = {
  uuid: 'app-1',
  appType: 'WebAppProps',
  appSecondaryType: 'website',
  name: 'Test App',
  summary: 'A test application for unit testing',
  shortSummary: 'Test App',
  lastUpdatedEpoch: Math.floor(Date.now() / 1000),
  runtimeVersion: '1.0.0',
  agentVersion: '1.0.0',
  alias: 'test-app',
  languages: [
    {
      code: 'en',
      nameEnglish: 'English',
      nameNative: 'English',
      isDefault: true,
    },
  ],
  layout: 'wide',
  menuPosition: 'HeaderMenuTop',
  theme: {
    radius: '0.5rem',
    light: {
      background: '#ffffff',
      foreground: '#111827',
      primary: '#3b82f6',
      'primary-foreground': '#ffffff',
    },
    dark: {
      background: '#111827',
      foreground: '#ffffff',
      primary: '#3b82f6',
      'primary-foreground': '#ffffff',
    },
    fonts: {
      body: {
        family: 'Inter',
        variant: '400',
      },
      heading: {
        family: 'Inter',
        variant: '700',
      },
    },
  },
  sidebar: [],
  header: [mockHeader],
  pages: [mockPage, mockAboutPage, mockBlogPage],
  footer: [mockFooter],
};

/**
 * Mock App Configuration with minimal data
 */
export const mockMinimalAppConfig: WebAppProps = {
  uuid: 'minimal-app',
  appType: 'WebAppProps',
  appSecondaryType: 'website',
  name: 'Minimal App',
  summary: 'Minimal test app',
  shortSummary: 'Minimal',
  lastUpdatedEpoch: Math.floor(Date.now() / 1000),
  runtimeVersion: '1.0.0',
  agentVersion: '1.0.0',
  alias: 'minimal-app',
  languages: [{ code: 'en', nameEnglish: 'English', nameNative: 'English', isDefault: true }],
  layout: 'boxed',
  menuPosition: 'HeaderMenuTop',
  theme: { radius: '0.5rem' },
  sidebar: [],
  header: [],
  pages: [mockPage],
  footer: [],
};

/**
 * Create a mock component with custom props
 */
export function createMockComponent<T extends ComponentProps>(
  type: string,
  overrides: Partial<T> = {}
): T {
  return {
    uuid: `mock-${type}-${Date.now()}`,
    componentType: type,
    lastUpdatedEpoch: Math.floor(Date.now() / 1000),
    ...overrides,
  } as T;
}

/**
 * Create a mock page with custom props
 */
export function createMockPage(overrides: Partial<PageProps> = {}): PageProps {
  return {
    uuid: `mock-page-${Date.now()}`,
    pageType: 'WebPageProps',
    title: 'Mock Page',
    slug: `/mock-${Date.now()}`,
    summary: 'Mock page summary',
    shortSummary: 'Mock',
    lastUpdatedEpoch: Math.floor(Date.now() / 1000),
    content: [],
    ...overrides,
  };
}

// =========================================
// State Management Mocks
// =========================================

import { StateSchema } from '@/app_runtime/interfaces/state';

/**
 * Mock State Schema - Ecommerce style (new key-value format)
 */
export const mockStateSchema: StateSchema = {
  cartItems: [],
  cartOpen: false,
  selectedCategory: 'all',
  searchQuery: '',
  isProcessing: false,
  customerInfo: { name: '', email: '', phone: '' },
};


/**
 * Mock Datasets - Product catalog
 */
export const mockDatasets = {
  products: {
    type: 'static',
    generated: false,
    records: [
      {
        id: '1',
        name: 'Wireless Headphones',
        category: 'Electronics',
        price: 299.99,
        stock: 45,
        image: 'https://example.com/headphones.jpg',
      },
      {
        id: '2',
        name: 'Smart Watch',
        category: 'Electronics',
        price: 449.99,
        stock: 32,
        image: 'https://example.com/watch.jpg',
      },
      {
        id: '3',
        name: 'Laptop Stand',
        category: 'Accessories',
        price: 79.99,
        stock: 156,
        image: 'https://example.com/stand.jpg',
      },
      {
        id: '4',
        name: 'USB-C Hub',
        category: 'Accessories',
        price: 59.99,
        stock: 89,
        image: 'https://example.com/hub.jpg',
      },
    ],
  },
  categories: {
    type: 'static',
    generated: false,
    records: [
      { id: 'all', name: 'All Products' },
      { id: 'electronics', name: 'Electronics' },
      { id: 'accessories', name: 'Accessories' },
    ],
  },
};

/**
 * Mock App Config with state management
 */
export const mockAppConfigWithState: WebAppProps = {
  ...mockAppConfig,
  state: mockStateSchema,
  data: {
    datasets: mockDatasets as any,
  },
};

/**
 * Create a custom state schema
 */
export function createMockStateSchema(
  state: StateSchema
): StateSchema {
  return state;
}

