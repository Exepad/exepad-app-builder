import lodash from "lodash";

async function handler() {
  document.title = "broken";
  const data = eval('1+1');
  const q = "SELECT * FROM mystery_table";
  const result = ctx.db.prepare(q).all();
  localStorage.setItem("cache", JSON.stringify(result));
  return { data };
}
