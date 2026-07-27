/**
 * Layout options for web applications
 */
export type MenuPosition = "HeaderMenuTop" | "SidebarMenuLeft";

export type LayoutOption = "boxed" | "wide" | "narrow" | "full-width";

/**
 * app type options for web applications
 */
export type AppTypeOption = "WebAppProps";


/**
 * Configures a supported language for internationalization (i18n).
 */
export interface LanguageOptionProps {
  /** BCP 47 language code (e.g., 'en', 'tr', 'fr-FR'). */
  code: string;
  /** Language name in English (e.g., 'Turkish', 'French'). */
  nameEnglish: string;
  /** Language name in its native script (e.g., 'Turkce', 'Francais'). */
  nameNative: string;
  /** If true, this is the app's default language. Only one language should be marked as default. */
  isDefault: boolean;
}

/**
 * Configures a font family with its weight variant and optional remote source URL.
 */
export interface FontProps {
  /** CSS font-family name (e.g., 'Inter', 'Playfair Display'). */
  family: string;
  /** Font weight and style variant (e.g., 'regular', 'italic', '400' for regular, '700' for bold, '400italic' for italic). */
  variant: 'regular' | 'italic' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' |
           '100italic' | '200italic' | '300italic' | '400italic' | '500italic' |
           '600italic' | '700italic' | '800italic' | '900italic';
  /** URL to load the font from (e.g., Google Fonts CSS URL). If omitted, the font is assumed to be locally available. */
  url?: string;
}

/**
 * Defines up to five series colors for charts and data visualizations, using HEX format (e.g., '#3b82f6').
 */
export interface ChartPaletteProps {
  /** Color for the first data series in charts. */
  'chart-1'?: string;
  /** Color for the second data series in charts. */
  'chart-2'?: string;
  /** Color for the third data series in charts. */
  'chart-3'?: string;
  /** Color for the fourth data series in charts. */
  'chart-4'?: string;
  /** Color for the fifth data series in charts. */
  'chart-5'?: string;
}

/**
 * Defines the color palette for a theme mode (light or dark).
 * Values can be hex ('#3f3f46') or bare HSL ('222.2 47.4% 11.2%').
 * Hex is auto-converted to HSL at runtime by DynamicTheme.
 */
export interface ColorPaletteProps {
  /** The main page background color. */
  background?: string;
  /** The default text color rendered on the background. */
  foreground?: string;
  /** The background color for Card components. */
  card?: string;
  /** The text color rendered on Card backgrounds. */
  'card-foreground'?: string;
  /** The background color for Popover, Dropdown, and Tooltip overlays. */
  popover?: string;
  /** The text color rendered on Popover backgrounds. */
  'popover-foreground'?: string;
  /** The primary brand color used for buttons, links, and active elements. */
  primary?: string;
  /** The text color rendered on primary-colored backgrounds. */
  'primary-foreground'?: string;
  /** The secondary color used for less prominent interactive elements. */
  secondary?: string;
  /** The text color rendered on secondary-colored backgrounds. */
  'secondary-foreground'?: string;
  /** The muted background color for subtle UI areas such as disabled states and badges. */
  muted?: string;
  /** The text color rendered on muted backgrounds (e.g., placeholder text, help text). */
  'muted-foreground'?: string;
  /** The accent color for hover states, highlights, and selection indicators. */
  accent?: string;
  /** The text color rendered on accent-colored backgrounds. */
  'accent-foreground'?: string;
  /** The color for destructive actions such as delete buttons and error states. */
  destructive?: string;
  /** The text color rendered on destructive-colored backgrounds. */
  'destructive-foreground'?: string;
  /** The color for borders on cards, dividers, and separators. */
  border?: string;
  /** The border color specifically for form input fields. */
  input?: string;
  /** The focus ring color shown around focused interactive elements. */
  ring?: string;
}

/**
 * Configures global CSS custom properties for shadows and transitions.
 */
export interface StyleVariableProps {
  /** Small box-shadow value (e.g., '0 1px 2px 0 rgb(0 0 0 / 0.05)'). */
  shadowSm?: string;
  /** Default box-shadow value. */
  shadow?: string;
  /** Medium box-shadow value. */
  shadowMd?: string;
  /** Large box-shadow value. */
  shadowLg?: string;
  /** Extra-large box-shadow value. */
  shadowXl?: string;
  /** 2XL box-shadow value. */
  shadow2xl?: string;
  /** Inset box-shadow value. */
  shadowInner?: string;
  /** Default CSS transition duration (e.g., '150ms', '300ms'). */
  transitionDuration?: string;
  /** Default CSS transition timing function (e.g., 'ease', 'cubic-bezier(0.4, 0, 0.2, 1)'). */
  transitionTimingFunction?: string;
}

// ============================================================================
// Component Defaults — global variant preferences set via theme.defaults
// ============================================================================

export interface SectionDefaultProps {
  variant?: 'default' | 'card' | 'glass' | 'gradient';
  radius?: 'none' | 'sm' | 'md' | 'lg';
  elevation?: 0 | 1 | 2 | 3;
}

export interface CardDefaultProps {
  variant?: 'default' | 'outlined' | 'filled' | 'elevated' | 'glass';
  elevation?: 0 | 1 | 2 | 3;
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  hoverEffect?: 'none' | 'lift' | 'glow' | 'border-glow' | 'scale';
}

/**
 * Subset of ButtonProps.variant — excludes 'destructive' and 'link' which
 * are semantic/contextual and should not be set as global defaults.
 */
