const test = require('node:test');
const assert = require('node:assert/strict');
const { PLATFORM_CASES } = require('./fixtures/macos27-native-contract');
const {
  darwinMajor,
  getMacOS27Support,
  isMacOS27OrNewer,
} = require('../src/helpers/macos27Support');

test('macOS 27 support requires Darwin 26+ on Apple Silicon', () => {
  assert.equal(isMacOS27OrNewer(PLATFORM_CASES.supportedMac), true);
  assert.deepEqual(getMacOS27Support(PLATFORM_CASES.oldMac), {
    supported: false,
    reason: 'os_version_unsupported',
    platform: 'darwin',
    arch: 'arm64',
    darwinMajor: 25,
  });
  assert.equal(getMacOS27Support(PLATFORM_CASES.intelMac).reason, 'architecture_unsupported');
  assert.equal(getMacOS27Support(PLATFORM_CASES.windows).reason, 'platform_unsupported');
});

test('invalid Darwin releases fail closed', () => {
  assert.equal(darwinMajor(''), null);
  assert.equal(darwinMajor('not-a-release'), null);
  assert.equal(isMacOS27OrNewer({ platform: 'darwin', arch: 'arm64', release: '' }), false);
});
