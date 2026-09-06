const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isProtectedRendererSetting,
  redactSettingsForRenderer,
} = require("../src/utils/settingsSecurity");

test("renderer 設定快照不包含 API credential", () => {
  const result = redactSettingsForRenderer({
    ai_provider: "deepseek",
    ai_api_key: "TOP-SECRET",
    ai_model: "deepseek-chat",
  });

  assert.deepEqual(result, {
    ai_provider: "deepseek",
    ai_model: "deepseek-chat",
    has_ai_api_key: true,
  });
  assert.equal(isProtectedRendererSetting("ai_api_key"), true);
  assert.equal(isProtectedRendererSetting("ai_model"), false);
});
