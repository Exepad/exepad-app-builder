import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  document.title = "Dashboard";
  const el = document.getElementById("app");

  const data = localStorage.getItem("cache");
  console.log("fetched cache:", data);

  setTimeout(() => {
    window.location.href = "/done";
  }, 1000);

  return { ok: true };
}
