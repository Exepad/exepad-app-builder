import { useNavigate } from "@exepad/sdk";

// The path below has no plausible counterpart in page_slugs (only "/"
// and one product page). The fixer must rewrite to the first declared
// page so the link is a redirect to home rather than a 404.
export default function GhostLink() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/sprints")}>Sprints</button>;
}
