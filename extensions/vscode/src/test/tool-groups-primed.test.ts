import test from 'node:test';
import assert from 'node:assert/strict';
import { selectToolGroups } from '../tool-groups.js';
import { extractStructuredPassEnvelope } from '../autonomy-structured.js';

const AVAILABLE = [
  'query_resource',
  'graph_rag_retrieve',
  'read_source_code',
  'list_directory',
  'scan_database',
  'scan_project',
  'init_graph',
  'extract_api_surface',
  'dream_cycle',
  'normalize_dreams',
  'enrich_seed_data',
];

test('primed tool is exposed even when next prompt is terse', () => {
  const decision = selectToolGroups({
    task: 'chat',
    prompt: 'yes',
    autonomy: false,
    availableToolNames: AVAILABLE,
    primedTools: ['scan_database'],
  });
  assert.ok(decision.selected.includes('scan_database'),
    `expected scan_database in selection, got [${decision.selected.join(', ')}]`);
});

test('priming a tool also exposes its sibling group members', () => {
  const decision = selectToolGroups({
    task: 'chat',
    prompt: 'do it',
    autonomy: false,
    availableToolNames: AVAILABLE,
    primedTools: ['scan_project'],
  });
  // scan_project lives in project_scan group alongside init_graph + extract_api_surface
  assert.ok(decision.selected.includes('scan_project'));
  assert.ok(decision.selected.includes('init_graph'));
  assert.ok(decision.selected.includes('extract_api_surface'));
});

test('primed tools that are not in availableToolNames are skipped', () => {
  const decision = selectToolGroups({
    task: 'chat',
    prompt: 'yes',
    autonomy: false,
    availableToolNames: AVAILABLE,
    primedTools: ['nonexistent_tool'],
  });
  assert.ok(!decision.selected.includes('nonexistent_tool'));
});

test('no primed tools behaves identically to omitting the field', () => {
  const a = selectToolGroups({
    task: 'chat',
    prompt: 'hello',
    autonomy: false,
    availableToolNames: AVAILABLE,
  });
  const b = selectToolGroups({
    task: 'chat',
    prompt: 'hello',
    autonomy: false,
    availableToolNames: AVAILABLE,
    primedTools: [],
  });
  assert.deepEqual(a.selected, b.selected);
});

test('envelope tool/tool_args fields survive structured extraction', () => {
  const content = [
    'Here is what I suggest.',
    '',
    '```json',
    '{',
    '  "summary": "low graph density",',
    '  "recommended_next_steps": [',
    '    {',
    '      "id": "run-dream",',
    '      "label": "Run a dream cycle",',
    '      "tool": "dream_cycle",',
    '      "tool_args": { "strategy": "gap_detection" }',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');
  const env = extractStructuredPassEnvelope(content);
  assert.equal(env.nextSteps.length, 1);
  assert.equal(env.nextSteps[0].tool, 'dream_cycle');
  assert.deepEqual(env.nextSteps[0].toolArgs, { strategy: 'gap_detection' });
});

test('envelope without tool field leaves action.tool undefined', () => {
  const content = [
    '```json',
    '{',
    '  "summary": "refactor needed",',
    '  "recommended_next_steps": [',
    '    { "label": "Refactor module" }',
    '  ]',
    '}',
    '```',
  ].join('\n');
  const env = extractStructuredPassEnvelope(content);
  assert.equal(env.nextSteps.length, 1);
  assert.equal(env.nextSteps[0].tool, undefined);
  assert.equal(env.nextSteps[0].toolArgs, undefined);
});
