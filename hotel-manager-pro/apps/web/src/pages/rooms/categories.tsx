import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useCategories, type Category } from '../../api/rooms';
import { useCan } from '../../auth/session';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState } from '../../ui/data';
import { Panel } from '../../ui/page';
import { CategoryModal } from './modals';

export default function CategoriesPage() {
  useDocumentTitle('Catégories de chambres');
  const manage = useCan()('rooms:manage');
  const currency = useCurrency();
  const cats = useCategories();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <>
      <Panel title="Catégories" description="Le tarif de base d'une catégorie s'applique hors saison, sauf tarif propre à une chambre." actions={manage ? <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouvelle catégorie</Button> : undefined}>
        {cats.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les catégories.</p> : (
          <DataTable<Category>
            caption="Catégories de chambres"
            loading={cats.isPending}
            rows={cats.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Catégorie', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.name}</span><span className="num-col text-[13px] text-ink-2">{r.code}</span></span>, sortValue: (r) => r.name },
              { key: 'rate', header: 'Tarif de base', align: 'right', cell: (r) => formatMoney(r.baseRate, currency), sortValue: (r) => r.baseRate },
              { key: 'cnt', header: 'Chambres', align: 'right', cell: (r) => r.roomsCount, sortValue: (r) => r.roomsCount },
              { key: 's', header: 'État', cell: (r) => <Badge tone={r.isActive ? 'accent' : 'neutral'}>{r.isActive ? 'Active' : 'Désactivée'}</Badge> },
              { key: 'a', header: 'Actions', cell: (r) => (manage ? <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier la catégorie ${r.name}`}>Modifier</Button> : null) },
            ]}
            mobileCard={(r) => <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.name}</span><Badge tone={r.isActive ? 'accent' : 'neutral'}>{r.isActive ? 'Active' : 'Désactivée'}</Badge></div><span className="text-[13px] text-ink-2">{formatMoney(r.baseRate, currency)} · {r.roomsCount} chambre{r.roomsCount > 1 ? 's' : ''}</span>{manage && <Button size="sm" variant="secondary" className="self-start" onClick={() => setEditing(r)}>Modifier</Button>}</div>}
            empty={<EmptyState kind="key" title="Aucune catégorie" description="Créez votre première catégorie (Standard, Deluxe, Suite…) avant d'ajouter des chambres." action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Créer une catégorie</Button> : undefined} />}
          />
        )}
      </Panel>
      {editing && <CategoryModal category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
