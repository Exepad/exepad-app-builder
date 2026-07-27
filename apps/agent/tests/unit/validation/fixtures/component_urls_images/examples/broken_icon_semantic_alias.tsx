import { React, Icons } from "@exepad/sdk";

function Toolbar() {
  return (
    <div className="flex gap-2">
      <Icons.Tool className="h-5 w-5" />
      <Icons.Email className="h-5 w-5" />
      <Icons.Photo className="h-5 w-5" />
    </div>
  );
}

export default Toolbar;
