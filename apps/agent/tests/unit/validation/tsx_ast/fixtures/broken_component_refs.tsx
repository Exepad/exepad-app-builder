import {
  Button,
  Icons,
  LightDOMContainer,
  navigate,
  setState,
  useHandler,
  useModel,
} from '@exepad/sdk';

export default function UnknownRefs() {
  // useModel('unknownModel') — not in the models catalogue.
  const { data: rows } = useModel('unknownModel');
  // useHandler('missingHandler') — not in the handlers catalogue.
  const { run } = useHandler('missingHandler');

  const clear = () => {
    // setState('unknownKey') — not in logic.state.
    setState('unknownKey', null);
    // navigate('/does-not-exist') — not in page_slugs.
    navigate('/does-not-exist');
  };

  return (
    <LightDOMContainer>
      <section className="bg-surface p-4">
        <Button aria-label="Clear" onClick={clear}>
          <Icons.NotARealIcon />
        </Button>
        <p>{rows?.length ?? 0}</p>
      </section>
    </LightDOMContainer>
  );
}
