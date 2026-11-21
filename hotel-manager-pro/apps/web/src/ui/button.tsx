import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../lib/cn';

/**
 * Un seul bouton principal par écran (règle de hiérarchie) ; les actions secondaires restent subordonnées.
 * Cibles tactiles : 44 px minimum sur écran tactile (voir .btn dans surfaces.css via @media (pointer: coarse)).
 */
export const buttonVariants = cva(
  'btn relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium ' +
    'transition-[background-color,box-shadow,transform,opacity,color] duration-[var(--d-quick)] ease-out ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-inverse hover:bg-accent-hover ' +
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(20,35,80,0.25),0_8px_18px_-8px_color-mix(in_srgb,var(--accent)_70%,transparent)]',
        secondary:
          'bg-[var(--glass-data)] text-ink shadow-[0_0_0_1px_var(--hairline),0_1px_2px_rgba(20,35,80,0.08)] ' +
          'hover:shadow-[0_0_0_1px_var(--field-border),0_2px_6px_rgba(20,35,80,0.1)]',
        ghost: 'text-ink-2 hover:bg-glass-hover hover:text-ink',
        danger:
          'bg-danger text-inverse hover:bg-danger-hover shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(120,20,15,0.3)]',
      },
      size: {
        sm: 'h-8 rounded-control px-3 text-[13px]',
        md: 'h-10 rounded-control px-4 text-[14px]',
        lg: 'h-12 rounded-[14px] px-6 text-[15px]',
        icon: 'btn-icon h-10 w-10 rounded-control p-0',
        'icon-sm': 'btn-icon h-8 w-8 rounded-[9px] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Pendant une opération asynchrone : bouton inactif + indicateur ; l'état est annoncé aux lecteurs d'écran. */
  loading?: boolean;
  /** React 19 : `ref` est une prop ordinaire, transmise au <button>. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, loading, disabled, children, type = 'button', ...props }: ButtonProps) {
  const iconOnly = size === 'icon' || size === 'icon-sm';
  // Un bouton icône DOIT avoir un nom accessible : on le signale au développement plutôt qu'en production.
  if (import.meta.env.DEV && iconOnly && !props['aria-label'] && !props['aria-labelledby']) {
    console.warn('Button : un bouton icône exige aria-label');
  }
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-[hmp-spin_0.8s_linear_infinite]" />}
      {children}
    </button>
  );
}
