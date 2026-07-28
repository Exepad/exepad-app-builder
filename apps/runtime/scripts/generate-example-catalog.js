#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Parse command line arguments
const args = process.argv.slice(2);
const stripExamples = args.includes("--strip-examples");

// ─── Source directories ──────────────────────────────────────────────────────
// Primary (new) — blocks, logic, backend
const newSourceDir = "public/example/examples_for_agents";
// Legacy — components + full only
const legacySourceDir = "public/example/apps/webapp";
// Output (shared library consumed by agents)
const outputDir = "../../packages/schemas/data/examples";

// ─── Category definitions ────────────────────────────────────────────────────
// Each entry: { source, output, catalogKey, stripMode }
//   stripMode: "block"  → strip header/footer/theme/languages
//              "none"   → copy as-is
//              "full"   → keep everything (full apps)

const newSourceCategories = [
  { source: "frontend/blocks_website", output: "blocks_website", catalogKey: "blocks_website", stripMode: "block" },
  { source: "frontend/blocks_header", output: "blocks_header", catalogKey: "blocks_header", stripMode: "skeleton" },
  { source: "frontend/blocks_footer", output: "blocks_footer", catalogKey: "blocks_footer", stripMode: "skeleton" },
  { source: "frontend/blocks_sidebar", output: "blocks_sidebar", catalogKey: "blocks_sidebar", stripMode: "skeleton" },
  { source: "frontend/blocks_form", output: "blocks_form", catalogKey: "blocks_form", stripMode: "block" },
  { source: "frontend/blocks_blog", output: "blocks_blog", catalogKey: "blocks_blog", stripMode: "block" },
  { source: "frontend/blocks_dataapp", output: "blocks_dataapp", catalogKey: "blocks_dataapp", stripMode: "block" },
  { source: "frontend/blocks_scaffold", output: "blocks_scaffold", catalogKey: "blocks_scaffold", stripMode: "none", nestedKeys: true },
  { source: "frontend/blocks_common", output: "blocks_common", catalogKey: "blocks_common", stripMode: "block" },
  { source: "frontend/logic_common", output: "logic_common", catalogKey: "logic_common", stripMode: "none" },
  { source: "frontend/theme", output: "theme", catalogKey: "theme", stripMode: "none" },
];

const backendCategories = [
  { source: "backend", output: "backend", catalogKey: "backend", stripMode: "none" },
];

const legacyCategories = [
  { source: "components", output: "components", catalogKey: "components", stripMode: "block" },
  { source: "full", output: "full", catalogKey: "full", stripMode: "full" },
];

// All categories in processing order
const allCategories = [
  ...newSourceCategories.map((c) => ({ ...c, baseDir: newSourceDir })),
  ...backendCategories.map((c) => ({ ...c, baseDir: newSourceDir })),
  ...legacyCategories.map((c) => ({ ...c, baseDir: legacySourceDir })),
];

console.log("Generating example catalogs and copying files...");
console.log(`  New source:    ${newSourceDir}`);
console.log(`  Legacy source: ${legacySourceDir}`);
console.log(`  Output:        ${outputDir}`);
console.log(`  Categories:    ${allCategories.map((c) => c.catalogKey).join(", ")}`);
if (stripExamples) {
  console.log("  Strip mode:    ENABLED");
}

// ─── Strip helpers ───────────────────────────────────────────────────────────

/**
 * Strip fields from example JSON based on strip mode.
 *   "block"    → remove header, footer, theme, languages (keep pages/content)
 *   "skeleton" → remove pages, theme (keep header/footer)
 *   "none"     → no stripping (logic, backend)
 *   "full"     → no stripping (full app examples)
 */
function stripExampleFields(jsonData, stripMode) {
  if (!stripExamples) return jsonData;

  const data = JSON.parse(JSON.stringify(jsonData)); // deep clone

  // Strip at both top level and frontend level for WebAppProps compatibility
  const frontend = data.frontend || {};

  switch (stripMode) {
    case "block":
      // Remove header/footer/theme/languages, keep pages
      // Only strip inside frontend — do NOT add root-level properties
      delete data.header;
      delete data.footer;
      delete data.theme;
      delete data.languages;
      if (data.frontend) {
        data.frontend.header = [];
        data.frontend.footer = [];
        data.frontend.theme = {};
        data.frontend.languages = [];
      }
      break;

    case "skeleton":
      // Remove pages/theme, keep header/footer
      delete data.pages;
      delete data.theme;
      if (data.frontend) {
        data.frontend.pages = [];
        data.frontend.theme = {};
      }
      break;

    case "none":
    case "full":
      // No stripping
      break;
  }

  return data;
}

