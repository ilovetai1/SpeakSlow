const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const installer = import('../scripts/install-mac.mjs');

function makeApp(app, payload = 'new', id = 'com.speakslow.app') {
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), JSON.stringify({
    CFBundleIdentifier: id, CFBundleExecutable: 'SpeakSlow',
    CFBundleShortVersionString: '2.1.0', CFBundleVersion: '2.1.0', CFBundlePackageType: 'APPL',
  }));
  fs.writeFileSync(path.join(app, 'Contents/MacOS/SpeakSlow'), payload, { mode: 0o755 });
}

function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-install-test-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project'), destination = path.join(temp, 'Applications/SpeakSlow.app');
  const source = path.join(root, 'dist/mac-arm64/SpeakSlow.app');
  const stale = path.join(root, 'dist/older/mac-arm64/SpeakSlow.app');
  makeApp(destination, 'installed'); makeApp(source, 'new'); makeApp(stale, 'stale');
  const archive = path.join(root, 'dist/SpeakSlow-arm64.dmg');
  fs.writeFileSync(archive, 'keep distribution archive');
  const controls = { running: [], tracked: [], failVerify: () => false };
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    switch (path.basename(command)) {
      case 'plutil': return fs.readFileSync(args.at(-1), 'utf8');
      case 'codesign':
        if (controls.failVerify(args.at(-1))) throw new Error('Signature verification failed');
        return '';
      case 'ps': return controls.running.join('\n');
      case 'git': return controls.tracked.includes(args.at(-1)) ? 'tracked-file\0' : '';
      case 'ditto':
        if (controls.failCopy) throw new Error('Copy failed');
        fs.cpSync(args[0], args[1], { recursive: true, verbatimSymlinks: true });
        if (controls.corruptCopy) fs.writeFileSync(path.join(args[1], 'Contents/MacOS/SpeakSlow'), 'truncated');
        return '';
      default: throw new Error(`Unexpected command: ${command}`);
    }
  };
  return { temp, root, destination, source, stale, archive, controls, calls, execute };
}

function installedPayload(f) { return fs.readFileSync(path.join(f.destination, 'Contents/MacOS/SpeakSlow'), 'utf8'); }
function assertNoStaging(f) {
  assert.deepEqual(fs.readdirSync(path.dirname(f.destination)).filter(name => name.startsWith('.speakslow-install-')), []);
}

test('cleanup preserves the running installation, archives and unrelated apps', async t => {
  const f = fixture(t), { cleanupMacApps, findProjectApps } = await installer;
  const unrelated = path.join(f.root, 'dist/Other.app'); makeApp(unrelated, 'other', 'example.other');
  const external = path.join(f.temp, 'external/SpeakSlow.app'); makeApp(external, 'external');
  fs.symlinkSync(path.dirname(external), path.join(f.root, 'linked-output'));
  f.controls.running = [path.join(f.destination, 'Contents/MacOS/SpeakSlow')];
  const report = cleanupMacApps(f);
  assert.equal(report.installedUnchanged, true);
  assert.equal(installedPayload(f), 'installed');
  assert.deepEqual(findProjectApps(f.root), []);
  assert.equal(report.removed.length, 2);
  for (const file of [f.destination, f.archive, unrelated, external]) assert.ok(fs.existsSync(file));
});

test('an invalid installed signature prevents every deletion', async t => {
  const f = fixture(t), { cleanupMacApps } = await installer;
  f.controls.failVerify = app => app === f.destination;
  assert.throws(() => cleanupMacApps(f), /Signature verification failed/);
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
  assert.equal(installedPayload(f), 'installed');
});

test('tracked build copies are rejected before deleting any candidate', async t => {
  const f = fixture(t), { cleanupMacApps } = await installer;
  f.controls.tracked = [path.relative(f.root, f.stale)];
  assert.throws(() => cleanupMacApps(f), /tracked app/);
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
});

test('a running build helper prevents cleanup of all build copies', async t => {
  const f = fixture(t), { cleanupMacApps } = await installer;
  f.controls.running = [path.join(f.stale, 'Contents/Frameworks/SpeakSlow Helper.app/Contents/MacOS/SpeakSlow Helper')];
  assert.throws(() => cleanupMacApps(f), /Quit SpeakSlow/);
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
});

test('unexpected identity in a SpeakSlow.app is rejected before cleanup', async t => {
  const f = fixture(t), { cleanupMacApps } = await installer;
  makeApp(f.stale, 'foreign', 'example.other');
  assert.throws(() => cleanupMacApps(f), /Not a complete com.speakslow.app/);
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
});

