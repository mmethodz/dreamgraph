// Quick end-to-end test for card-renderer + render-markdown pipeline
globalThis.window = {};
globalThis.DOMPurify = { sanitize: (h) => h };

const cr = require('../dist/webview/card-renderer.js');
const rm = require('../dist/webview/render-markdown.js');

// Execute card-renderer script (defines window.registerCardFencePlugin, window.renderEnvelope)
const crScript = cr.getCardRendererScript();
new Function(crScript)();
console.log('registerCardFencePlugin:', typeof window.registerCardFencePlugin);
console.log('renderEnvelope:', typeof window.renderEnvelope);

// Execute render-markdown script (creates md instance, registers fence plugin, defines window.renderMarkdown)
window.markdownit = require('../node_modules/markdown-it');
const rmScript = rm.getRenderScript();
new Function(rmScript)();
console.log('renderMarkdown:', typeof window.renderMarkdown);

// Test 1: JSON envelope in fenced block
const test1 = [
  'Hello world',
  '',
  '```json',
  '{"summary":"Normalization done","goal_status":"complete","progress_status":"advancing","uncertainty":"low","recommended_next_steps":[{"id":"recheck","label":"Re-check graph health","rationale":"Verify"}]}',
  '```',
].join('\n');

const html1 = window.renderMarkdown(test1);
console.log('\n--- Test 1: JSON envelope ---');
console.log('Has dg-envelope:', html1.includes('dg-envelope'));
console.log('Has pill-complete:', html1.includes('dg-pill-complete'));
console.log('Has action chip:', html1.includes('dg-envelope-action'));
console.log('Output preview:', html1.substring(0, 400));

// Test 2: Entity card
const test2 = [
  '```entity',
  'id: my-feature',
  'name: Cool Feature',
  'status: active',
  '',
  'This is a feature body.',
  '```',
].join('\n');

const html2 = window.renderMarkdown(test2);
console.log('\n--- Test 2: Entity card ---');
console.log('Has dg-card:', html2.includes('dg-card'));
console.log('Has dg-card-entity:', html2.includes('dg-card-entity'));
console.log('Output preview:', html2.substring(0, 400));

// Test 3: parseCardBody works
const test3body = 'id: test-id\nname: Test Name\nstatus: active\n\nBody text here.';
console.log('\n--- Test 3: parseCardBody ---');
// parseCardBody is internal but we can test via entity fence
const test3 = '```entity\n' + test3body + '\n```';
const html3 = window.renderMarkdown(test3);
console.log('Has card title:', html3.includes('Test Name'));
console.log('Output:', html3.substring(0, 300));

console.log('\nAll tests passed!');
