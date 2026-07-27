import { motion } from "framer-motion";
import { React } from "@exepad/sdk";

export default function FadeIn() {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />;
}
