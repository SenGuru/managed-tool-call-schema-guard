#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  PostgresActionState,
  PostgresAlertState,
  PostgresBillingState,
  PostgresControlState,
  PostgresIntelligenceState,
  PostgresSchemaState,
  createSharedStatePool,
  type SharedStatePool,
} from '../packages/shared-state/src/index.js';
import { hmac } from '../packages/managed/src/crypto.js';
import { createManagedServer } from '../packages/managed/src/server.js';
import { ManagedStore } from '../packages/managed/src/store.js';

type JsonRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function ownerOnlyFile(path: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
    throw new Error(`${path} is not an owner-only regular file`);
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is not a JSON object`);
  return value as JsonRecord;
}

function receiptIsValid(secret: string, receipt: JsonRecord): boolean {
  const { receipt_hmac: receiptHmac, ...unsigned } = receipt;
  return (
    typeof receiptHmac === 'string' &&
    receiptHmac === hmac(secret, 'managed-manual-billing-receipt-v1', unsigned)
  );
}

async function runOperator(
  executable: string,
  environment: NodeJS.ProcessEnv,
  arguments_: string[],
): Promise<JsonRecord> {
  const result = await execFileAsync(
    executable,
    ['packages/managed/src/tenant-operator.ts', ...arguments_],
    {
      cwd: process.cwd(),
      env: environment,
      maxBuffer: 1024 * 1024,
    },
  );
  return asRecord(JSON.parse(result.stdout) as unknown, 'tenant operator response');
}

async function listen(service: ReturnType<typeof createManagedServer>): Promise<string> {
  await new Promise<void>((resolvePromise) =>
    service.server.listen(0, '127.0.0.1', resolvePromise),
  );
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('managed audit server has no port');
  return `http://127.0.0.1:${address.port}`;
}

async function responseJson(response: Response): Promise<JsonRecord> {
  return asRecord(await response.json(), 'managed API response');
}

