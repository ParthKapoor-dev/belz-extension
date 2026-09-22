// Shared helpers for the AD Network DevTools panel.
//
// The Automation Designer "chain" API is hit two ways:
//   - definition fetch  GET /rest/api/automation/chain[/v2]/<uuid>
//   - execution         POST /rest/api/automation/chain/[test/]execute/<uuid>
// A definition fetch returns the full method definition, so the human-readable
// method name can be read straight out of that response body. An `execute`
// response carries no name — those uuids are resolved via api.ts against
// the platform's own chain endpoint on the inspected host.

import { CHAIN_PATH_RE } from '../../config/endpoints';
import type { ChainRequestInfo } from './types';

const EXECUTE_RE = /\/chain\/(?:test\/)?execute\//i;
const UUID_GLOBAL_RE = /[0-9a-f]{32}/gi;

export { CHAIN_PATH_RE };

/** Classify an AD chain request URL, or null when it is not one. */
export function classifyChainUrl(url: unknown): ChainRequestInfo | null {
  if (typeof url !== 'string' || !CHAIN_PATH_RE.test(url)) return null;
  const path = url.split('?')[0] ?? '';
  const found = path.match(UUID_GLOBAL_RE);
  if (!found || found.length === 0) return null;
  return {
    uuid: found[found.length - 1]!.toLowerCase(),
    kind: EXECUTE_RE.test(url) ? 'execute' : 'fetch',
    version: /\/chain\/v2\//i.test(url) ? 'v2' : 'v1'
  };
}

export function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function nameFromDefinition(def: unknown): string | null {
  if (!def || typeof def !== 'object') return null;
  const d = def as { name?: unknown; methodName?: unknown; metadata?: { name?: unknown; methodName?: unknown } };
  return firstString(d.name, d.methodName, d.metadata?.name, d.metadata?.methodName);
}

/**
 * Extract the method name from a chain definition-fetch response. Accepts the
 * raw response (a JSON string or an already-parsed object) and handles V1
 * (stringified `jsonDefinition`) and V2 (`metadata`) shapes defensively.
 */
export function extractMethodNameFromChainResponse(body: unknown): string | null {
  let obj: unknown = body;
  if (typeof body === 'string') {
    if (!body.trim()) return null;
    try {
      obj = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const direct = nameFromDefinition(obj);
  if (direct) return direct;

  let def: unknown = (obj as { jsonDefinition?: unknown }).jsonDefinition;
  if (typeof def === 'string') {
    try {
      def = JSON.parse(def);
    } catch {
      def = null;
    }
  }
  return nameFromDefinition(def);
}
