const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndicatorVisibilityMonitor } = require('../src/helpers/indicatorVisibility');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('native invisibility triggers recovery even when the window was shown; successful recovery stops retries', async () => {
  let visible = false;
  const attempts = [], errors = [];
  const monitor = createIndicatorVisibilityMonitor({ interval: 5,
    readVisible: async () => visible,
    recover: async attempt => { attempts.push(attempt); visible = true; },
    reportError: error => errors.push(error),
  });
  try { monitor.start(); await delay(60); assert.deepEqual(attempts, [1]); assert.deepEqual(errors, []); }
  finally { monitor.stop(); }
});

test('Space transitions do not trigger repair; persistent failure is bounded and observable', async () => {
  const attempts = [], errors = [];
  let reads = 0;
  const monitor = createIndicatorVisibilityMonitor({ interval: 5,
    readVisible: async () => ++reads === 2,
    recover: async attempt => { attempts.push(attempt); monitor.start(); },
    reportError: error => errors.push(error),
  });
  try {
    monitor.start(); await delay(100);
    assert.deepEqual(attempts, [1, 2]); assert.equal(errors.length, 1);
    const stoppedAt = reads; await delay(20); assert.equal(reads, stoppedAt);
  } finally { monitor.stop(); }
});

test('stopping while a native query is pending cannot resurrect the indicator', async () => {
  let resolve;
  const attempts = [];
  const monitor = createIndicatorVisibilityMonitor({ interval: 5,
    readVisible: () => new Promise(r => { resolve = r; }),
    recover: async attempt => attempts.push(attempt),
    reportError: error => { throw error; },
  });
  monitor.start(); await delay(15); monitor.stop(); resolve(false); await delay(20);
  assert.deepEqual(attempts, []);
});

test('native helper failures are reported, never interpreted as visible', async () => {
  const errors = [];
  const monitor = createIndicatorVisibilityMonitor({ interval: 5,
    readVisible: async () => { throw new Error('native helper unavailable'); },
    recover: async () => assert.fail('cannot recover an unmeasured state'),
    reportError: error => errors.push(error.message),
  });
  monitor.start(); await delay(20); monitor.stop();
  assert.deepEqual(errors, ['native helper unavailable']);
});
