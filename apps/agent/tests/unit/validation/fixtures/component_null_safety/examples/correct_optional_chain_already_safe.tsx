export default function FirstName({ names }: { names: string[] | null }) {
  return <h2>{names?.[0]?.toUpperCase()}</h2>;
}
