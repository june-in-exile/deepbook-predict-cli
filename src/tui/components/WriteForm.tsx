import React from 'react';
import { Box, Text } from 'ink';
import type { Transaction } from '@mysten/sui/transactions';

import { useApp } from '../state/AppContext.js';
import { useExecution } from '../hooks/useExecution.js';
import { useFieldNav } from '../hooks/useFieldNav.js';
import { Field } from './Field.js';
import { ActionRow } from './Field.js';
import { ConfirmModal } from './ConfirmModal.js';
import { Outcome } from './Outcome.js';

export type FormField = Readonly<{
  key: string;
  label: string;
  placeholder?: string;
}>;

export type WriteFormProps = Readonly<{
  focus: boolean;
  onExit: () => void;
  fields: ReadonlyArray<FormField>;
  values: Readonly<Record<string, string>>;
  setValue: (key: string, value: string) => void;
  /** Live preview rendered between the fields and the action row. */
  renderPreview?: React.ReactNode;
  buildTx: () => Promise<Transaction>;
  confirmMessage: string;
  actionLabel: string;
  /** When false, the action is disabled (e.g. no manager selected, read-only). */
  canRun: boolean;
  blockedReason?: string;
}>;

/**
 * Shared write-action form: labelled fields → live preview → action row →
 * dry-run → (if signing) confirm modal → sign → outcome. Reused by deposit,
 * withdraw, mint, redeem and LP screens.
 */
export const WriteForm = ({
  focus,
  onExit,
  fields,
  values,
  setValue,
  renderPreview,
  buildTx,
  confirmMessage,
  actionLabel,
  canRun,
  blockedReason,
}: WriteFormProps): React.ReactElement => {
  const app = useApp();
  const exec = useExecution(app);
  const actionIndex = fields.length;
  const navActive = focus && (exec.phase === 'idle' || exec.phase === 'done' || exec.phase === 'error');

  const { focusIndex, setFocusIndex } = useFieldNav({
    slots: fields.length + 1,
    active: navActive,
    onEnter: (i) => {
      if (i === actionIndex) {
        if (canRun) void exec.start(buildTx);
      } else {
        setFocusIndex(Math.min(i + 1, actionIndex));
      }
    },
    onEscape: onExit,
  });

  return (
    <Box flexDirection="column">
      {fields.map((f, i) => (
        <Field
          key={f.key}
          label={f.label}
          value={values[f.key] ?? ''}
          onChange={(v) => setValue(f.key, v)}
          focus={navActive && focusIndex === i}
          {...(f.placeholder ? { placeholder: f.placeholder } : {})}
        />
      ))}

      {renderPreview ? <Box flexDirection="column" marginTop={1}>{renderPreview}</Box> : null}

      <Box marginTop={1}>
        <ActionRow
          label={actionLabel}
          focus={navActive && focusIndex === actionIndex}
          disabled={!canRun}
          {...(canRun ? {} : blockedReason ? { note: blockedReason } : {})}
        />
      </Box>

      {exec.phase === 'working' ? <Text dimColor>working…</Text> : null}

      {exec.phase === 'confirm' ? (
        <Box marginTop={1}>
          <ConfirmModal message={confirmMessage} focus={focus} onConfirm={() => void exec.confirm()} onCancel={exec.cancel} />
        </Box>
      ) : null}

      {exec.error ? <Text color="red">✗ {exec.error}</Text> : null}
      {exec.dryOutcome ? (
        <Box marginTop={1}>
          <Outcome outcome={exec.dryOutcome} />
        </Box>
      ) : null}
      {exec.execOutcome ? (
        <Box marginTop={1}>
          <Outcome outcome={exec.execOutcome} />
        </Box>
      ) : null}
    </Box>
  );
};
