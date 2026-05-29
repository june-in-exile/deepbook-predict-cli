export const SECTIONS = ['Account', 'Markets', 'Preview', 'Trade', 'LP', 'Lifecycle', 'Config'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_HINTS: Readonly<Record<Section, string>> = {
  Account: 'setup · inspect · deposit · withdraw',
  Markets: 'list oracles · pick active',
  Preview: 'UP/DOWN + range ask/bid',
  Trade: 'mint / redeem binary & range',
  LP: 'supply · withdraw PLP',
  Lifecycle: 'full e2e lifecycle',
  Config: 'risk · pricing · treasury · oracle',
};
