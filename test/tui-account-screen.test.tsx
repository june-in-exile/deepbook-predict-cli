import { describe, it, expect } from 'vitest';

import { accountPageSize } from '../src/tui/screens/AccountScreen.js';
import { SECTIONS } from '../src/tui/sections.js';

describe('accountPageSize', () => {
  it('fills the sidebar-pinned frame on a short terminal', () => {
    // The content frame stretches to the sidebar height regardless of how few
    // rows the body would otherwise show, so the body must claim every inner
    // row or the frame paints blank lines beneath it.
    expect(accountPageSize(14)).toBe(SECTIONS.length);
    expect(accountPageSize(0)).toBe(SECTIONS.length);
  });

  it('grows row-for-row once the terminal is taller than the sidebar', () => {
    expect(accountPageSize(41)).toBe(accountPageSize(40) + 1);
    expect(accountPageSize(60)).toBeGreaterThan(SECTIONS.length);
  });
});
