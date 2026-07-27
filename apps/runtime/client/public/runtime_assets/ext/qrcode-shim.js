/**
 * QR Code extension shim — QRCodeCanvas may be default or named export
 */
import _M from 'https://esm.sh/qrcode.react@4?external=react,react-dom';
export * from 'https://esm.sh/qrcode.react@4?external=react,react-dom';
const QRCodeCanvas = _M?.QRCodeCanvas || _M;
const QRCodeSVG = _M?.QRCodeSVG || null;
export default _M;
export { QRCodeCanvas, QRCodeSVG };
