import { useState } from 'react';
import { useInput } from 'ink';

/** ←/→ cycle through `count` tabs while `active`. TextInput ignores arrows,
 *  so this never clashes with field editing. */
export const useTabs = (count: number, active: boolean) => {
  const [tab, setTab] = useState(0);
  useInput(
    (_input, key) => {
      if (key.leftArrow) setTab((t) => (t - 1 + count) % count);
      else if (key.rightArrow) setTab((t) => (t + 1) % count);
    },
    { isActive: active },
  );
  return [tab, setTab] as const;
};
