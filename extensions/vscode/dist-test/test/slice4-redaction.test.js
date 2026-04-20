"use strict";
/**
 * Slice 4 unit tests — secret redaction helper semantics.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const SECRET_PATTERNS = [
    /(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi,
    /(?:sk-|pk-|ghp_|gho_|github_pat_)\S+/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];
function redactSecrets(content) {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (match) => {
        const sepMatch = match.match(/[:=]\s*/);
        if (sepMatch && typeof sepMatch.index === 'number') {
            return match.slice(0, sepMatch.index + sepMatch[0].length) + '****';
        }
        return match.slice(0, 8) + '****';
    }), content);
}
(0, node_test_1.default)('T-S2.1: key-value secrets are redacted', () => {
    const out = redactSecrets('api_key: abc123 secret=hello password = hunter2');
    strict_1.default.match(out, /api_key: \*\*\*\*/);
    strict_1.default.match(out, /secret=\*\*\*\*/);
    strict_1.default.match(out, /password = \*\*\*\*/);
    strict_1.default.doesNotMatch(out, /abc123|hello|hunter2/);
});
(0, node_test_1.default)('T-S2.2: token-like prefixes are partially masked', () => {
    const out = redactSecrets('token sk-abcdef123456 ghp_1234567890');
    strict_1.default.match(out, /sk-abcde\*\*\*\*/);
    strict_1.default.match(out, /ghp_1234\*\*\*\*/);
    strict_1.default.doesNotMatch(out, /abcdef123456|ghp_1234567890$/);
});
(0, node_test_1.default)('T-S2.3: private key blocks are redacted', () => {
    const out = redactSecrets('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
    strict_1.default.match(out, /^-----BEG\*\*\*\*/);
    strict_1.default.doesNotMatch(out, /abc|END PRIVATE KEY/);
});
//# sourceMappingURL=slice4-redaction.test.js.map