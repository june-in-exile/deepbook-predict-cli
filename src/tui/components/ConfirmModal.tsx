import React from 'react';
import { Box, Text, useInput } from 'ink';

export type ConfirmModalProps = Readonly<{
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  focus: boolean;
}>;

/** Blocking y/N confirmation, replacing the CLI's readline confirm before signing. */
export const ConfirmModal = ({ message, onConfirm, onCancel, focus }: ConfirmModalProps): React.ReactElement => {
  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') onConfirm();
      else if (input === 'n' || input === 'N' || key.escape) onCancel();
    },
    { isActive: focus },
  );

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{message}</Text>
      <Text dimColor>y confirm · n / esc cancel</Text>
    </Box>
  );
};
