export interface UseModelOptions {
  filters?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  enabled?: boolean;
  /** Server-side aggregation (e.g., { fn: 'sum', of: 'total' }). */
  aggregate?: { fn: string; of: string };
  /** Full-text search query string. */
  search?: string;
  /** Columns to search across when `search` is provided. */
  searchFields?: string[];
}

export interface UseModelReturn<T = Record<string, unknown>> {
  data: T[] | null;
  loading: boolean;
  error: string | null;
  totalCount: number;
  refetch: () => void;
  create: (record: Partial<T>) => Promise<T>;
  update: (id: string | number, updates: Partial<T>) => Promise<T>;
  remove: (id: string | number) => Promise<void>;
}

export interface UseHandlerOptions {
  params?: Record<string, unknown>;
  autoFetch?: boolean;
}

export interface UseHandlerReturn<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (params?: Record<string, unknown>) => Promise<T | null>;
  refetch: () => void;
}

export interface NavigationAPI {
  navigate: (path: string, options?: { replace?: boolean }) => void;
  currentPath: string;
  /** Page slug without basePath (e.g., "/about"). Reactive — updates on navigation. */
  currentSlug: string;
  basePath: string;
}

export interface ThemeTokens {
  /**
   * Theme colors in the format provided by the app config (typically hex).
   * Note: the CSS variable path uses bare HSL — if you need to match
   * getComputedStyle values, convert with a hex→HSL utility.
   */
  colors: {
    primary: string;
    'primary-foreground': string;
    secondary: string;
    'secondary-foreground': string;
    accent: string;
    'accent-foreground': string;
    background: string;
    foreground: string;
    muted: string;
    'muted-foreground': string;
    destructive: string;
    'destructive-foreground': string;
    card: string;
    'card-foreground': string;
    popover: string;
    'popover-foreground': string;
    border: string;
    input: string;
    ring: string;
    success: string;
    warning: string;
  };
  typography: {
    fontFamily: string;
    headingFontFamily: string;
  };
  borderRadius: string;
  mode: 'light' | 'dark' | 'system';
}

export interface CurrentUser {
  id: string | null;
  email: string | null;
  name?: string | null;
  roles: string[];
  isAuthenticated: boolean;
}

export interface ExepadPlatformAPI {
  useModel: <T = Record<string, unknown>>(name: string, opts?: UseModelOptions) => UseModelReturn<T>;
  useHandler: <T = unknown>(name: string, opts?: UseHandlerOptions) => UseHandlerReturn<T>;
  useNavigation: () => NavigationAPI;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  useTheme: () => ThemeTokens;
  useCurrentUser: () => CurrentUser;
  getBasePath: () => string;
  getAppId: () => string;
  getRpcUrl: () => string;
}
