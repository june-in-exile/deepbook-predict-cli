import React, { useState } from 'react';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';

import { useApp } from './state/AppContext.js';
import { StatusBar } from './components/StatusBar.js';
import { Sidebar } from './components/Sidebar.js';
import { Footer } from './components/Footer.js';
import { TextInput } from './components/TextInput.js';
import { SECTION_HINTS, type Section } from './sections.js';
import { AccountScreen } from './screens/AccountScreen.js';
import { MarketsScreen } from './screens/MarketsScreen.js';
import { PreviewScreen } from './screens/PreviewScreen.js';
import { TradeScreen } from './screens/TradeScreen.js';
import { LpScreen } from './screens/LpScreen.js';
import { LifecycleScreen } from './screens/LifecycleScreen.js';
import { ConfigScreen } from './screens/ConfigScreen.js';

export type ScreenProps = Readonly<{ focus: boolean; onExit: () => void }>;

const HEX_ADDR = /^0x[0-9a-f]{64}$/;

/** Read-only entry: ask for a watch address when no PRIVATE_KEY is configured. */
const WatchAddressPrompt = (): React.ReactElement => {
  const { setSender } = useApp();
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (v: string): void => {
    const addr = v.trim().toLowerCase();
    if (!HEX_ADDR.test(addr)) {
      setErr('expected a 0x-prefixed 32-byte address');
      return;
    }
    setSender(addr);
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">READ-ONLY mode — no PRIVATE_KEY in .env.</Text>
      <Text>Enter a wallet address to watch (used as devInspect sender):</Text>
      <Box>
        <Text dimColor>address ▸ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} focus placeholder="0x…" />
      </Box>
      {err ? <Text color="red">{err}</Text> : null}
      <Text dimColor>set PRIVATE_KEY in .env to enable signing</Text>
    </Box>
  );
};

const renderScreen = (section: Section, props: ScreenProps): React.ReactElement => {
  switch (section) {
    case 'Account':
      return <AccountScreen {...props} />;
    case 'Markets':
      return <MarketsScreen {...props} />;
    case 'Preview':
      return <PreviewScreen {...props} />;
    case 'Trade':
      return <TradeScreen {...props} />;
    case 'LP':
      return <LpScreen {...props} />;
    case 'Lifecycle':
      return <LifecycleScreen {...props} />;
    case 'Config':
      return <ConfigScreen {...props} />;
  }
};

export const App = (): React.ReactElement => {
  const { sender, refresh } = useApp();
  const { exit } = useInkApp();
  const [section, setSection] = useState<Section>('Account');
  const [focusZone, setFocusZone] = useState<'sidebar' | 'content'>('sidebar');

  // Global keys only while the sidebar is focused, so form typing never quits the app.
  useInput(
    (input) => {
      if (input === 'q') exit();
      else if (input === 'r') refresh();
    },
    { isActive: focusZone === 'sidebar' && sender !== null },
  );

  if (sender === null) {
    return (
      <Box flexDirection="column">
        <StatusBar />
        <WatchAddressPrompt />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <StatusBar />
      <Box>
        <Sidebar
          section={section}
          focus={focusZone === 'sidebar'}
          onHighlight={setSection}
          onEnter={(s) => {
            setSection(s);
            setFocusZone('content');
          }}
        />
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={focusZone === 'content' ? 'cyan' : 'gray'} paddingX={1}>
          {renderScreen(section, { focus: focusZone === 'content', onExit: () => setFocusZone('sidebar') })}
        </Box>
      </Box>
      <Footer focusZone={focusZone} hint={SECTION_HINTS[section]} />
    </Box>
  );
};
