import { useModel } from "@exepad/sdk";

export default function CountBadge() {
  const { data } = useModel("posts");
  return <span>{data?.length ?? 0} posts</span>;
}
