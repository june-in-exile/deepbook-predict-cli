import React from 'react';
import { Box, Text } from 'ink';

export type TabsProps = Readonly<{ labels: ReadonlyArray<string>; index: number; focus: boolean }>;

export const Tabs = ({ labels, index, focus }: TabsProps): React.ReactElement => (
  <Box marginBottom={1}>
    {labels.map((label, i) => {
      const active = i === index;
      return (
        <Text key={i} {...(active ? { color: 'cyanBright' as const, inverse: focus } : { dimColor: true })}>
          {' '}
          {label}{' '}
        </Text>
      );
    })}
    {focus ? <Text dimColor>{'  ←/→ switch'}</Text> : null}
  </Box>
);
