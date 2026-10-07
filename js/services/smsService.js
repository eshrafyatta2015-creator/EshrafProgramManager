/* SMSService — طبقة مستقلة قابلة لتبديل المزوّد (لا تدّعِ إرسالاً صامتاً) */

import { CFG } from '../config.js';

export const SMS_PROVIDERS = [
  { key: 'device', label: '📱 تطبيق الرسائل (الجهاز)', needsPhone: false },
  { key: 'whatsapp', label: '💬 واتساب', needsPhone: false },
  { key: 'copy', label: '📋 نسخ النص فقط', needsPhone: false },
  { key: 'api', label: '🌐 مزوّد SMS عبر API', needsPhone: true },
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
    if (!s.smsApiUrl) {
      return { ok: false, mode: 'api', code: 'NOT_CONFIGURED', error: 'لم يتم ضبط رابط مزوّد SMS (الإعدادات ← مزوّد SMS).' };
    }
    if (!phones.length) {
      return { ok: false, mode: 'api', code: 'NO_PHONES', error: 'لا توجد أرقام هواتف للمشرفين المحددين.' };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      let resp;
      try {
        resp = await fetch(s.smsApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phones, body, count: phones.length }),
          signal: ctrl.signal,
        });
      } finally { clearTimeout(t); }
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, mode: 'api', error: 'HTTP ' + resp.status, raw: data };
      return { ok: true, mode: 'api', providerResponse: data, count: phones.length, notice: 'أكد المزوّد استلام الطلب.' };
    } catch (e) {
      return { ok: false, mode: 'api', error: String((e && e.message) || e) };
    }
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

/* سبب الفشل بصيغة عربية واضحة يُعرض للمستخدم باسم المشرف */
export function failureReason(res, item) {
  const code = (res && res.code) || '';
  const err = String((res && res.error) || '');
  if (code === 'NO_PHONES' || (!item || !item.phone)) return 'لا يوجد رقم هاتف';
  if (code === 'INVALID_PHONE') return 'رقم الهاتف غير صالح';
  if (code === 'NOT_CONFIGURED') return 'لم يتم ضبط رابط مزوّد SMS';
  if (code === 'BLOCKED_POPUP') return 'المتصفح حجب فتح النافذة';
  if (err) return err;
  return 'سبب غير معروف';
}

/* إرسال متسلسل لرسائل مستقلة لكل مشرف (§3):
   يمرّ على المحددين حصراً، يُبلّغ عن التقدّم بعد كل رسالة، ويترك الواجهة حرة (لا تجميد).
   لا يُرسل إلى غير المحددين إطلاقاً — القائمة هي entries ولا شيء آخر. */
export async function sendBatch({ provider, entries, settings, onProgress, delayMs }) {
  const list = (entries || []).slice();
  const total = list.length;
  const delay = delayMs == null ? 350 : delayMs;
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
      const r = { name: list[i].name, phone: list[i].phone, ok: res.ok, mode: 'copy', error: res.ok ? '' : (res.error || '') };
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
    /* تحقق مسبق من رقم الجوال قبل استدعاء المزوّد — لا إرسال بدون رقم صالح */
    if (provider === 'api' && !isValidPhone(item.phone)) {
      okRes = false;
      code = item.phone ? 'INVALID_PHONE' : 'NO_PHONES';
      err = item.phone ? 'رقم الهاتف غير صالح' : 'لا يوجد رقم هاتف';
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
        if (!okRes) { err = res.error || ''; code = res.code || ''; }
      } catch (e) {
        okRes = false;
        err = String((e && e.message) || e);
      }
    }
    results.push({ name: item.name, phone: item.phone, ok: okRes, mode, error: err, code });
    if (okRes) sent++; else failed++;
    report(i + 1, item);
    if (i < total - 1 && delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  return { ok: failed === 0, results, sent, failed, total, mode: provider };
}
