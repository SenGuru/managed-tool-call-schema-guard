export function redactEvidence(value) {
  return value
    .replace(/sg_(?:live|test)_[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/(authorization\s*[:=]\s*["']?Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/("api_key"\s*:\s*")[^"]+("?)/g, '$1[REDACTED]$2');
}
