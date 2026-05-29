import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type SelectItem<T> = Readonly<{ label: string; value: T; hint?: string }>;

export type SelectProps<T> = Readonly<{
  items: ReadonlyArray<SelectItem<T>>;
  onSelect: (value: T, index: number) => void;
  focus: boolean;
  onHighlightChange?: (value: T, index: number) => void;
  initialIndex?: number;
}>;

/**
 * Vertical keyboard list. ↑/↓ or j/k move the highlight; Enter selects.
 * Highlight state is internal; parent reacts via onSelect / onHighlightChange.
 */
export const Select = <T,>({
  items,
  onSelect,
  focus,
  onHighlightChange,
  initialIndex = 0,
}: SelectProps<T>): React.ReactElement => {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)));

  const move = (next: number): void => {
    if (items.length === 0) return;
    const clamped = (next + items.length) % items.length;
    setIndex(clamped);
    const item = items[clamped];
    if (item && onHighlightChange) onHighlightChange(item.value, clamped);
  };

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') move(index - 1);
      else if (key.downArrow || input === 'j') move(index + 1);
      else if (key.return) {
        const item = items[index];
        if (item) onSelect(item.value, index);
      }
    },
    { isActive: focus },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const active = i === index;
        return (
          <Text key={i} bold={active} {...(active && focus ? { color: 'cyan' as const } : {})}>
            {active ? '▸ ' : '  '}
            {item.label}
            {item.hint ? <Text dimColor>{`  ${item.hint}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
};
