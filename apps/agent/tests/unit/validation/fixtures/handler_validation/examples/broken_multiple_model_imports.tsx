import { Order } from "Order";
import { Customer } from "customer";
import { Product } from "products";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function checkoutHandler(ctx: ExepadHandlerCtx, input: Order) {
  return { ok: true };
}
