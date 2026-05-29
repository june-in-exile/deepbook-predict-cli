import React from 'react';
import { Text, useInput } from 'ink';

export type TextInputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  /** Enter key pressed while focused. */
  onSubmit?: (value: string) => void;
  /** Only captures keystrokes when true; shows a cursor when focused. */
  focus: boolean;
  placeholder?: string;
}>;

/**
 * Minimal single-line controlled text field. Handles printable characters and
 * backspace; leaves arrow keys / tab for parent navigation. Kept dependency-free
 * rather than pulling in ink-text-input.
 */
export const TextInput = ({
  value,
  onChange,
  onSubmit,
  focus,
  placeholder = '',
}: TextInputProps): React.ReactElement => {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.delete || key.backspace) {
        onChange(value.slice(0, -1));
        return;
      }
      // Ignore control / navigation keys; capture only printable input.
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab || key.escape) {
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive: focus },
  );

  const showPlaceholder = value.length === 0;
  const display = showPlaceholder ? placeholder : value;
  return (
    <Text>
      <Text dimColor={showPlaceholder} {...(focus ? { color: 'cyan' as const } : {})}>
        {display || ' '}
      </Text>
      {focus ? <Text inverse> </Text> : null}
    </Text>
  );
};
