// Handlers should not import React, but the LLM occasionally does. The
// auto-fixer rewrites both the default and named forms to @exepad/sdk
// so the import resolves at deploy time even if the handler accidentally
// references React internals.
import React from "react";
import { useState } from "react";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function dummyHandler(ctx: ExepadHandlerCtx) {
  return { ok: true };
}
