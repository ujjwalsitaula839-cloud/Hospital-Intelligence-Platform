import { describe, it, expect } from 'vitest';
import { BED_STATUS_STYLES, getBedStatusStyle } from '../lib/bedStatus';

describe('Shared bed-status colour map', () => {
  it('defines a distinct badge colour for every bed status', () => {
    const badges = Object.values(BED_STATUS_STYLES).map((style) => style.badge);
    expect(new Set(badges).size).toBe(badges.length);
  });

  it('uses red for OCCUPIED and yellow for RESERVED (same on every screen)', () => {
    expect(getBedStatusStyle('OCCUPIED').badge).toContain('red');
    expect(getBedStatusStyle('RESERVED').badge).toContain('yellow');
    expect(getBedStatusStyle('CLEANING_IN_PROGRESS').label).toBe('CLEANING');
  });

  it('falls back to the neutral style for an unknown status but keeps its label', () => {
    const style = getBedStatusStyle('QUARANTINE');
    expect(style.badge).toBe(BED_STATUS_STYLES.MAINTENANCE.badge);
    expect(style.label).toBe('QUARANTINE');
  });
});
