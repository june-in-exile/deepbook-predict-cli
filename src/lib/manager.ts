import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type Position = Readonly<{
  oracleId: string;
  expiryMs: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
}>;

export type RangePosition = Readonly<{
  oracleId: string;
  expiryMs: bigint;
  lowerStrike: bigint;
  higherStrike: bigint;
  quantity: bigint;
}>;

export type ManagerState = Readonly<{
  id: string;
  owner: string;
  balanceManagerId: string;
  positionsTableId: string;
  rangePositionsTableId: string;
}>;

export const getManager = async (ctx: Ctx): Promise<ManagerState> => {
  const id = ctx.config.MANAGER_OBJECT_ID;
  const res = await ctx.client.getObject({
    id,
    options: { showContent: true, showType: true },
  });
  if (res.error) {
    throw new Error(`Failed to read PredictManager ${id}: ${JSON.stringify(res.error)}`);
  }
  const content = res.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`PredictManager ${id} has no Move content`);
  }
  const fields = content.fields as Record<string, unknown>;
  const balanceManager = inner(fields.balance_manager);
  return Object.freeze({
    id,
    owner: String(fields.owner ?? ''),
    balanceManagerId: extractId(balanceManager.id) ?? '',
    positionsTableId: extractId(inner(fields.positions).id) ?? '',
    rangePositionsTableId: extractId(inner(fields.range_positions).id) ?? '',
  });
};

export const listBinaryPositions = async (
  ctx: Ctx,
  manager: ManagerState,
): Promise<readonly Position[]> => {
  const fields = await fetchAllDynamicFields(ctx, manager.positionsTableId);
  const positions = await Promise.all(
    fields.map(async (df) => {
      const obj = await ctx.client.getDynamicFieldObject({
        parentId: manager.positionsTableId,
        name: df.name,
      });
      return parsePositionEntry(obj.data?.content);
    }),
  );
  return positions.filter((p): p is Position => p !== null);
};

export const listRangePositions = async (
  ctx: Ctx,
  manager: ManagerState,
): Promise<readonly RangePosition[]> => {
  const fields = await fetchAllDynamicFields(ctx, manager.rangePositionsTableId);
  const positions = await Promise.all(
    fields.map(async (df) => {
      const obj = await ctx.client.getDynamicFieldObject({
        parentId: manager.rangePositionsTableId,
        name: df.name,
      });
      return parseRangeEntry(obj.data?.content);
    }),
  );
  return positions.filter((p): p is RangePosition => p !== null);
};

export const getQuoteBalance = async (
  ctx: Ctx,
  manager: ManagerState,
  coinType: string,
): Promise<bigint> => {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict_manager::balance`,
    typeArguments: [coinType],
    arguments: [tx.object(manager.id)],
  });
  const res = await ctx.client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: manager.owner,
  });
  const ret = res.results?.[0]?.returnValues?.[0];
  if (!ret) {
    const err = res.error ?? 'no return value';
    throw new Error(`predict_manager::balance<${coinType}> devInspect failed: ${err}`);
  }
  const [bytes] = ret;
  return decodeU64LittleEndian(bytes);
};

const fetchAllDynamicFields = async (
  ctx: Ctx,
  parentId: string,
): Promise<readonly { name: { type: string; value: unknown } }[]> => {
  const out: { name: { type: string; value: unknown } }[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await ctx.client.getDynamicFields({ parentId, cursor: cursor ?? null });
    for (const f of page.data) {
      out.push({ name: { type: f.name.type, value: f.name.value } });
    }
    cursor = page.hasNextPage ? page.nextCursor : undefined;
  } while (cursor);
  return out;
};

const parsePositionEntry = (content: unknown): Position | null => {
  if (!content || typeof content !== 'object' || (content as { dataType?: string }).dataType !== 'moveObject') {
    return null;
  }
  const fields = (content as { fields: Record<string, unknown> }).fields;
  const name = inner(fields.name);
  const value = fields.value;
  return Object.freeze({
    oracleId: String(name.oracle_id ?? ''),
    expiryMs: readBigInt(name.expiry),
    strike: readBigInt(name.strike),
    isUp: Boolean(name.is_up),
    quantity: readBigInt(value),
  });
};

const parseRangeEntry = (content: unknown): RangePosition | null => {
  if (!content || typeof content !== 'object' || (content as { dataType?: string }).dataType !== 'moveObject') {
    return null;
  }
  const fields = (content as { fields: Record<string, unknown> }).fields;
  const name = inner(fields.name);
  const value = fields.value;
  return Object.freeze({
    oracleId: String(name.oracle_id ?? ''),
    expiryMs: readBigInt(name.expiry),
    lowerStrike: readBigInt(name.lower_strike),
    higherStrike: readBigInt(name.higher_strike),
    quantity: readBigInt(value),
  });
};

const inner = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && 'fields' in raw) {
    const f = (raw as { fields?: unknown }).fields;
    if (f && typeof f === 'object') return f as Record<string, unknown>;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};

const extractId = (raw: unknown): string | null => {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as { id?: unknown }).id;
  return typeof v === 'string' ? v : null;
};

const readBigInt = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  return 0n;
};

const decodeU64LittleEndian = (bytes: readonly number[]): bigint => {
  let n = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    n += BigInt(bytes[i] ?? 0) << BigInt(i * 8);
  }
  return n;
};
