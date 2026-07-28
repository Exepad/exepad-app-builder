export default function DraftButton({ saveDraft }: { saveDraft: (s: string) => void }) {
  return <button onClick={() => saveDraft("Draft")}>Save as draft</button>;
}
