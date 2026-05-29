import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';

import { ConfigTree } from '../src/tui/components/ConfigTree.js';

describe('ConfigTree', () => {
  it('renders primitive key/values', () => {
    const { lastFrame } = render(<ConfigTree data={{ fee_bps: '30', enabled: true }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('fee_bps:');
    expect(frame).toContain('30');
    expect(frame).toContain('enabled:');
    expect(frame).toContain('true');
  });

  it('unwraps a nested Move struct and indents its fields', () => {
    const data = { spread: { type: '0x2::pricing::Spread', fields: { min: '10', max: '200' } } };
    const { lastFrame } = render(<ConfigTree data={data} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('spread:');
    // child fields are present and indented (no `fields` wrapper key leaks through)
    expect(frame).toContain('min:');
    expect(frame).toContain('10');
    expect(frame).toContain('max:');
    expect(frame).toContain('200');
    expect(frame).not.toContain('fields:');
    expect(frame).toMatch(/\n {2}min:/);
  });

  it('renders vectors with indexed entries', () => {
    const data = { accepted_quotes: ['0x2::sui::SUI', '0x2::dusdc::DUSDC'] };
    const { lastFrame } = render(<ConfigTree data={data} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('accepted_quotes:');
    expect(frame).toContain('[0]:');
    expect(frame).toContain('0x2::sui::SUI');
    expect(frame).toContain('[1]:');
    expect(frame).toContain('0x2::dusdc::DUSDC');
  });

  it('shows empty markers for empty objects and arrays', () => {
    expect(render(<ConfigTree data={{}} />).lastFrame()).toContain('(empty)');
    expect((render(<ConfigTree data={{ quotes: [] }} />).lastFrame() ?? '')).toContain('quotes: []');
  });
});
