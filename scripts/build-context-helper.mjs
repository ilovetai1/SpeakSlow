import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'darwin') process.exit(0);
mkdirSync(path.join(root, 'native/build'), { recursive: true });
for (const [cmd, args] of [
  ['xcrun', ['swiftc', '-O', path.join(root, 'native/ContextReader.swift'), '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-o', path.join(root, 'native/build/context-reader')]],
  ['codesign', ['--force', '--sign', '-', path.join(root, 'native/build/context-reader')]],
]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
