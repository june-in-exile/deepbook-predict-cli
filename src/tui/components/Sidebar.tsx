import React from 'react';
import { Box, Text } from 'ink';

import { SECTIONS, type Section } from '../sections.js';
import { Select } from './Select.js';

export type SidebarProps = Readonly<{
  section: Section;
  focus: boolean;
  onHighlight: (section: Section) => void;
  onEnter: (section: Section) => void;
}>;

export const Sidebar = ({ section, focus, onHighlight, onEnter }: SidebarProps): React.ReactElement => {
  const items = SECTIONS.map((s) => ({ label: s, value: s }));
  const initialIndex = SECTIONS.indexOf(section);
  return (
    <Box flexDirection="column" width={16} borderStyle="round" borderColor={focus ? 'cyan' : 'gray'} paddingX={1}>
      <Text dimColor>sections</Text>
      <Select
        items={items}
        focus={focus}
        initialIndex={initialIndex < 0 ? 0 : initialIndex}
        onHighlightChange={(v) => onHighlight(v)}
        onSelect={(v) => onEnter(v)}
      />
    </Box>
  );
};
