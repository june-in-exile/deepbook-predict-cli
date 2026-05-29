import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Ctx } from '../../client.js';
import type { Quote } from '../../lib/quote.js';

export type AppState = Readonly<{
  ctx: Ctx;
  quote: Quote;
  /** devInspect sender + signer-derived address. Null only transiently before
   *  a read-only watch address is entered. */
  sender: string | null;
  /** True when PRIVATE_KEY is present — gates every signing action. */
  canSign: boolean;
  selectedOracleId: string | null;
  selectedManagerId: string | null;
  refreshNonce: number;
  setSender: (addr: string) => void;
  setSelectedOracleId: (id: string | null) => void;
  setSelectedManagerId: (id: string | null) => void;
  refresh: () => void;
}>;

const AppContextObj = createContext<AppState | null>(null);

export type AppProviderProps = Readonly<{
  ctx: Ctx;
  quote: Quote;
  initialSender: string | null;
  canSign: boolean;
  initialManagerId: string | null;
  children: React.ReactNode;
}>;

export const AppProvider = ({
  ctx,
  quote,
  initialSender,
  canSign,
  initialManagerId,
  children,
}: AppProviderProps): React.ReactElement => {
  const [sender, setSender] = useState<string | null>(initialSender);
  const [selectedOracleId, setSelectedOracleId] = useState<string | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(initialManagerId);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const value = useMemo<AppState>(
    () => ({
      ctx,
      quote,
      sender,
      canSign,
      selectedOracleId,
      selectedManagerId,
      refreshNonce,
      setSender,
      setSelectedOracleId,
      setSelectedManagerId,
      refresh,
    }),
    [ctx, quote, sender, canSign, selectedOracleId, selectedManagerId, refreshNonce, refresh],
  );

  return <AppContextObj.Provider value={value}>{children}</AppContextObj.Provider>;
};

export const useApp = (): AppState => {
  const value = useContext(AppContextObj);
  if (!value) throw new Error('useApp must be used within <AppProvider>');
  return value;
};
