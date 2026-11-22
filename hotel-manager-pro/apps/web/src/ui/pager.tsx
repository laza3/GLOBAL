import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { fmt } from './stats';

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total > 0 ? <p className="text-[13px] text-ink-2">{fmt.int.format(total)} résultat{total > 1 ? 's' : ''}</p> : null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-ink-2" role="status">
        Page {page} sur {pages} — {fmt.int.format(total)} résultats
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
