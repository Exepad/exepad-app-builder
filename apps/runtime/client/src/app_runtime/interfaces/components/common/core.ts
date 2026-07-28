// src/interfaces/core.ts

import { AnimationProps } from './animation';

// Re-export animation types for convenience
export type { AnimationProps, ListAnimationProps } from './animation';
export type { AnimationPreset, AnimationTiming, AnimationEasing } from './animation';

/**
 * Base interface for all renderable UI components, providing identification, conditional visibility, and animation.
 */
export interface ComponentProps {
  /** A UUID v4 that uniquely identifies this component instance within the app config. */
  uuid: string;

  /** The component type discriminator matching the interface name (e.g., 'CodeComponentProps'), used by DynamicRenderer to resolve the React component. */
  componentType: string;

  /** Last updated timestamp in epoch seconds, managed by the backend. */
  lastUpdatedEpoch?: number;

  /** Tailwind CSS utility classes applied to this component's wrapper element (e.g., 'p-4 bg-muted rounded-lg'). */
  classes?: string;

  /** An internal integrity hash for change-detection, managed automatically — do not set manually. */
  signature?: string;

  /** Optional animation configuration for enter/exit and layout animations. */
  animation?: AnimationProps;

  /** Conditional visibility — hides component when it evaluates to false. Accepts a boolean or a $expression string (e.g., "$isLoggedIn", "$items.length > 0"). */
  showWhen?: boolean | string;

  /** Inline CSS styles applied to this component's wrapper element. Use as a last resort — prefer typed props and `classes` for standard styling. Named `inlineStyle` (not `style`) to avoid collision with component-specific `style` variant selectors. */
  inlineStyle?: Record<string, string>;
}

/**
 * Base interface for components that exist only as children of a specific parent and cannot be used standalone.
 */
export interface SubComponentProps extends ComponentProps {
}

/**
 * Text or element alignment options
 */
export type Alignment = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'justify';

/**
 * Layout display modes
 */
export type LayoutMode = 'grid' | 'list' | 'cards';

/**
 * Unified data reference type for components that consume data.
 */
export type DataRef<T = Record<string, any>> = string | T[];

/**
 * Renders a Lucide icon by name at a specified pixel size.
 * Kept as infrastructure type (used by metadata generator for favicon resolution).
 */
export interface IconProps extends ComponentProps {
  /** The Lucide icon name (e.g., 'ChevronRight', 'Search', 'Star'). */
  name: string;
  /** The icon width and height in pixels. @default 24 */
  size: number;
}

/**
 * Renders a clickable hyperlink for internal navigation or external URLs.
 * Kept as infrastructure type (used by the metadata generator and renderers).
 */
export interface LinkProps extends ComponentProps {
  href: string;
  text: string;
  target?: string;
}

/**
 * Stores metadata for an image asset.
 * Kept as infrastructure type (used by image renderers and the metadata generator).
 */
export interface ImageAssetProps extends ComponentProps {
  isProcessed: boolean;
  keywords: string;
  requestedWidth: number;
  requestedHeight: number;
  provider?: string;
  providerImgId?: string;
  providerImgUrl?: string;
  datetimeGenerated?: string;
}

/**
 * Renders an image element with metadata.
 * Kept as infrastructure type (used by image renderers and the metadata generator).
 */
export interface ImageProps extends ComponentProps {
  asset: ImageAssetProps;
  src: string;
  alt: string;
  width?: number;
  height?: number;
  classes?: string;
  hoverEffect?: 'darken' | 'zoom' | 'grayscale' | 'blur' | 'brightness' | 'lift' | 'none';
}
