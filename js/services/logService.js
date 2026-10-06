/* LogService — سجل العمليات المهمة (محلي، لا يُرسل لأي مكان) */

import { CFG } from '../config.js';
import { storeGet, storeSet, uid, formatDateTime } from '../utils.js';

export function logAdd(type, detail) {
  const logs = storeGet(CFG.storage.log, []);
  logs.unshift({
    id: uid(),
    time: formatDateTime(new Date()),
    ts: Date.now(),
    type,
    detail: String(detail == null ? '' : detail),
  });
  if (logs.length > CFG.logMax) logs.length = CFG.logMax;
  storeSet(CFG.storage.log, logs);
  return logs;
}

export function logList() {
  return storeGet(CFG.storage.log, []);
}

export function logClear() {
  storeSet(CFG.storage.log, []);
  return [];
}
