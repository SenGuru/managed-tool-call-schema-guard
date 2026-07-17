import { validateToolCall, type GuardDecision, type ValidateRequest } from '@schema-guard/core';
export type { GuardDecision, ValidateRequest } from '@schema-guard/core';

export class SchemaGuardClient {
  constructor(private readonly options: { baseUrl?: string } = {}) {}
  validateLocal(request: ValidateRequest): GuardDecision {
    return validateToolCall(request);
  }
  async validate(request: ValidateRequest): Promise<GuardDecision> {
    if (!this.options.baseUrl) return this.validateLocal(request);
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/u, '')}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const decision = (await response.json()) as GuardDecision;
    if (response.status >= 500)
      throw new Error(`Schema Guard service failed with ${response.status}`);
    return decision;
  }
}
