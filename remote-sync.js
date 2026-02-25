import { buildDefaultSettings, normalizeSettings } from "./settings-schema.js";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDLhvVcx25XGvV9h_ppcS5aaxOMN7wyH_w",
  authDomain: "open-3-87692.firebaseapp.com",
  projectId: "open-3-87692",
  storageBucket: "open-3-87692.firebasestorage.app",
  messagingSenderId: "449986188484",
  appId: "1:449986188484:web:1e0b9cf43ce7ce0e942591",
  measurementId: "G-5YYMVMRDGH"
};

export const UUID_CAPTURE_URL = "http://search3958.github.io/usercheck/uuid.html?service=Y-FILTER";
export const REMOTE_SYNC_INTERVAL_MS = 5000;
export const PRESENCE_UPDATE_INTERVAL_MS = 60000;

const DEVICES_COLLECTION = "yfilterDevices";
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

function encodeDocId(value) {
  return encodeURIComponent(value);
}

function decodeDocId(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

function buildFirestoreUrl(path, queryEntries = []) {
  const url = new URL(`${FIRESTORE_BASE_URL}/${path}`);
  url.searchParams.set("key", FIREBASE_CONFIG.apiKey);
  for (const [k, v] of queryEntries) {
    url.searchParams.append(k, v);
  }
  return url;
}

async function requestFirestore(url, options = {}, { allow404 = false } = {}) {
  const response = await fetch(url, options);
  if (response.status === 404 && allow404) {
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (e) {
    payload = null;
  }

  if (!response.ok) {
    const rawMessage = payload?.error?.message || `${response.status} ${response.statusText}`;
    const err = new Error(`Firestore request failed: ${rawMessage}`);
    const lowered = String(rawMessage).toLowerCase();
    if (
      lowered.includes("cloud firestore api has not been used") ||
      lowered.includes("firestore.googleapis.com") && lowered.includes("disabled")
    ) {
      err.code = "FIRESTORE_DISABLED";
      err.message = "Firestore API が無効です。Google Cloud Console で Firestore API を有効化してから再試行してください。";
      err.detail = rawMessage;
    }
    throw err;
  }

  return payload;
}

function toFirestoreValue(value) {
  if (value === null) {
    return { nullValue: null };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { arrayValue: {} };
    return {
      arrayValue: {
        values: value.map((entry) => toFirestoreValue(entry))
      }
    };
  }

  const t = typeof value;
  if (t === "string") return { stringValue: value };
  if (t === "boolean") return { booleanValue: value };
  if (t === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }

  if (t === "object") {
    const fields = toFirestoreFields(value);
    if (Object.keys(fields).length === 0) return { mapValue: {} };
    return { mapValue: { fields } };
  }

  return { stringValue: String(value) };
}

function toFirestoreFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return !!value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) {
    const n = Number(value.integerValue);
    return Number.isFinite(n) ? n : 0;
  }
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) {
    const n = Number(value.doubleValue);
    return Number.isFinite(n) ? n : 0;
  }
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, "arrayValue")) {
    const values = value.arrayValue?.values || [];
    return values.map((entry) => fromFirestoreValue(entry));
  }
  if (Object.prototype.hasOwnProperty.call(value, "mapValue")) {
    return fromFirestoreFields(value.mapValue?.fields || {});
  }
  return null;
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function parseDeviceDocument(document) {
  const fields = fromFirestoreFields(document?.fields || {});
  const namePath = String(document?.name || "");
  const docId = decodeDocId(namePath.split("/").pop() || "");
  const uuid = sanitizeUuid(fields.uuid || docId);
  return {
    ...fields,
    docId,
    uuid
  };
}

function buildDevicePath(uuid) {
  return `${DEVICES_COLLECTION}/${encodeDocId(uuid)}`;
}

async function patchDeviceDocument(uuid, patch, updateMask = []) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) throw new Error("UUID is empty.");

  const url = buildFirestoreUrl(buildDevicePath(safeUuid));
  if (updateMask.length > 0) {
    for (const fieldPath of updateMask) {
      url.searchParams.append("updateMask.fieldPaths", fieldPath);
    }
  }

  const payload = await requestFirestore(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: toFirestoreFields(patch)
    })
  });

  return parseDeviceDocument(payload);
}

