import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function cleanHandler(ctx: ExepadHandlerCtx, input: { id: string }) {
  return { ok: true, id: input.id };
}