test('installation replaces rather than overlays, then removes all build copies', async t => {
  const f = fixture(t), { installMacApp, findProjectApps } = await installer;
  fs.writeFileSync(path.join(f.destination, 'Contents/obsolete-file'), 'old');
  const report = installMacApp(f);
  assert.equal(installedPayload(f), 'new');
  assert.equal(report.signatureVerified, true);
  assert.equal(report.removed.length, 2);
  assert.equal(fs.existsSync(path.join(f.destination, 'Contents/obsolete-file')), false);
  assert.deepEqual(findProjectApps(f.root), []);
  assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), ['SpeakSlow.app']);
  assert.ok(fs.existsSync(f.archive)); assertNoStaging(f);
});

for (const failure of ['failCopy', 'corruptCopy', 'stagedSignature']) {
  test(`${failure} preserves the existing installation and source`, async t => {
    const f = fixture(t), { installMacApp } = await installer;
    if (failure === 'stagedSignature') f.controls.failVerify = app => app.includes('/.speakslow-install-');
    else f.controls[failure] = true;
    assert.throws(() => installMacApp(f), /Copy failed|does not match|Signature verification failed/);
    assert.equal(installedPayload(f), 'installed');
    assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
    assertNoStaging(f);
  });
}

test('a running installed app prevents replacement', async t => {
  const f = fixture(t), { installMacApp } = await installer;
  f.controls.running = [path.join(f.destination, 'Contents/MacOS/SpeakSlow')];
  assert.throws(() => installMacApp(f), /Quit SpeakSlow/);
  assert.equal(installedPayload(f), 'installed');
  assert.ok(fs.existsSync(f.source)); assertNoStaging(f);
});

test('a failed signing command leaves the installation and build copies intact', async t => {
  const f = fixture(t), { installMacApp } = await installer;
  const execute = (command, args) => {
    if (command === process.execPath) throw new Error('Signing failed');
    return f.execute(command, args);
  };
  assert.throws(() => installMacApp({ ...f, identity: '-', execute }), /Signing failed/);
  assert.equal(installedPayload(f), 'installed');
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale)); assertNoStaging(f);
});

test('a failed final signature check keeps the recovery source and skips cleanup', async t => {
  const f = fixture(t), { installMacApp } = await installer;
  f.controls.failVerify = app => app === f.destination;
  assert.throws(() => installMacApp(f), /Signature verification failed/);
  assert.ok(fs.existsSync(f.source)); assert.ok(fs.existsSync(f.stale));
  assertNoStaging(f);
});

test('the installed app and outside-project or symlinked sources cannot be used as build inputs', async t => {
  const f = fixture(t), { installMacApp } = await installer;
  assert.throws(() => installMacApp({ ...f, source: f.destination }), /project build copy/);
  const outside = path.join(f.temp, 'outside/SpeakSlow.app'); makeApp(outside);
  assert.throws(() => installMacApp({ ...f, source: outside }), /project build copy/);
  fs.symlinkSync(path.dirname(outside), path.join(f.root, 'alias'));
  assert.throws(() => installMacApp({ ...f, source: path.join(f.root, 'alias/SpeakSlow.app') }), /symlink ancestors/);
  assert.equal(installedPayload(f), 'installed'); assert.ok(fs.existsSync(outside));
});

test('real macOS signing, ditto, replacement and cleanup work in isolated temporary directories', {
  skip: process.platform !== 'darwin',
}, async t => {
  const f = fixture(t), { installMacApp, cleanupMacApps, findProjectApps } = await installer;
  execFileSync('/usr/bin/git', ['init', '--quiet', f.root]);
  fs.mkdirSync(path.join(f.root, 'scripts'));
  fs.copyFileSync(path.resolve(__dirname, '../scripts/sign-mac-development.mjs'), path.join(f.root, 'scripts/sign-mac-development.mjs'));
  for (const app of [f.source, f.destination]) {
    const executable = path.join(app, 'Contents/MacOS/SpeakSlow');
    fs.copyFileSync('/usr/bin/true', executable);
    fs.chmodSync(executable, 0o755);
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', path.join(app, 'Contents/Info.plist')]);
    if (app === f.destination) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  }
  // Use real platform commands, keeping both source and destination outside /Applications.
  const report = installMacApp({ root: f.root, source: f.source, destination: f.destination, identity: '-' });
  assert.equal(report.signatureVerified, true);
  assert.equal(report.removed.length, 2);
  assert.deepEqual(findProjectApps(f.root), []);
  assert.ok(fs.existsSync(f.archive)); assertNoStaging(f);
  assert.equal(cleanupMacApps({ root: f.root, destination: f.destination }).installedUnchanged, true);
});
