import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform === 'darwin') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const target = path.join(root, 'native/build/window-visibility');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const [command, args] of [
    ['swiftc', ['-O', path.join(root, 'native/window-visibility.swift'), '-o', target]],
    ['codesign', ['--force', '--sign', '-', target]],
  ]) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}
