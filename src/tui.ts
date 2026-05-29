import React from 'react';
import { render } from 'ink';

import { createContext, requireKeypair } from './client.js';
import { resolveQuote } from './lib/quote.js';
import { findOwnedManagers } from './lib/manager.js';
import { readFlag } from './scripts/_cli.js';
import { AppProvider } from './tui/state/AppContext.js';
import { App } from './tui/App.js';

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote') ?? process.env.QUOTE);

  // Resolve the signer/sender. PRIVATE_KEY → full signing; --sender → read-only;
  // otherwise the App prompts for a watch address.
  let sender: string | null = null;
  let canSign = false;
  if (ctx.config.PRIVATE_KEY) {
    sender = requireKeypair(ctx.config).getPublicKey().toSuiAddress();
    canSign = true;
  } else {
    const flag = readFlag(argv, '--sender');
    if (flag) sender = flag.toLowerCase();
  }

  // Auto-select the manager when the sender owns exactly one.
  let initialManagerId: string | null = null;
  if (sender) {
    try {
      const ids = await findOwnedManagers(ctx, sender);
      if (ids.length === 1) initialManagerId = ids[0] ?? null;
    } catch {
      // indexer hiccup — leave unselected; Account lets the user pick/retry.
    }
  }

  const { waitUntilExit } = render(
    React.createElement(AppProvider, {
      ctx,
      quote,
      initialSender: sender,
      canSign,
      initialManagerId,
      children: React.createElement(App),
    }),
  );
  await waitUntilExit();
};

main().catch((err: unknown) => {
  process.stderr.write(`tui failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
