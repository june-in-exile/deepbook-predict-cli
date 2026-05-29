import React from 'react';
import { Box, Text } from 'ink';

import type { ExecuteOutcome } from '../../scripts/_cli.js';
import { shortId } from '../format.js';

export type OutcomeProps = Readonly<{ outcome: ExecuteOutcome }>;

/** React rendering of the CLI's printOutcome: dry-run or execution result. */
export const Outcome = ({ outcome }: OutcomeProps): React.ReactElement => {
  const title = outcome.mode === 'execute' ? 'execution' : 'dry-run (devInspect)';
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={outcome.success ? 'green' : 'red'} paddingX={1}>
      <Text bold>=== {title} ===</Text>
      <Text>
        success: <Text color={outcome.success ? 'green' : 'red'}>{String(outcome.success)}</Text>
      </Text>
      {'digest' in outcome ? (
        <>
          <Text>digest: {outcome.digest}</Text>
          <Text dimColor>https://suiscan.xyz/testnet/tx/{outcome.digest}</Text>
        </>
      ) : null}
      {outcome.error ? <Text color="red">error: {outcome.error}</Text> : null}
      {'gasUsed' in outcome && outcome.gasUsed ? <Text dimColor>gas (est): {outcome.gasUsed}</Text> : null}
      {'balanceChanges' in outcome && outcome.balanceChanges && outcome.balanceChanges.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor>balance changes:</Text>
          {outcome.balanceChanges.map((c, i) => (
            <Text key={i}>
              {'  '}
              {c.amount.padStart(16)} {shortId(c.coinType, 12, 10)}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
