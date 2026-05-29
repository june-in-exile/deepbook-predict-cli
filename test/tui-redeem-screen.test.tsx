import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';

import type { Ctx } from '../src/client.js';
import type { Quote } from '../src/lib/quote.js';
import { AppProvider } from '../src/tui/state/AppContext.js';
import { App } from '../src/tui/App.js';

const fakeCtx = {
  config: {
    RPC_URL: 'https://fullnode.testnet.example',
    SERVER_URL: 'https://indexer.testnet.example',
    PACKAGE_ID: '0x' + '0'.repeat(64),
  },
  client: { getBalance: async () => ({ totalBalance: '0' }) },
  predictObjectId: '0x' + '1'.repeat(64),
} as unknown as Ctx;

const quote: Quote = { coinType: '0x2::dusdc::DUSDC', symbol: 'DUSDC', decimals: 6n };

const DOWN = '\x1B[B';
const RIGHT = '\x1B[C';
const ENTER = '\r';
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('Redeem screen', () => {
  it('gates on manager selection before loading positions', async () => {
    const { stdin, lastFrame } = render(
      React.createElement(AppProvider, {
        ctx: fakeCtx,
        quote,
        initialSender: '0x' + 'a'.repeat(64),
        canSign: true,
        initialManagerId: null,
        children: React.createElement(App),
      }),
    );

    // Sidebar starts on Account (index 0); Trade is index 3.
    await tick();
    for (let i = 0; i < 3; i++) {
      stdin.write(DOWN);
      await tick();
    }
    stdin.write(ENTER); // enter the Trade screen
    await tick();
    stdin.write(RIGHT); // Mint UP/DOWN -> Mint Range
    await tick();
    stdin.write(RIGHT); // Mint Range -> Redeem
    await tick();

    expect(lastFrame() ?? '').toContain('select a manager in Account first');
  });
});
