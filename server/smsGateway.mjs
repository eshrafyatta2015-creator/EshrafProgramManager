/* بوابة الإرسال المباشر — طبقة خادمية (Server-side)
   المسار: الواجهة → POST /api/sms/send → هنا → مزوّد SMS (Upstream API)
   القاعدة: لا تُوضع أسرار (Token/Key/Password) في المتصفح ولا في المستودع —
   كل الاعتماديات تأتي من متغيرات البيئة (process.env) على الخادم فقط. */

const IDEM_TTL_MS = 10 * 60 * 1000;
const idemCache = new Map(); /* idempotencyKey -> استجابة مخزّنة (منع الإرسال المكرر) */

export function gatewayConfig(env) {
  const e = env || {};
  return {
    upstream: e.SMS_UPSTREAM_URL || '',
    token: e.SMS_API_TOKEN || '',
    apiKey: e.SMS_API_KEY || '',
    user: e.SMS_API_USER || '',
    pass: e.SMS_API_PASSWORD || '',
    from: e.SMS_FROM || '',
    timeoutMs: parseInt(e.SMS_TIMEOUT_MS || '20000', 10) || 20000,
  };
}

export function cleanPhone(p) {
  return String(p == null ? '' : p).replace(/[^\d+]/g, '');
}

export function validPhone(p) {
  const d = cleanPhone(p).replace(/\+/g, '');
  return d.length >= 8 && d.length <= 15;
}

function humanUpstreamError(status, data) {
  const msg = data && (data.error || data.message || data.detail);
  const detail = typeof msg === 'string' && msg.trim() ? ' — ' + msg.trim().slice(0, 160) : '';
  if (status === 401 || status === 403) return 'تعذّر التحقق من صلاحية الاتصال بمزود الرسائل.';
  if (status === 402) return 'الرصيد غير كافٍ لدى مزود الرسائل.';
  if (status === 429) return 'تجاوزت حد الإرسال المسموح مؤقتاً — أعد المحاولة بعد قليل.';
  if (status === 400 || status === 422) return 'رفض المزوّد بيانات الطلب' + detail;
  if (status >= 500) return 'خطأ مؤقت من مزود الرسائل — أعد المحاولة لاحقاً.';
  return 'رفض المزوّد الطلب (HTTP ' + status + ')' + detail;
}

function pickId(data) {
  if (!data || typeof data !== 'object') return '';
  const v = data.messageId || data.message_id || data.id || data.sid || data.smsId || data.ref || '';
  return v == null ? '' : String(v);
}

function mapStatus(data) {
  if (!data || typeof data !== 'object') return 'SENT';
  const s = String(data.status || data.state || '').toLowerCase();
  if (s === 'delivered' || s === 'delivery_success') return 'DELIVERED';
  if (s === 'pending' || s === 'queued' || s === 'accepted' || s === 'sent') return s === 'sent' ? 'SENT' : 'PENDING';
  if (data.delivered === true) return 'DELIVERED';
  return 'SENT';
}

