/**
 * Tests for entry-generator — generateEntryModule
 */

import { describe, it, expect } from 'vitest';
import { generateEntryModule } from '../src/bundle/entry-generator';

describe('generateEntryModule', () => {
  it('generates module with 0 handlers', () => {
    const output = generateEntryModule([]);
    expect(output).toContain('globalThis.INJECTED_HANDLERS = {  };');
    expect(output).toContain("export { default } from './template.js';");
    // No import lines
    expect(output).not.toContain('import handler_');
  });

  it('generates module with 1 handler', () => {
    const output = generateEntryModule(['getDashboardStats']);
    // Import
    expect(output).toContain("import handler_0 from './handlers/getDashboardStats.js';");
    // Registry
    expect(output).toContain("'getDashboardStats': handler_0");
    // Re-export
    expect(output).toContain("export { default } from './template.js';");
  });

  it('generates module with N handlers', () => {
    const handlers = ['getDashboardStats', 'processLoan', 'sendEmail'];
    const output = generateEntryModule(handlers);

    // All imports
    expect(output).toContain("import handler_0 from './handlers/getDashboardStats.js';");
    expect(output).toContain("import handler_1 from './handlers/processLoan.js';");
    expect(output).toContain("import handler_2 from './handlers/sendEmail.js';");

    // All registry entries in globalThis
    expect(output).toContain("'getDashboardStats': handler_0");
    expect(output).toContain("'processLoan': handler_1");
    expect(output).toContain("'sendEmail': handler_2");

    // Re-export
    expect(output).toContain("export { default } from './template.js';");
  });

  it('preserves handler ordering', () => {
    const handlers = ['alpha', 'beta', 'gamma'];
    const output = generateEntryModule(handlers);
    const lines = output.split('\n');

    // Imports are in order: handler_0=alpha, handler_1=beta, handler_2=gamma
    expect(lines[0]).toContain('alpha');
    expect(lines[1]).toContain('beta');
    expect(lines[2]).toContain('gamma');
  });
});
