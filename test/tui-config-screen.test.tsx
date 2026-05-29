import { describe, it, expect } from 'vitest';

import { configPageSize } from '../src/tui/screens/ConfigScreen.js';
import { SECTIONS } from '../src/tui/sections.js';

describe('configPageSize', () => {
  it('fills the sidebar-pinned frame on a short terminal', () => {
    // The frame stretches to the sidebar height regardless of how few rows the
    // body would otherwise show, so the body must claim every inner row or the
    // frame paints blank lines beneath it.
    expect(configPageSize(14)).toBe(SECTIONS.length);
    expect(configPageSize(0)).toBe(SECTIONS.length);
  });

  it('grows row-for-row once the terminal is taller than the sidebar', () => {
    expect(configPageSize(41)).toBe(configPageSize(40) + 1);
    expect(configPageSize(60)).toBeGreaterThan(SECTIONS.length);
  });
});
