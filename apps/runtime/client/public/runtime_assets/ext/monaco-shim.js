/**
 * Monaco Editor extension shim — Editor component may be in default or named
 */
import _M from 'https://esm.sh/monaco-editor@0.52?external=react,react-dom';
export * from 'https://esm.sh/monaco-editor@0.52?external=react,react-dom';
const Editor = _M?.Editor || _M;
export default _M;
export { Editor };
