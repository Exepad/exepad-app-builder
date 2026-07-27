import { ComponentProps } from '../components/common/core';
import { CodeComponentProps } from '../code_components/code_component';
import { PageTransitionProps } from './transitions';
import {MetadataProps,LayoutOption,MenuPosition} from "./core";
import type { AccessLevel } from '@exepad/types';

export type PageType = 'WebPageProps';

/**
 * Defines a single page in the application with its route, content tree, SEO metadata, and optional transition overrides.
 */
export interface PageProps {
    /** Unique identifier (UUID v4) for this page instance. */
    uuid: string;
    /** The page type discriminator that determines which page interface to use. */
    pageType: PageType;
    /** Human-readable page title displayed in the navigation and browser tab. */
    title: string;
    /** URL path starting with '/' (e.g., '/', '/about', '/products/:id'). Dynamic segments use ':paramName' syntax. */
    slug: string;
    /** Comprehensive summary of the page, visible to the user. This is not the SEO description. */
    summary?: string;
    /** Short one-sentence summary of the page, visible to the user. This is not the SEO description. */
    shortSummary?: string;
    /** Last updated timestamp in epoch seconds, managed by the backend. */
    lastUpdatedEpoch?: number;
    /** The ordered list of component trees that make up the page body. */
    content: (ComponentProps | CodeComponentProps)[];
    /** Additional CSS class names to apply to the page wrapper element. */
    classes?: string;
    /** Page-specific SEO and social sharing metadata that overrides site-wide defaults. */
    metadata?: MetadataProps;
    /** Content width strategy for this page, overrides the app-level layout setting. */
    layout?: LayoutOption;
    /** Page-specific entrance/exit transition animation overrides. */
    transitions?: PageTransitionProps;
    /** An internal integrity hash for change-detection, managed automatically -- do not set manually. */
    signature?: string;
    /** Access control for this page. Determines who can view it. @default security.defaultAccess or 'public' */
    access?: AccessLevel;
    /** Override the app-level menuPosition for this page.
     *  When set, this page uses the corresponding nav shell (header or sidebar)
     *  instead of the app-level default. @default inherited from frontend.menuPosition */
    menuPosition?: MenuPosition;
}

/**
 * A standard web page.
 * This interface extends PageProps without additional properties,
 * serving as a distinct type in the PageType discriminated union.
 */
export interface WebPageProps extends PageProps{

}

