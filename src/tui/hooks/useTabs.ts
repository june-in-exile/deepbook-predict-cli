import { useState } from 'react';
import { useInput } from 'ink';

/** ←/→ move between `count` tabs while `active`, laid out left-to-right next to
 *  the sidebar. → stops at the last tab; ← on the first tab calls `onExitLeft`
 *  (collapsing the panel back to the sidebar) rather than wrapping around.
 *  TextInput ignores arrows, so this never clashes with field editing. */
export const useTabs = (count: number, active: boolean, onExitLeft?: () => void) => {
  const [tab, setTab] = useState(0);
  useInput(
    (_input, key) => {
      if (key.leftArrow) {
        if (tab === 0) onExitLeft?.();
        else setTab(tab - 1);
      } else if (key.rightArrow) {
        if (tab < count - 1) setTab(tab + 1);
      }
    },
    { isActive: active },
  );
  return [tab, setTab] as const;
};
