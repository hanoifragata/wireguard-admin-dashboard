import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils.js';

type Variant = 'default' | 'success' | 'destructive' | 'warning' | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-zinc-700 text-zinc-100',
  success: 'bg-green-900/60 text-green-400 border border-green-800',
  destructive: 'bg-red-900/60 text-red-400 border border-red-800',
  warning: 'bg-yellow-900/60 text-yellow-400 border border-yellow-800',
  outline: 'border border-zinc-700 text-zinc-300',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