async function getDeviceDocument(uuid, fieldPaths = []) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) return null;

  const url = buildFirestoreUrl(buildDevicePath(safeUuid));
  for (const fieldPath of fieldPaths) {
    url.searchParams.append("mask.fieldPaths", fieldPath);
  }

  const payload = await requestFirestore(url, {}, { allow404: true });
  if (!payload) return null;
  return parseDeviceDocument(payload);
}

export function sanitizeUuid(uuid) {
  return String(uuid || "").trim();
}

export async function listRemoteDevices(pageSize = 200) {
  const url = buildFirestoreUrl(DEVICES_COLLECTION, [["pageSize", String(pageSize)]]);
  const payload = await requestFirestore(url, {}, { allow404: true });
  const devices = (payload?.documents || []).map((doc) => parseDeviceDocument(doc));
  devices.sort((a, b) => Number(b.lastSeenAtMillis || 0) - Number(a.lastSeenAtMillis || 0));
  return devices;
}

export async function getRemoteDeviceMeta(uuid) {
  return getDeviceDocument(uuid, [
    "uuid",
    "name",
    "settingsUpdatedAtMillis",
    "lastSeenAtMillis",
    "updatedAtMillis"
  ]);
}

export async function getRemoteDeviceSettings(uuid) {
  const data = await getDeviceDocument(uuid);
  if (!data) return null;
  const hasStoredSettings = !!(data.settings && typeof data.settings === "object");
  if (hasStoredSettings) {
    data.settings = normalizeSettings(data.settings);
  } else {
    data.settings = buildDefaultSettings();
  }
  data.hasStoredSettings = hasStoredSettings;
  return data;
}

export async function touchDevicePresence(uuid) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) return null;
  const now = Date.now();
  return patchDeviceDocument(
    safeUuid,
    {
      uuid: safeUuid,
      lastSeenAtMillis: now,
      updatedAtMillis: now
    },
    ["uuid", "lastSeenAtMillis", "updatedAtMillis"]
  );
}

export async function saveRemoteDeviceSettings(uuid, settings, source = "local") {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) throw new Error("UUID is empty.");
  const now = Date.now();
  const normalized = normalizeSettings(settings || buildDefaultSettings());

  await patchDeviceDocument(
    safeUuid,
    {
      uuid: safeUuid,
      settings: normalized,
      settingsUpdatedAtMillis: now,
      lastSeenAtMillis: now,
      updatedAtMillis: now,
      updatedBy: String(source || "local")
    },
    ["uuid", "settings", "settingsUpdatedAtMillis", "lastSeenAtMillis", "updatedAtMillis", "updatedBy"]
  );

  return now;
}

export async function updateRemoteDeviceName(uuid, name) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) throw new Error("UUID is empty.");
  const now = Date.now();

  return patchDeviceDocument(
    safeUuid,
    {
      uuid: safeUuid,
      name: String(name || "").trim(),
      nameUpdatedAtMillis: now,
      updatedAtMillis: now,
      lastSeenAtMillis: now
    },
    ["uuid", "name", "nameUpdatedAtMillis", "updatedAtMillis", "lastSeenAtMillis"]
  );
}

export async function ensureRemoteDeviceRegistered(uuid, initialSettings = null) {
  const safeUuid = sanitizeUuid(uuid);
  if (!safeUuid) return null;

  const existing = await getRemoteDeviceSettings(safeUuid);
  if (existing) {
    if (initialSettings && existing.hasStoredSettings === false) {
      await saveRemoteDeviceSettings(safeUuid, initialSettings, "bootstrap");
      return getRemoteDeviceSettings(safeUuid);
    }
    await touchDevicePresence(safeUuid);
    return existing;
  }

  if (initialSettings) {
    await saveRemoteDeviceSettings(safeUuid, initialSettings, "bootstrap");
    return getRemoteDeviceSettings(safeUuid);
  }

  await touchDevicePresence(safeUuid);
  return getRemoteDeviceMeta(safeUuid);
}
