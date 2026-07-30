import { Heart } from "lucide-react";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function lucideHandler(ctx: ExepadHandlerCtx) {
  return { ok: true, icon: typeof Heart };
}
