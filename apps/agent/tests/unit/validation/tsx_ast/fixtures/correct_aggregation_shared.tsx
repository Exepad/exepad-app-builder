import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const employeeCount = await ctx.db.prepare(
    'SELECT COUNT(*) as count FROM employees'
  ).first();

  const departmentCount = await ctx.db.prepare(
    'SELECT COUNT(*) as count FROM departments'
  ).first();

  return {
    employeeCount: employeeCount?.count ?? 0,
    departmentCount: departmentCount?.count ?? 0,
  };
}

export default handler;
