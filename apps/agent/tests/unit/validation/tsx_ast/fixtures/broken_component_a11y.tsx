import { Button, DialogContent, DialogTitle, Icons, LightDOMContainer } from '@exepad/sdk';

export default function A11yProblem() {
  return (
    <LightDOMContainer>
      {/* First heading at h4 and the jump h4 → h2 reversed on a second card. */}
      <h4>Too deep a first heading</h4>
      <h1>Whoops, now h1</h1>
      <h4>And h1 → h4 is a two-level skip</h4>

      {/* Icon-only button with no aria-label / title. */}
      <Button>
        <Icons.Plus />
      </Button>

      {/* DialogContent without a DialogDescription anywhere in the tree. */}
      <DialogContent>
        <DialogTitle>Create</DialogTitle>
      </DialogContent>
    </LightDOMContainer>
  );
}
