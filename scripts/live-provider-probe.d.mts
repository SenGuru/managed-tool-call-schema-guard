export interface LiveProbeRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function requestFor(
  provider: string,
  configuration: { key: string; model: string },
  declaration: Record<string, unknown>,
): LiveProbeRequest;

export function emittedCall(
  provider: string,
  payload: unknown,
): { name: string; arguments: unknown } | undefined;

export function runLiveProviderProbes(argv?: string[]): Promise<Record<string, unknown>>;
