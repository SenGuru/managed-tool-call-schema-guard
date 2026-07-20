import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { ActionState, AlertState } from '@schema-guard/shared-state';
import type { ManagedStore } from './store.js';

export interface AlertWebhookDispatchSummary {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
}

export type CheckpointAnchorDispatchSummary = AlertWebhookDispatchSummary;

interface DeliveryResult {
  delivered: boolean;
  retryable: boolean;
  responseStatus?: number;
  errorCode?: string;
}

export function signAlertWebhookPayload(
  signingSecret: string,
  timestamp: string,
  payload: string,
): string {
  return `v1=${createHmac('sha256', signingSecret)
    .update(timestamp)
    .update('.')
    .update(payload)
    .digest('hex')}`;
}

function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === undefined || b === undefined || c === undefined) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

async function resolveSafeAddress(hostname: string): Promise<string> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const ipv4 = addresses.filter((entry) => entry.family === 4);
  if (!ipv4.length || addresses.some((entry) => entry.family === 4 && !isPublicIpv4(entry.address)))
    throw new Error('unsafe_destination');
  return ipv4[0]!.address;
}

async function resolveSafeAddressWithin(hostname: string, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveSafeAddress(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('dns_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function deliverAlertWebhook(
  endpoint: string,
  signingSecret: string,
  payload: string,
  timeoutMs: number,
): Promise<DeliveryResult> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { delivered: false, retryable: false, errorCode: 'invalid_endpoint' };
  }
  let address: string;
  try {
    address = await resolveSafeAddressWithin(url.hostname, timeoutMs);
  } catch (error) {
    return {
      delivered: false,
      retryable: error instanceof Error && error.message !== 'unsafe_destination',
      errorCode:
        error instanceof Error && ['unsafe_destination', 'dns_timeout'].includes(error.message)
          ? error.message
          : 'dns_failed',
    };
  }
  const timestamp = new Date().toISOString();
  const signature = signAlertWebhookPayload(signingSecret, timestamp, payload);
  return new Promise<DeliveryResult>((resolve) => {
    let settled = false;
    const finish = (result: DeliveryResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const outbound = request(
      url,
      {
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
          'user-agent': 'schema-guard-managed/0.2.0',
          'x-schema-guard-timestamp': timestamp,
          'x-schema-guard-signature': signature,
        },
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300)
          finish({ delivered: true, retryable: false, responseStatus: status });
        else
          finish({
            delivered: false,
            retryable: status === 408 || status === 425 || status === 429 || status >= 500,
            ...(status ? { responseStatus: status } : {}),
            errorCode:
              status >= 300 && status < 400 ? 'redirect_refused' : `http_${status || 'unknown'}`,
          });
        response.destroy();
      },
    );
    outbound.setTimeout(timeoutMs, () => outbound.destroy(new Error('request_timeout')));
    outbound.on('error', (error) =>
      finish({
        delivered: false,
        retryable: true,
        errorCode: error.message === 'request_timeout' ? 'request_timeout' : 'network_error',
      }),
    );
    outbound.end(payload);
  });
}

export async function dispatchAlertWebhooksOnce(
  store: ManagedStore,
  options: {
    timeoutMs?: number;
    concurrency?: number;
    deliver?: typeof deliverAlertWebhook;
  } = {},
): Promise<AlertWebhookDispatchSummary> {
  const claims = store.claimDueAlertWebhookDeliveries(25);
  const summary: AlertWebhookDispatchSummary = {
    claimed: claims.length,
    delivered: 0,
    retrying: 0,
    dead: 0,
  };
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 16);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
      while (cursor < claims.length) {
        const claim = claims[cursor++]!;
        const result = await (options.deliver ?? deliverAlertWebhook)(
          claim.endpoint,
          claim.signingSecret,
          claim.payload,
          options.timeoutMs ?? 5_000,
        );
        const finalStatus = store.finishAlertWebhookDelivery({
          deliveryId: claim.deliveryId,
          leaseId: claim.leaseId,
          ...result,
        });
        if (finalStatus === 'delivered') summary.delivered += 1;
        else if (finalStatus === 'pending') summary.retrying += 1;
        else if (finalStatus === 'dead') summary.dead += 1;
      }
    }),
  );
  return summary;
}

