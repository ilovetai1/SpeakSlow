import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installedApp = '/Applications/SpeakSlow.app';
const bundleID = 'com.speakslow.app';
const skippedDirectories = new Set(['.git', 'node_modules', '.venv', 'python', 'build_pyi', 'poc-sherpa']);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr.trim() || result.status}`);
  }
  return result.stdout;
}

function inspectBundle(appPath, execute) {
  if (!fs.lstatSync(appPath).isDirectory() || fs.realpathSync(appPath) !== appPath) {
    throw new Error(`Expected a real app directory without symlink ancestors: ${appPath}`);
  }
  const info = JSON.parse(execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')]));
  if (info.CFBundleIdentifier !== bundleID || info.CFBundleExecutable !== 'SpeakSlow' ||
      typeof info.CFBundleShortVersionString !== 'string' ||
      !fs.statSync(path.join(appPath, 'Contents/MacOS/SpeakSlow')).isFile()) {
    throw new Error(`Not a complete ${bundleID} app: ${appPath}`);
  }
  return info;
}

function assertProjectApp(appPath, root, destination) {
  const relative = path.relative(root, appPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) || appPath === destination || path.basename(appPath) !== 'SpeakSlow.app') {
    throw new Error(`App must be a project build copy, not the installed app: ${appPath}`);
  }
}

export function findProjectApps(root, destination = installedApp) {
  const apps = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === 'SpeakSlow.app') {
        if (child !== destination) apps.push(child);
      } else if (!entry.name.endsWith('.app') && !skippedDirectories.has(entry.name)) {
        walk(child);
      }
    }
  }
  walk(root);
  return apps.sort();
}

function assertNotRunning(apps, execute) {
  const processes = execute('/bin/ps', ['-axo', 'comm=']).split('\n').map(line => line.trim());
  const running = apps.find(app => processes.some(command => command.startsWith(`${app}/Contents/`)));
  if (running) throw new Error(`Quit SpeakSlow before replacing or removing this app: ${running}`);
}

function planCleanup(root, destination, execute) {
  const apps = findProjectApps(root, destination);
  for (const app of apps) {
    assertProjectApp(app, root, destination);
    inspectBundle(app, execute);
    const tracked = execute('/usr/bin/git', ['-C', root, 'ls-files', '-z', '--', path.relative(root, app)]);
    if (tracked) throw new Error(`Refusing to remove a tracked app: ${app}`);
  }
  assertNotRunning(apps, execute);
  return apps;
}

function verifySignature(app, execute) {
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
}

// Include link destinations and executable permissions so a partial copy cannot pass.
function fingerprint(root) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let allocatedBytes = 0;
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      const relative = path.relative(root, file);
      if (stat.isSymbolicLink()) hash.update(`link:${relative}:${fs.readlinkSync(file)}\n`);
      else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        hash.update(`file:${relative}:${stat.mode & 0o777}\n`);
        const fd = fs.openSync(file, 'r');
        try {
          let bytes;
          while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
        } finally { fs.closeSync(fd); }
        allocatedBytes += stat.blocks * 512;
      } else throw new Error(`Unsupported app entry: ${file}`);
    }
  }
  walk(root);
  return { sha256: hash.digest('hex'), allocatedBytes };
}

function removeProjectApps(apps) {
  const removed = [];
  for (const app of apps) {
    const { allocatedBytes } = fingerprint(app);
    fs.rmSync(app, { recursive: true });
    removed.push({ path: app, allocatedBytes });
  }
  return removed;
}

export function cleanupMacApps({ root = projectRoot, destination = installedApp, execute = run } = {}) {
  root = fs.realpathSync(root);
  const info = inspectBundle(destination, execute);
  verifySignature(destination, execute);
  const before = fingerprint(destination);
  const apps = planCleanup(root, destination, execute);
  const removed = removeProjectApps(apps);
  verifySignature(destination, execute);
  if (fingerprint(destination).sha256 !== before.sha256) throw new Error('Installed app changed during cleanup.');
  if (findProjectApps(root, destination).length) throw new Error('Project app copies remain after cleanup.');
  return { installedApp: destination, version: info.CFBundleShortVersionString, removed, installedUnchanged: true };
}

export function installMacApp({ root = projectRoot, destination = installedApp, source, identity, execute = run } = {}) {
  root = fs.realpathSync(root);
  source = path.resolve(source || path.join(root, 'dist/mac-arm64/SpeakSlow.app'));
  assertProjectApp(source, root, destination);
  const info = inspectBundle(source, execute);
  if (fs.existsSync(destination)) inspectBundle(destination, execute);
  // Preflight every candidate before signing, copying or replacing anything.
  const apps = planCleanup(root, destination, execute);
  if (!apps.includes(source)) throw new Error(`Source is outside the managed project cleanup scope: ${source}`);
  assertNotRunning([...apps, destination], execute);
  if (identity) execute(process.execPath, [path.join(root, 'scripts/sign-mac-development.mjs'), source, identity]);
  verifySignature(source, execute);
  const expected = fingerprint(source).sha256;
  const stage = fs.mkdtempSync(path.join(path.dirname(destination), '.speakslow-install-'));
  const stagedApp = path.join(stage, 'SpeakSlow.app');
  try {
    execute('/usr/bin/ditto', [source, stagedApp]);
    inspectBundle(stagedApp, execute);
    verifySignature(stagedApp, execute);
    if (fingerprint(stagedApp).sha256 !== expected) throw new Error('Staged app does not match the source.');
    assertNotRunning([...apps, destination], execute);
    // The new copy is complete and verified before the old installation is removed.
    // No old .app backup is created. A failed install keeps the project source.
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true });
    fs.renameSync(stagedApp, destination);
    verifySignature(destination, execute);
    if (fingerprint(destination).sha256 !== expected) throw new Error('Installed app does not match the source.');
    const removed = removeProjectApps(apps);
    if (findProjectApps(root, destination).length) throw new Error('Project app copies remain after installation.');
    return { installedApp: destination, version: info.CFBundleShortVersionString, removed, signatureVerified: true };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    source: { type: 'string' }, identity: { type: 'string' },
    'cleanup-only': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run install:mac -- [--source /absolute/project/path/SpeakSlow.app] [--identity "-"]\n' +
      '       npm run install:mac -- --cleanup-only\n' +
      'Destination: /Applications/SpeakSlow.app. Successful installation removes project .app copies; DMG/ZIP files are kept.\n' +
      'Close SpeakSlow before installing. --identity delegates local development signing (no notarization).\n');
    return;
  }
  if (process.platform !== 'darwin') throw new Error('This installer only supports macOS.');
  if (values['cleanup-only'] && (values.source || values.identity)) throw new Error('--cleanup-only cannot be combined with --source or --identity.');
  const report = values['cleanup-only'] ? cleanupMacApps() : installMacApp(values);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(`SpeakSlow installation failed: ${error.message}\n`); process.exitCode = 1; }
}
