/* SMSService — طبقة الإرسال المباشر (Server-side Gateway ← SMS Provider API)
   زر «إرسال SMS» لا يفتح أي تطبيق خارجي إطلاقاً: المسار الوحيد هو POST /api/sms/send
   على الخادم، والخادم وحده يحمل بيانات المزوّد (متغيرات البيئة — لا أسرار في المستودع). */

import { CFG } from '../config.js';

/* مزوّدو الإرسال المباشر (ما يخدم زر «إرسال SMS») */
export const SMS_PROVIDERS = [
  { key: 'api', label: '🌐 إرسال مباشر عبر بوابة SMS', needsPhone: true },
  { key: 'copy', label: '📋 نسخ النص فقط', needsPhone: false },
];

/* أدوات يدوية منفصلة عن الإرسال المباشر (لا تُستخدم في مسار «تأكيد وإرسال») */
export const MANUAL_PROVIDERS = [
  { key: 'device', label: '📱 تطبيق الرسائل (يدوي)', needsPhone: false },
  { key: 'whatsapp', label: '💬 واتساب (يدوي)', needsPhone: false },
];

export function typeLabel(type) {
  if (type === CFG.typePlanning) return 'التخطيطي';
  if (type === CFG.typeActual) return 'الفعلي';
  return 'التخطيطي/الفعلي';
}

export function templateFor(type) {
  const t = type === CFG.typePlanning ? 'planning' : type === CFG.typeActual ? 'actual' : 'both';
  return CFG.messages[t];
}

export const STATE_TEMPLATES = [
  { key: 'auto', label: '📡 حسب حالة المحددين (تلقائي)' },
  { key: 'none', label: '🔴 لم يرسلوا أي برنامج' },
  { key: 'planning', label: '🟠 أرسلوا التخطيط ولم يرسلوا الفعلي' },
  { key: 'actual', label: '🟢 أرسلوا الفعلي' },
  { key: 'complete', label: '🟢 مكتمل (أرسلوا الاثنين)' },
  { key: 'both', label: '⚪ التخطيطي/الفعلي (رسالة عامة)' },
];

export function stateTemplateKey(stateSel, rows) {
  if (stateSel && stateSel !== 'auto') return stateSel;
  if (!rows || !rows.length) return 'both';
  const complete = rows.every((r) => r.status && r.status.key === 'both');
  if (complete) return 'complete';
  const none = rows.every((r) => r.status && r.status.key === 'none');
  if (none) return 'none';
  const missPlan = rows.some((r) => !r.sentPlanning);
  const missAct = rows.some((r) => !r.sentActual);
  if (missPlan && !missAct) return 'planning';
  if (missAct && !missPlan) return 'actual';
  return 'both';
}

export function buildMessage(template, ctx) {
  const week = ctx.week ? (ctx.week.label || '') : '';
  return String(template || '')
    .replace(/\{المشرف\}/g, ctx.supervisor || '')
    .replace(/\{الاسبوع\}/g, week)
    .replace(/\{النوع\}/g, typeLabel(ctx.type));
}

export function resolveRecipients(selectedRows, phones) {
  const map = phones || {};
  const entries = selectedRows.map((r) => ({
    name: r.name,
    nameNorm: r.nameNorm,
    phone: r.phone || map[r.nameNorm] || '',
  }));
  return {
    entries,
    withPhone: entries.filter((e) => e.phone),
    withoutPhone: entries.filter((e) => !e.phone),
  };
}

/* رسالة مستقلة لكل مشرف (§2): يُستبدل {المشرف} باسم كل مستلم على حدة،
   فلا تصل رسالة باسم مشرف إلى مشرف آخر. */
export function buildMessages(selectedRows, template, ctx, phones) {
  const resolved = resolveRecipients(selectedRows, phones);
  return resolved.entries.map((e) => ({
    ...e,
    body: buildMessage(template, { ...ctx, supervisor: e.name }),
  }));
}

function openUrl(url) {
  try {
    const w = window.open(url, '_blank');
    if (w) return true;
  } catch (e) { /* fallthrough */ }
  try { window.location.href = url; return true; } catch (e) { return false; }
}

function encodeBody(body) {
  return encodeURIComponent(body);
}

