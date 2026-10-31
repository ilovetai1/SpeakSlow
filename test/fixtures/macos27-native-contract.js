const MACOS_27_ARM64 = Object.freeze({
  platform: 'darwin',
  arch: 'arm64',
  release: '26.0.0',
  osVersion: '27.0',
});

const PLATFORM_CASES = Object.freeze({
  supportedMac: MACOS_27_ARM64,
  oldMac: Object.freeze({ platform: 'darwin', arch: 'arm64', release: '25.6.0', osVersion: '26.6' }),
  intelMac: Object.freeze({ platform: 'darwin', arch: 'x64', release: '26.0.0', osVersion: '27.0' }),
  windows: Object.freeze({ platform: 'win32', arch: 'x64', release: '10.0.26100', osVersion: '11' }),
});

const SETTING_CASES = Object.freeze({
  fresh: Object.freeze({}),
  legacySherpa: Object.freeze({ asr_engine: 'sherpa', apple_speech_profile: 'responsive' }),
  validApple: Object.freeze({ asr_engine: 'apple', apple_speech_profile: 'dictation' }),
  invalidEngine: Object.freeze({ asr_engine: 'unexpected', apple_speech_profile: 'accurate' }),
});

const APPLE_STATUS_CASES = Object.freeze({
  ready: Object.freeze({
    available: true,
    status: 'available',
    locale: 'zh-TW',
    modelVariant: 'system-default',
    contextSize: 8192,
  }),
  unavailable: Object.freeze({
    available: false,
    status: 'unavailable',
    reason: 'model_not_ready',
  }),
});

const PROTOCOL_CASES = Object.freeze({
  invalidJson: '{not-json}\n',
  wrongVersion: Object.freeze({ version: 999, type: 'probe', id: 'wrong-version' }),
  terminalError: Object.freeze({
    version: 1,
    type: 'error',
    id: 'terminal-error',
    code: 'guardrail_blocked',
    terminal: true,
  }),
});

const PRIVATE_SENTINEL = 'SPEAKSLOW_PRIVATE_SENTINEL_27_3500_NEGATION';

module.exports = {
  MACOS_27_ARM64,
  PLATFORM_CASES,
  SETTING_CASES,
  APPLE_STATUS_CASES,
  PROTOCOL_CASES,
  PRIVATE_SENTINEL,
};
