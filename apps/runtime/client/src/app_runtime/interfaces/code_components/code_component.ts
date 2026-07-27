import { ComponentProps } from "../components/common/core";

export interface CodeComponentSourceProps {
    /** * The absolute URL to the source code.
     * @example "https://cdn.exepad.com/slots/v1/hero_section.tsx"
     */
    source_code_url: string;

    /** * Integrity hash.
     * @example "sha256:1234567890"
     */
    source_code_hash: string;
}

/**
* Code component props
* Now strictly structural. Content is "baked in" to the compiled module.
*
* Can be used in two ways:
* 1. Direct URL: { compiled_module_url: "https://..." }
* 2. Repo reference: { component: "StatsWidget" } - resolves from repo.components
*/
export interface CodeComponentProps extends ComponentProps {
    /** * The absolute URL to the compiled ES module (for external components).
     * @example "https://cdn.exepad.com/slots/v1/hero_section.js"
     */
    compiled_module_url?: string;

    /** * Reference to a component in repo.frontend.components.
     * When provided, the URL is resolved from the app's repo.frontend.components configuration.
     * @example "StatsWidget"
     */
    component?: string;

    /** * Source code details (Optional).
     * Used only for debugging or "Click to Edit" features in the platform.
     */
    code_component_source?: CodeComponentSourceProps;

    /** * Extensions required by this component (e.g., ["d3", "dnd-kit"]).
     * Auto-detected from @exepad/ext-* imports during generation.
     * The runtime loads these into the import map before the component mounts.
     */
    extensions?: string[];

    /** * CLS guard: a reserved minimum height for this component's slot, held
     * during async load and as a floor once mounted, so the skeleton→content
     * swap does not shift siblings below it. Stamped by the agent at codegen
     * for above-the-fold/large sections. Accepts a CSS length (e.g. "60svh",
     * "640px") or a number (interpreted as px). Omitted ⇒ no reservation
     * (existing apps render exactly as before).
     */
    reserved_min_height?: string | number;
}
