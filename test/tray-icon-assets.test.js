const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const TrayManager = require("../src/helpers/tray");

const projectRoot = path.resolve(__dirname, "..");

function readPngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test("macOS tray uses paired Template Image assets", () => {
  const manager = new TrayManager();
  const standardPath = manager.getTrayIconPath("darwin");
  const retinaPath = standardPath.replace(/\.png$/, "@2x.png");

  assert.equal(path.basename(standardPath), "speakslowTemplate.png");
  assert.equal(readPngDimensions(standardPath).width, 16);
  assert.equal(readPngDimensions(standardPath).height, 16);
  assert.equal(readPngDimensions(retinaPath).width, 32);
  assert.equal(readPngDimensions(retinaPath).height, 32);
});

test("other platforms keep their native icon formats", () => {
  const manager = new TrayManager();
  assert.equal(manager.getTrayIconPath("win32"), path.join(projectRoot, "assets", "icon.ico"));
  assert.equal(manager.getTrayIconPath("linux"), path.join(projectRoot, "assets", "icon.png"));
});