export async function send({ provider, recipients, body, settings }) {
  const s = settings || {};
  const entries = (recipients && recipients.entries) || [];
  const phones = entries.filter((e) => e.phone).map((e) => e.phone);

  if (provider === 'copy') {
    const text = body || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      return { ok: true, mode: 'copy', notice: 'تم نسخ نص الرسالة إلى الحافظة.', count: entries.length };
    } catch (e) {
      return { ok: false, mode: 'copy', error: 'تعذّر النسخ: ' + String(e && e.message) };
    }
  }

  if (provider === 'device') {
    let url;
    if (entries.length === 1 && phones.length === 1) url = 'sms:' + phones[0] + '?body=' + encodeBody(body);
    else url = 'sms:?body=' + encodeBody(body);
    const opened = openUrl(url);
    return {
      ok: opened,
      mode: 'composer',
      notice: opened
        ? 'تم فتح تطبيق الرسائل برسالة جاهزة.' + (phones.length < entries.length ? ' لم تُدرج أرقام لعدم توفرها — اختر المرسلين يدوياً.' : '')
        : 'تعذّر فتح تطبيق الرسائل في هذا المتصفح.',
      count: entries.length,
      phonesIncluded: phones.length,
    };
  }

  if (provider === 'whatsapp') {
    let url;
    if (entries.length === 1 && phones.length === 1) {
      url = 'https://wa.me/' + phones[0].replace(/[^\d]/g, '') + '?text=' + encodeBody(body);
    } else {
      url = 'https://wa.me/?text=' + encodeBody(body);
    }
    const opened = openUrl(url);
    return {
      ok: opened,
      mode: 'composer',
      notice: opened
        ? 'تم فتح واتساب بالرسالة.' + (phones.length < entries.length ? ' اختر جهات الاتصال يدوياً.' : '')
        : 'تعذّر فتح واتساب.',
      count: entries.length,
      phonesIncluded: phones.length,
    };
  }

  if (provider === 'api') {
    if (!phones.length) {
      return { ok: false, mode: 'api', code: 'NO_PHONES', error: 'لا توجد أرقام هواتف للمشرفين المحددين.' };
    }
    const res = await sendSms(phones[0], body, { settings: s, name: entries[0] && entries[0].name });
    return {
      ok: res.ok,
      mode: 'api',
      status: res.status,
      messageId: res.messageId,
      code: res.code || '',
      error: res.error || '',
      count: phones.length,
      notice: res.ok ? 'تم إرسال الطلب إلى مزود الرسائل.' : '',
    };
  }

  return { ok: false, mode: provider, error: 'مزوّد غير معروف: ' + provider };
}

export function confirmText(count) {
  return 'سيتم إرسال رسالة إلى ' + count + ' مشرفًا، هل تريد المتابعة؟';
}

