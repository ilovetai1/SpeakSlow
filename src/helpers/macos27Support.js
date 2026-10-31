const os = require('node:os');

const MINIMUM_DARWIN_MAJOR = 26;

function darwinMajor(release) {
  const value = Number.parseInt(String(release || '').split('.')[0], 10);
  return Number.isInteger(value) ? value : null;
}

function getMacOS27Support({
  platform = process.platform,
  arch = process.arch,
  release = os.release(),
} = {}) {
  if (platform !== 'darwin') {
    return { supported: false, reason: 'platform_unsupported', platform, arch, darwinMajor: null };
  }
  if (arch !== 'arm64') {
    return { supported: false, reason: 'architecture_unsupported', platform, arch, darwinMajor: darwinMajor(release) };
  }
  const major = darwinMajor(release);
  if (major === null || major < MINIMUM_DARWIN_MAJOR) {
    return { supported: false, reason: 'os_version_unsupported', platform, arch, darwinMajor: major };
  }
  return { supported: true, reason: null, platform, arch, darwinMajor: major };
}

function isMacOS27OrNewer(runtime) {
  return getMacOS27Support(runtime).supported;
}

module.exports = {
  MINIMUM_DARWIN_MAJOR,
  darwinMajor,
  getMacOS27Support,
  isMacOS27OrNewer,
};
