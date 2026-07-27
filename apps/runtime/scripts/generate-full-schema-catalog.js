#!/usr/bin/env node

// NOTE: This is the single source of truth for `full_catalog.json`.
// `full_schema.json` is owned by the `@exepad/schemas` `generate` script
// (ts-json-schema-generator over WebAppProps) — this script MUST NOT write it.
// All paths are resolved from this script's own location, so it is safe to
// invoke from any working directory.

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> apps/runtime -> apps -> <repo root>
const repoRoot = path.resolve(scriptDir, "../../..");
const runtimeClientDir = path.join(repoRoot, "apps/runtime/client");

// Interface directories (absolute)
const appsInterfacesDir = path.join(runtimeClientDir, "src/app_runtime/interfaces/apps");
const componentsInterfacesDir = path.join(runtimeClientDir, "src/app_runtime/interfaces/components");

// Output paths (absolute)
const outputDir = path.join(repoRoot, "packages/schemas/data/full_schema_model");
const fullCatalogPath = path.join(outputDir, "full_catalog.json");

console.log("🔄 Generating full schema catalog directly from TypeScript interfaces...");
console.log(`📂 Source directories:`);
console.log(`   - Apps: ${appsInterfacesDir}/**/*.ts`);
console.log(`   - Components: ${componentsInterfacesDir}/**/*.ts`);
console.log(`📝 Output Directory: ${outputDir}`);

