import type { ProviderId, Quota } from "./model";

export type ProviderReadResult =
  | { ok: true; quota: Quota }
  | {
      ok: false;
      kind: "missing" | "auth" | "rate-limited" | "transient";
      error: string;
      retryAfterSeconds?: number;
    };

export interface QuotaProvider {
  readonly id: ProviderId;
  read(nowSec: number): Promise<ProviderReadResult>;
  dispose(): void;
}
