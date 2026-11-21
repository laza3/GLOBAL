import { Command } from 'cmdk';
import { X } from 'lucide-react';
import { Dialog as RDialog, DropdownMenu as RDropdown, Tooltip as RTooltip } from 'radix-ui';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Toaster as Sonner } from 'sonner';
import { cn } from '../lib/cn';
import { Button } from './button';

/**
 * Focus des fenêtres pilotées par un état : Radix ne restitue le focus qu'à un <Trigger> ; ici on mémorise l'élément
 * actif à l'ouverture et on le restitue à la fermeture. `initialFocus` désigne l'élément à focaliser en premier
 * (pour une confirmation : le choix sûr, jamais l'action destructive).
 */
function useFocusReturn(initialFocus?: RefObject<HTMLElement | null>) {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (initialFocus?.current) {
        e.preventDefault();
        initialFocus.current.focus();
      }
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      returnTo.current?.focus();
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * Modal : le flou signale la mise à l'arrière-plan (jamais décoratif). Échappatoire toujours visible
 * (bouton fermer + Échap), focus piégé et restitué par Radix. Sur mobile : feuille basculante.
 * ------------------------------------------------------------------------------------------- */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width,
  initialFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const focus = useFocusReturn(initialFocusRef);
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay-scrim fixed inset-0 z-40 bg-[var(--scrim)]" />
        <RDialog.Content
          {...focus}
          className="surface glass-3 modal-content z-50 flex flex-col gap-5 p-6 outline-none"
          style={width ? ({ '--modal-width': width } as React.CSSProperties) : undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <RDialog.Title className="text-[19px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="text-[14px] leading-snug text-ink-2">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Fermer" className="-mt-1 -mr-2">
                <X aria-hidden className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          {children}
          {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Confirmation d'une action sensible : verbe explicite sur le bouton, rouge réservé au destructif, annulation par défaut. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      initialFocusRef={keepRef}
      footer={
        <>
          <Button ref={keepRef} variant="secondary" onClick={() => onOpenChange(false)}>
            Garder
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/** Panneau latéral (bureau) / feuille basculante (mobile) pour les fiches détaillées. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const focus = useFocusReturn();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay-scrim fixed inset-0 z-40 bg-[var(--scrim)]" />
        <RDialog.Content {...focus} className="surface glass-3 drawer-content z-50 flex flex-col gap-5 p-6 outline-none">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <RDialog.Title className="text-[19px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</RDialog.Title>
              <RDialog.Description className={cn('text-[14px] leading-snug text-ink-2', !description && 'sr-only')}>
                {description ?? title}
              </RDialog.Description>
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Fermer" className="-mt-1 -mr-2">
                <X aria-hidden className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Menu déroulant
 * ------------------------------------------------------------------------------------------- */
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Séparateur AVANT cet élément : les actions dangereuses sont toujours isolées visuellement. */
  separated?: boolean;
}

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' | 'center' }) {
  return (
    <RDropdown.Root>
      <RDropdown.Trigger asChild>{trigger}</RDropdown.Trigger>
      <RDropdown.Portal>
        <RDropdown.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="surface glass-2 menu-content z-50 min-w-52 p-1.5 [--surface-radius:16px]"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <RDropdown.Separator className="mx-2 my-1.5 h-px bg-hairline" />}
              <RDropdown.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2 text-[14px] outline-none select-none',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                  item.destructive
                    ? 'text-danger-ink data-[highlighted]:bg-[var(--st-cancelled-soft)]'
                    : 'text-ink data-[highlighted]:bg-accent-soft',
                )}
              >
                {item.icon && <span aria-hidden className="grid size-4 place-items-center text-ink-2 [&_svg]:size-4">{item.icon}</span>}
                {item.label}
              </RDropdown.Item>
            </div>
          ))}
        </RDropdown.Content>
      </RDropdown.Portal>
    </RDropdown.Root>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Infobulle : complément, jamais le seul moyen d'accéder à une information.
 * ------------------------------------------------------------------------------------------- */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={250} skipDelayDuration={400}>{children}</RTooltip.Provider>;
}

export function Tip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={8}
          className="surface glass-2 menu-content z-[60] px-3 py-1.5 text-[13px] font-medium text-ink [--surface-radius:10px]"
        >
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Notifications toast (sonner) : annoncées en aria-live « polite », ne volent pas le focus,
 * disparaissent seules (4,5 s) ; les actions annulables proposent « Annuler ».
 * ------------------------------------------------------------------------------------------- */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      offset={{ bottom: 16, right: 16 }}
      mobileOffset={{ bottom: 88, left: 12, right: 12 }}
      duration={4500}
      visibleToasts={3}
      gap={10}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'surface glass-2 flex w-[min(calc(100vw-1.5rem),22rem)] items-start gap-3 p-4 text-ink [--surface-radius:16px]',
          title: 'text-[14px] font-medium leading-snug text-ink',
          description: 'mt-0.5 text-[13px] leading-snug text-ink-2',
          icon: 'mt-0.5 shrink-0',
          actionButton:
            'ml-auto shrink-0 cursor-pointer rounded-[9px] px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:bg-accent-soft',
          closeButton: 'cursor-pointer',
        },
      }}
    />
  );
}

/* ---------------------------------------------------------------------------------------------
 * Palette de commandes : ⌘K / Ctrl+K (ou « / » hors champ de saisie). Navigation et actions au clavier.
 * ------------------------------------------------------------------------------------------- */
export interface CommandEntry {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
}

export function useCommandShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}

export function CommandPalette({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: CommandEntry[];
}) {
  const groups = [...new Set(entries.map((e) => e.group))];
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Palette de commandes"
      loop
      overlayClassName="overlay-scrim fixed inset-0 z-40 bg-[var(--scrim)]"
      contentClassName="surface glass-3 fixed left-1/2 top-[14vh] z-50 w-[min(94vw,36rem)] -translate-x-1/2 overflow-hidden outline-none [--surface-radius:22px] max-sm:top-[8vh]"
    >
      <div className="flex items-center gap-3 border-b border-hairline px-4">
        <Command.Input
          autoFocus
          placeholder="Rechercher une section, une action…"
          className="h-14 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="hidden rounded-md border border-hairline px-1.5 py-0.5 text-[12px] text-ink-3 sm:block">Échap</kbd>
      </div>
      <Command.List className="max-h-[min(55dvh,26rem)] overflow-auto p-2">
        <Command.Empty className="px-4 py-10 text-center text-[14px] text-ink-2">Aucun résultat. Essayez un autre mot.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3"
          >
            {entries
              .filter((e) => e.group === group)
              .map((e) => (
                <Command.Item
                  key={e.id}
                  value={`${e.label} ${e.keywords?.join(' ') ?? ''}`}
                  onSelect={() => {
                    onOpenChange(false);
                    // Laisse la palette se refermer avant l'action (restitution du focus)
                    setTimeout(e.onSelect, 0);
                  }}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 text-[14px] text-ink data-[selected=true]:bg-accent-soft"
                >
                  {e.icon && <span aria-hidden className="grid size-5 place-items-center text-ink-2 [&_svg]:size-[18px]">{e.icon}</span>}
                  <span className="flex-1">{e.label}</span>
                  {e.hint && <span className="text-[13px] text-ink-3">{e.hint}</span>}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
