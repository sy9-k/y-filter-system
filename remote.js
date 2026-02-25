import { CATEGORY_DATA } from "./categories.js";
import { buildDefaultSettings, normalizeSettings } from "./settings-schema.js";
import {
  ensureRemoteDeviceRegistered,
  getRemoteDeviceSettings,
  listRemoteDevices,
  sanitizeUuid,
  saveRemoteDeviceSettings,
  updateRemoteDeviceName
} from "./remote-sync.js";

const PRESETS = {
  focus: ["SNS・チャット", "動画・ストリーミング", "ゲーム", "匿名掲示板", "ポイ活・クーポン"],
  school: ["アダルトコンテンツ", "犯罪・暴力", "自傷・自殺", "不正IT・ハッキング", "ギャンブル・タバコ", "誹謗中傷・宗教", "匿名掲示板", "SNS・チャット", "ゲーム", "動画・ストリーミング"],
  work: ["SNS・チャット", "動画・ストリーミング", "ゲーム", "ポイ活・クーポン", "オークション・フリマ", "総合EC", "ファッション・雑貨"]
};

const ACCESS_CODE_KEY = "accessCode";
const ACCESS_MODE_KEY = "accessMode";

let currentDeviceUuid = "";
let currentLearningModeUntil = 0;
let remoteDevices = [];

