import { motion } from "framer-motion";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function motionHandler(ctx: ExepadHandlerCtx) {
  return { ok: true, motion: typeof motion };
}
