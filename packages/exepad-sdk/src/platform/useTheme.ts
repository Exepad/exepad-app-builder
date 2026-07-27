import { getPlatform } from '../helpers/bridge';
import type { ThemeTokens } from './types';

const defaultTheme: ThemeTokens = {
  colors: {
    primary: '#0f172a',
    'primary-foreground': '#ffffff',
    secondary: '#64748b',
    'secondary-foreground': '#0f172a',
    accent: '#3b82f6',
    'accent-foreground': '#0f172a',
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#f1f5f9',
    'muted-foreground': '#64748b',
    destructive: '#ef4444',
    'destructive-foreground': '#ffffff',
    card: '#ffffff',
    'card-foreground': '#0f172a',
    popover: '#ffffff',
    'popover-foreground': '#0f172a',
    border: '#e2e8f0',
    input: '#e2e8f0',
    ring: '#0f172a',
    success: '#22c55e',
    warning: '#f59e0b',
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    headingFontFamily: 'Inter, system-ui, sans-serif',
  },
  borderRadius: '0.5rem',
  mode: 'light',
};

export function useTheme(): ThemeTokens {
  const platform = getPlatform();
  if (platform) {
    return platform.useTheme();
  }
  return defaultTheme;
}
