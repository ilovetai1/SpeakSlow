const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// Explicit local acceptance runs must not use the normal user database or logs.
function acceptanceConfig(argv = process.argv) {
  const value = key => argv.find(a => a.startsWith(`${key}=`))?.slice(key.length + 1);
  const dataDirectory = value('--acceptance-data-dir');
  const planPath = value('--acceptance-plan');
  if (!dataDirectory) { if (planPath) throw new Error('acceptance_data_required'); return null; }
  if (!path.isAbsolute(dataDirectory)) throw new Error('acceptance_path_invalid');
  const normal = path.join(os.homedir(), 'Library', 'Application Support');
  const resolved = path.resolve(dataDirectory);
  if (resolved.startsWith(normal + path.sep) || resolved === normal || resolved === os.homedir() || resolved === path.parse(resolved).root) throw new Error('acceptance_path_invalid');
  fs.mkdirSync(dataDirectory, { recursive: true });
  const real = fs.realpathSync(dataDirectory);
  if (real.startsWith(normal + path.sep) || real === normal || real === os.homedir() || real === path.parse(real).root) throw new Error('acceptance_path_invalid');
  if (planPath && !path.isAbsolute(planPath)) throw new Error('acceptance_path_invalid');
  return { dataDirectory: real, planPath };
}
module.exports = { acceptanceConfig };
