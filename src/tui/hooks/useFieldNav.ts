import { useState } from 'react';
import { useInput } from 'ink';

export type FieldNavOptions = Readonly<{
  /** Total navigable rows (input fields + the action row). */
  slots: number;
  active: boolean;
  /** Enter pressed on the row at `index`. */
  onEnter: (index: number) => void;
  /** Esc pressed — typically returns focus to the sidebar. */
  onEscape: () => void;
}>;

/**
 * Vertical focus management for forms. Tab / ↓ advance, Shift-Tab / ↑ retreat
 * (wrapping), Enter activates the focused row, Esc bubbles up. Coexists with
 * each field's TextInput (which only consumes printable keys + backspace).
 */
export const useFieldNav = ({ slots, active, onEnter, onEscape }: FieldNavOptions) => {
  const [focusIndex, setFocusIndex] = useState(0);

  useInput(
    (_input, key) => {
      if (key.escape) onEscape();
      else if (key.tab && key.shift) setFocusIndex((i) => (i - 1 + slots) % slots);
      else if (key.tab || key.downArrow) setFocusIndex((i) => (i + 1) % slots);
      else if (key.upArrow) setFocusIndex((i) => (i - 1 + slots) % slots);
      else if (key.return) onEnter(focusIndex);
    },
    { isActive: active },
  );

  return { focusIndex, setFocusIndex };
};
