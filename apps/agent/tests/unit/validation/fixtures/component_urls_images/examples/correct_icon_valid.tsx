import { Icons } from "@/sdk";

export default function ValidIconDemo() {
  return (
    <div className="flex items-center gap-2">
      <Icons.Heart className="h-5 w-5" />
      <span>Favorited</span>
    </div>
  );
}