export async function dispatchSharedAlertWebhooksOnce(
  alertState: AlertState,
  options: {
    timeoutMs?: number;
    concurrency?: number;
    deliver?: typeof deliverAlertWebhook;
  } = {},
): Promise<AlertWebhookDispatchSummary> {
  const claims = await alertState.claimDeliveries(25);
  const summary: AlertWebhookDispatchSummary = {
    claimed: claims.length,
    delivered: 0,
    retrying: 0,
    dead: 0,
  };
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 16);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
      while (cursor < claims.length) {
        const claim = claims[cursor++]!;
        const result = await (options.deliver ?? deliverAlertWebhook)(
          claim.endpoint,
          claim.signingSecret,
          claim.payload,
          options.timeoutMs ?? 5_000,
        );
        const finalStatus = await alertState.finishDelivery({
          deliveryId: claim.deliveryId,
          leaseId: claim.leaseId,
          ...result,
        });
        if (finalStatus === 'delivered') summary.delivered += 1;
        else if (finalStatus === 'pending') summary.retrying += 1;
        else if (finalStatus === 'dead') summary.dead += 1;
      }
    }),
  );
  return summary;
}

export async function dispatchCheckpointAnchorsOnce(
  store: ManagedStore,
  options: {
    timeoutMs?: number;
    concurrency?: number;
    batchSize?: number;
    deliver?: typeof deliverAlertWebhook;
  } = {},
): Promise<CheckpointAnchorDispatchSummary> {
  const claims = store.claimDueCheckpointAnchorDeliveries(options.batchSize ?? 25);
  const summary: CheckpointAnchorDispatchSummary = {
    claimed: claims.length,
    delivered: 0,
    retrying: 0,
    dead: 0,
  };
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 16);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
      while (cursor < claims.length) {
        const claim = claims[cursor++]!;
        const result = await (options.deliver ?? deliverAlertWebhook)(
          claim.endpoint,
          claim.signingSecret,
          claim.payload,
          options.timeoutMs ?? 5_000,
        );
        const finalStatus = store.finishCheckpointAnchorDelivery({
          deliveryId: claim.deliveryId,
          leaseId: claim.leaseId,
          ...result,
        });
        if (finalStatus === 'delivered') summary.delivered += 1;
        else if (finalStatus === 'pending') summary.retrying += 1;
        else if (finalStatus === 'dead') summary.dead += 1;
      }
    }),
  );
  return summary;
}

export async function dispatchSharedCheckpointAnchorsOnce(
  actionState: ActionState,
  endpoint: string,
  signingSecret: string,
  options: {
    timeoutMs?: number;
    concurrency?: number;
    batchSize?: number;
    deliver?: typeof deliverAlertWebhook;
  } = {},
): Promise<CheckpointAnchorDispatchSummary> {
  const claims = await actionState.claimCheckpointAnchorDeliveries(options.batchSize ?? 25);
  const summary: CheckpointAnchorDispatchSummary = {
    claimed: claims.length,
    delivered: 0,
    retrying: 0,
    dead: 0,
  };
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 16);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
      while (cursor < claims.length) {
        const claim = claims[cursor++]!;
        const result = await (options.deliver ?? deliverAlertWebhook)(
          endpoint,
          signingSecret,
          claim.payload,
          options.timeoutMs ?? 5_000,
        );
        const finalStatus = await actionState.finishCheckpointAnchorDelivery({
          deliveryId: claim.deliveryId,
          leaseId: claim.leaseId,
          ...result,
        });
        if (finalStatus === 'delivered') summary.delivered += 1;
        else if (finalStatus === 'pending') summary.retrying += 1;
        else if (finalStatus === 'dead') summary.dead += 1;
      }
    }),
  );
  return summary;
}