try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`📁 Created directory: ${outputDir}`);
    }

    // ========== STEP 1: Generate Apps Schema ==========
    console.log("\n📖 Step 1: Generating apps schema from interfaces...");
    const appsCliCommand = `npx ts-json-schema-generator@2.4.0 --path "${appsInterfacesDir}/*.ts" --type "*" --no-type-check --jsDoc extended`;
    console.log(`📋 Running: ${appsCliCommand}`);
    
    const appsSchemaOutput = execSync(appsCliCommand, { encoding: 'utf8' });
    const appsSchema = JSON.parse(appsSchemaOutput);
    
    if (!appsSchema.definitions) {
        throw new Error("No definitions found in apps schema");
    }
    
    console.log(`✅ Generated ${Object.keys(appsSchema.definitions).length} app definitions`);

    // Ensure ComponentProps and SubComponentProps allow additional properties
    if (appsSchema.definitions.ComponentProps) {
        appsSchema.definitions.ComponentProps.additionalProperties = true;
    }
    if (appsSchema.definitions.SubComponentProps) {
        appsSchema.definitions.SubComponentProps.additionalProperties = true;
    }

    // ========== STEP 2: Generate Components Schema ==========
    console.log("\n📖 Step 2: Generating components schema from interfaces...");
    const componentsCliCommand = `npx ts-json-schema-generator@2.4.0 --path "${componentsInterfacesDir}/**/*.ts" --type "*" --no-type-check --jsDoc extended`;
    console.log(`📋 Running: ${componentsCliCommand}`);
    
    const componentsSchemaOutput = execSync(componentsCliCommand, { encoding: 'utf8' });
    const componentsSchema = JSON.parse(componentsSchemaOutput);
    
    if (!componentsSchema.definitions) {
        throw new Error("No definitions found in components schema");
    }

    console.log(`✅ Generated ${Object.keys(componentsSchema.definitions).length} component definitions`);

    // Ensure ComponentProps and SubComponentProps allow additional properties
    if (componentsSchema.definitions.ComponentProps) {
        componentsSchema.definitions.ComponentProps.additionalProperties = true;
    }
    if (componentsSchema.definitions.SubComponentProps) {
        componentsSchema.definitions.SubComponentProps.additionalProperties = true;
    }

    // ========== STEP 3: Process Components and Create Catalog ==========
    console.log("\n📖 Step 3: Processing components and creating catalog...");
    
    // Helper function to get all TypeScript files
    const getAllTsFiles = (dir) => {
        let files = [];
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                files = files.concat(getAllTsFiles(fullPath));
            } else if (item.endsWith('.ts') && item !== 'index.ts') {
                files.push(fullPath);
            }
        }
        return files;
    };
    
    const interfaceFiles = getAllTsFiles(componentsInterfacesDir);
    console.log(`📋 Found ${interfaceFiles.length} component interface files`);

    // Create mapping of interface names to their categories and identify SubComponents
    const interfaceToCategory = new Map();
    const subComponentInterfaces = new Set();
    
    for (const filePath of interfaceFiles) {
        const relativePath = path.relative(componentsInterfacesDir, filePath);
        const category = path.dirname(relativePath).replace(/[\\/]/g, '/');
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract exported interfaces
        const interfaceMatches = content.match(/export\s+interface\s+(\w+)/g);
        const typeMatches = content.match(/export\s+type\s+(\w+)/g);
        
        // Find SubComponents
        const subComponentMatches = content.match(/export\s+interface\s+(\w+)\s+extends\s+SubComponentProps/g);
        if (subComponentMatches) {
            subComponentMatches.forEach(match => {
                const interfaceName = match.replace(/export\s+interface\s+(\w+)\s+extends\s+SubComponentProps.*/, '$1');
                subComponentInterfaces.add(interfaceName);
                console.log(`🔸 Found SubComponent: ${interfaceName}`);
            });
        }
        
        if (interfaceMatches) {
            interfaceMatches.forEach(match => {
                const interfaceName = match.replace(/export\s+interface\s+/, '');
                interfaceToCategory.set(interfaceName, category);
            });
        }
        
        if (typeMatches) {
            typeMatches.forEach(match => {
                const typeName = match.replace(/export\s+type\s+/, '');
                interfaceToCategory.set(typeName, category);
            });
        }
    }

    // Add categories to component definitions
    Object.keys(componentsSchema.definitions).forEach(definitionName => {
        const definition = componentsSchema.definitions[definitionName];
        const category = interfaceToCategory.get(definitionName) || 'utils';
        definition.category = category;
    });

    // Create component catalog (excluding SubComponents)
    const componentsCatalog = [];
    let excludedCount = 0;

    Object.keys(componentsSchema.definitions).forEach(definitionName => {
        const definition = componentsSchema.definitions[definitionName];
        
        if (definition.type === "object" && !subComponentInterfaces.has(definitionName)) {
            const category = interfaceToCategory.get(definitionName) || 'utils';
            const catalogEntry = {
                componentType: definitionName,
                description: definition.description || "No description available",
                keyProperties: [],
                category: category.charAt(0).toUpperCase() + category.slice(1)
            };
            
            // Extract key properties
            if (definition.required && Array.isArray(definition.required)) {
                catalogEntry.keyProperties = definition.required
                    .filter(prop => prop !== "componentType" && prop !== "id")
                    .slice(0, 6);
            }
            
            // Add optional properties if needed
            if (catalogEntry.keyProperties.length < 4 && definition.properties) {
                const optionalProps = Object.keys(definition.properties)
                    .filter(prop =>
                        !catalogEntry.keyProperties.includes(prop) &&
                        prop !== "componentType" &&
                        prop !== "id" &&
                        prop !== "classes"
                    )
                    .slice(0, 4 - catalogEntry.keyProperties.length);
                catalogEntry.keyProperties.push(...optionalProps);
            }
            
            componentsCatalog.push(catalogEntry);
        } else if (subComponentInterfaces.has(definitionName)) {
            excludedCount++;
        }
    });

    console.log(`📋 Generated ${componentsCatalog.length} component catalog entries`);
    console.log(`🚫 Excluded ${excludedCount} SubComponent interfaces from catalog`);

    // ========== STEP 4: Generate Apps Catalog ==========
    console.log("\n🔍 Step 4: Generating apps catalog...");
    const appsCatalog = [];
    
    Object.keys(appsSchema.definitions).forEach(definitionName => {
        const definition = appsSchema.definitions[definitionName];
        
        // Check if this is an app type (ends with AppProps and is an object)
        if (definitionName.endsWith('AppProps') && definition.type === "object" && definitionName !== 'AppProps') {
            const catalogEntry = {
                appType: definitionName,
                description: definition.description || "No description available",
                keyProperties: [],
            };
            
            // Extract key properties
            if (definition.required && Array.isArray(definition.required)) {
                catalogEntry.keyProperties = definition.required
                    .filter(prop => prop !== "appType" && prop !== "uuid")
                    .slice(0, 8);
            }
            
            // Add optional properties if needed
            if (catalogEntry.keyProperties.length < 5 && definition.properties) {
                const optionalProps = Object.keys(definition.properties)
                    .filter(prop =>
                        !catalogEntry.keyProperties.includes(prop) &&
                        prop !== "appType" &&
                        prop !== "uuid" &&
                        prop !== "lastUpdatedEpoch" &&
                        prop !== "signature"
                    )
                    .slice(0, 5 - catalogEntry.keyProperties.length);
                catalogEntry.keyProperties.push(...optionalProps);
            }
            
            appsCatalog.push(catalogEntry);
            console.log(`  ✓ ${definitionName}`);
        }
    });

    // ========== STEP 5: Generate Pages Catalog ==========
    console.log("\n🔍 Step 5: Generating pages catalog...");
    const pagesCatalog = [];
    const pageTypes = ['WebPageProps', 'BlogMainPageProps', 'BlogPostPageProps'];
    
    pageTypes.forEach(definitionName => {
        if (appsSchema.definitions[definitionName]) {
            const definition = appsSchema.definitions[definitionName];
            
            if (definition.type === "object") {
                const catalogEntry = {
                    pageType: definitionName,
                    description: definition.description || "No description available",
                    keyProperties: [],
                };
                
                // Extract key properties
                if (definition.required && Array.isArray(definition.required)) {
                    catalogEntry.keyProperties = definition.required
                        .filter(prop => prop !== "pageType" && prop !== "uuid")
                        .slice(0, 8);
                }
                
                // Add optional properties if needed
                if (catalogEntry.keyProperties.length < 5 && definition.properties) {
                    const optionalProps = Object.keys(definition.properties)
                        .filter(prop =>
                            !catalogEntry.keyProperties.includes(prop) &&
                            prop !== "pageType" &&
                            prop !== "uuid" &&
                            prop !== "lastUpdatedEpoch" &&
                            prop !== "signature"
                        )
                        .slice(0, 5 - catalogEntry.keyProperties.length);
                    catalogEntry.keyProperties.push(...optionalProps);
                }
                
                pagesCatalog.push(catalogEntry);
                console.log(`  ✓ ${definitionName}`);
            }
        }
    });

    // ========== STEP 6: Create Full Catalog ==========
    console.log("\n📋 Step 6: Creating full catalog...");
    const fullCatalog = {
        apps: appsCatalog,
        pages: pagesCatalog,
        components: componentsCatalog
    };

    // ========== STEP 7: Write Output File ==========
    // Only `full_catalog.json` is written here. `full_schema.json` is owned by
    // the `@exepad/schemas` `generate` script and must NOT be clobbered.
    console.log("\n💾 Step 7: Writing catalog output file...");
    fs.writeFileSync(fullCatalogPath, JSON.stringify(fullCatalog, null, 2), "utf8");
    console.log(`✅ Full catalog written to: ${fullCatalogPath}`);

    // ========== Summary ==========
    console.log("\n📊 Generation Summary:");
    console.log(`   Apps in catalog: ${appsCatalog.length}`);
    console.log(`   Pages in catalog: ${pagesCatalog.length}`);
    console.log(`   Components in catalog: ${componentsCatalog.length}`);
    console.log("\n✨ Full catalog generation complete!");

} catch (error) {
    console.error("❌ Error generating full schema catalog:", error);
    process.exit(1);
}

