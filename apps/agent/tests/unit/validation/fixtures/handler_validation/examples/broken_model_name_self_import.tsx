import { Order } from "Order";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function createOrderHandler(ctx: ExepadHandlerCtx, input: Order) {
  return ctx.models.order.create({ data: input });
}
