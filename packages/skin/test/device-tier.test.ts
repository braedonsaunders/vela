import { describe, expect, test } from 'bun:test';
import { deviceFacts, liteShadow, renderTier, type DeviceFacts } from '../src/device-tier';

const p720 = { width: 1280, height: 720 };
const p1080 = { width: 1920, height: 1080 };
const p4k = { width: 3840, height: 2160 };

describe('render tier', () => {
  test('the lab tx1-box (H313: 4x A53, 32-bit, 2 GB, low-RAM flag, 720p) renders lite', () => {
    expect(renderTier({ tv: true, totalMemoryMiB: 1990, lowRam: true, littleCoresOnly: true, maxCpuMHz: 1512, is64Bit: false, screenPixels: p720 })).toBe('lite');
  });

  test('Android\'s low-RAM flag decides alone on a TV', () => {
    expect(renderTier({ tv: true, lowRam: true })).toBe('lite');
  });

  test('without the flag, a 2 GB box on efficiency cores that is 32-bit or drives 720p renders lite', () => {
    const box: DeviceFacts = { tv: true, totalMemoryMiB: 1900, littleCoresOnly: true, is64Bit: true, screenPixels: p720 };
    expect(renderTier(box)).toBe('lite');
    expect(renderTier({ ...box, is64Bit: false, screenPixels: p1080 })).toBe('lite');
    // A slow top clock counts as efficiency cores when the core types are unknown.
    expect(renderTier({ ...box, littleCoresOnly: undefined, maxCpuMHz: 1400 })).toBe('lite');
  });

  test('1.5 GB or less is lite whatever the CPU', () => {
    expect(renderTier({ tv: true, totalMemoryMiB: 1450, littleCoresOnly: false, is64Bit: true, screenPixels: p4k })).toBe('lite');
  });

  test('a SHIELD (2 GB, big Cortex-A57 cores, 32-bit userland) and a 64-bit 1080p or 4K stick keep the full render', () => {
    expect(renderTier({ tv: true, totalMemoryMiB: 1950, littleCoresOnly: false, maxCpuMHz: 2014, is64Bit: false, screenPixels: p4k })).toBe('full');
    expect(renderTier({ tv: true, totalMemoryMiB: 1900, littleCoresOnly: true, maxCpuMHz: 1900, is64Bit: true, screenPixels: p1080 })).toBe('full');
    expect(renderTier({ tv: true, totalMemoryMiB: 3800, littleCoresOnly: true, is64Bit: false, screenPixels: p720 })).toBe('full');
  });

  test('phones, tablets and desktops always render in full; unknown facts keep it full', () => {
    expect(renderTier({ tv: false, totalMemoryMiB: 1024, lowRam: true, littleCoresOnly: true, is64Bit: false, screenPixels: p720 })).toBe('full');
    expect(renderTier({ tv: true })).toBe('full');
  });

  test('facts come from the native profile; malformed or missing fields stay unknown', () => {
    expect(deviceFacts(true, { totalMemoryMiB: 1990, lowRam: true, littleCoresOnly: true, maxCpuMHz: 1512, is64Bit: false, sdk: 29 }, p720)).toEqual({
      tv: true, totalMemoryMiB: 1990, lowRam: true, littleCoresOnly: true, maxCpuMHz: 1512, is64Bit: false, screenPixels: p720,
    });
    expect(deviceFacts(true, { totalMemoryMiB: '2048', lowRam: 1 })).toEqual({ tv: true, totalMemoryMiB: undefined, lowRam: undefined,
      littleCoresOnly: undefined, maxCpuMHz: undefined, is64Bit: undefined, screenPixels: undefined });
    expect(renderTier(deviceFacts(true, null))).toBe('full');
  });
});

describe('lite shadows', () => {
  test('a shadow keeps its rings and drops its blurred layers', () => {
    expect(liteShadow('0px 0px 0px 3px $ui.ink, 0px 28px 50px -14px $ui.shadow')).toBe('0px 0px 0px 3px $ui.ink');
    expect(liteShadow('0px 10px 24px -12px $ui.shadow, 0px 0px 0px 1px $ui.glassEdge')).toBe('0px 0px 0px 1px $ui.glassEdge');
    expect(liteShadow('0px 2px 10px rgba(0, 0, 0, 0.45), 0px 0px 0px 1px rgba(0, 0, 0, 0.35)')).toBe('0px 0px 0px 1px rgba(0, 0, 0, 0.35)');
  });

  test('a blurred-only or inset blurred shadow goes; a two-length shadow has no blur and stays', () => {
    expect(liteShadow('0px 8px 24px $ui.shadow')).toBe('');
    expect(liteShadow('inset 0px 0px 12px color-mix(in srgb, $ui.ink 20%, transparent)')).toBe('');
    expect(liteShadow('2px 2px #000')).toBe('2px 2px #000');
  });
});
