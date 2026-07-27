// Self-closing <Button /> with no children but an onClick={handleSearch}
// handler. Fixer derives "Search" from the handler identifier.
import { Button, React } from "@exepad/sdk";

export default function SearchBar() {
  const handleSearch = React.useCallback(() => {}, []);
  return <Button onClick={handleSearch} />;
}
