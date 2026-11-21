import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Tip } from './overlay';

/*
 * Éléments chiffrés légers (aucune dépendance à Recharts) : anneau, tuile, barres, légende, mini-courbe.
 * Séparés des graphiques pour que le tableau de bord se charge sans embarquer la bibliothèque de courbes.
 */

export const fmt = {
  compact: new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }),
  ar: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MGA', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }),
  int: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
  pct1: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }),
};

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

/* ---------------------------------------------------------------------------------------------
 * Jauge d'utilisation (quota) : valeur en texte + barre fine ; devient ambre près de la limite (et le dit en toutes lettres).
 * ------------------------------------------------------------------------------------------- */
export function Meter({ value, max, label, unit }: { value: number; max: number | null; label: string; unit?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const full = max !== null && value >= max;
  const near = max !== null && !full && value / max >= 0.9;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="text-ink-2">{label}</span>
        <span className="num-col font-medium text-ink">
          {fmt.int.format(value)}
          {max !== null ? ` sur ${fmt.int.format(max)}` : ''}
          {unit ? ` ${unit}` : ''}
          {max === null && <span className="font-normal text-ink-2"> · illimité</span>}
        </span>
      </div>
      {max !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          className="h-2 overflow-hidden rounded-full bg-[var(--chart-track)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-[var(--d-slow)] ease-out"
            style={{ width: `${pct}%`, background: full || near ? 'var(--st-pending)' : 'var(--accent)' }}
          />
        </div>
      )}
      {(full || near) && <p className="text-[13px] text-[var(--st-pending)]">{full ? 'Limite atteinte : passez à une formule supérieure pour en ajouter.' : 'Limite presque atteinte.'}</p>}
    </div>
  );
}
