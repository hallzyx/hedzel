import { z } from "zod";

export const TINYBARS_PER_HBAR = 100_000_000;

export function hbarToTinybars(hbar: number): string {
  return String(Math.round(hbar * TINYBARS_PER_HBAR));
}

/** A sellable service. `schema` validates params; `paramsSchema` is the ACP-facing JSON Schema. */
export interface ServiceDef {
  id: string;
  name: string;
  description: string;
  priceHbar: number;
  schema: z.ZodTypeAny;
  paramsSchema: Record<string, unknown>;
}

const accountIdField = {
  type: "string",
  description: "Hedera account id, e.g. 0.0.1234567",
  pattern: "^\\d+\\.\\d+\\.\\d+$",
};

export const SERVICES: Record<string, ServiceDef> = {
  "account-intelligence": {
    id: "account-intelligence",
    name: "Account Intelligence",
    description:
      "Current balance, last 10 transactions, associated tokens and recent activity for a Hedera account.",
    priceHbar: 2,
    schema: z.object({ accountId: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    paramsSchema: {
      type: "object",
      required: ["accountId"],
      properties: { accountId: accountIdField },
    },
  },

  "token-report": {
    id: "token-report",
    name: "Token Report",
    description:
      "Total supply, top 10 holders and 24h transfer activity of an HTS token.",
    priceHbar: 3,
    schema: z.object({ tokenId: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    paramsSchema: {
      type: "object",
      required: ["tokenId"],
      properties: {
        tokenId: { ...accountIdField, description: "HTS token id, e.g. 0.0.456858" },
      },
    },
  },

  "topic-feed": {
    id: "topic-feed",
    name: "Topic Feed",
    description: "Latest N messages of an HCS topic with timestamps and decoded content.",
    priceHbar: 1,
    schema: z.object({
      topicId: z.string().regex(/^\d+\.\d+\.\d+$/),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    paramsSchema: {
      type: "object",
      required: ["topicId"],
      properties: {
        topicId: { ...accountIdField, description: "HCS topic id, e.g. 0.0.789012" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
  },

  "network-pulse": {
    id: "network-pulse",
    name: "Network Pulse",
    description: "Current TPS, average fees and total transactions over the last 24h of the network.",
    priceHbar: 1,
    schema: z.object({}),
    paramsSchema: { type: "object", properties: {} },
  },

  "wallet-forensics": {
    id: "wallet-forensics",
    name: "Wallet Forensics",
    description:
      "Relationship graph of an account: frequent counterparties and transfer volume.",
    priceHbar: 5,
    schema: z.object({ accountId: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    paramsSchema: {
      type: "object",
      required: ["accountId"],
      properties: { accountId: accountIdField },
    },
  },
};

export function getService(id: string): ServiceDef | undefined {
  return SERVICES[id];
}

export function listServices(): ServiceDef[] {
  return Object.values(SERVICES);
}
