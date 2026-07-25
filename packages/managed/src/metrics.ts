export interface ManagedReadinessMetrics {
  draining: boolean;
  localDatabase: boolean;
  actionState: boolean;
  controlState: boolean;
  schemaState: boolean;
  alertState: boolean;
  intelligenceState: boolean;
  billingState: boolean;
}

interface HttpSeries {
  count: number;
  durationMs: number;
  buckets: number[];
}

const durationBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

const escapeLabel = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');

export class ManagedMetrics {
  readonly startedAt = Date.now();
  private inFlight = 0;
  private timeouts = 0;
  private webhookDispatchFailures = 0;
  private anchorDispatchFailures = 0;
  private readonly http = new Map<string, HttpSeries>();

  requestStarted(): void {
    this.inFlight += 1;
  }

  requestCompleted(method: string, route: string, status: number, durationMs: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const key = JSON.stringify([method, route, statusClass]);
    const series = this.http.get(key) ?? {
      count: 0,
      durationMs: 0,
      buckets: durationBucketsMs.map(() => 0),
    };
    series.count += 1;
    series.durationMs += durationMs;
    for (let index = 0; index < durationBucketsMs.length; index += 1)
      if (durationMs <= durationBucketsMs[index]!) series.buckets[index]! += 1;
    this.http.set(key, series);
  }

  requestTimedOut(): void {
    this.timeouts += 1;
  }

  webhookDispatchFailed(): void {
    this.webhookDispatchFailures += 1;
  }

  anchorDispatchFailed(): void {
    this.anchorDispatchFailures += 1;
  }

  render(readiness: ManagedReadinessMetrics): string {
    const lines = [
      '# HELP schema_guard_http_requests_total Completed HTTP requests.',
      '# TYPE schema_guard_http_requests_total counter',
    ];
    for (const [key, series] of [...this.http.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const [method, route, statusClass] = JSON.parse(key) as [string, string, string];
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_class="${escapeLabel(statusClass)}"`;
      lines.push(`schema_guard_http_requests_total{${labels}} ${series.count}`);
    }
    lines.push(
      '# HELP schema_guard_http_request_duration_ms HTTP request duration in milliseconds.',
      '# TYPE schema_guard_http_request_duration_ms histogram',
    );
    for (const [key, series] of [...this.http.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const [method, route, statusClass] = JSON.parse(key) as [string, string, string];
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_class="${escapeLabel(statusClass)}"`;
      for (let index = 0; index < durationBucketsMs.length; index += 1)
        lines.push(
          `schema_guard_http_request_duration_ms_bucket{${labels},le="${durationBucketsMs[index]}"} ${series.buckets[index]}`,
        );
      lines.push(
        `schema_guard_http_request_duration_ms_bucket{${labels},le="+Inf"} ${series.count}`,
        `schema_guard_http_request_duration_ms_sum{${labels}} ${series.durationMs.toFixed(3)}`,
        `schema_guard_http_request_duration_ms_count{${labels}} ${series.count}`,
      );
    }
    const readinessValues: Array<[string, boolean]> = [
      ['draining', readiness.draining],
      ['local_database', readiness.localDatabase],
      ['action_state', readiness.actionState],
      ['control_state', readiness.controlState],
      ['schema_state', readiness.schemaState],
      ['alert_state', readiness.alertState],
      ['intelligence_state', readiness.intelligenceState],
      ['billing_state', readiness.billingState],
    ];
    lines.push(
      '# HELP schema_guard_http_requests_in_flight Requests currently being handled.',
      '# TYPE schema_guard_http_requests_in_flight gauge',
      `schema_guard_http_requests_in_flight ${this.inFlight}`,
      '# HELP schema_guard_http_request_timeouts_total Requests terminated by the service deadline.',
      '# TYPE schema_guard_http_request_timeouts_total counter',
      `schema_guard_http_request_timeouts_total ${this.timeouts}`,
      '# HELP schema_guard_dispatch_failures_total Background delivery dispatch failures.',
      '# TYPE schema_guard_dispatch_failures_total counter',
      `schema_guard_dispatch_failures_total{dispatcher="alert_webhook"} ${this.webhookDispatchFailures}`,
      `schema_guard_dispatch_failures_total{dispatcher="checkpoint_anchor"} ${this.anchorDispatchFailures}`,
      '# HELP schema_guard_dependency_ready Dependency readiness (1 ready, 0 unavailable).',
      '# TYPE schema_guard_dependency_ready gauge',
      ...readinessValues.map(
        ([dependency, ready]) =>
          `schema_guard_dependency_ready{dependency="${dependency}"} ${ready ? 1 : 0}`,
      ),
      '# HELP schema_guard_process_uptime_seconds Managed-service process uptime.',
      '# TYPE schema_guard_process_uptime_seconds gauge',
      `schema_guard_process_uptime_seconds ${((Date.now() - this.startedAt) / 1_000).toFixed(3)}`,
      '# HELP schema_guard_process_resident_memory_bytes Resident memory used by the managed process.',
      '# TYPE schema_guard_process_resident_memory_bytes gauge',
      `schema_guard_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
