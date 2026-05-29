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

  it('keeps the full frame strictly shorter than the terminal so Ink can clear it', () => {
    // The rendered Account frame is the scroll window plus its surrounding
    // chrome. Ink cannot incrementally clear a frame whose height *reaches* the
    // terminal row count — it falls back to a full-screen write that desyncs
    // its line tracker, so the next (shorter) screen paints over a stale copy
    // instead of replacing it. The window must leave at least one spare row.
    //
    // Real chrome around the body: StatusBar 6 + content border 2 + Tabs label
    // row 1 + Tabs marginBottom 1 + scroll footer 1 + app footer 1 = 12. (The
    // Tabs block — its label row *and* its bottom margin — is what Config's
    // identical budget omits, and why only Account hit this.)
    const FRAME_CHROME = 12;
    for (const rows of [20, 24, 30, 50, 80]) {
      expect(accountPageSize(rows) + FRAME_CHROME).toBeLessThan(rows);
    }
  });
});
