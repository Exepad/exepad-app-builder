// Reference name "qrstvw" has no close match (>0.8 cutoff) among declared
// identifiers ["saveAllDirty"], so the fixer must leave it untouched.
export default function NoMatch() {
  const saveAllDirty = () => {};
  // qrstvw is undeclared — the AST rule will flag it; this fixer is the
  // wrong layer to repair "no plausible candidate" cases.
  return <button onClick={qrstvw}>Save</button>;
}
