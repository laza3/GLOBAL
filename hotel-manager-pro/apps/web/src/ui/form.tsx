import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Checkbox as RCheckbox, Select as RSelect, Switch as RSwitch, ToggleGroup } from 'radix-ui';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/* ---------------------------------------------------------------------------------------------
 * Field : étiquette visible (jamais l'attribut placeholder seul), aide persistante, erreur sous le champ,
 * annoncée aux lecteurs d'écran. Le champ reçoit id / aria-describedby / aria-invalid via le render-prop.
 * ------------------------------------------------------------------------------------------- */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger-ink">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] leading-snug text-danger-ink">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-[13px] leading-snug text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const control =
  'w-full min-h-11 rounded-control border border-field-border bg-field-bg px-3 text-[15px] text-ink ' +
  'placeholder:text-ink-3 transition-[border-color,box-shadow] duration-[var(--d-quick)] ' +
  'hover:border-ink-2 focus-visible:border-accent aria-[invalid=true]:border-danger ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({
  className,
  leading,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }) {
  if (!leading) return <input className={cn(control, className)} {...props} />;
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">
        {leading}
      </span>
      <input className={cn(control, 'pl-10', className)} {...props} />
    </div>
  );
}

/** Mot de passe avec bouton afficher/masquer (nom accessible explicite, état annoncé). */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input className={cn(control, 'pr-12', className)} type={shown ? 'text' : 'password'} {...props} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        className="absolute inset-y-0 right-1 grid w-10 cursor-pointer place-items-center rounded-control text-ink-3 hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden className="size-[18px]" /> : <Eye aria-hidden className="size-[18px]" />}
      </button>
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 py-2.5 leading-relaxed', className)} {...props} />;
}

/* ---------------------------------------------------------------------------------------------
 * Select (Radix) : clavier complet, recherche par frappe, menu vitré.
 * ------------------------------------------------------------------------------------------- */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  ...aria
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
} & Partial<FieldControlProps>) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        className={cn(control, 'inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-3')}
        {...aria}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown aria-hidden className="size-4 text-ink-3" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="surface glass-2 menu-content z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden p-1.5 [--surface-radius:14px]"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex min-h-10 cursor-pointer select-none items-center rounded-[9px] py-2 pr-3 pl-8 text-[14px] text-ink outline-none data-[highlighted]:bg-accent-soft data-[state=checked]:font-medium"
              >
                <RSelect.ItemIndicator className="absolute left-2.5">
                  <Check aria-hidden className="size-4 text-accent-ink" />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Switch, Checkbox, SegmentedControl
 * ------------------------------------------------------------------------------------------- */
export function Switch({ label, description, ...props }: RSwitch.SwitchProps & { label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="flex min-h-6 cursor-pointer flex-col">
        <span className="text-[14px] font-medium text-ink">{label}</span>
        {description && <span className="text-[13px] leading-snug text-ink-3">{description}</span>}
      </label>
      <RSwitch.Root
        id={id}
        className="peer relative h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full bg-field-border transition-colors duration-[var(--d-base)] data-[state=checked]:bg-accent"
        {...props}
      >
        <RSwitch.Thumb className="block size-[22px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-[var(--d-base)] ease-out data-[state=checked]:translate-x-[20px]" />
      </RSwitch.Root>
    </div>
  );
}

export function Checkbox({ label, ...props }: RCheckbox.CheckboxProps & { label: string }) {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center gap-3">
      <RCheckbox.Root
        id={id}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[7px] border border-field-border bg-field-bg transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        {...props}
      >
        <RCheckbox.Indicator>
          <Check aria-hidden strokeWidth={3} className="size-4 text-inverse" />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className="cursor-pointer text-[14px] text-ink">
        {label}
      </label>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
  compactLabels,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  label: string;
  className?: string;
  /** Sur très petit écran, seules les icônes sont affichées (le libellé reste lu par les lecteurs d'écran). */
  compactLabels?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix renvoie '' quand on clique l'élément déjà actif : une sélection reste toujours active
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={label}
      className={cn('inline-flex rounded-[12px] bg-silver-soft p-1', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium text-ink-2 transition-[background-color,color,box-shadow] duration-[var(--d-quick)] hover:text-ink data-[state=on]:bg-[var(--glass-data)] data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]"
        >
          {o.icon}
          <span className={compactLabels ? 'max-sm:sr-only' : undefined}>{o.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
