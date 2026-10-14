import type { ProviderConfig, AIRequest } from "../../domain/models";
export type TokenUsage = {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  actual: boolean;
};
export function normalizeUsage(
  provider: string,
  raw: unknown,
  inputText?: string,
  outputText?: string,
): TokenUsage;
export function estimateCost(
  usage: TokenUsage,
  config: ProviderConfig,
): number | null;
export function complete(
  config: ProviderConfig,
  key: string,
  request: Pick<AIRequest, "system" | "prompt" | "maxTokens">,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  fetcher?: typeof fetch,
): Promise<{ text: string; usage: TokenUsage }>;
