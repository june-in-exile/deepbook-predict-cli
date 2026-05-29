import React from 'react';
import { Box, Text } from 'ink';

export type FooterProps = Readonly<{
  focusZone: 'sidebar' | 'content';
  hint?: string;
}>;

export const Footer = ({ focusZone, hint }: FooterProps): React.ReactElement => {
  const base =
    focusZone === 'sidebar'
      ? '↑/↓ section · enter/→ open · r refresh · q quit'
      : 'esc back · ' + (hint ?? 'tab fields · enter act');
  return (
    <Box paddingX={1}>
      <Text dimColor>{base}</Text>
    </Box>
  );
};
