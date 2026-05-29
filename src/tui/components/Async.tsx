import React from 'react';
import { Box, Text } from 'ink';

import type { AsyncState } from '../hooks/useAsync.js';

export type AsyncProps<T> = Readonly<{
  state: AsyncState<T>;
  children: (value: T) => React.ReactNode;
  loadingLabel?: string;
}>;

/** Render children with the resolved value, or a loading / error line. */
export const Async = <T,>({ state, children, loadingLabel = 'loading…' }: AsyncProps<T>): React.ReactElement => {
  if (state.error) {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {state.error.message}</Text>
        <Text dimColor>press r to retry</Text>
      </Box>
    );
  }
  if (state.value === null) {
    return <Text dimColor>{loadingLabel}</Text>;
  }
  return <>{children(state.value)}</>;
};
