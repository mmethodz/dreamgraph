/**
 * Slice 4 unit tests — secret redaction helper semantics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi,
  /(?:sk-|pk-|ghp_|gho_|github_pat_)\S+/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];

function redactSecrets(content: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) =>
    text.replace(pattern, (match) => {
      const sepMatch = match.match(/[:=]\s*/);
      if (sepMatch && typeof sepMatch.index === 'number') {
        return match.slice(0, sepMatch.index + sepMatch[0].length) + '****';
      }
      return match.slice(0, 8) + '****';
    }),
    content,
  );
}

test('T-S2.1: key-value secrets are redacted', () => {
  const out = redactSecrets('api_key: abc123 secret=hello password = hunter2');
  assert.match(out, /api_key: \*\*\*\*/);
  assert.match(out, /secret=\*\*\*\*/);
  assert.match(out, /password = \*\*\*\*/);
  assert.doesNotMatch(out, /abc123|hello|hunter2/);
});

test('T-S2.2: token-like prefixes are partially masked', () => {
  const out = redactSecrets('token sk-abcdef123456 ghp_1234567890');
  assert.match(out, /sk-abcde\*\*\*\*/);
  assert.match(out, /ghp_1234\*\*\*\*/);
  assert.doesNotMatch(out, /abcdef123456|ghp_1234567890$/);
});

test('T-S2.3: private key blocks are redacted', () => {
  const out = redactSecrets('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  assert.match(out, /^-----BEG\*\*\*\*/);
  assert.doesNotMatch(out, /abc|END PRIVATE KEY/);
});
