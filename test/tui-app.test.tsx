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
  client: {
    getBalance: async () => ({ totalBalance: '0' }),
  },
  predictObjectId: '0x' + '1'.repeat(64),
} as unknown as Ctx;

const quote: Quote = { coinType: '0x2::dusdc::DUSDC', symbol: 'DUSDC', decimals: 6n };

const renderApp = (initialSender: string | null, canSign: boolean) =>
  render(
    React.createElement(AppProvider, {
      ctx: fakeCtx,
      quote,
      initialSender,
      canSign,
      initialManagerId: null,
      children: React.createElement(App),
    }),
  );

describe('App', () => {
  it('prompts for a watch address in read-only mode', () => {
    const { lastFrame } = renderApp(null, false);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('READ-ONLY');
    expect(frame).toContain('address');
  });

  it('renders the sidebar sections when a signer is present', () => {
    const { lastFrame } = renderApp('0x' + 'a'.repeat(64), true);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('sections');
    for (const label of ['Account', 'Markets', 'Preview', 'Trade', 'LP', 'Lifecycle', 'Config']) {
      expect(frame).toContain(label);
    }
  });

  it('collapses the content panel back to the sidebar when ← is pressed on the first tab', async () => {
    const ENTER = '\r';
    const LEFT = '\x1B[D';
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

    const { stdin, lastFrame } = renderApp('0x' + 'a'.repeat(64), true);
    await tick();

    stdin.write(ENTER); // open Account (tab 0 = Overview)
    await tick();
    // Footer reflects content focus once the panel is open.
    expect(lastFrame() ?? '').toContain('esc back');

    stdin.write(LEFT); // ← on the leftmost tab returns focus to the sidebar
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('enter/→ open'); // sidebar footer
    expect(frame).not.toContain('esc back');
  });
});
