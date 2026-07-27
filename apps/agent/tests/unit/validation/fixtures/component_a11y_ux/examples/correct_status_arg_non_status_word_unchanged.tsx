// "Confirmed" is title-case but NOT in the status-words catalog, so the
// fixer must leave it untouched.
export default function ConfirmAction({ handleConfirmation }: { handleConfirmation: (s: string) => void }) {
  return <button onClick={() => handleConfirmation("Confirmed")}>Confirm</button>;
}
