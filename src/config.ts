import 'dotenv/config';
import { z } from 'zod';

const HEX_OBJECT_ID = /^0x[0-9a-f]{64}$/;
const SUI_PRIVKEY = /^suiprivkey1[a-z0-9]{50,}$/;

const objectId = (label: string) =>
  z.string().regex(HEX_OBJECT_ID, `${label} must be a 0x-prefixed 32-byte hex string`);

const ConfigSchema = z.object({
  RPC_URL: z.string().url(),
  SERVER_URL: z.string().url(),
  PACKAGE_ID: objectId('PACKAGE_ID'),
  PREDICT_OBJECT_ID: objectId('PREDICT_OBJECT_ID'),
  PREDICT_REGISTRY_ID: objectId('PREDICT_REGISTRY_ID'),
  MANAGER_OBJECT_ID: objectId('MANAGER_OBJECT_ID'),
  PRIVATE_KEY: z
    .string()
    .regex(SUI_PRIVKEY, 'PRIVATE_KEY must be in suiprivkey1… form (sui keytool export)')
    .optional(),
});

export type Config = Readonly<z.infer<typeof ConfigSchema>>;

export const loadConfig = (): Config => {
  const raw = pickEnv();
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(formatIssues(parsed.error.issues));
  return Object.freeze(parsed.data);
};

const pickEnv = (): Record<string, string | undefined> => ({
  RPC_URL: process.env.RPC_URL,
  SERVER_URL: process.env.SERVER_URL,
  PACKAGE_ID: process.env.PACKAGE_ID,
  PREDICT_OBJECT_ID: process.env.PREDICT_OBJECT_ID,
  PREDICT_REGISTRY_ID: process.env.PREDICT_REGISTRY_ID,
  MANAGER_OBJECT_ID: process.env.MANAGER_OBJECT_ID,
  PRIVATE_KEY: process.env.PRIVATE_KEY || undefined,
});

const formatIssues = (issues: z.ZodIssue[]): string => {
  const lines = issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  return `Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env and fill in the missing values.`;
};
