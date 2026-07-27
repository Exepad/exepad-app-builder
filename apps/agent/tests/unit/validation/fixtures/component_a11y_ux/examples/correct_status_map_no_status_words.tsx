const ROUTE_PATHS = {
  Home: "/",
  About: "/about",
  Contact: "/contact",
};

export default function NavBar() {
  return <nav>{Object.values(ROUTE_PATHS).join(" | ")}</nav>;
}
