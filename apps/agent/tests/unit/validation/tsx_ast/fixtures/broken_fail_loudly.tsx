import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  throw new Error('handler_plan references undeclared tables: walks, pets, activity_logs. Only walkers table is declared.');
}

export default handler;
