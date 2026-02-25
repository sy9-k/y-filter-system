export const REMOTE_SETTING_KEYS = Object.freeze([
  "blockRules",
  "blockKeywords",
  "enabledCategories",
  "timeConfig",
  "allowList",
  "uiMode",
  "adBlockEnabled",
  "adBlockLevel",
  "blockAllDownloads",
  "blockAllUploads",
  "downloadExtensions",
  "uploadExtensions",
  "downloadBlockedDomains",
  "systemEnabled",
  "learningModeUntil",
  "chromeOsLiteMode",
  "chromeOsOfflineScreen",
  "safeSearchEnabled",
  "accessCode",
  "accessMode",
  "blockedExtensions"
]);

export const DEFAULT_SETTINGS = Object.freeze({
  blockRules: [],
  blockKeywords: [],
  enabledCategories: [],
  timeConfig: { enabled: false, start: "21:00", end: "07:00" },
  allowList: ["search3958.github.io"],
  uiMode: "admin",
  adBlockEnabled: true,
  adBlockLevel: "medium",
  blockAllDownloads: false,
  blockAllUploads: false,
  downloadExtensions: ["exe", "msi"],
  uploadExtensions: [],
  downloadBlockedDomains: [],
  systemEnabled: true,
  learningModeUntil: 0,
  chromeOsLiteMode: false,
  chromeOsOfflineScreen: false,
  safeSearchEnabled: false,
  accessCode: "0000",
  accessMode: 0,
  blockedExtensions: ["exe", "msi"]
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function normalizeStringArray(value, { lower = false } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    let next = normalizeString(String(item || ""));
    if (!next) continue;
    if (lower) next = next.toLowerCase();
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function normalizeRuleList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const pattern = normalizeString(String(item.pattern || ""));
    if (!pattern) continue;
    const category = normalizeString(String(item.category || "未分類")) || "未分類";
    out.push({ pattern, category });
  }
  return out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeTime(value, fallback) {
  const s = normalizeString(String(value || ""));
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : fallback;
}

function normalizeAccessMode(value) {
  const mode = normalizeNumber(value, 0);
  if (mode === 1 || mode === 2) return mode;
  return 0;
}

function normalizeAdBlockLevel(value) {
  const level = normalizeString(String(value || "")).toLowerCase();
  if (level === "low" || level === "high") return level;
  return "medium";
}

function normalizeUiMode(value) {
  const mode = normalizeString(String(value || "")).toLowerCase();
  return mode === "user" ? "user" : "admin";
}

function normalizeTimeConfig(value) {
  const src = isObject(value) ? value : {};
  return {
    enabled: normalizeBoolean(src.enabled, false),
    start: normalizeTime(src.start, "21:00"),
    end: normalizeTime(src.end, "07:00")
  };
}

export function buildDefaultSettings() {
  return {
    blockRules: [],
    blockKeywords: [],
    enabledCategories: [],
    timeConfig: { enabled: false, start: "21:00", end: "07:00" },
    allowList: ["search3958.github.io"],
    uiMode: "admin",
    adBlockEnabled: true,
    adBlockLevel: "medium",
    blockAllDownloads: false,
    blockAllUploads: false,
    downloadExtensions: ["exe", "msi"],
    uploadExtensions: [],
    downloadBlockedDomains: [],
    systemEnabled: true,
    learningModeUntil: 0,
    chromeOsLiteMode: false,
    chromeOsOfflineScreen: false,
    safeSearchEnabled: false,
    accessCode: "0000",
    accessMode: 0,
    blockedExtensions: ["exe", "msi"]
  };
}

export function normalizeSettings(raw = {}) {
  const src = isObject(raw) ? raw : {};
  const out = buildDefaultSettings();

  out.blockRules = normalizeRuleList(src.blockRules);
  out.blockKeywords = normalizeStringArray(src.blockKeywords);
  out.enabledCategories = normalizeStringArray(src.enabledCategories);
  out.timeConfig = normalizeTimeConfig(src.timeConfig);
  out.allowList = normalizeStringArray(src.allowList, { lower: true });
  out.uiMode = normalizeUiMode(src.uiMode);
  out.adBlockEnabled = normalizeBoolean(src.adBlockEnabled, true);
  out.adBlockLevel = normalizeAdBlockLevel(src.adBlockLevel);
  out.blockAllDownloads = normalizeBoolean(src.blockAllDownloads, false);
  out.blockAllUploads = normalizeBoolean(src.blockAllUploads, false);
  out.downloadExtensions = normalizeStringArray(src.downloadExtensions, { lower: true });
  out.uploadExtensions = normalizeStringArray(src.uploadExtensions, { lower: true });
  out.downloadBlockedDomains = normalizeStringArray(src.downloadBlockedDomains, { lower: true });
  out.systemEnabled = normalizeBoolean(src.systemEnabled, true);
  out.learningModeUntil = Math.max(0, normalizeNumber(src.learningModeUntil, 0));
  out.chromeOsLiteMode = normalizeBoolean(src.chromeOsLiteMode, false);
  out.chromeOsOfflineScreen = normalizeBoolean(src.chromeOsOfflineScreen, false);
  out.safeSearchEnabled = normalizeBoolean(src.safeSearchEnabled, false);
  out.accessCode = normalizeString(String(src.accessCode || "0000")) || "0000";
  out.accessMode = normalizeAccessMode(src.accessMode);
  out.blockedExtensions = normalizeStringArray(src.blockedExtensions, { lower: true });

  return out;
}
