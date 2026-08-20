import { readFile, writeFile, rename, mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import path from "path";
import defaults from "./config-default.json" with { type: "json" };

const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ".";
const storePath = join(dataDir, "config-store.json");
const backupPath = join(dataDir, "config-store.backup.json");

let cache = null;
let writeChain = Promise.resolve();
let saveTimer = null;

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (typeof base === "object" && typeof over === "object") {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;
}

async function ensureFile() {
  await mkdir(dataDir === "." ? path.resolve(".") : dataDir, { recursive: true });
  try { await readFile(storePath); return; } catch (_) {}
  try {
    await writeFile(storePath, JSON.stringify(defaults, null, 2), "utf8");
    cache = JSON.parse(JSON.stringify(defaults));
  } catch (_) {}
}

export async function loadStore() {
  await ensureFile();
  if (cache) return cache;
  let raw;
  try { raw = await readFile(storePath, "utf8"); } catch (_) { raw = "{}"; }
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch (_) {}
  cache = deepMerge(JSON.parse(JSON.stringify(defaults)), parsed);
  return cache;
}

export async function getStore() {
  return cache || (await loadStore());
}

export async function saveStore(next) {
  const target = deepMerge(JSON.parse(JSON.stringify(defaults)), next || cache || {});
  cache = target;
  writeChain = writeChain.then(async () => {
    const tmp = storePath + ".tmp";
    await writeFile(tmp, JSON.stringify(target, null, 2), "utf8");
    await copyFile(storePath, backupPath).catch(() => {});
    await rename(tmp, storePath);
  });
  return writeChain;
}

export async function updateStore(fn) {
  const cur = cache || (await loadStore());
  const next = fn(JSON.parse(JSON.stringify(cur)));
  await saveStore(next);
  return cache;
}

export function scheduleStoreSave(fn, delay = 150) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!cache) await loadStore();
    const snapshot = fn(JSON.parse(JSON.stringify(cache || {})));
    await saveStore(snapshot);
  }, delay);
  return saveTimer;
}

export const storeDefaults = defaults;
export const STORE_PATH = storePath;