function renderBlockedPage() {
  document.body.innerHTML = `
    <div style="font-family:Roboto, sans-serif; background:#f7f9ff; min-height:100vh; padding:24px;">
      <div style="max-width:980px; margin:0 auto; background:#fff; border-radius:28px; box-shadow:0 4px 12px rgba(0,0,0,0.05); overflow:hidden;">
        <div style="padding:20px 28px; background:#f2f5ff; border-bottom:1px solid #dce2f0; display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:22px; font-weight:800; color:#2a57b7;">Y-FILTER.</div>
          <div style="font-size:12px;color:#5f6368;">Remote Settings</div>
        </div>
        <div style="padding:28px;">
          <div style="background:#eff1f9; border:1px solid #dce2f0; border-radius:20px; padding:20px;">
            <h3 style="margin:0 0 8px;">現在開けません</h3>
            <p style="margin:0; color:#5f6368; font-size:13px; line-height:1.6;">このページは現在アクセスできません。管理者が許可した場合のみ開けます。</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatTimestamp(ts) {
  const n = Number(ts || 0);
  if (!n) return "-";
  try {
    return new Date(n).toLocaleString();
  } catch (e) {
    return "-";
  }
}

function setMessage(text, isError = false) {
  const msg = document.getElementById("msg");
  if (!msg) return;
  msg.style.color = isError ? "#b3261e" : "#006a6a";
  msg.textContent = text || "";
}

function renderLearningStatus() {
  const learningStatus = document.getElementById("learning-status");
  if (!learningStatus) return;
  if (currentLearningModeUntil > Date.now()) {
    const mins = Math.ceil((currentLearningModeUntil - Date.now()) / 60000);
    learningStatus.textContent = `学習モード中（残り約 ${mins} 分）`;
  } else {
    learningStatus.textContent = "停止中";
  }
}

function updateStatusIndicators(data) {
  const onOff = (v) => (v ? "○" : "×");
  const adEnabled = data.adBlockEnabled !== false;
  const systemEnabled = data.systemEnabled !== false;
  const learningActive = data.learningModeUntil > Date.now();
  const timeEnabled = data.timeConfig?.enabled === true;
  const offlineEnabled = !!data.chromeOsOfflineScreen;
  const liteEnabled = !!data.chromeOsLiteMode;
  const uploadEnabled = !!data.blockAllUploads || (data.uploadExtensions || []).length > 0;
  const downloadEnabled = !!data.blockAllDownloads || (data.downloadExtensions || []).length > 0 || (data.downloadBlockedDomains || []).length > 0;
  const accessEnabled = (data.enabledCategories || []).length > 0 || (data.blockRules || []).length > 0 || (data.blockKeywords || []).length > 0 || (data.timeConfig?.enabled === true);

  const byId = (id) => document.getElementById(id);
  const statusSystemEl = byId("status-system");
  const monitoringEl = byId("status-monitoring");
  const adsEl = byId("status-ads");
  const dlEl = byId("status-download");
  const accessEl = byId("status-access");
  const learningEl = byId("status-learning");
  const timeEl = byId("status-time");
  const offlineStatusEl = byId("status-offline");
  const liteStatusEl = byId("status-lite");
  const uploadEl = byId("status-upload");
  const adsLevelEl = byId("status-ads-level");

  if (statusSystemEl) statusSystemEl.textContent = onOff(systemEnabled);
  if (monitoringEl) monitoringEl.textContent = onOff(systemEnabled);
  if (adsEl) adsEl.textContent = onOff(systemEnabled && adEnabled);
  if (dlEl) dlEl.textContent = onOff(systemEnabled && downloadEnabled);
  if (accessEl) accessEl.textContent = onOff(systemEnabled && accessEnabled);
  if (learningEl) learningEl.textContent = onOff(learningActive);
  if (timeEl) timeEl.textContent = onOff(systemEnabled && timeEnabled);
  if (offlineStatusEl) offlineStatusEl.textContent = onOff(systemEnabled && offlineEnabled);
  if (liteStatusEl) liteStatusEl.textContent = onOff(systemEnabled && liteEnabled);
  if (uploadEl) uploadEl.textContent = onOff(systemEnabled && uploadEnabled);
  if (adsLevelEl) adsLevelEl.textContent = adEnabled ? (data.adBlockLevel || "medium") : "-";

  renderLearningStatus();
}

function setupCategoryUI() {
  const container = document.getElementById("category-options");
  if (!container) return;
  container.innerHTML = "";
  Object.keys(CATEGORY_DATA).forEach((cat) => {
    const label = document.createElement("label");
    label.style.display = "block";
    label.innerHTML = `<input type="checkbox" value="${cat}"> ${cat}`;
    container.appendChild(label);
  });
}

function collectSettingsFromForm() {
  const selectedCats = Array.from(document.querySelectorAll("#category-options input:checked")).map((i) => i.value);
  let keywords = [];
  selectedCats.forEach((cat) => {
    if (CATEGORY_DATA[cat]?.keywords) keywords = keywords.concat(CATEGORY_DATA[cat].keywords);
  });

  const rules = (document.getElementById("rules")?.value || "")
    .split("\n")
    .filter((line) => line.includes(","))
    .map((line) => {
      const [pattern, category] = line.split(",");
      return {
        pattern: String(pattern || "").trim(),
        category: String(category || "").trim()
      };
    });

  const downloadExtensions = Array.from(document.querySelectorAll("#download-extensions-list input:checked"))
    .map((i) => i.value.trim().toLowerCase())
    .filter(Boolean);
  const uploadExtensions = Array.from(document.querySelectorAll("#upload-extensions-list input:checked"))
    .map((i) => i.value.trim().toLowerCase())
    .filter(Boolean);
  const downloadBlockedDomains = (document.getElementById("download-block-domains")?.value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return normalizeSettings({
    blockRules: rules,
    enabledCategories: selectedCats,
    blockKeywords: keywords,
    allowList: (document.getElementById("allow-list")?.value || "").split("\n").map((line) => line.trim()).filter(Boolean),
    timeConfig: {
      enabled: document.getElementById("time-enabled")?.value === "true",
      start: document.getElementById("time-start")?.value || "21:00",
      end: document.getElementById("time-end")?.value || "07:00"
    },
    downloadExtensions,
    uploadExtensions,
    downloadBlockedDomains,
    systemEnabled: !!document.getElementById("system-enabled")?.checked,
    chromeOsLiteMode: !!document.getElementById("chromeos-lite-mode")?.checked,
    chromeOsOfflineScreen: !!document.getElementById("chromeos-offline-screen")?.checked,
    safeSearchEnabled: !!document.getElementById("safe-search-enabled")?.checked,
    uiMode: document.getElementById("ui-mode")?.value || "admin",
    adBlockEnabled: !!document.getElementById("ad-block-enabled")?.checked,
    adBlockLevel: document.getElementById("ad-block-level")?.value || "medium",
    blockAllDownloads: !!document.getElementById("block-all-downloads")?.checked,
    blockAllUploads: !!document.getElementById("block-all-uploads")?.checked,
    learningModeUntil: currentLearningModeUntil,
    accessCode: (document.getElementById("access-code")?.value || "0000").trim() || "0000",
    accessMode: Number(document.getElementById("access-mode")?.value || 0)
  });
}

function applySettingsToForm(rawSettings) {
  const data = normalizeSettings(rawSettings || buildDefaultSettings());
  currentLearningModeUntil = data.learningModeUntil || 0;

  const enabledCats = new Set(data.enabledCategories || []);
  document.querySelectorAll("#category-options input").forEach((input) => {
    input.checked = enabledCats.has(input.value);
  });

  const rulesEl = document.getElementById("rules");
  if (rulesEl) rulesEl.value = (data.blockRules || []).map((r) => `${r.pattern},${r.category}`).join("\n");
  const allowListEl = document.getElementById("allow-list");
  if (allowListEl) allowListEl.value = (data.allowList || []).join("\n");

  const uiModeEl = document.getElementById("ui-mode");
  if (uiModeEl) uiModeEl.value = data.uiMode || "admin";
  const systemToggleEl = document.getElementById("system-enabled");
  if (systemToggleEl) systemToggleEl.checked = data.systemEnabled !== false;
  const liteToggleEl = document.getElementById("chromeos-lite-mode");
  if (liteToggleEl) liteToggleEl.checked = !!data.chromeOsLiteMode;
  const offlineToggleEl = document.getElementById("chromeos-offline-screen");
  if (offlineToggleEl) offlineToggleEl.checked = !!data.chromeOsOfflineScreen;
  const safeSearchEl = document.getElementById("safe-search-enabled");
  if (safeSearchEl) safeSearchEl.checked = !!data.safeSearchEnabled;

  const timeEnabledEl = document.getElementById("time-enabled");
  if (timeEnabledEl) timeEnabledEl.value = String(!!data.timeConfig?.enabled);
  const timeStartEl = document.getElementById("time-start");
  if (timeStartEl) timeStartEl.value = data.timeConfig?.start || "21:00";
  const timeEndEl = document.getElementById("time-end");
  if (timeEndEl) timeEndEl.value = data.timeConfig?.end || "07:00";

  const dlExtSet = new Set((data.downloadExtensions || []).map((s) => s.toLowerCase()));
  document.querySelectorAll("#download-extensions-list input[type='checkbox']").forEach((input) => {
    input.checked = dlExtSet.has(input.value.toLowerCase());
  });

  const upExtSet = new Set((data.uploadExtensions || []).map((s) => s.toLowerCase()));
  document.querySelectorAll("#upload-extensions-list input[type='checkbox']").forEach((input) => {
    input.checked = upExtSet.has(input.value.toLowerCase());
  });

  const domainEl = document.getElementById("download-block-domains");
  if (domainEl) domainEl.value = (data.downloadBlockedDomains || []).join("\n");
  const adBlockEl = document.getElementById("ad-block-enabled");
  if (adBlockEl) adBlockEl.checked = data.adBlockEnabled !== false;
  const adLevelEl = document.getElementById("ad-block-level");
  if (adLevelEl) adLevelEl.value = data.adBlockLevel || "medium";
  const blockDlEl = document.getElementById("block-all-downloads");
  if (blockDlEl) blockDlEl.checked = !!data.blockAllDownloads;
  const blockUpEl = document.getElementById("block-all-uploads");
  if (blockUpEl) blockUpEl.checked = !!data.blockAllUploads;
  const accessCodeEl = document.getElementById("access-code");
  if (accessCodeEl) accessCodeEl.value = data.accessCode || "0000";
  const accessModeEl = document.getElementById("access-mode");
  if (accessModeEl) accessModeEl.value = String(Number(data.accessMode || 0));

  updateStatusIndicators(data);
}

function updateSelectedDeviceMeta(device) {
  document.getElementById("selected-uuid").textContent = sanitizeUuid(device?.uuid || "") || "-";
  document.getElementById("remote-updated-at").textContent = formatTimestamp(device?.settingsUpdatedAtMillis);
  document.getElementById("remote-last-seen-at").textContent = formatTimestamp(device?.lastSeenAtMillis);
}

async function loadDevice(uuid) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) {
    currentDeviceUuid = "";
    applySettingsToForm(buildDefaultSettings());
    updateSelectedDeviceMeta(null);
    return;
  }

  currentDeviceUuid = safeUuid;
  updateSelectedDeviceMeta({ uuid: safeUuid });
  setMessage(`UUID ${safeUuid} の設定を読み込み中...`);

  let remote = await getRemoteDeviceSettings(safeUuid);
  if (!remote) {
    await ensureRemoteDeviceRegistered(safeUuid, buildDefaultSettings());
    remote = await getRemoteDeviceSettings(safeUuid);
  }

  if (!remote) {
    applySettingsToForm(buildDefaultSettings());
    setMessage("設定の読み込みに失敗しました。", true);
    return;
  }

  applySettingsToForm(remote.settings || buildDefaultSettings());
  const nameEl = document.getElementById("device-name");
  if (nameEl) nameEl.value = remote.name || "";
  updateSelectedDeviceMeta(remote);
  setMessage(`設定を読み込みました（${new Date().toLocaleTimeString()}）`);
}

async function refreshDeviceList(preferredUuid = "") {
  const select = document.getElementById("device-select");
  if (!select) return;

  setMessage("UUID 一覧を更新中...");
  remoteDevices = await listRemoteDevices();
  select.innerHTML = "";

  const head = document.createElement("option");
  head.value = "";
  head.textContent = remoteDevices.length > 0 ? "UUIDを選択してください" : "UUIDがまだ登録されていません";
  select.appendChild(head);

  remoteDevices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.uuid;
    const labelName = device.name ? device.name : "名前未設定";
    option.textContent = `${labelName} / ${device.uuid}`;
    select.appendChild(option);
  });

  const targetUuid = sanitizeUuid(preferredUuid || currentDeviceUuid || remoteDevices[0]?.uuid || "");
  if (!targetUuid) {
    currentDeviceUuid = "";
    updateSelectedDeviceMeta(null);
    applySettingsToForm(buildDefaultSettings());
    setMessage("UUID が未登録です。対象端末で拡張機能を起動してUUIDを取得してください。", true);
    return;
  }

  select.value = targetUuid;
  await loadDevice(targetUuid);
}

async function handleSaveSettings() {
  if (!currentDeviceUuid) {
    setMessage("UUID を選択してから保存してください。", true);
    return;
  }

  const settings = collectSettingsFromForm();
  const name = document.getElementById("device-name")?.value || "";
  const updatedAt = await saveRemoteDeviceSettings(currentDeviceUuid, settings, "admin");
  await updateRemoteDeviceName(currentDeviceUuid, name);
  document.getElementById("remote-updated-at").textContent = formatTimestamp(updatedAt);
  setMessage(`遠隔設定を保存しました（${new Date(updatedAt).toLocaleTimeString()}）`);
  await refreshDeviceList(currentDeviceUuid);
}

async function handleSaveDeviceName() {
  if (!currentDeviceUuid) {
    setMessage("UUID を選択してから端末名を保存してください。", true);
    return;
  }
  const name = document.getElementById("device-name")?.value || "";
  await updateRemoteDeviceName(currentDeviceUuid, name);
  setMessage(`端末名を保存しました（${new Date().toLocaleTimeString()}）`);
  await refreshDeviceList(currentDeviceUuid);
}

function setupNav() {
  const navItems = Array.from(document.querySelectorAll(".nav-item"));
  const sections = Array.from(document.querySelectorAll(".section"));
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      navItems.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-target");
      sections.forEach((sec) => sec.classList.toggle("active", sec.id === target));
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // パスコード認証チェックを削除し、常に初期化処理を実行
  setupCategoryUI();
  setupNav();

  const chromeosCard = document.getElementById("chromeos-settings");
  if (chromeosCard) chromeosCard.style.display = "block";

  document.getElementById("save")?.addEventListener("click", () => {
    handleSaveSettings().catch((e) => setMessage(String(e?.message || e), true));
  });
  document.getElementById("open-local-options")?.addEventListener("click", () => {
    const url = new URL(chrome.runtime.getURL("options.html"));
    const code = new URLSearchParams(location.search).get("code");
    if (code) url.searchParams.set("code", code);
    chrome.tabs.create({ url: url.toString() });
  });
  document.getElementById("refresh-devices")?.addEventListener("click", () => {
    refreshDeviceList(currentDeviceUuid).catch((e) => setMessage(String(e?.message || e), true));
  });
  document.getElementById("device-select")?.addEventListener("change", (e) => {
    loadDevice(e.target.value).catch((err) => setMessage(String(err?.message || err), true));
  });
  document.getElementById("load-manual-uuid")?.addEventListener("click", async () => {
    try {
      const uuid = sanitizeUuid(document.getElementById("manual-uuid")?.value || "");
      if (!uuid) {
        setMessage("UUID を入力してください。", true);
        return;
      }
      await ensureRemoteDeviceRegistered(uuid, buildDefaultSettings());
      await refreshDeviceList(uuid);
    } catch (e) {
      setMessage(String(e?.message || e), true);
    }
  });
  document.getElementById("save-device-name")?.addEventListener("click", () => {
    handleSaveDeviceName().catch((e) => setMessage(String(e?.message || e), true));
  });

  document.getElementById("start-learning")?.addEventListener("click", async () => {
    try {
      const minutes = parseInt(document.getElementById("learning-duration")?.value || "60", 10);
      currentLearningModeUntil = Date.now() + Math.max(1, minutes) * 60 * 1000;
      renderLearningStatus();
      await handleSaveSettings();
    } catch (e) {
      setMessage(String(e?.message || e), true);
    }
  });
  document.getElementById("stop-learning")?.addEventListener("click", async () => {
    try {
      currentLearningModeUntil = 0;
      renderLearningStatus();
      await handleSaveSettings();
    } catch (e) {
      setMessage(String(e?.message || e), true);
    }
  });

  document.getElementById("apply-preset")?.addEventListener("click", async () => {
    try {
      const preset = document.getElementById("preset-select")?.value;
      if (!preset || !PRESETS[preset]) return;
      document.querySelectorAll("#category-options input").forEach((input) => {
        input.checked = PRESETS[preset].includes(input.value);
      });
      await handleSaveSettings();
    } catch (e) {
      setMessage(String(e?.message || e), true);
    }
  });

  applySettingsToForm(buildDefaultSettings());
  try {
    await refreshDeviceList();
  } catch (e) {
    setMessage(String(e?.message || e), true);
  }
});
