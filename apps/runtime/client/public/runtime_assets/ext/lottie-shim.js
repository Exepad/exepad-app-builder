/**
 * Lottie extension shim — double-nested default from esm.sh
 * The actual Lottie component may be at .default.default or .default
 */
import _M from 'https://esm.sh/lottie-react@2?external=react,react-dom';
export * from 'https://esm.sh/lottie-react@2?external=react,react-dom';
const Lottie = _M?.default || _M;
export default Lottie;
export { Lottie };
