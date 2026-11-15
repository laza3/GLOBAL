import { useState } from 'react';
import { FileSpreadsheet, FileText, FileDown } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, PageHeader, Select, useToast } from '../components/ui';
import { system, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateOnly, dateTime, money, monthStartStr, pct, qty, todayStr } from '../lib/format';

export function ReportsPage() {
  const { t } = useT();
  const { can } = useAuth();
  const { push } = useToast();
  const types = (useQ('reports.types').data ?? []) as any[];
  const [type, setType] = useState('sales');
  const [range, setRange] = useState({ from: monthStartStr(), to: todayStr() });
  const { data: rep, error } = useQ('reports.run', { type, ...range }, { enabled: types.some((x) => x.type === type) });
  const exp = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try { const p = await system('exportReport', { query: { type, ...range }, format }); if (p) push('success', `${t('Fichier enregistré')} : ${p}`); } catch (e) { push('error', (e as Error).message); }
  };
  const fmt = (v: any, ty: string) => (v == null ? '' : ty === 'money' ? money(v) : ty === 'qty' ? qty(v) : ty === 'percent' ? pct(v) : ty === 'datetime' ? dateTime(v) : ty === 'date' ? dateOnly(v) : ty === 'int' ? String(v) : String(v));
  const noRange = ['stock', 'customers', 'suppliers', 'receivables', 'payables'].includes(type);
  return (
    <>
      <PageHeader title="Rapports" subtitle="Analyses et exports PDF, Excel et CSV"
        actions={can('report.export') && <><Button onClick={() => exp('pdf')} icon={<FileText className="size-4" />}>PDF</Button><Button onClick={() => exp('xlsx')} icon={<FileSpreadsheet className="size-4" />}>Excel</Button><Button onClick={() => exp('csv')} icon={<FileDown className="size-4" />}>CSV</Button></>} />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Rapport"><Select className="w-72" value={type} onChange={(e) => setType(e.target.value)}>{types.map((x) => <option key={x.type} value={x.type}>{t(x.title)}</option>)}</Select></Field>
        {!noRange && <><Field label="Du"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field><Field label="Au"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></>}
      </Card>
      <Card>
        {error ? <div className="p-6 text-red-600">{error.message}</div> : !rep ? null : (
          <DataTable dense rowKey={(r: any) => JSON.stringify(r)} rows={rep.rows as any[]} empty={<EmptyState title="Aucune donnée pour cette période" />}
            columns={rep.columns.map((c: any) => ({ key: c.key, header: c.label, align: ['money', 'qty', 'percent', 'int'].includes(c.type) ? 'right' as const : undefined, render: (r: any) => fmt(r[c.key], c.type) }))}
            footer={rep.totals && rep.rows.length > 0 ? <tfoot><tr className="border-t-2 border-ink-200 font-semibold dark:border-white/20">{rep.columns.map((c: any, i: number) => <td key={c.key} className={`px-4 py-3 ${['money', 'qty', 'percent', 'int'].includes(c.type) ? 'text-right tabular' : ''}`}>{i === 0 ? 'TOTAL' : rep.totals![c.key] !== undefined ? fmt(rep.totals![c.key], c.type) : ''}</td>)}</tr></tfoot> : undefined} />
        )}
      </Card>
    </>
  );
}
