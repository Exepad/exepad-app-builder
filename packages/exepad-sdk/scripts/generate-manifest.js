import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory is in apps/runtime/client/public/runtime_assets/dist
const outputDir = path.resolve(__dirname, '../../../apps/runtime/client/public/runtime_assets/dist');

// Mock window.React and window.ReactDOM for Node.js environment
// The SDK expects these to be available at runtime (in browser they come from Next.js)
globalThis.window = globalThis.window || {};
globalThis.window.React = await import('react');
globalThis.window.ReactDOM = await import('react-dom');

// Import the built artifact from its new location
const SDK = await import(path.join(outputDir, 'exepad-sdk.js'));

// Read the real SDK version from package.json so the manifest can never
// disagree with the published package version / SDK_VERSION helper.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')
);

const manifest = {
  version: pkg.version,
  primitives: [],
  charts: [],
  utilities: [],
  icons: [] // Array for Icon names
};

// 1. Helper to decide if a key is a React Component
const isComponent = (key) => /^[A-Z]/.test(key);

// 2. Scan the SDK exports
Object.keys(SDK).forEach(key => {
  const exportValue = SDK[key];

  if (key === 'Charts') {
    // Extract Chart components (LineChart, BarChart, etc.)
    manifest.charts = Object.keys(exportValue).filter(isComponent);
    
  } else if (key === 'Icons') {
    // Extract all Icon names (Home, User, Plus, etc.)
    // We filter out internal properties if any exist
    manifest.icons = Object.keys(exportValue).filter(isComponent);
    
    // OPTIONAL: Limit to top 200 to save tokens?
    // manifest.icons = manifest.icons.slice(0, 200); 

  } else if (key === 'Motion' || key === 'React' || key === 'ReactDOM') {
    // Skip large internals
    return;
    
  } else if (key === '_') {
    manifest.utilities.push('lodash (as _)');
    
  } else {
    // Everything else is likely a UI Primitive (Button, Card, etc.)
    if (isComponent(key)) {
      manifest.primitives.push(key);
    }
  }
});

// 3. Save the file to the output directory
fs.writeFileSync(path.join(outputDir, 'sdk-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`✅ SDK Manifest generated!`);
console.log(`   - Primitives: ${manifest.primitives.length}`);
console.log(`   - Charts: ${manifest.charts.length}`);
console.log(`   - Icons: ${manifest.icons.length} (Token Impact: High)`);