// ─── File operations ─────────────────────────────────────────────────────────

/**
 * Recursively copy directory, optionally stripping fields from JSON files.
 */
function copyDirectoryRecursive(src, dest, stripMode) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath, stripMode);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      if (stripExamples && stripMode !== "none" && stripMode !== "full") {
        try {
          const content = fs.readFileSync(srcPath, "utf8");
          const jsonData = JSON.parse(content);
          const strippedData = stripExampleFields(jsonData, stripMode);
          fs.writeFileSync(destPath, JSON.stringify(strippedData, null, 2), "utf8");
        } catch (error) {
          console.error(`  Error processing ${srcPath}: ${error.message}`);
          fs.copyFileSync(srcPath, destPath);
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

/**
 * Recursively process JSON files and extract summaries for the catalog.
 * @param {string} dir - Current directory being scanned
 * @param {Object} catalogEntries - Accumulated catalog entries
 * @param {string} [baseDir] - Root directory for relative path computation.
 *   When set, the catalog key is the relative path from baseDir (without .json).
 *   When unset, the catalog key is just the filename (without .json).
 */
function processJsonFiles(dir, catalogEntries = {}, baseDir = null) {
  if (!fs.existsSync(dir)) return catalogEntries;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      processJsonFiles(fullPath, catalogEntries, baseDir);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const jsonData = JSON.parse(content);
        const exampleID = baseDir
          ? path.relative(baseDir, fullPath).replace(/\.json$/, "")
          : path.basename(entry.name, ".json");
        const summary =
          jsonData.summary || jsonData.shortSummary || "No description available";
        catalogEntries[exampleID] = summary;
      } catch (error) {
        console.error(`  Error reading ${fullPath}: ${error.message}`);
        const exampleID = baseDir
          ? path.relative(baseDir, fullPath).replace(/\.json$/, "")
          : path.basename(entry.name, ".json");
        catalogEntries[exampleID] = "Error reading file";
      }
    }
  }

  return catalogEntries;
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  // Clean and recreate output directory
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\nCleaned and created: ${outputDir}`);

  const stats = { totalFiles: 0, categoryCounts: {} };
  const masterCatalog = {};

  for (const category of allCategories) {
    const categorySourceDir = path.join(category.baseDir, category.source);
    const categoryOutputDir = path.join(outputDir, category.output);

    if (!fs.existsSync(categorySourceDir)) {
      console.log(`  [SKIP] ${category.catalogKey}: source not found (${categorySourceDir})`);
      continue;
    }

    // Copy files
    copyDirectoryRecursive(categorySourceDir, categoryOutputDir, category.stripMode);

    // Build catalog entries (pass baseDir for nested categories to avoid key collisions)
    const catalog = processJsonFiles(categorySourceDir, {}, category.nestedKeys ? categorySourceDir : null);
    const count = Object.keys(catalog).length;

    if (count === 0) {
      console.log(`  [EMPTY] ${category.catalogKey}: no JSON files found`);
      continue;
    }

    // Write per-category catalog
    const catalogPath = path.join(outputDir, `catalog_${category.catalogKey}.json`);
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

    // Add to master catalog
    masterCatalog[category.catalogKey] = catalog;
    stats.categoryCounts[category.catalogKey] = count;
    stats.totalFiles += count;

    console.log(`  [OK] ${category.catalogKey}: ${count} examples`);
  }

  // Write master catalog
  const masterCatalogPath = path.join(outputDir, "catalog_master.json");
  fs.writeFileSync(masterCatalogPath, JSON.stringify(masterCatalog, null, 2), "utf8");

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Example catalog generation complete!");
  console.log("=".repeat(60));
  console.log(`  Categories: ${Object.keys(stats.categoryCounts).length}`);
  console.log(`  Total examples: ${stats.totalFiles}`);
  console.log("\nBreakdown:");
  for (const [key, count] of Object.entries(stats.categoryCounts)) {
    console.log(`  ${key}: ${count}`);
  }
  console.log(`\nOutput: ${path.relative(process.cwd(), outputDir)}`);
  console.log(`Master catalog: ${path.relative(process.cwd(), masterCatalogPath)}`);

  console.log("\nPer-category catalogs:");
  for (const key of Object.keys(stats.categoryCounts)) {
    const p = path.join(outputDir, `catalog_${key}.json`);
    console.log(`  ${path.relative(process.cwd(), p)}`);
  }
} catch (error) {
  console.error("Error generating example catalogs:", error);
  process.exit(1);
}
