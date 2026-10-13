const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const macTest = (name, run) => test(name, { skip: process.platform !== 'darwin' }, run);

function harness({ exitCodes = [], onDispatch } = {}) {
  let clipboardText = '使用者原有剪貼簿';
  const received = [];
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return {
      clipboard: { readText: () => clipboardText, writeText: text => { clipboardText = text; } },
    };
    if (name === 'osascript') return {};
    if (name === 'child_process') return {
      ...originalLoad.call(this, name, ...args),
      spawn: () => {
        const child = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {},
        });
        setImmediate(() => {
          received.push(clipboardText);
          onDispatch?.(text => { clipboardText = text; });
          child.emit('close', exitCodes.shift() ?? 0);
        });
        return child;
      },
    };
    return originalLoad.call(this, name, ...args);
  };
  let manager;
  try {
    delete require.cache[require.resolve('../src/helpers/clipboard')];
    const ClipboardManager = require('../src/helpers/clipboard');
    manager = new ClipboardManager({ info() {} });
    manager.checkAccessibilityPermissions = async () => true;
  } finally { Module._load = originalLoad; }
  return { manager, received, clipboard: () => clipboardText };
}

macTest('連續兩次貼上時，前一次的還原不得覆蓋後一次尚未貼出的逐字稿', async () => {
  const h = harness();
  await h.manager.pasteText('第一段逐字稿', { target: 'current' });
  await h.manager.pasteText('第二段逐字稿', { target: 'current' });
  assert.deepEqual(h.received, ['第一段逐字稿', '第二段逐字稿']);
  assert.equal(h.clipboard(), '使用者原有剪貼簿');
});

macTest('同時到達的貼上請求依序執行完整剪貼簿交易', async () => {
  const h = harness();
  await Promise.all([
    h.manager.pasteText('第一段', { target: 'current' }),
    h.manager.pasteText('第二段', { target: 'current' }),
    h.manager.pasteText('第三段', { target: 'current' }),
  ]);
  assert.deepEqual(h.received, ['第一段', '第二段', '第三段']);
  assert.equal(h.clipboard(), '使用者原有剪貼簿');
});

macTest('失敗會傳回呼叫端，且不阻塞之後的明確貼上請求', async () => {
  const h = harness({ exitCodes: [1, 0] });
  await assert.rejects(h.manager.pasteText('失敗文字', { target: 'current' }), /代码 1/);
  assert.equal(h.clipboard(), '失敗文字');
  await h.manager.pasteText('重試文字', { target: 'current' });
  assert.deepEqual(h.received, ['失敗文字', '重試文字']);
});

macTest('使用者在貼上送出後另行複製，不被延遲還原覆蓋', async () => {
  const h = harness({ onDispatch: copy => copy('使用者新複製的內容') });
  await h.manager.pasteText('逐字稿', { target: 'current' });
  assert.equal(h.clipboard(), '使用者新複製的內容');
});
