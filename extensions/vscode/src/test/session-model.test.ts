import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionAutonomyModel,
  renderSessionAutonomyMeta,
  withRunningAction,
  withSelectedAction,
  withStoppedAction,
} from '../webview/session-model.js';

test('session autonomy model renders selection and running states', () => {
  const selected = withSelectedAction(createSessionAutonomyModel(), 'm1', ['a1'], 'User selected next step');
  assert.match(renderSessionAutonomyMeta(selected), /Action selected/);

  const running = withRunningAction(selected, 'Continuing automatically');
  assert.match(renderSessionAutonomyMeta(running), /Autonomy running/);
});

test('session autonomy model renders stopped state', () => {
  const stopped = withStoppedAction(createSessionAutonomyModel(), 'Stopped: goal sufficiently reached');
  assert.match(renderSessionAutonomyMeta(stopped), /Autonomy stopped/);
});