export interface ButtonDefaultProps {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export interface InputDefaultProps {
  variant?: 'default' | 'underlined' | 'filled' | 'bordered';
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  size?: 'sm' | 'md' | 'lg';
}

export interface TabDefaultProps {
  variant?: 'default' | 'underline' | 'pill' | 'boxed' | 'minimal';
  size?: 'sm' | 'md' | 'lg';
}

export interface StepperDefaultProps {
  variant?: 'circles' | 'dots' | 'line' | 'numbered';
  size?: 'sm' | 'md' | 'lg';
}

export interface HeadingDefaultProps {
  decoration?: 'none' | 'underline-accent' | 'gradient';
  weight?: 'light' | 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
}

export interface TextDefaultProps {
  weight?: 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
}

export interface AccordionDefaultProps {
  style?: 'default' | 'flush';
}

export interface DataTableDefaultProps {
  striped?: boolean;
  hoverable?: boolean;
  compact?: boolean;
}

export interface FormLayoutDefaultProps {
  labelPosition?: 'top' | 'left';
  fieldSpacing?: 'tight' | 'default' | 'relaxed';
  fieldSetVariant?: 'default' | 'card' | 'borderless' | 'highlighted';
}

export interface ComponentDefaultProps {
  section?: SectionDefaultProps;
  card?: CardDefaultProps;
  button?: ButtonDefaultProps;
  input?: InputDefaultProps;
  tab?: TabDefaultProps;
  stepper?: StepperDefaultProps;
  heading?: HeadingDefaultProps;
  text?: TextDefaultProps;
  accordion?: AccordionDefaultProps;
  dataTable?: DataTableDefaultProps;
  form?: FormLayoutDefaultProps;
  animated?: boolean;
}

// ============================================================================
// Theme
// ============================================================================

/**
 * Defines all customizable theme properties for a WebApp.
 */
export interface ThemeProps {
  /** Color palette applied when the user is in light mode. */
  light?: ColorPaletteProps;
  /** Color palette applied when the user is in dark mode. */
  dark?: ColorPaletteProps;
  /** Color palette for chart/data-visualization series (chart-1 through chart-5). */
  charts?: ChartPaletteProps;
  /** Font configurations for body text and headings. */
  fonts?: {
    /** Font used for body text, paragraphs, and general content. */
    body?: FontProps;
    /** Font used for headings (h1-h6) and display text. */
    heading?: FontProps;
  };
  /** Defines the font size for different typographic scale steps. */
  fontSizes?: {
    xs?: string;
    sm?: string;
    base?: string;
    lg?: string;
    xl?: string;
    '2xl'?: string;
    '3xl'?: string;
    '4xl'?: string;
    '5xl'?: string;
    '6xl'?: string;
    '7xl'?: string;
    '8xl'?: string;
    '9xl'?: string;
  };
  /** Global border-radius in rem (e.g., '0.5'). @default '0.5' */
  radius?: string;
  /** Global spacing values applied to page sections. */
  spacing?: {
    /** Vertical section padding as Tailwind spacing value (e.g., '8', '12'). */
    y?: string;
    /** Horizontal content padding as Tailwind spacing value (e.g., '4', '6'). */
    x?: string;
  };
  /** Global CSS custom properties for shadows and transitions. */
  styles?: StyleVariableProps;
  /** Layout dimension overrides for the main content container. */
  layout?: {
    /** Maximum width of the content container (e.g., '1280px', '80rem'). */
    containerWidth?: string;
    /** Horizontal padding inside the content container (e.g., '1rem', '2rem'). */
    contentPadding?: string;
  };
  /** Global component variant defaults. Resolution order: component prop > form-scoped override > theme.defaults > built-in default. */
  defaults?: ComponentDefaultProps;
  /** Which color mode to render by default. Omit for light. */
  defaultTheme?: 'light' | 'dark';
}

/**
 * Defines the SEO and social sharing metadata for a page or the entire site.
 */
export interface MetadataProps {
  /** The title of the page or the site. */
  title?: string;
  /** The description of the page or the site. */
  description?: string;
  /** Site favicon as an inline SVG string (e.g. "<svg xmlns='...' viewBox='0 0 32 32'>...</svg>") or a URL. */
  favicon?: string;
  /** Comma-separated keywords. */
  keywords?: string;
  /** Open Graph metadata for social sharing. */
  openGraph?: {
    title?: string;
    description?: string;
    image?: string; // A full URL to an image
    url?: string; // The canonical URL for the page
    /** Open Graph type for social media cards. Common values: 'website' for homepages, 'article' for blog posts. */
    type?: 'website' | 'article' | 'profile' | 'book' | 'music.song' | 'music.album' | 'video.movie' | 'video.episode';
  };
}

export type AppSecondaryTypeOption = "website" | "form" | "dataapp" | "custom";

/**
 * Base interface for all Exepad application types, containing identification, metadata, and versioning.
 * All app type interfaces (WebAppProps, etc.) should extend this.
 */
export interface AppProps {
    /** Unique identifier (UUID v4) for this application. */
    uuid: string;

    /** The URL-friendly subdomain alias (e.g., 'my-crm-app'), used in the deployment URL: {alias}.exepad.com. */
    alias: string;

    /** The semantic version of the app config (e.g., '1.0.0'). */
    version: string;

    /** Application Type discriminator that determines which interface to use for parsing. */
    appType: AppTypeOption;

    /** Application secondary type that categorizes the app by its primary purpose (e.g., 'website', 'dataapp'). */
    appSecondaryType: AppSecondaryTypeOption;

    /** Human-readable display name shown in the admin panel and browser tab. */
    name: string;

    /** Detailed description of the application's purpose and features. */
    summary: string;

    /** One-line summary for listings and search results. */
    shortSummary: string;

    /** Last modified timestamp in epoch seconds. */
    lastUpdatedEpoch: number;

    /** An internal integrity hash for change-detection, managed automatically -- do not set manually. */
    signature?: string;
}