import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'darwin') process.exit(0);
if (process.arch !== 'arm64') throw new Error('Apple Foundation Models helper requires arm64');

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'native/build');
mkdirSync(directory, { recursive: true });
const target = path.join(directory, 'apple-foundation-models');
const temporary = `${target}.building-${process.pid}`;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Apple Foundation Models build failed: ${command}`);
}

try {
  run('xcrun', ['--sdk', 'macosx', 'swiftc', '-parse-as-library', '-O',
    '-target', 'arm64-apple-macos27.0', '-framework', 'FoundationModels',
    path.join(root, 'native/AppleFoundationModels.swift'), '-o', temporary]);
  run('codesign', ['--force', '--sign', '-', temporary]);
  run('codesign', ['--verify', '--strict', temporary]);
  // A failed build never replaces a working binary, and still exits non-zero.
  renameSync(temporary, target);
} finally {
  rmSync(temporary, { force: true });
}
