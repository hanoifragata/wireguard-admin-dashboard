import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils.js';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-zinc-700 bg-zinc-900',
        'px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50 resize-y',
        'transition-colors',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