async function callUpstream(cfg, to, message, idempotencyKey, fetchImpl) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;
  else if (cfg.user && cfg.pass) headers['Authorization'] = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.pass).toString('base64');
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;
  if (cfg.from) headers['X-From'] = cfg.from;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const resp = await fetchImpl(cfg.upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, message, text: message, from: cfg.from || undefined, idempotencyKey: idempotencyKey || undefined }),
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return { ok: false, status: 'FAILED', code: 'UPSTREAM_HTTP_' + resp.status, error: humanUpstreamError(resp.status, data) };
    }
    return { ok: true, status: mapStatus(data), messageId: pickId(data), error: '' };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    return {
      ok: false,
      status: 'FAILED',
      code: aborted ? 'TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      error: aborted ? 'انتهت مهلة الاتصال بمزود الرسائل.' : 'تعذر الوصول إلى مزود الرسائل — تحقق من الاتصال.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function pruneIdem(now) {
  for (const [k, v] of idemCache) {
    if (!v.ts || now - v.ts > IDEM_TTL_MS) idemCache.delete(k);
  }
}

/* معالجة موحّدة لطلبات SMS — تُستخدم من serve.mjs ومن الاختبارات مباشرة */
export async function routeSms({ method, path, body, env, fetchImpl }) {
  const f = fetchImpl || fetch;
  const cfg = gatewayConfig(env);
  const p = String(path || '').split('?')[0];

  if (method === 'GET' && p === '/api/sms/health') {
    return {
      status: 200,
      json: { ok: true, configured: !!cfg.upstream, provider: 'custom-gateway' },
    };
  }

  if (method !== 'POST' || (p !== '/api/sms/send' && p !== '/api/sms/bulk')) {
    return { status: 404, json: { ok: false, code: 'NOT_FOUND', error: 'مسار غير معروف.' } };
  }

  if (!cfg.upstream) {
    return {
      status: 501,
      json: { ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم تهيئة مزود SMS على الخادم (SMS_UPSTREAM_URL).' },
    };
  }

  const message = String((body && body.message) || (body && body.body) || '').trim();
  if (!message) return { status: 400, json: { ok: false, code: 'EMPTY_MESSAGE', error: 'نص الرسالة فارغ.' } };
  if (message.length > 1600) return { status: 400, json: { ok: false, code: 'MESSAGE_TOO_LONG', error: 'نص الرسالة طويل جداً.' } };

  let recipients = [];
  if (p === '/api/sms/send') {
    recipients = [{ to: body && body.to, name: (body && body.name) || '' }];
  } else {
    const raw = (body && (body.recipients || body.to)) || [];
    recipients = Array.isArray(raw) ? raw.map((r) => (typeof r === 'string' ? { to: r, name: '' } : { to: r.to, name: r.name || '' })) : [];
  }
  if (!recipients.length) return { status: 400, json: { ok: false, code: 'NO_RECIPIENTS', error: 'لا يوجد مستلمون.' } };
  if (recipients.length > 200) return { status: 400, json: { ok: false, code: 'TOO_MANY', error: 'عدد المستلمين كبير جداً في الطلب الواحد.' } };

  const baseKey = String((body && body.idempotencyKey) || '').trim();
  const now = Date.now();
  pruneIdem(now);

  const results = [];
  let attempted = 0;
  for (const r of recipients) {
    const phone = cleanPhone(r.to);
    const itemKey = baseKey ? baseKey + ':' + phone : '';
    if (!validPhone(phone)) {
      results.push({ to: r.to, name: r.name, ok: false, status: 'FAILED', code: 'INVALID_PHONE', error: 'رقم الهاتف غير صالح', messageId: '' });
      continue;
    }
    if (itemKey && idemCache.has(itemKey)) {
      results.push({ to: phone, name: r.name, ok: true, deduped: true, ...idemCache.get(itemKey).res });
      continue;
    }
    attempted++;
    const res = await callUpstream(cfg, phone, message, itemKey, f);
    if (itemKey && res.ok) idemCache.set(itemKey, { res: { status: res.status, messageId: res.messageId, error: '' }, ts: now });
    results.push({ to: phone, name: r.name, ...res });
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  const allOk = failed === 0;
  return {
    status: allOk ? 200 : (sent ? 207 : (attempted ? 502 : 400)),
    json: {
      ok: allOk,
      results,
      sent,
      failed,
      messageId: (results.find((r) => r.messageId) || {}).messageId || '',
      status: results.every((r) => r.status === 'DELIVERED') ? 'DELIVERED' : (results.find((r) => r.ok) || {}).status || 'FAILED',
      error: allOk ? '' : ((results.find((r) => !r.ok) || {}).error || ''),
      code: allOk ? '' : ((results.find((r) => !r.ok) || {}).code || ''),
    },
  };
}

/* للصيانة/الاختبارات: مسح ذاكرة منع التكرار */
export function clearIdempotencyCache() {
  idemCache.clear();
}
