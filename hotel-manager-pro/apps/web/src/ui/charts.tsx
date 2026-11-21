import { ChartLine, Table2 } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Legend, fmt } from './stats';

export { BarList, Legend, Ring, SegmentedBar, Sparkline, StatTile, fmt } from './stats';

/*
 * Graphiques — règles du skill dataviz appliquées :
 *  - couleurs de séries validées par script (daltonisme) ; texte toujours en encre, jamais à la couleur de la série ;
 *  - lignes 2 px, aire en lavis à ~10 %, grille et axes en filets discrets ;
 *  - légende dès 2 séries + libellés directs en fin de courbe (jamais un chiffre sur chaque point) ;
 *  - survol : repère + infobulle ; vue tableau toujours disponible (l'infobulle n'est jamais le seul accès à la donnée) ;
 *  - un seul chiffre « héros » par vue ; grands nombres en chiffres proportionnels, colonnes en chiffres tabulaires.
 */


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
