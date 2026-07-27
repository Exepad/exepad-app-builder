/**
 * Compile TSX methods for backend-demo example app
 * 
 * Usage: pnpm compile:backend-demo
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

// Import directly from the built dist folder
import { compileAppMethods } from '../../../packages/deploy-utils/dist/bundle/methods.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_DIR = path.join(__dirname, '../client/public/example/backend-demo');

async function main() {
  console.log('');
  console.log('Compiling methods for backend-demo...');
  console.log(`App directory: ${APP_DIR}`);
  console.log('');

  const result = await compileAppMethods(APP_DIR, {
    backend: ['backend/handlers'],
    frontend: [],
  });

  console.log('');

  if (result.success) {
    console.log(`✓ Compiled ${result.compiled.length} file(s) successfully:`);
    result.compiled.forEach((file) => console.log(`    ${file}`));
  } else {
    console.error('✗ Compilation failed with errors:');
    for (const [file, errs] of Object.entries(result.errors)) {
      console.error(`  ${file}:`);
      errs.forEach((e) => console.error(`    - ${e}`));
    }
    process.exit(1);
  }

  console.log('');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
