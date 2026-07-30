// Type surface for `@exepad/sdk/core`.
//
// Re-exports the whole barrel by its package specifier so that whatever types
// the barrel `@exepad/sdk` (the in-repo `src/index.ts` via the package exports
// map, OR the agent's flat staged `agent_sdk_gate.d.ts`) automatically
// satisfies this subpath — without re-walking the `@/`-aliased entry source.
// This keeps `moduleResolution: bundler` from emitting TS2307 on
// `import { Button } from "@exepad/sdk/core"`.
//
// Runtime resolution is via the import map (index.html), independent of types.
//
// The narrower per-subpath surface (core excludes Charts/motion/etc.) is NOT
// enforced at the type level here — symbol-origin enforcement is the
// `component_imports.py` AST rule's job (a separate codegen follow-on). The
// per-app TYPED augmentation (`declare module "@exepad/sdk/core"` narrowing
// AppModels/AppHandlerOutputs/AppState/AppRoutes) is the dts_generator.py
// follow-on and is intentionally NOT done here.
export * from '@exepad/sdk';
