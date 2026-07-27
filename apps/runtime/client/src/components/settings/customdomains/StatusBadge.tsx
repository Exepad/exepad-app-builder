/** A domain's lifecycle status as a small colored badge (active/verifying/pending/error). */
import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    active: { variant: 'default', label: '● Active' },
    verifying: { variant: 'secondary', label: '◐ Verifying' },
    pending: { variant: 'secondary', label: '◐ Pending' },
    error: { variant: 'destructive', label: '✕ Error' },
  };
  const s = map[status] ?? { variant: 'outline' as const, label: status };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
