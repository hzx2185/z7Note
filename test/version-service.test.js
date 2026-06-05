const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions,
  startSystemUpdate
} = require('../src/services/versionService');

test('treats latest docker tag as non-comparable', () => {
  assert.equal(compareVersions('1.0.5', 'latest'), null);
  assert.equal(compareVersions('1.0.5', 'v1.0.6'), 1);
});

test('rejects invalid update target docker tags before starting update command', () => {
  const previousCommand = process.env.Z7NOTE_UPDATE_COMMAND;
  process.env.Z7NOTE_UPDATE_COMMAND = 'echo should-not-run';

  try {
    assert.throws(
      () => startSystemUpdate({ targetVersion: 'latest;bad' }),
      error => {
        assert.equal(error.message, 'UPDATE_TARGET_TAG_INVALID');
        assert.equal(error.statusCode, 400);
        return true;
      }
    );
  } finally {
    if (previousCommand === undefined) {
      delete process.env.Z7NOTE_UPDATE_COMMAND;
    } else {
      process.env.Z7NOTE_UPDATE_COMMAND = previousCommand;
    }
  }
});
