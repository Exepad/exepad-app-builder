import { Icons } from "@/sdk";

export default function IconTypoDemo() {
  return (
    <div className="flex items-center gap-2">
      <Icons.HearttIcon className="h-5 w-5" />
      <span>Favorited</span>
    </div>
  );
}
