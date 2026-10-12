import { describe, expect, it } from 'vitest';
import { followPaletteInterval, migrateStoredQuality, normalizeQuality } from './quality';

describe('quality defaults', () => {
  it('min interval follows the palette when not set', () => {
    expect(normalizeQuality({}).minIntervalSec).toBe(5);
    expect(normalizeQuality({ palette: 'bwr' }).minIntervalSec).toBe(25);
    expect(normalizeQuality({ palette: 'bw' }).minIntervalSec).toBe(5);
  });

  it('keeps a customised interval and defaults ghostClearEvery to 10', () => {
    const q = normalizeQuality({ palette: 'bw', minIntervalSec: 60 });
    expect(q.minIntervalSec).toBe(60);
    expect(q.ghostClearEvery).toBe(10);
    expect(normalizeQuality({ ghostClearEvery: 0 }).ghostClearEvery).toBe(0);
    expect(normalizeQuality({ ghostClearEvery: 3.7 }).ghostClearEvery).toBe(3);
  });

  it('drops the legacy 35 s default on load', () => {
    expect(normalizeQuality(migrateStoredQuality({ palette: 'bw', minIntervalSec: 35 })).minIntervalSec).toBe(5);
    expect(migrateStoredQuality({ minIntervalSec: 40 }).minIntervalSec).toBe(40);
  });

  it('algorithm follows the palette: threshold for bw, Floyd-Steinberg for bwr', () => {
    expect(normalizeQuality({}).algorithm).toBe('threshold');
    expect(normalizeQuality({ palette: 'bwr' }).algorithm).toBe('floyd-steinberg');
    expect(normalizeQuality({ palette: 'bw' }).algorithm).toBe('threshold');
    expect(normalizeQuality({ palette: 'bw', algorithm: 'atkinson' }).algorithm).toBe('atkinson');
    expect(normalizeQuality({ palette: 'bw', algorithm: 'floyd-steinberg' }).algorithm).toBe('floyd-steinberg');
  });

  it('stored bw + Floyd-Steinberg (old default) is migrated to follow the palette; other choices are kept', () => {
    expect(normalizeQuality(migrateStoredQuality({ palette: 'bw', algorithm: 'floyd-steinberg' })).algorithm).toBe('threshold');
    expect(normalizeQuality(migrateStoredQuality({ palette: 'bw', algorithm: 'atkinson' })).algorithm).toBe('atkinson');
    // the old 3-colour default is dropped on load so it follows the new black/white + threshold default
    expect(normalizeQuality(migrateStoredQuality({ palette: 'bwr', algorithm: 'floyd-steinberg' }))).toMatchObject({ palette: 'bw', algorithm: 'threshold' });
  });

  it('form: palette change moves the algorithm only while it is the old default', () => {
    const base = normalizeQuality({});
    expect(followPaletteInterval(base, { ...base, palette: 'bw' }).algorithm).toBe('threshold');
    const custom = { ...base, algorithm: 'atkinson' as const };
    expect(followPaletteInterval(custom, { ...custom, palette: 'bw' }).algorithm).toBe('atkinson');
  });

  it('form: palette change moves the interval only while it is the old default', () => {
    const base = normalizeQuality({});
    expect(followPaletteInterval(base, { ...base, palette: 'bw' }).minIntervalSec).toBe(5);
    const custom = { ...base, minIntervalSec: 40 };
    expect(followPaletteInterval(custom, { ...custom, palette: 'bw' }).minIntervalSec).toBe(40);
  });
});
