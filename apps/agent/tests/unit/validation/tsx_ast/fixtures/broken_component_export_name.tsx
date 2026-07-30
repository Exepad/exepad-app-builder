import { LightDOMContainer } from '@exepad/sdk';

export default function MismatchedExport() {
  return (
    <LightDOMContainer>
      <p>The save tool asked for "ExpectedName" but this file exports "MismatchedExport".</p>
    </LightDOMContainer>
  );
}
