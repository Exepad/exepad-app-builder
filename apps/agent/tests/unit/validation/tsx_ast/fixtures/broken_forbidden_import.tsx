import axios from "axios";
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  const res = await axios.get("https://api.example.com/data");
  return { data: res.data };
}
