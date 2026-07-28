/**
 * Tests for component compilation (Profile B: bundled with external React)
 */

import { describe, it, expect } from 'vitest';
import { compileComponent } from '../src/bundle/components';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('compileComponent', () => {
  const tmpDir = path.join(os.tmpdir(), 'exepad-component-test');

  function setup() {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  }

  function cleanup() {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }

  it('compiles a simple React component to valid ESM', async () => {
    setup();
    try {
      const sourcePath = path.join(tmpDir, 'Hello.tsx');
      const outputPath = path.join(tmpDir, 'Hello.js');

      fs.writeFileSync(
        sourcePath,
        `import React from 'react';
export default function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}
`
      );

      const result = await compileComponent(sourcePath, outputPath);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);

      const output = fs.readFileSync(outputPath, 'utf-8');
      // Valid ESM — should have export
      expect(output).toContain('export');
      // Should NOT bundle React — it's external
      expect(output).not.toContain('createElement =');
    } finally {
      cleanup();
    }
  });

  it('externalizes react imports (not bundled)', async () => {
    setup();
    try {
      const sourcePath = path.join(tmpDir, 'Counter.tsx');
      const outputPath = path.join(tmpDir, 'Counter.js');

      fs.writeFileSync(
        sourcePath,
        `import React, { useState } from 'react';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`
      );

      const result = await compileComponent(sourcePath, outputPath);
      expect(result.success).toBe(true);

      const output = fs.readFileSync(outputPath, 'utf-8');
      // React is external — import preserved, not inlined
      expect(output).toContain('react');
      // useState should reference the external import, not be defined inline
      expect(output).not.toMatch(/function useState/);
    } finally {
      cleanup();
    }
  });

  it('returns errors for invalid TypeScript', async () => {
    setup();
    try {
      const sourcePath = path.join(tmpDir, 'Bad.tsx');
      const outputPath = path.join(tmpDir, 'Bad.js');

      fs.writeFileSync(sourcePath, 'const x: number = ;'); // syntax error

      const result = await compileComponent(sourcePath, outputPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
