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

const indent = (depth: number): string => '  '.repeat(depth);

/** One key/value node — recurses into Move structs, arrays, and plain objects. */
const Node = ({ label, value, depth }: { label: string; value: unknown; depth: number }): React.ReactElement => {
  const v = unwrap(value);

  if (isLeaf(v)) {
    return (
      <Text>
        {indent(depth)}
        <Text dimColor>{label}: </Text>
        {leafText(v)}
      </Text>
    );
  }

  if (Array.isArray(v)) {
    if (v.length === 0) {
      return (
        <Text>
          {indent(depth)}
          <Text dimColor>{label}: </Text>[]
        </Text>
      );
    }
    return (
      <Box flexDirection="column">
        <Text>
          {indent(depth)}
          <Text dimColor>{label}:</Text>
        </Text>
        {v.map((item, i) => (
          <Node key={i} label={`[${i}]`} value={item} depth={depth + 1} />
        ))}
      </Box>
    );
  }

  const entries = Object.entries(v as Record<string, unknown>);
  return (
    <Box flexDirection="column">
      <Text>
        {indent(depth)}
        <Text dimColor>{label}:</Text>
      </Text>
      {entries.map(([k, val]) => (
        <Node key={k} label={k} value={val} depth={depth + 1} />
      ))}
    </Box>
  );
};

/** Read-only recursive view of an arbitrary Move config object. */
export const ConfigTree = ({ data }: { data: Record<string, unknown> }): React.ReactElement => {
  const entries = Object.entries(data);
  if (entries.length === 0) return <Text dimColor>(empty)</Text>;
  return (
    <Box flexDirection="column">
      {entries.map(([k, v]) => (
        <Node key={k} label={k} value={v} depth={0} />
      ))}
    </Box>
  );
};
