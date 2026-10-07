/* LogService — سجل العمليات المهمة (محلي، لا يُرسل لأي مكان) */

import { CFG } from '../config.js';
import { storeGet, storeSet, uid, formatDateTime } from '../utils.js';

export function logAdd(type, detail, meta) {
  const m = meta || {};
  const logs = storeGet(CFG.storage.log, []);
  logs.unshift({
    id: uid(),
    time: formatDateTime(new Date()),
    ts: Date.now(),
    type,
    detail: String(detail == null ? '' : detail),
    /* حقول منظمة لجدول سجل العمليات (§17) — اختيارية للتوافق الخلفي */
    op: String(m.op || type),
    week: String(m.week || ''),
    count: m.count == null ? '' : m.count,
    user: String(m.user || ''),
    status: String(m.status || 'ناجح'),
  });
  if (logs.length > CFG.logMax) logs.length = CFG.logMax;
  storeSet(CFG.storage.log, logs);
  return logs;
}

export function logList() {
  return storeGet(CFG.storage.log, []);
}

/* صفوف جدول سجل العمليات: العملية | الأسبوع | العدد | التاريخ | المستخدم | الحالة */
export function logRows(limit) {
  const logs = logList().slice(0, limit || 100);
  return logs.map((l) => ({
    id: l.id,
    op: l.op || l.type || '—',
    week: l.week || '—',
    count: l.count === '' || l.count == null ? '—' : String(l.count),
    time: l.time || '—',
    user: l.user || '—',
    status: l.status || '—',
    type: l.type || '—',
    detail: l.detail || '',
    ts: l.ts || 0,
  }));
}

export function logClear() {
  storeSet(CFG.storage.log, []);
  return [];
}

/* ---------- سجل إرسال الرسائل (§11) ----------
   التاريخ والوقت · المستخدم · اسم المشرف · هاتف مموّه (آمن) · نص الرسالة/معرفها ·
   الحالة (SENT/FAILED/PENDING) · Message ID من المزوّد · سبب الفشل */
export function maskPhone(p) {
  const d = String(p == null ? '' : p).replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.length <= 5) return d;
  return d.slice(0, 4) + '*'.repeat(Math.max(2, d.length - 6)) + d.slice(-2);
}

export function smsLogAdd(entry) {
  const logs = storeGet(CFG.storage.smsLog, []);
  const statusCode = entry.status || (entry.ok ? 'SENT' : 'FAILED');
  const labels = CFG.texts.smsStatus || { SENT: 'تم الإرسال', FAILED: 'فشل', PENDING: 'تم الطلب', DELIVERED: 'تم التسليم' };
  logs.unshift({
    id: uid(),
    time: formatDateTime(new Date()),
    ts: Date.now(),
    name: String(entry.name == null ? '' : entry.name),
    phone: maskPhone(entry.phone),
    body: String(entry.body == null ? '' : entry.body).slice(0, 300),
    status: labels[statusCode] || String(statusCode),
    statusCode: String(statusCode),
    ok: statusCode !== 'FAILED',
    messageId: String(entry.messageId == null ? '' : entry.messageId),
    user: String(entry.user == null ? '' : entry.user),
    provider: String(entry.provider == null ? '' : entry.provider),
    error: String(entry.error == null ? '' : entry.error),
  });
  const max = CFG.smsLogMax || 300;
  if (logs.length > max) logs.length = max;
  storeSet(CFG.storage.smsLog, logs);
  return logs;
}

export function smsLogList(limit) {
  const logs = storeGet(CFG.storage.smsLog, []);
  return limit ? logs.slice(0, limit) : logs;
}

export function smsLogClear() {
  storeSet(CFG.storage.smsLog, []);
  return [];
}
