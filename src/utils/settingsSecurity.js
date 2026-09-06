const PROTECTED_RENDERER_SETTING_KEYS = new Set(["ai_api_key"]);

function isProtectedRendererSetting(key) {
  return PROTECTED_RENDERER_SETTING_KEYS.has(key);
}

function redactSettingsForRenderer(settings) {
  const safeSettings = { ...(settings || {}) };
  const hasAIAPIKey = Boolean(safeSettings.ai_api_key);
  delete safeSettings.ai_api_key;
  safeSettings.has_ai_api_key = hasAIAPIKey;
  return safeSettings;
}

module.exports = { isProtectedRendererSetting, redactSettingsForRenderer };
