import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

import type { ScreenProps } from '../App.js';
import { SECTIONS } from '../sections.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async } from '../components/Async.js';
import { ConfigLineView, flattenConfig, type ConfigLine } from '../components/ConfigTree.js';
import { getPredict, type PredictState } from '../../lib/predict.js';

const BLOCKS: ReadonlyArray<{ title: string; pick: (p: PredictState) => Record<string, unknown> }> = [
  { title: 'risk', pick: (p) => p.riskConfig },
  { title: 'pricing', pick: (p) => p.pricingConfig },
  { title: 'treasury', pick: (p) => p.treasuryConfig },
  { title: 'oracle', pick: (p) => p.oracleConfig },
];

type ScreenLine =
  | Readonly<{ kind: 'title'; text: string }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'line'; line: ConfigLine }>;

const buildLines = (p: PredictState): ScreenLine[] =>
  BLOCKS.flatMap(({ title, pick }) => {
    const lines = flattenConfig(pick(p));
    const head: ScreenLine = { kind: 'title', text: title };
    if (lines.length === 0) return [head, { kind: 'empty' } as ScreenLine];
    return [head, ...lines.map((line): ScreenLine => ({ kind: 'line', line }))];
  });

/**
 * Fixed rows around the scrolling body so the frame fits the terminal — a frame
 * taller than the viewport can't be cleared by Ink and piles up stale copies.
 * StatusBar (6) + content border (2) + scroll footer (1) + app footer (1) = 10,
 * plus one spare against resizes.
 */
const CHROME_ROWS = 11;

/**
 * The content frame is a flex sibling of the sidebar, so it always stretches to
 * the sidebar's height. The sidebar is `SECTIONS.length` rows plus a "sections"
 * header inside its border; the content frame swaps that border for its own,
 * leaving `SECTIONS.length + 1` inner rows — one of which is our paging footer.
 * If the body shows fewer than `SECTIONS.length` rows the frame paints blank
 * lines beneath it, so that count is the floor. On a taller terminal
 * `rows - CHROME_ROWS` wins and the frame grows past the sidebar instead.
 */
export const configPageSize = (rows: number): number =>
  Math.max(SECTIONS.length, rows - CHROME_ROWS);

/** Read-only, scrollable view of the on-chain Predict config (risk / pricing / treasury / oracle). */
export const ConfigScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const { ctx, refreshNonce } = useApp();
  const state = useAsync(() => getPredict(ctx), [refreshNonce]);
  return (
    <Async state={state} loadingLabel="loading config…">
      {(p) => <ConfigBody lines={buildLines(p)} focus={focus} onExit={onExit} />}
    </Async>
  );
};

const ConfigBody = ({
  lines,
  focus,
  onExit,
}: {
  lines: readonly ScreenLine[];
  focus: boolean;
  onExit: () => void;
}): React.ReactElement => {
  const { stdout } = useStdout();
  const [offset, setOffset] = useState(0);

  const total = lines.length;
  const pageSize = configPageSize(stdout?.rows ?? 30);
  const maxOffset = Math.max(0, total - pageSize);
  const clamped = Math.min(offset, maxOffset);
  const window = lines.slice(clamped, clamped + pageSize);

  useInput(
    (input, key) => {
      if (key.escape) return onExit();
      if (key.upArrow || input === 'k') setOffset((o) => Math.max(0, o - 1));
      else if (key.downArrow || input === 'j') setOffset((o) => Math.min(maxOffset, o + 1));
      else if (input === ' ') setOffset((o) => Math.min(maxOffset, o + pageSize));
      else if (input === 'b') setOffset((o) => Math.max(0, o - pageSize));
      else if (input === 'g') setOffset(0);
      else if (input === 'G') setOffset(maxOffset);
    },
    { isActive: focus },
  );

  return (
    <Box flexDirection="column">
      {window.map((l, i) =>
        l.kind === 'title' ? (
          <Text key={i} bold>
            {l.text}
          </Text>
        ) : l.kind === 'empty' ? (
          <Text key={i} dimColor>
            {'  '}(empty)
          </Text>
        ) : (
          <ConfigLineView key={i} line={l.line} />
        ),
      )}
      <Text dimColor>
        {total === 0 ? 0 : clamped + 1}-{Math.min(clamped + pageSize, total)} of {total} · ↑/↓ j/k · space/b page · g/G
      </Text>
    </Box>
  );
};
