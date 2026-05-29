import React from 'react';
import { Box, Text } from 'ink';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Unwrap a Move struct's `{ fields: {...} }` wrapper so nested structs render flat. */
const unwrap = (v: unknown): unknown => {
  if (isPlainObject(v) && isPlainObject((v as { fields?: unknown }).fields)) {
    return (v as { fields: Record<string, unknown> }).fields;
  }
  return v;
};

const isLeaf = (v: unknown): boolean => v === null || v === undefined || typeof v !== 'object';

const leafText = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'bigint') return v.toString();
  return String(v);
};

/**
 * One flattened line of the config tree. `value === null` marks a parent whose
 * children follow on indented lines; otherwise it's a leaf `label: value`.
 */
export type ConfigLine = Readonly<{ depth: number; label: string; value: string | null }>;

/** Recursively flatten one key/value into ordered lines (Move structs unwrapped). */
const flattenNode = (label: string, value: unknown, depth: number): ConfigLine[] => {
  const v = unwrap(value);

  if (isLeaf(v)) return [{ depth, label, value: leafText(v) }];

  if (Array.isArray(v)) {
    if (v.length === 0) return [{ depth, label, value: '[]' }];
    return [
      { depth, label, value: null },
      ...v.flatMap((item, i) => flattenNode(`[${i}]`, item, depth + 1)),
    ];
  }

  return [
    { depth, label, value: null },
    ...Object.entries(v as Record<string, unknown>).flatMap(([k, val]) => flattenNode(k, val, depth + 1)),
  ];
};

/** Flatten a config object into ordered lines for windowed rendering. */
export const flattenConfig = (data: Record<string, unknown>): ConfigLine[] =>
  Object.entries(data).flatMap(([k, v]) => flattenNode(k, v, 0));

/** Render a single flattened config line with depth-based indentation. */
export const ConfigLineView = ({ line }: { line: ConfigLine }): React.ReactElement => (
  <Text>
    {'  '.repeat(line.depth)}
    <Text dimColor>
      {line.label}
      {line.value === null ? ':' : ': '}
    </Text>
    {line.value ?? ''}
  </Text>
);

/** Read-only recursive view of an arbitrary Move config object (renders every line). */
export const ConfigTree = ({ data }: { data: Record<string, unknown> }): React.ReactElement => {
  const lines = flattenConfig(data);
  if (lines.length === 0) return <Text dimColor>(empty)</Text>;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <ConfigLineView key={i} line={line} />
      ))}
    </Box>
  );
};
