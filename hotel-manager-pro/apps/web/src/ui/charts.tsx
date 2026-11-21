import { ArrowDownRight, ArrowUpRight, ChartLine, Table2 } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Tip } from './overlay';

/*
 * Graphiques — règles du skill dataviz appliquées :
 *  - couleurs de séries validées par script (daltonisme) ; texte toujours en encre, jamais à la couleur de la série ;
 *  - lignes 2 px, aire en lavis à ~10 %, grille et axes en filets discrets ;
 *  - légende dès 2 séries + libellés directs en fin de courbe (jamais un chiffre sur chaque point) ;
 *  - survol : repère + infobulle ; vue tableau toujours disponible (l'infobulle n'est jamais le seul accès à la donnée) ;
 *  - un seul chiffre « héros » par vue ; grands nombres en chiffres proportionnels, colonnes en chiffres tabulaires.
 */

export const fmt = {
  compact: new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }),
  ar: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MGA', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }),
  int: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
  pct1: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }),
};

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
};

/* ---------------------------------------------------------------------------------------------
 * Cadre d'un graphique : titre, résumé (lu par les lecteurs d'écran), bascule graphique / tableau.
 * ------------------------------------------------------------------------------------------- */
export interface TableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ChartFigure({
  title,
  summary,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  summary: string;
  legend?: ReactNode;
  table: TableData;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure aria-labelledby={`${id}-title`} className={cn('surface glass-data m-0 flex flex-col gap-4 p-5 [--surface-radius:var(--r-card)]', className)}>
      <div className="flex items-start justify-between gap-3">
        <figcaption className="flex flex-col gap-0.5">
          <span id={`${id}-title`} className="text-[16px] font-semibold text-ink">
            {title}
          </span>
          <span className="text-[13px] leading-snug text-ink-2">{summary}</span>
        </figcaption>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="-mr-2 shrink-0"
        >
          {asTable ? <ChartLine aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
          {asTable ? 'Graphique' : 'Tableau'}
        </Button>
      </div>
      {!asTable && legend}
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-hairline">
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={cn('px-2 py-2 text-[13px] font-medium text-ink-2', i === 0 ? 'text-left' : 'text-right')}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])} className="border-b border-hairline last:border-0">
                  {row.map((cell, i) => (
                    <td key={i} className={cn('px-2 py-2', i === 0 ? 'text-left text-ink' : 'num-col text-right text-ink')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; value?: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: i.color }} />
          <span>{i.label}</span>
          {i.value && <span className="num-col font-medium text-ink">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Courbe d'évolution : série 1 en aire (lavis 10 %), série 2 en ligne ; infobulle et repère au survol.
 * ------------------------------------------------------------------------------------------- */
export interface TrendPoint {
  label: string;
  current: number;
  previous: number;
}

interface TooltipLikeProps {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string }>;
  label?: string | number;
}

function TrendTooltip({ active, payload, label, names }: TooltipLikeProps & { names: [string, string] }) {
  if (!active || !payload?.length) return null;
  const rows: Array<[string, number, string]> = [
    [names[0], Number(payload.find((p) => p.dataKey === 'current')?.value ?? 0), 'var(--series-1)'],
    [names[1], Number(payload.find((p) => p.dataKey === 'previous')?.value ?? 0), 'var(--series-2)'],
  ];
  return (
    <div className="surface glass-2 flex min-w-40 flex-col gap-1.5 px-3.5 py-2.5 text-[13px] [--surface-radius:14px]">
      <span className="font-medium text-ink">{label}</span>
      {rows.map(([name, value, color]) => (
        <span key={name} className="flex items-center justify-between gap-5 text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
            {name}
          </span>
          <span className="num-col font-medium text-ink">{fmt.ar.format(value)}</span>
        </span>
      ))}
    </div>
  );
}

export function TrendChart({ data, names }: { data: TrendPoint[]; names: [string, string] }) {
  const reduced = usePrefersReducedMotion();
  const last = data.length - 1;
  const endDot = (color: string, name: string) =>
    function EndDot(props: { cx?: number; cy?: number; index?: number }) {
      const { cx = 0, cy = 0, index = 0 } = props;
      if (index !== last) return <g key={index} />;
      return (
        <g key={index}>
          <circle cx={cx} cy={cy} r={6} fill="var(--glass-data)" />
          <circle cx={cx} cy={cy} r={4} fill={color} />
          <text x={cx + 12} y={cy + 4} fill="var(--ink-2)" fontSize={12} fontWeight={500}>
            {name}
          </text>
        </g>
      );
    };
  return (
    <div className="min-h-[15.5rem] w-full flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 44, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
            tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
            tickMargin={10}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, 'auto']}
            tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
            tickFormatter={(v: number) => fmt.compact.format(v)}
          />
          <Tooltip cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }} content={<TrendTooltip names={names} />} />
          <Area
            dataKey="current"
            type="monotone"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            fill="var(--series-1)"
            fillOpacity={0.1}
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={endDot('var(--series-1)', names[0])}
            activeDot={{ r: 5, fill: 'var(--series-1)', stroke: 'var(--glass-data)', strokeWidth: 2 }}
          />
          <Line
            dataKey="previous"
            type="monotone"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeLinecap="round"
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={endDot('var(--series-2)', names[1])}
            activeDot={{ r: 5, fill: 'var(--series-2)', stroke: 'var(--glass-data)', strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Barres horizontales : une seule teinte (catégories nominales), barre fine (≤ 24 px), bout arrondi 4 px,
 * valeur au bout, repère au survol / au focus clavier.
 * ------------------------------------------------------------------------------------------- */
export function BarList({ rows, format = (v: number) => fmt.ar.format(v) }: { rows: Array<{ label: string; value: number }>; format?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((r) => {
        const share = (r.value / total) * 100;
        return (
          <li key={r.label}>
            <Tip label={`${r.label} : ${fmt.pct1.format(share)} % du total`} side="top">
              <div
                tabIndex={0}
                role="group"
                aria-label={`${r.label} : ${format(r.value)}, ${fmt.pct1.format(share)} % du total`}
                className="grid grid-cols-[6.5rem_1fr] items-center gap-3 rounded-lg py-1 outline-offset-4 sm:grid-cols-[8rem_1fr]"
              >
                <span className="truncate text-[13px] text-ink-2">{r.label}</span>
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-3 rounded-r-[4px] bg-series-1 transition-[width] duration-[var(--d-slow)] ease-out"
                    style={{ width: `calc(${(r.value / max) * 100}% - 4.75rem)`, minWidth: 4 }}
                  />
                  <span className="num-col shrink-0 text-[13px] font-medium text-ink">{format(r.value)}</span>
                </span>
              </div>
            </Tip>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Anneau de progression : le remplissage porte la valeur, le rail est un pas plus clair de la même teinte.
 * ------------------------------------------------------------------------------------------- */
export function Ring({ value, label, size = 148, children }: { value: number; label: string; size?: number; children?: ReactNode }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(Math.max(shown, 0), 100) / 100)}
          style={{ transition: 'stroke-dashoffset var(--d-slow) var(--ease-out)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Mini-courbe : la valeur est toujours donnée par le texte voisin ; la courbe n'est qu'une tendance.
 * ------------------------------------------------------------------------------------------- */
export function Sparkline({ values, width = 92, height = 32 }: { values: number[]; width?: number; height?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
    return [x, y] as const;
  });
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible">
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="var(--silver)"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r={5} fill="var(--glass-data)" />
      <circle cx={lx} cy={ly} r={3.5} fill="var(--accent)" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Tuile chiffrée : libellé, valeur, variation signée (couleur = sens × « plus est mieux ? » + icône + texte), tendance.
 * ------------------------------------------------------------------------------------------- */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = true,
  trend,
  className,
}: {
  label: string;
  value: string;
  /** Variation en % (signée) par rapport à `deltaLabel` */
  delta?: number;
  deltaLabel?: string;
  upIsGood?: boolean;
  trend?: number[];
  className?: string;
}) {
  const good = delta === undefined ? true : (delta >= 0) === upIsGood;
  const Icon = delta !== undefined && delta < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <div className={cn('surface glass-1 flex flex-col justify-between gap-4 p-5 [--surface-radius:var(--r-card)]', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[14px] text-ink-2">{label}</span>
          <span className="num-display text-[30px] leading-none font-semibold text-ink">{value}</span>
        </div>
        {trend && <Sparkline values={trend} />}
      </div>
      {delta !== undefined && (
        <span
          className="inline-flex items-center gap-1 text-[13px] font-medium"
          style={{ color: good ? 'var(--st-inhouse)' : 'var(--danger-ink)' }}
        >
          <Icon aria-hidden className="size-4" />
          <span>
            {delta >= 0 ? '+' : '−'}
            {fmt.pct1.format(Math.abs(delta))} %
          </span>
          {deltaLabel && <span className="font-normal text-ink-2">{deltaLabel}</span>}
          <span className="sr-only">{good ? ', évolution favorable' : ', évolution défavorable'}</span>
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Barre segmentée fine : un tout réparti en parts (écart de 2 px entre les parts, extrémités arrondies, sans texte).
 * ------------------------------------------------------------------------------------------- */
export function SegmentedBar({ parts, label }: { parts: Array<{ label: string; value: number; color: string }>; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={`${label} : ${parts.map((p) => `${p.label} ${fmt.pct1.format((p.value / total) * 100)} %`).join(', ')}`} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.label} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: `${fmt.pct1.format((p.value / total) * 100)} %` }))} />
    </div>
  );
}
