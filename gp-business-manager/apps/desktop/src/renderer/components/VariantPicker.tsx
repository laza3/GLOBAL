import { useState } from 'react';
import { Input, cx } from './ui';
import { useQ } from '../lib/api';
import { useT } from '../lib/i18n';
import { money, qty } from '../lib/format';

export interface PickedVariant { variantId: string; name: string; sku: string; price: number; stockMilli: number; trackStock: boolean; taxRateBp: number; allowDecimal: boolean }

/** Recherche d'article (nom, SKU, code-barres) avec liste déroulante. */
export function VariantPicker({ onPick, warehouseId, autoFocus, placeholder, className }: { onPick: (v: PickedVariant) => void; warehouseId?: string; autoFocus?: boolean; placeholder?: string; className?: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useQ('sellable.search', { q, warehouseId, limit: 12 }, { enabled: open && q.length > 0, placeholderData: (p) => p });
  return (
    <div className={cx('relative', className)}>
      <Input autoFocus={autoFocus} value={q} placeholder={t(placeholder ?? 'Rechercher un article…')} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && q.length > 0 && !!data?.length && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white p-1 shadow-pop dark:border-white/10 dark:bg-ink-800">
          {data.map((v: any) => (
            <li key={v.variantId}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(v); setQ(''); setOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gold-50 dark:hover:bg-white/10">
              <span className="min-w-0"><span className="block truncate font-medium">{v.name}</span><span className="text-xs text-ink-400">{v.sku}</span></span>
              <span className="shrink-0 text-right text-xs tabular text-ink-500">{money(v.price)}<br />{v.trackStock ? `${t('Stock')} ${qty(v.stockMilli)}` : ''}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
