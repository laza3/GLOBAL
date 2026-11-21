import { Tabs as RTabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Onglets : flèches gauche/droite, Début/Fin, activation automatique (Radix). */
export function Tabs({
  tabs,
  defaultValue,
  label,
}: {
  tabs: Array<{ value: string; label: string; content: ReactNode }>;
  defaultValue?: string;
  label: string;
}) {
  return (
    <RTabs.Root defaultValue={defaultValue ?? tabs[0]?.value} className="flex flex-col gap-4">
      <RTabs.List aria-label={label} className="flex gap-1 overflow-x-auto border-b border-hairline">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'relative min-h-11 cursor-pointer px-4 text-[14px] font-medium whitespace-nowrap text-ink-2 transition-colors hover:text-ink',
              'data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent',
            )}
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="outline-offset-4">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
