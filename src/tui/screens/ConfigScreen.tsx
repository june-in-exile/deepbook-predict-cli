import React from 'react';
import { Box, Text, useInput } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async } from '../components/Async.js';
import { ConfigTree } from '../components/ConfigTree.js';
import { getPredict, type PredictState } from '../../lib/predict.js';

const BLOCKS: ReadonlyArray<{ title: string; pick: (p: PredictState) => Record<string, unknown> }> = [
  { title: 'risk', pick: (p) => p.riskConfig },
  { title: 'pricing', pick: (p) => p.pricingConfig },
  { title: 'treasury', pick: (p) => p.treasuryConfig },
  { title: 'oracle', pick: (p) => p.oracleConfig },
];

/** Read-only view of the on-chain Predict config (risk / pricing / treasury / oracle). */
export const ConfigScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const { ctx, refreshNonce } = useApp();
  const state = useAsync(() => getPredict(ctx), [refreshNonce]);

  useInput(
    (_input, key) => {
      if (key.escape) onExit();
    },
    { isActive: focus },
  );

  return (
    <Async state={state} loadingLabel="loading config…">
      {(p) => (
        <Box flexDirection="column">
          {BLOCKS.map(({ title, pick }) => (
            <Box key={title} flexDirection="column" marginBottom={1}>
              <Text bold>{title}</Text>
              <ConfigTree data={pick(p)} />
            </Box>
          ))}
        </Box>
      )}
    </Async>
  );
};
