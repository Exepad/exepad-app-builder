/**
 * Cytoscape extension shim — the default export is the factory function.
 * Re-export it as both default and named so import * as Cytoscape works.
 */
import cytoscape from 'https://esm.sh/cytoscape@3';
export default cytoscape;
export { cytoscape };