/* رقم جوال صالح: 8-15 رقماً بعد إزالة الرموز */
export function isValidPhone(p) {
  const digits = String(p == null ? '' : p).replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/* تنظيف الرقم: يحذف المسافات والشرطات والقوس ويحفظ + دولي إن وُجد */
export function normalizePhone(p) {
  const raw = String(p == null ? '' : p).trim();
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return (plus ? '+' : '') + digits;
}

/* تحقق صارم قبل الإرسال (§8): لا رقم → NO_PHONES، رقم مشوّه → INVALID_PHONE */
export function validatePhone(p) {
  const phone = normalizePhone(p);
  if (!phone) return { ok: false, code: 'NO_PHONES', reason: 'لا يوجد رقم جوال صالح' };
  const d = phone.replace('+', '');
  if (!/^\d{8,15}$/.test(d) || (phone.startsWith('+') && d.length > 0 && d.length < 8)) {
    return { ok: false, code: 'INVALID_PHONE', reason: 'رقم الهاتف غير صالح' };
  }
  if (d.length < 8 || d.length > 15) return { ok: false, code: 'INVALID_PHONE', reason: 'رقم الهاتف غير صالح' };
  return { ok: true, phone };
}

/* عدد مقاطع الرسالة المتوقعة (§10): عربي/يونيكود → UCS-2 (70/67)، لاتيني → GSM-7 (160/153) */
const GSM_BASIC = "\n\r !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~£¥èéùìòÇØøÅåÆæßÉ¤¡¿ÄÖÑÜ§";
const GSM_EXT = '{}[]~^|\\€';
export function smsSegments(text) {
  const t = String(text == null ? '' : text);
  if (!t) return 1;
  let ucs2 = false;
  let len = 0;
  for (const ch of t) {
    if (GSM_EXT.includes(ch)) len += 2;
    else if (GSM_BASIC.includes(ch)) len += 1;
    else { ucs2 = true; break; }
  }
  if (ucs2) {
    const n = t.length;
    return n <= 70 ? 1 : Math.ceil(n / 67);
  }
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

/* رابط بوابة الإرسال: مسار الخادم الافتراضي /api/sms/send (بلا أي سر في المتصفح).
   smsApiUrl القديم محفوظ كخيار متوافق خلفياً. */
export function gatewayUrl(settings) {
  const s = settings || {};
  return s.smsGatewayUrl || s.smsApiUrl || '/api/sms/send';
}

/* إرسال رسالة واحدة مباشرة (§3): sendSms(phoneNumber, message)
   لا يفتح أي تطبيق — ينادي بوابة الخادم فقط، ويعيد الحالة (SENT/PENDING/FAILED). */
export async function sendSms(phoneNumber, message, opts) {
  const o = opts || {};
  const settings = o.settings || {};
  const v = validatePhone(phoneNumber);
  if (!v.ok) return { ok: false, status: 'FAILED', code: v.code, error: v.reason };
  const msg = String(message == null ? '' : message);
  if (!msg.trim()) return { ok: false, status: 'FAILED', code: 'EMPTY_MESSAGE', error: 'نص الرسالة فارغ' };
  const url = gatewayUrl(settings);
  const doFetch = o.fetchImpl || fetch;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeoutMs || 30000) : null;
  try {
    const resp = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: v.phone,
        message: msg,
        name: o.name || '',
        idempotencyKey: o.idempotencyKey || '',
      }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!resp.ok) {
      /* HTML من استضافة ثابتة (404/405) يعني أن خادم الإرسال غير موجود */
      if (!data || resp.status === 404 || resp.status === 405) {
        return { ok: false, status: 'FAILED', code: 'GATEWAY_UNAVAILABLE', error: CFG.texts.smsGatewayDown };
      }
      const item = (data.results && data.results[0]) || data;
      return {
        ok: false,
        status: 'FAILED',
        code: item.code || data.code || ('HTTP_' + resp.status),
        error: item.error || data.error || ('HTTP ' + resp.status),
      };
    }
    if (data && data.ok === false) {
      const item = (data.results && data.results[0]) || data;
      return { ok: false, status: 'FAILED', code: item.code || data.code || '', error: item.error || data.error || '' };
    }
    const item = (data && data.results && data.results[0]) || data || {};
    return {
      ok: true,
      status: item.status || (data && data.status) || 'SENT',
      messageId: item.messageId || (data && data.messageId) || '',
      error: '',
    };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    return {
      ok: false,
      status: 'FAILED',
      code: aborted ? 'TIMEOUT' : 'NETWORK',
      error: aborted ? 'انتهت مهلة الاتصال بخادم الإرسال.' : CFG.texts.smsUpstreamDown,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* سبب الفشل بصيغة عربية واضحة تُعرض للمستخدم باسم المشرف (§15) */
export function failureReason(res, item) {
  const code = (res && res.code) || '';
  const err = String((res && res.error) || '');
  if (code === 'NO_PHONES' || (!item || !item.phone)) return 'لا يوجد رقم هاتف';
  if (code === 'INVALID_PHONE') return 'رقم الهاتف غير صالح';
  if (code === 'EMPTY_MESSAGE') return 'نص الرسالة فارغ';
  if (code === 'NOT_CONFIGURED') return CFG.texts.smsGatewayNotConfigured;
  if (code === 'GATEWAY_UNAVAILABLE') return CFG.texts.smsGatewayDown;
  if (code === 'NETWORK' || code === 'UPSTREAM_UNREACHABLE') return CFG.texts.smsUpstreamDown;
  if (code === 'TIMEOUT') return 'انتهت مهلة الاتصال بمزود الرسائل.';
  if (code === 'BLOCKED_POPUP') return 'المتصفح حجب فتح النافذة';
  if (err) return err;
  return 'سبب غير معروف';
}

/* إرسال متسلسل لرسائل مستقلة لكل مشرف (§3-§7):
   - يمرّ على المحددين حصراً، يُبلّغ عن التقدّم بعد كل رسالة، ويترك الواجهة حرة (لا تجميد).
   - لا يُرسل إلى غير المحددين إطلاقاً — القائمة هي entries ولا شيء آخر.
   - idempotencyKey: مفتاح ثابت لكل رسالة داخل العملية يُمرَّر للخادم/المزوّد لمنع التكرار (§7).
   - النتائج تُحفظ رسالة رسالة: عند انقطاع الاتصال تبقى الناجحة محفوظة ولا تُعاد (§16). */
export async function sendBatch({ provider, entries, settings, onProgress, delayMs, idempotencyKey, fetchImpl }) {
  const list = (entries || []).slice();
  const total = list.length;
  const delay = delayMs == null ? 350 : delayMs;
  const baseKey = idempotencyKey || '';
  const results = [];
  let sent = 0;
  let failed = 0;
  const report = (i, item) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ index: i, total, sent, failed, remaining: total - i, item }); } catch (e) { /* لا يُعطّل الإرسال */ }
    }
  };

  if (!total) return { ok: false, code: 'EMPTY', results, sent: 0, failed: 0, total: 0 };

  /* نسخ النص: عملية واحدة لجميع الرسائل (لا يمكن تجاوز الحافظة رسالةً رسالة) */
  if (provider === 'copy') {
    const text = list.map((e) => e.body).join('\n\n──────────\n\n');
    const res = await send({ provider: 'copy', recipients: { entries: list, withPhone: list, withoutPhone: [] }, body: text, settings });
    for (let i = 0; i < total; i++) {
      const r = { name: list[i].name, phone: list[i].phone, ok: res.ok, mode: 'copy', status: res.ok ? 'SENT' : 'FAILED', error: res.ok ? '' : (res.error || ''), code: res.ok ? '' : (res.code || '') };
      results.push(r);
      if (res.ok) sent++; else failed++;
      report(i + 1, list[i]);
    }
    return { ok: res.ok, mode: 'copy', notice: res.notice, results, sent, failed, total };
  }

  for (let i = 0; i < total; i++) {
    const item = list[i];
    let okRes = false;
    let err = '';
    let code = '';
    let mode = provider;
    let status = 'FAILED';
    let messageId = '';
    /* تحقق مسبق من رقم الجوال قبل استدعاء البوابة — لا إرسال بدون رقم صالح (§8) */
    if (provider === 'api' && !isValidPhone(item.phone)) {
      okRes = false;
      code = item.phone ? 'INVALID_PHONE' : 'NO_PHONES';
      err = item.phone ? 'رقم الهاتف غير صالح' : 'لا يوجد رقم هاتف';
    } else if (provider === 'api') {
      /* الإرسال المباشر: رسالة واحدة → بوابة الخادم → مزوّد SMS */
      const res = await sendSms(item.phone, item.body, {
        settings,
        name: item.name,
        idempotencyKey: baseKey ? baseKey + ':' + i : '',
        fetchImpl,
      });
      okRes = !!res.ok;
      mode = 'api';
      status = res.status || (okRes ? 'SENT' : 'FAILED');
      messageId = res.messageId || '';
      if (!okRes) { err = res.error || ''; code = res.code || ''; }
    } else {
      try {
        const res = await send({
          provider,
          recipients: { entries: [item], withPhone: item.phone ? [item] : [], withoutPhone: item.phone ? [] : [item] },
          body: item.body,
          settings,
        });
        okRes = !!res.ok;
        mode = res.mode || provider;
        status = okRes ? 'SENT' : 'FAILED';
        if (!okRes) { err = res.error || ''; code = res.code || ''; }
      } catch (e) {
        okRes = false;
        err = String((e && e.message) || e);
      }
    }
    results.push({ name: item.name, phone: item.phone, ok: okRes, mode, status, messageId, error: err, code });
    if (okRes) sent++; else failed++;
    report(i + 1, item);
    if (i < total - 1 && delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  return {
    ok: failed === 0,
    results,
    sent,
    failed,
    total,
    mode: provider,
    failedItems: results.map((r, i) => (r.ok ? null : list[i])).filter(Boolean),
  };
}

/* إرسال مجموعة عبر بوابة الخادم مباشرة (§3): sendBulkSms(recipients, message) */
export async function sendBulkSms(recipients, message, opts) {
  const o = opts || {};
  const entries = (recipients || []).map((r) => ({
    name: r.name || '',
    nameNorm: r.nameNorm || '',
    phone: r.phone || r.to || '',
    body: r.body || message,
  }));
  return sendBatch({
    provider: 'api',
    entries,
    settings: o.settings,
    onProgress: o.onProgress,
    delayMs: o.delayMs,
    idempotencyKey: o.idempotencyKey,
    fetchImpl: o.fetchImpl,
  });
}

/* الفاشلة فقط لإعادة المحاولة (§17) — الناجحة لا تُعاد أبداً */
export function onlyFailed(results) {
  return (results || []).filter((r) => !r.ok);
}