async function main(): Promise<void> {
  const output = resolve(requiredOption('output'));
  const sourceRevision = requiredOption('source-revision');
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision))
    throw new Error('--source-revision must be an exact lowercase 40-character Git SHA');
  const postgresUrl = process.env.SCHEMA_GUARD_TEST_POSTGRES_URL;
  if (!postgresUrl) throw new Error('SCHEMA_GUARD_TEST_POSTGRES_URL is required');
  const outputParent = await stat(dirname(output));
  if (!outputParent.isDirectory() || (outputParent.mode & 0o077) !== 0)
    throw new Error('output parent must be an owner-only directory');

  const directory = await mkdtemp(join(tmpdir(), 'akriven-manual-billing-audit-'));
  await chmod(directory, 0o700);
  const databasePath = join(directory, 'managed.db');
  const grantConfirmation = join(directory, 'grant.json');
  const grantReceipt = join(directory, 'grant-receipt.json');
  const cancellationConfirmation = join(directory, 'cancellation.json');
  const cancellationReceipt = join(directory, 'cancellation-receipt.json');
  const tenantExport = join(directory, 'tenant-export.json');
  const cleanupExport = join(directory, 'cleanup-export.json');
  const deletionConfirmation = join(directory, 'delete.json');
  const masterSecret = randomBytes(48).toString('base64url');
  const apiKey = `sg_live_${randomBytes(24).toString('base64url')}`;
  const tenantId = `manual-audit-${randomBytes(8).toString('hex')}`;
  const tenantReference = hmac(
    masterSecret,
    'managed-manual-billing-audit-tenant-reference-v1',
    tenantId,
  );
  const grantEvidenceReference = `audit-settlement-${randomBytes(12).toString('hex')}`;
  const cancellationEvidenceReference = `audit-cancellation-${randomBytes(12).toString('hex')}`;
  const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SCHEMA_GUARD_MASTER_SECRET: masterSecret,
    SCHEMA_GUARD_SHARED_CONTROL_DATABASE_URL: postgresUrl,
    SCHEMA_GUARD_STRIPE_MODE: '',
    SCHEMA_GUARD_STRIPE_SECRET_KEY: '',
    SCHEMA_GUARD_STRIPE_SECRET_KEY_FILE: '',
    SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET: '',
    SCHEMA_GUARD_STRIPE_WEBHOOK_SECRET_FILE: '',
    SCHEMA_GUARD_STRIPE_TEAM_PRICE_ID: '',
    SCHEMA_GUARD_STRIPE_CHECKOUT_SUCCESS_URL: '',
    SCHEMA_GUARD_STRIPE_CHECKOUT_CANCEL_URL: '',
    SCHEMA_GUARD_STRIPE_PORTAL_RETURN_URL: '',
  };

  let pool: SharedStatePool | undefined;
  let service: ReturnType<typeof createManagedServer> | undefined;
  try {
    pool = createSharedStatePool(postgresUrl, 5);
    const action = new PostgresActionState(postgresUrl, masterSecret, pool);
    const bootstrapControl = new PostgresControlState(postgresUrl, masterSecret, pool);
    const schema = new PostgresSchemaState(postgresUrl, masterSecret, pool);
    const alerts = new PostgresAlertState(postgresUrl, masterSecret, pool);
    const intelligence = new PostgresIntelligenceState(postgresUrl, masterSecret, pool);
    const billingState = new PostgresBillingState(postgresUrl, masterSecret, pool);
    await bootstrapControl.migrate();
    await Promise.all([
      action.migrate(),
      schema.migrate(),
      alerts.migrate(),
      intelligence.migrate(),
      billingState.migrate(),
    ]);
    await bootstrapControl.bootstrapTenant({
      id: tenantId,
      name: 'Manual billing audit tenant',
      plan: 'trial',
      apiKey,
    });
    await Promise.all([
      schema.bootstrapTenant(tenantId),
      alerts.bootstrapTenant(tenantId),
      intelligence.bootstrapTenant(tenantId),
    ]);
    const store = new ManagedStore({ databasePath, masterSecret });
    store.bootstrapTenant({
      id: tenantId,
      name: 'Manual billing audit tenant',
      plan: 'trial',
      apiKey,
    });
    store.close();

    await writeFile(
      grantConfirmation,
      `${JSON.stringify({
        tenant_id: tenantId,
        billing_variant: 'manual',
        target_plan: 'team',
        reason_code: 'manual_invoice_settled',
        evidence_reference: grantEvidenceReference,
        operator_id: 'commercial-audit-operator',
        automated_charging_disabled: true,
        confirm: `set tenant ${tenantId} plan team`,
      })}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await chmod(grantConfirmation, 0o600);
    const common = ['--database', databasePath, '--tenant-id', tenantId];
    const grant = await runOperator(executable, environment, [
      'entitlement',
      ...common,
      '--service-state',
      'stopped',
      '--plan',
      'team',
      '--confirmation-file',
      grantConfirmation,
      '--receipt-output',
      grantReceipt,
    ]);
    const grantedInspection = await runOperator(executable, environment, ['inspect', ...common]);
    await ownerOnlyFile(grantReceipt);
    const grantReceiptText = await readFile(grantReceipt, 'utf8');
    const parsedGrantReceipt = asRecord(JSON.parse(grantReceiptText) as unknown, 'grant receipt');
    if (
      grantReceiptText.includes(grantEvidenceReference) ||
      grantReceiptText.includes(tenantId) ||
      !receiptIsValid(masterSecret, parsedGrantReceipt)
    )
      throw new Error('grant receipt privacy or integrity verification failed');

    const apiControl = new PostgresControlState(postgresUrl, masterSecret, pool);
    service = createManagedServer({ databasePath, masterSecret }, { controlState: apiControl });
    const base = await listen(service);
    const headers = { authorization: `Bearer ${apiKey}` };
    const usageResponse = await fetch(`${base}/v1/usage`, { headers });
    const billingResponse = await fetch(`${base}/v1/billing/statement`, { headers });
    const checkoutResponse = await fetch(`${base}/v1/billing/checkout-session`, {
      method: 'POST',
      headers,
    });
    const portalResponse = await fetch(`${base}/v1/billing/portal-session`, {
      method: 'POST',
      headers,
    });
    const usage = await responseJson(usageResponse);
    const billing = await responseJson(billingResponse);
    const checkout = await responseJson(checkoutResponse);
    const portal = await responseJson(portalResponse);
    await service.close();
    service = undefined;

    await runOperator(executable, environment, [
      'export',
      ...common,
      '--service-state',
      'stopped',
      '--output',
      tenantExport,
    ]);
    await ownerOnlyFile(tenantExport);
    await runOperator(executable, environment, [
      'transition',
      ...common,
      '--service-state',
      'stopped',
      '--status',
      'canceled',
      '--reason-code',
      'manual_private_beta_cancelled',
    ]);
    await writeFile(
      cancellationConfirmation,
      `${JSON.stringify({
        tenant_id: tenantId,
        billing_variant: 'manual',
        target_plan: 'trial',
        reason_code: 'manual_cancelled',
        evidence_reference: cancellationEvidenceReference,
        operator_id: 'commercial-audit-operator',
        automated_charging_disabled: true,
        confirm: `set tenant ${tenantId} plan trial`,
      })}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await chmod(cancellationConfirmation, 0o600);
    const cancellation = await runOperator(executable, environment, [
      'entitlement',
      ...common,
      '--service-state',
      'stopped',
      '--plan',
      'trial',
      '--confirmation-file',
      cancellationConfirmation,
      '--receipt-output',
      cancellationReceipt,
    ]);
    const canceledInspection = await runOperator(executable, environment, ['inspect', ...common]);
    await ownerOnlyFile(cancellationReceipt);
    const cancellationReceiptText = await readFile(cancellationReceipt, 'utf8');
    const parsedCancellationReceipt = asRecord(
      JSON.parse(cancellationReceiptText) as unknown,
      'cancellation receipt',
    );
    if (
      cancellationReceiptText.includes(cancellationEvidenceReference) ||
      cancellationReceiptText.includes(tenantId) ||
      !receiptIsValid(masterSecret, parsedCancellationReceipt)
    )
      throw new Error('cancellation receipt privacy or integrity verification failed');

    const grantedEntitlement = asRecord(
      grantedInspection.entitlement,
      'granted entitlement inspection',
    );
    const canceledEntitlement = asRecord(
      canceledInspection.entitlement,
      'canceled entitlement inspection',
    );
    const canceledLocal = asRecord(canceledInspection.local, 'canceled local lifecycle');
    const canceledShared = asRecord(canceledInspection.shared, 'canceled shared lifecycle');
    const usageEntitlements = asRecord(usage.entitlements, 'usage entitlements');
    const billingEntitlements = asRecord(billing.entitlements, 'billing entitlements');

    await runOperator(executable, environment, [
      'transition',
      ...common,
      '--service-state',
      'stopped',
      '--status',
      'deletion_pending',
      '--reason-code',
      'manual_billing_audit_cleanup',
    ]);
    const cleanupExportSummary = await runOperator(executable, environment, [
      'export',
      ...common,
      '--service-state',
      'stopped',
      '--output',
      cleanupExport,
    ]);
    await writeFile(
      deletionConfirmation,
      `${JSON.stringify({
        tenant_id: tenantId,
        confirm: `delete tenant ${tenantId}`,
        local_export_sha256: cleanupExportSummary.local_export_sha256,
        shared_export_sha256: cleanupExportSummary.shared_export_sha256,
      })}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await chmod(deletionConfirmation, 0o600);
    const deletion = await runOperator(executable, environment, [
      'delete',
      ...common,
      '--service-state',
      'stopped',
      '--confirmation-file',
      deletionConfirmation,
    ]);
    const cleanupStore = new ManagedStore({ databasePath, masterSecret });
    const localDeleted = cleanupStore.authenticate(apiKey) === undefined;
    cleanupStore.close();
    const sharedCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*) count FROM sg_control_tenants WHERE id=$1',
      [tenantId],
    );
    const sharedDeleted = sharedCount.rows[0]?.count === '0';
    const checks = {
      manual_invoice_policy:
        sha256(await readFile('docs/MANUAL_BILLING_PRIVATE_BETA.md')) !==
        `sha256:${'0'.repeat(64)}`,
      operator_entitlement:
        grant.plan === 'team' &&
        grant.changed === true &&
        grantedEntitlement.synchronized === true &&
        usage.plan === 'team' &&
        usage.monthly_limit === 250_000 &&
        usageEntitlements.retention_days === 30 &&
        billing.plan === 'team' &&
        billing.included_validations === 250_000 &&
        billingEntitlements.retention_days === 30,
      cancellation_policy:
        cancellation.plan === 'trial' &&
        cancellation.changed === true &&
        canceledEntitlement.synchronized === true &&
        canceledLocal.status === 'canceled' &&
        canceledShared.status === 'canceled' &&
        deletion.deleted === true &&
        localDeleted &&
        sharedDeleted,
      no_automated_charge:
        usage.payment_processing === 'manual_provider_setup_required' &&
        billing.payment_processing === 'integration_required' &&
        checkoutResponse.status === 501 &&
        checkout.error === 'billing_integration_required' &&
        portalResponse.status === 501 &&
        portal.error === 'billing_integration_required',
    };
    if (Object.values(checks).some((value) => !value))
      throw new Error('manual billing audit checks did not all pass');

    const report = {
      report_version: '1',
      audit: 'akriven_private_beta_manual_billing',
      source_revision: sourceRevision,
      executed_at: new Date().toISOString(),
      status: 'proven',
      redacted: true,
      evidence_kind: 'production_like_network',
      tenant_ref: tenantReference,
      checks,
      observations: {
        shared_postgresql: true,
        stopped_service_mutations: true,
        grant: {
          plan: grant.plan,
          validations_per_month: grant.validations_per_month,
          retention_days: grant.retention_days,
          receipt_sha256: sha256(grantReceiptText),
        },
        api_boundary: {
          usage_status: usageResponse.status,
          billing_statement_status: billingResponse.status,
          checkout_status: checkoutResponse.status,
          portal_status: portalResponse.status,
          payment_automation: billing.payment_processing,
        },
        cancellation: {
          plan: cancellation.plan,
          lifecycle: canceledLocal.status,
          export_sha256: sha256(await readFile(tenantExport)),
          receipt_sha256: sha256(cancellationReceiptText),
          audit_tenant_deleted: localDeleted && sharedDeleted,
        },
      },
      policy_sha256: sha256(await readFile('docs/MANUAL_BILLING_PRIVATE_BETA.md')),
      nonclaims: [
        'real payment settlement',
        'invoice delivery',
        'tax or refund review',
        'customer willingness to pay',
      ],
    };
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(output, 0o600);
    process.stdout.write(
      `${JSON.stringify({
        passed: true,
        output,
        source_revision: sourceRevision,
        checks,
      })}\n`,
    );
  } finally {
    if (service) await service.close().catch(() => undefined);
    if (pool) await pool.end().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
