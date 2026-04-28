import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAIResponsesRequest,
  extractOpenAIResponsesText,
  extractOpenAIResponsesToolCalls,
  translateRawToOpenAIResponses,
  usesOpenAIResponsesApi,
} from '../openai-responses-adapter';

test('routes only GPT-5.5 model slugs to the Responses API', () => {
  assert.equal(usesOpenAIResponsesApi('gpt-5.5'), true);
  assert.equal(usesOpenAIResponsesApi(' GPT-5.5-2026-04-27 '), true);
  assert.equal(usesOpenAIResponsesApi('gpt-5.4'), false);
  assert.equal(usesOpenAIResponsesApi('gpt-5'), false);
});

test('builds a GPT-5.5 Responses request with reasoning, verbosity, and function tools', () => {
  const body = buildOpenAIResponsesRequest(
    [{ role: 'user', content: 'Inspect the graph' }],
    {
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      textVerbosity: 'low',
      tools: [
        {
          name: 'query_resource',
          description: 'Query graph resources',
          inputSchema: {
            type: 'object',
            properties: { uri: { type: 'string' } },
            required: ['uri'],
          },
        },
      ],
    },
  );

  assert.equal(body.model, 'gpt-5.5');
  assert.equal(body.max_output_tokens, 16384);
  assert.deepEqual(body.reasoning, { effort: 'medium' });
  assert.deepEqual(body.text, { verbosity: 'low' });
  assert.deepEqual(body.input, [{ role: 'user', content: 'Inspect the graph' }]);
  assert.deepEqual(body.tools, [
    {
      type: 'function',
      name: 'query_resource',
      description: 'Query graph resources',
      parameters: {
        type: 'object',
        properties: { uri: { type: 'string' } },
        required: ['uri'],
      },
    },
  ]);
});

test('translates Architect tool history into Responses function-call items', () => {
  const translated = translateRawToOpenAIResponses([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will query the graph.' },
        { type: 'tool_use', id: 'call_1', name: 'query_resource', input: { uri: 'dream://adrs' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: [{ id: 'ADR-086' }] },
      ],
    },
  ]);

  assert.deepEqual(translated, [
    { role: 'assistant', content: 'I will query the graph.' },
    {
      type: 'function_call',
      call_id: 'call_1',
      name: 'query_resource',
      arguments: JSON.stringify({ uri: 'dream://adrs' }),
    },
    {
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify([{ id: 'ADR-086' }]),
    },
  ]);
});

test('skips malformed raw replay items instead of emitting invalid Responses items', () => {
  const translated = translateRawToOpenAIResponses([
    null,
    'not a message',
    { role: 'assistant', content: [{ type: 'tool_use', id: '', name: 'query_resource', input: {} }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_missing_name', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', content: 'missing tool id' }] },
    { role: 'user', content: [{ type: 'unknown', text: 'ignored' }] },
    { role: 'system', content: 'Keep responses concise.' },
  ]);

  assert.deepEqual(translated, [
    { role: 'system', content: 'Keep responses concise.' },
  ]);
});

test('extracts text while safely ignoring unknown Responses output items', () => {
  const text = extractOpenAIResponsesText({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'web_search_call', id: 'search_1', status: 'completed' },
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Known text. ' },
          { type: 'unknown_block', text: 'ignored' },
        ],
      },
      { type: 'text', text: 'Fallback text.' },
    ],
  });

  assert.equal(text, 'Known text. Fallback text.');
});

test('inserts a paragraph break between adjacent verbose-mode message items lacking surrounding whitespace', () => {
  // Reproduces the GPT-5.5 verbose-mode bug where consecutive top-level
  // messages were concatenated tightly, producing
  // "...stale references.Autonomy counters: steps=54..." in the chat.
  const text = extractOpenAIResponsesText({
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Resuming by patching final stale version references.' },
        ],
      },
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Autonomy counters: steps=54, writes=19, stalls=1.' },
        ],
      },
    ],
  });

  assert.equal(
    text,
    'Resuming by patching final stale version references.\n\nAutonomy counters: steps=54, writes=19, stalls=1.',
  );
});

test('keeps streamed sub-blocks within a single message tightly joined', () => {
  const text = extractOpenAIResponsesText({
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Step 1: ' },
          { type: 'output_text', text: 'reading file.' },
        ],
      },
    ],
  });

  assert.equal(text, 'Step 1: reading file.');
});

test('extracts function calls and hardens malformed or unknown items', () => {
  const calls = extractOpenAIResponsesToolCalls({
    output: [
      { type: 'reasoning', id: 'rs_1' },
      { type: 'function_call', call_id: 'call_valid', name: 'read_source_code', arguments: '{"filePath":"src/a.ts"}' },
      { type: 'function_call', call_id: 'call_malformed', name: 'query_resource', arguments: '{bad json' },
      { type: 'function_call', call_id: 'call_missing_name', arguments: '{}' },
      { type: 'function_call', name: 'missing_id', arguments: '{}' },
      { type: 'custom_tool_call', name: 'unsupported', input: '{}' },
    ],
  });

  assert.deepEqual(calls, [
    { id: 'call_valid', name: 'read_source_code', input: { filePath: 'src/a.ts' } },
    { id: 'call_malformed', name: 'query_resource', input: { arguments: '{bad json' } },
  ]);
});
