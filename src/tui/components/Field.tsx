import React from 'react';
import { Box, Text } from 'ink';

import { TextInput } from './TextInput.js';

export type FieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  focus: boolean;
  placeholder?: string;
  labelWidth?: number;
}>;

/** A labelled text input row with a focus marker, for use inside forms. */
export const Field = ({ label, value, onChange, focus, placeholder = '', labelWidth = 12 }: FieldProps): React.ReactElement => (
  <Box>
    <Text {...(focus ? { color: 'cyan' as const } : {})}>{focus ? '▸ ' : '  '}</Text>
    <Text dimColor>{label.padEnd(labelWidth)} </Text>
    <TextInput value={value} onChange={onChange} focus={focus} placeholder={placeholder} />
  </Box>
);

export type ActionRowProps = Readonly<{
  label: string;
  focus: boolean;
  disabled?: boolean;
  note?: string;
}>;

/** A button-like row (e.g. the dry-run / execute trigger) with a focus marker. */
export const ActionRow = ({ label, focus, disabled = false, note }: ActionRowProps): React.ReactElement => (
  <Text bold={focus} {...(disabled ? { color: 'gray' as const } : focus ? { color: 'cyan' as const } : {})}>
    {focus ? '▸ ' : '  '}[{label}]
    {note ? <Text dimColor>{`  ${note}`}</Text> : null}
  </Text>
);
