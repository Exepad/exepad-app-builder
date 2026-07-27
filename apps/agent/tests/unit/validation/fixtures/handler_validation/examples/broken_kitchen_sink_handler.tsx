import React from "react";
import { Order } from "Order";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function multiBugHandler(ctx: ExepadHandlerCtx, input: Order) {
  return { ok: true, motion: typeof motion, icon: typeof Heart, react: typeof React };
}
