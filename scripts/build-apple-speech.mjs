import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'darwin') process.exit(0);
const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, 'native/build'), { recursive: true });
const target = path.join(root, 'native/build/apple-speech');
for (const [command, args] of [
  ['xcrun', ['swiftc', '-parse-as-library', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos26.0`, path.join(root, 'native/AppleSpeech.swift'), '-o', target]],
  ['codesign', ['--force', '--sign', '-', target]],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
