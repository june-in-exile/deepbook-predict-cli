import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async } from '../components/Async.js';
import { formatTimeToExpiry, formatUtc, oracleStatusLabel, shortId } from '../format.js';
import { findActiveOracles, listOracles, type OracleEntry } from '../../lib/server.js';

const HEADERS = ['oracle', 'asset', 'expiry (UTC)', 'in', 'status'] as const;

/**
 * Fixed rows the list must leave for surrounding chrome so the whole frame fits
 * the terminal — a frame taller than the viewport can't be cleared by Ink and
 * piles up stale copies. StatusBar (6) + content border (2) + list title/header/
 * paging/selected (4) + app footer (1) = 13, plus one spare against resizes.
 */
const CHROME_ROWS = 14;

export const MarketsScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const { ctx, selectedOracleId, setSelectedOracleId, refreshNonce } = useApp();
  const state = useAsync(() => listOracles(ctx), [refreshNonce]);
  return (
    <Async state={state} loadingLabel="loading oracles…">
      {(oracles) => (
        <MarketsList
          oracles={oracles}
          focus={focus}
          onExit={onExit}
          selectedOracleId={selectedOracleId}
          onSelect={setSelectedOracleId}
        />
      )}
    </Async>
  );
};

const MarketsList = ({
  oracles,
  focus,
  onExit,
  selectedOracleId,
  onSelect,
}: {
  oracles: readonly OracleEntry[];
  focus: boolean;
  onExit: () => void;
  selectedOracleId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement => {
  const { stdout } = useStdout();
  const now = Date.now();
  const [desc, setDesc] = useState(true);
  const [activeOnly, setActiveOnly] = useState(false);
  const [index, setIndex] = useState(0);

  const filtered = activeOnly ? findActiveOracles(oracles, { now }) : oracles;
  const sorted = [...filtered].sort((a, b) => (desc ? b.expiry - a.expiry : a.expiry - b.expiry));
  const total = sorted.length;
  const pageSize = Math.max(5, (stdout?.rows ?? 30) - CHROME_ROWS);
  const clampedIndex = Math.min(index, Math.max(0, total - 1));
  const offset = Math.min(Math.max(0, clampedIndex - Math.floor(pageSize / 2)), Math.max(0, total - pageSize));
  const window = sorted.slice(offset, offset + pageSize);

  useInput(
    (input, key) => {
      if (key.escape) return onExit();
      if (key.upArrow || input === 'k') setIndex((i) => Math.max(0, Math.min(i, total - 1) - 1));
      else if (key.downArrow || input === 'j') setIndex((i) => Math.min(total - 1, i + 1));
      else if (input === ' ') setIndex((i) => Math.min(total - 1, i + pageSize));
      else if (input === 'b') setIndex((i) => Math.max(0, i - pageSize));
      else if (input === 'g') setIndex(0);
      else if (input === 'G') setIndex(Math.max(0, total - 1));
      else if (input === 'r') setDesc((d) => !d);
      else if (input === 'a') {
        setActiveOnly((v) => !v);
        setIndex(0);
      } else if (key.return) {
        const picked = sorted[Math.min(clampedIndex, total - 1)];
        if (picked) onSelect(picked.oracle_id);
      }
    },
    { isActive: focus },
  );

  const rows = window.map((o) => [
    shortId(o.oracle_id, 6, 4),
    o.underlying_asset,
    formatUtc(o.expiry),
    formatTimeToExpiry(o.expiry, now),
    oracleStatusLabel(o.status, o.settlement_price),
  ]);
  const widths = HEADERS.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');

  return (
    <Box flexDirection="column">
      <Text>
        {total} {activeOnly ? 'active' : 'total'} oracles · expiry {desc ? '↓' : '↑'}
      </Text>
      <Text dimColor>   {line([...HEADERS])}</Text>
      {window.map((o, i) => {
        const absolute = offset + i;
        const active = absolute === clampedIndex;
        const isSelected = o.oracle_id === selectedOracleId;
        return (
          <Text key={o.oracle_id} {...(active && focus ? { color: 'cyan' as const, bold: true } : {})}>
            {isSelected ? '●' : active ? '▸' : ' '}
            {active ? ' ' : ' '}
            {line(rows[i] ?? [])}
          </Text>
        );
      })}
      <Text dimColor>
        {total === 0 ? 0 : offset + 1}-{Math.min(offset + pageSize, total)} of {total} · ↑/↓ j/k · space/b page · g/G · r reverse · a active · enter select
      </Text>
      {selectedOracleId ? <Text color="green">selected oracle: {shortId(selectedOracleId)} (flows into Preview / Trade)</Text> : null}
    </Box>
  );
};
