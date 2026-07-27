// Cross-branch: react default+named + animation lib (renamed below) +
// icon lib (renamed below) + missing SDK import + bare useApp
// destructure + wrong export name.
import React from "react";
import { useState } from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { React as _R, useApp } from "@exepad/sdk";

export default function HeaderOriginal() {
  const [open, setOpen] = useState(false);
  const { profile } = useApp();
  const navigate = useNavigation();
  return (
    <motion.header onClick={() => navigate("/home")}>
      <Heart />
      <Button onClick={() => setOpen(!open)}>{profile?.name}</Button>
    </motion.header>
  );
}
