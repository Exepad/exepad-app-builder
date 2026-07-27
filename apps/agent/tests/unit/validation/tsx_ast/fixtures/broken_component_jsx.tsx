import { Dialog, LightDOMContainer, ShadowContainer } from '@exepad/sdk';

export default function JsxProblem() {
  const items = [{ id: 1 }, { id: 2 }];

  return (
    <ShadowContainer>
      <Dialog>
        {/* ``<DialogContent>`` is an SDK export referenced in JSX but not
            imported — the SdkImportCompletenessRule should flag it. */}
        <DialogContent>
          <p>Modal body</p>
        </DialogContent>
      </Dialog>

      {/* Raw ``<img>`` with empty src — RawImgTagRule should warn. */}
      <img alt="missing src" />

      {/* Static src inside ``.map()`` — StaticSrcInMapRule should error. */}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <img src="https://storage.googleapis.com/same.jpg" alt="same" />
          </li>
        ))}
      </ul>
    </ShadowContainer>
  );
}
