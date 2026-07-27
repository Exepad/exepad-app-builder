/**
 * Compile TSX handlers for an example app
 *
 * Reads handler source from repo/backend/handlers/*.tsx
 * and compiles to backend/handlers/*.js
 *
 * Usage:
 *   pnpm compile:backend-crud                    # defaults to backend-crud
 *   APP_ID=backend-demo pnpm compile:backend-crud  # compile a different app
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { compileTsxFile } from '../../../packages/deploy-utils/dist/bundle/methods.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ID = process.env.APP_ID || 'backend-crud';
const APP_DIR = path.join(__dirname, '../client/public/example', APP_ID);
const SOURCE_DIR = path.join(APP_DIR, 'repo/backend/handlers');
const OUTPUT_DIR = path.join(APP_DIR, 'backend/handlers');

async function main() {
  console.log('');
  console.log(`Compiling handlers for ${APP_ID}...`);
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('✗ Source directory not found:', SOURCE_DIR);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const tsxFiles = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.tsx'));

  if (tsxFiles.length === 0) {
    console.log('No .tsx files found in source directory.');
    return;
  }

  console.log(`Found ${tsxFiles.length} handler(s) to compile:`);

  let successCount = 0;
  const errors: string[] = [];

  for (const file of tsxFiles) {
    const sourcePath = path.join(SOURCE_DIR, file);
    const outputFile = file.replace('.tsx', '.js');
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    const result = await compileTsxFile(sourcePath, outputPath);

    if (result.success) {
      console.log(`  ✓ ${file} → ${outputFile}`);
      successCount++;
    } else {
      console.error(`  ✗ ${file}: ${result.error}`);
      errors.push(`${file}: ${result.error}`);
    }
  }

  console.log('');

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} file(s) failed to compile`);
    process.exit(1);
  }

  console.log(`✓ Compiled ${successCount} handler(s) successfully`);
  console.log('');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
