import { useHandler } from "@exepad/sdk";

export default function SendButton() {
  const send = useHandler("sendInvoice");
  return (
    <button onClick={() => send({ status: "Sent" })}>Send</button>
  );
}
