import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges Tailwind CSS class names with deduplication. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formats bytes into a human-readable string (B, KB, MB, GB). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Formats a Unix timestamp into a relative time string. */
export function formatRelativeTime(unixSeconds: number): string {
  if (unixSeconds === 0) return 'Never';
  const delta = Math.floor(Date.now() / 1000) - unixSeconds;
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Formats an ISO-8601 date string for display. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Truncates a long public key for display. */
export function truncateKey(key: string, chars = 12): string {
  if (key.length <= chars * 2 + 3) return key;
  return `${key.slice(0, chars)}…${key.slice(-chars)}`;
}
