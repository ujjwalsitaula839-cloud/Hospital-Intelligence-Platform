import type { BedStatus } from '../types';

export interface BedStatusStyle {
  /** Short label shown in badges. */
  label: string;
  /** Badge classes (background, text, border). Light-mode variants come from the index.css overrides. */
  badge: string;
  /** Small status dot colour. */
  dot: string;
}

/**
 * Single source of truth for bed-status colours, shared by the Clinical grid,
 * the Admin bed registry and the notification feed so a status always looks the same.
 */
export const BED_STATUS_STYLES: Record<BedStatus, BedStatusStyle> = {
  AVAILABLE: { label: 'AVAILABLE', badge: 'bg-green-950 text-green-300 border border-green-700', dot: 'bg-green-400' },
  RESERVED: { label: 'RESERVED', badge: 'bg-yellow-950 text-yellow-300 border border-yellow-700', dot: 'bg-yellow-400' },
  OCCUPIED: { label: 'OCCUPIED', badge: 'bg-red-950 text-red-300 border border-red-700', dot: 'bg-red-400' },
  DIRTY: { label: 'DIRTY', badge: 'bg-orange-950 text-orange-300 border border-orange-700', dot: 'bg-orange-400' },
  CLEANING_IN_PROGRESS: { label: 'CLEANING', badge: 'bg-blue-950 text-blue-300 border border-blue-700', dot: 'bg-blue-400' },
  MAINTENANCE: { label: 'MAINTENANCE', badge: 'bg-zinc-800 text-zinc-300 border border-zinc-700', dot: 'bg-zinc-400' },
};

const FALLBACK_STYLE: BedStatusStyle = BED_STATUS_STYLES.MAINTENANCE;

/** Returns the shared style for a bed status; unknown statuses fall back to the neutral style with their own label. */
export function getBedStatusStyle(status: string | null | undefined): BedStatusStyle {
  const key = (status || '').toUpperCase() as BedStatus;
  return BED_STATUS_STYLES[key] ?? { ...FALLBACK_STYLE, label: status || 'UNKNOWN' };
}
