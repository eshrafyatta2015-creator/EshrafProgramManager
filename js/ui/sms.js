/* تنبيه SMS — إرسال مباشر من النظام: اختيار ← رسالة ← تأكيد وإرسال ← بوابة الخادم ← مزوّد SMS
   (لا يفتح تطبيق الرسائل ولا واتساب ولا أي تطبيق خارجي في مسار الإرسال المباشر) */

import { CFG } from '../config.js';
import { escapeHtml, ltr, uid } from '../utils.js';
import { showModal, toast, emptyState, tableHtml } from './components.js';
import { SMS_PROVIDERS, MANUAL_PROVIDERS, buildMessage, buildMessages, sendBatch, send, isValidPhone, smsSegments, failureReason, typeLabel, STATE_TEMPLATES, stateTemplateKey, gatewayUrl } from '../services/smsService.js';
import { logAdd, smsLogAdd, smsLogList, smsLogClear } from '../services/logService.js';
import { App, templateForKey, saveTemplate, go, requireAdmin } from './app.js';

let local = {
  state: 'auto',
  type: CFG.typePlanning,
  mode: 'selected',
  provider: 'api',
  body: '',
  query: '',
};

/* حارس ضد الضغط المكرر: أثناء الإرسال لا يبدأ إرسال جديد (§7) */
let sending = false;

function keyOfState(state) {
  return state === CFG.typePlanning ? 'planning' : state === CFG.typeActual ? 'actual' : state;
}

function typeOfKey(key) {
  return key === 'planning' ? CFG.typePlanning : key === 'actual' ? CFG.typeActual : 'both';
}

function resolveKey(state, rows) {
  return state === 'auto' ? stateTemplateKey('auto', rows) : keyOfState(state);
}

let lastResolvedKey = null;

export function render(root, app) {
  if (App.smsPrefill) {
    local.mode = App.smsPrefill.mode || local.mode;
    App.smsPrefill = null;
  }

  const allRows = app.status.rows;
  const selectedRows = allRows.filter((r) => app.selected.has(r.nameNorm));
  const targetRows = local.mode === 'all' ? allRows : selectedRows;
  const resolved = resolveKey(local.state, targetRows);
  local.type = typeOfKey(resolved);
  if (!local.body || resolved !== lastResolvedKey) {
    local.body = templateForKey(resolved);
    lastResolvedKey = resolved;
  }
  local.provider = app.settings.smsProvider || local.provider;
  if (!SMS_PROVIDERS.some((p) => p.key === local.provider)) local.provider = 'api';

  const listRows = local.query
    ? allRows.filter((r) => r.nameNorm.includes(local.query))
    : allRows;

  root.innerHTML =
    '<div class="sms-layout">' +
      '<div class="card sms-compose">' +
        '<h3>✉️ تحرير الرسالة</h3>' +
        '<div class="field-row">' +
          '<label class="field"><span>الرسالة حسب الحالة (افتراضي تلقائي ثم قابل للتعديل)</span><select id="s-state">' +
            STATE_TEMPLATES.map((t) => '<option value="' + t.key + '"' + (local.state === t.key ? ' selected' : '') + '>' + t.label + '</option>').join('') +
          '</select></label>' +
          '<label class="field"><span>طريقة الإرسال</span><select id="s-provider">' +
            SMS_PROVIDERS.map((p) => '<option value="' + p.key + '"' + (local.provider === p.key ? ' selected' : '') + '>' + p.label + '</option>').join('') +
          '</select></label>' +
        '</div>' +
        '<label class="field"><span>نص الرسالة (قابل للتعديل — المتغيرات: {المشرف} {الاسبوع} {النوع})</span>' +
          '<textarea id="s-body" rows="4">' + escapeHtml(local.body) + '</textarea></label>' +
        '<div class="muted" id="s-counters"></div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-sm" id="s-save-tpl">💾 حفظ كافتراضي</button>' +
          '<button class="btn btn-sm btn-ghost" id="s-reset-tpl">↩ استعادة الافتراضي</button>' +
          '<button class="btn btn-sm btn-ghost" id="s-manual-device">📱 تطبيق الرسائل (يدوي)</button>' +
          '<button class="btn btn-sm btn-ghost" id="s-manual-wa">💬 واتساب (يدوي)</button>' +
        '</div>' +
        '<div class="preview-box"><div class="preview-label">معاينة الرسالة (للأسبوع ' + escapeHtml(app.week ? app.week.label : '—') + '):</div>' +
          '<div class="preview-text" id="s-preview"></div></div>' +
      '</div>' +

      '<div class="card sms-recipients">' +
        '<h3>👥 اختيار المشرفين</h3>' +
        '<div class="field-row">' +
          '<label class="radio"><input type="radio" name="s-mode" value="all"' + (local.mode === 'all' ? ' checked' : '') + '> إرسال للجميع (' + allRows.length + ')</label>' +
          '<label class="radio"><input type="radio" name="s-mode" value="selected"' + (local.mode === 'selected' ? ' checked' : '') + '> اختيار مشرفين (' + selectedRows.length + ')</label>' +
          '<span class="grow"></span>' +
          '<button class="btn btn-sm btn-ghost" id="s-all">تحديد الكل</button>' +
          '<button class="btn btn-sm btn-ghost" id="s-none">مسح التحديد</button>' +
        '</div>' +
        '<div class="search-box"><span>🔍</span><input id="s-search" type="search" placeholder="بحث داخل القائمة" value="' + escapeHtml(local.query) + '"></div>' +
        '<div class="sms-list" id="s-list">' +
          (listRows.length ? listRows.map((r) => {
            const on = app.selected.has(r.nameNorm);
            return '<label class="sms-item ' + r.status.cls + (on ? ' on' : '') + '">' +
              '<input type="checkbox" data-norm="' + escapeHtml(r.nameNorm) + '"' + (on ? ' checked' : '') + '>' +
              '<span class="sms-name">' + escapeHtml(r.name) + '</span>' +
              statusMini(r) +
              (r.phone ? '<span class="sms-phone">' + escapeHtml(r.phone) + '</span>' : '<span class="sms-phone muted">بدون هاتف</span>') +
            '</label>';
          }).join('') : emptyState('لا نتائج')) +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="sms-footer">' +
      '<div class="sms-count" id="s-count"></div>' +
      '<button class="btn btn-primary btn-lg" id="s-send">📱 إرسال SMS</button>' +
    '</div>' +

    '<div class="card" id="s-log-card">' +
      '<div class="card-head"><h3>📜 سجل إرسال الرسائل</h3>' +
      '<button class="btn btn-sm btn-ghost" id="s-log-clear">🧹 مسح السجل</button></div>' +
      '<div id="s-log">' + logHtml() + '</div>' +
    '</div>';

  const preview = () => {
    const body = root.querySelector('#s-body').value;
    const target = local.mode === 'all' ? allRows : selectedRows;
    const name = target.length === 1 ? target[0].name : 'المشرف الكريم';
    const built = buildMessage(body, { week: app.week, type: local.type, supervisor: name });
    root.querySelector('#s-preview').textContent = built;

    /* §9/§10: عدّاد الاختيار + عدد الأحرف + عدد الرسائل المتوقعة */
    const n = local.mode === 'all' ? allRows.length : selectedRows.length;
    const cnt = root.querySelector('#s-count');
    cnt.innerHTML = local.mode === 'all'
      ? 'الإرسال إلى الجميع: <b>' + n + '</b> مشرف'
      : escapeHtml(CFG.texts.smsChosen(n)) + ' · النوع: <b>' + typeLabel(local.type) + '</b>';
    const counters = root.querySelector('#s-counters');
    if (counters) {
      counters.textContent = CFG.texts.smsChars(built.length) + ' · ' + CFG.texts.smsParts(smsSegments(built)) +
        ' · 🔒 الإرسال مباشر من الخادم (لا يفتح أي تطبيق)';
    }
    const sendBtn = root.querySelector('#s-send');
    if (sendBtn && !sending) sendBtn.textContent = n ? '📱 إرسال SMS إلى ' + n + ' مشرفين' : '📱 إرسال SMS';
  };

  root.querySelector('#s-state').addEventListener('change', (e) => {
    local.state = e.target.value;
    const key = resolveKey(local.state, targetRows);
    local.type = typeOfKey(key);
    local.body = templateForKey(key);
    lastResolvedKey = key;
    root.querySelector('#s-body').value = local.body;
    preview();
  });

  root.querySelectorAll('input[name="s-mode"]').forEach((r) => r.addEventListener('change', () => {
    local.mode = r.value;
    render(root, app);
  }));

  root.querySelector('#s-provider').addEventListener('change', (e) => {
    local.provider = e.target.value;
  });

  root.querySelector('#s-body').addEventListener('input', preview);

  root.querySelector('#s-save-tpl').addEventListener('click', () => {
    if (!requireAdminLocal()) return;
    const key = resolveKey(local.state, targetRows);
    saveTemplate(key, root.querySelector('#s-body').value);
    toast('تم حفظ الرسالة الافتراضية', 'ok');
  });

  root.querySelector('#s-reset-tpl').addEventListener('click', () => {
    if (!requireAdminLocal()) return;
    const key = resolveKey(local.state, targetRows);
    saveTemplate(key, '');
    local.body = templateForKey(key);
    root.querySelector('#s-body').value = local.body;
    preview();
    toast('تمت استعادة الرسالة الافتراضية', 'ok');
  });

  /* أدوات يدوية منفصلة عن الإرسال المباشر — تُفتح خارج مسار «تأكيد وإرسال» */
  const manualRun = async (providerKey) => {
    const bodyVal = root.querySelector('#s-body').value;
    if (!bodyVal.trim()) { toast('نص الرسالة فارغ', 'error'); return; }
    const rowsNow = local.mode === 'all' ? app.status.rows : app.status.rows.filter((r) => app.selected.has(r.nameNorm));
    if (!rowsNow.length) { toast(CFG.texts.smsSelectOne, 'error'); return; }
    const resolved = buildMessages(rowsNow, bodyVal, { week: app.week, type: local.type }, app.phones);
    const res = await send({
      provider: providerKey,
      recipients: { entries: resolved, withPhone: resolved.filter((e) => e.phone), withoutPhone: resolved.filter((e) => !e.phone) },
      body: bodyVal,
      settings: app.settings,
    });
    toast(res.notice || res.error || 'تم', res.ok ? 'ok' : 'error');
    logAdd('أداة يدوية', (providerKey === 'device' ? 'فتح تطبيق الرسائل' : 'فتح واتساب') + ' (' + rowsNow.length + ')');
  };
  root.querySelector('#s-manual-device').addEventListener('click', () => manualRun('device'));
  root.querySelector('#s-manual-wa').addEventListener('click', () => manualRun('whatsapp'));

  root.querySelector('#s-search').addEventListener('input', (e) => {
    local.query = e.target.value.trim();
    const pos = e.target.selectionStart;
    render(root, app);
    const el = root.querySelector('#s-search');
    el.focus();
    try { el.setSelectionRange(pos, pos); } catch (x) { /* noop */ }
  });

  root.querySelectorAll('#s-list input[data-norm]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) app.selected.add(cb.dataset.norm);
    else app.selected.delete(cb.dataset.norm);
    render(root, app);
  }));

  root.querySelector('#s-all').addEventListener('click', () => {
    allRows.forEach((r) => app.selected.add(r.nameNorm));
    logAdd('اختيار المشرفين', 'تحديد الجميع (' + allRows.length + ')');
    render(root, app);
  });
  root.querySelector('#s-none').addEventListener('click', () => {
    app.selected.clear();
    render(root, app);
  });

  root.querySelector('#s-send').addEventListener('click', () => {
    /* منع الضغط المكرر — لا إرسال مزدوج لنفس الرسالة */
    if (sending) { toast(CFG.texts.smsBusy, 'warn'); return; }
    doSend(app);
  });

  const logClearBtn = root.querySelector('#s-log-clear');
  if (logClearBtn) logClearBtn.addEventListener('click', () => {
    if (!requireAdmin('مسح سجل الرسائل')) return;
    smsLogClear();
    renderLog();
    toast('تم مسح سجل الرسائل', 'ok');
  });

  preview();
}

/* ---------- سجل الرسائل (§4) ---------- */

function logHtml() {
  const logs = smsLogList(40);
  if (!logs.length) return emptyState('لا توجد رسائل مُرسلة بعد');
  return tableHtml(['التاريخ والوقت', 'المستخدم', 'اسم المشرف', 'الهاتف', 'الحالة', 'Message ID', 'الرسالة', 'الخطأ'],
    logs.map((e) => [
      ltr(e.time),
      e.user || '—',
      e.name,
      ltr(e.phone || '—'),
      (e.statusCode === 'FAILED' ? '🔴 ' : e.statusCode === 'PENDING' ? '⏳ ' : '✅ ') + (e.status || '—'),
      ltr(e.messageId || '—'),
      (e.body || '').slice(0, 60) + ((e.body || '').length > 60 ? '…' : ''),
      e.error || '—',
    ]));
}

function renderLog() {
  const box = document.querySelector('#s-log');
  if (box) box.innerHTML = logHtml();
}

function statusMini(r) {
  const a = r.sentPlanning ? '🟠' : '';
  const b = r.sentActual ? '🔵' : '';
  if (r.sentPlanning && r.sentActual) return '<span class="sms-st">🟢</span>';
  if (r.sentPlanning) return '<span class="sms-st">🟠</span>';
  if (r.sentActual) return '<span class="sms-st">🔵</span>';
  return '<span class="sms-st">🔴</span>';
}

function requireAdminLocal() {
  if (App.role === 'admin') return true;
  toast('هذه العملية تتطلب صلاحية مدير', 'warn');
  return false;
}

async function doSend(app) {
  const root = document.querySelector('#tab-sms');
  const body = root.querySelector('#s-body').value;
  const rows = local.mode === 'all' ? app.status.rows : app.status.rows.filter((r) => app.selected.has(r.nameNorm));
  if (!rows.length) {
    toast(CFG.texts.smsSelectOne, 'error');
    return;
  }
  if (!body.trim()) {
    toast('نص الرسالة فارغ', 'error');
    return;
  }
  const provider = local.provider;
  const entries = buildMessages(rows, body, { week: app.week, type: local.type }, app.phones);

  /* التحقق من وجود رقم جوال صالح قبل فتح التأكيد (§8) */
  const validPhones = entries.filter((e) => isValidPhone(e.phone)).length;
  if (provider !== 'copy' && validPhones === 0) {
    toast(CFG.texts.smsNoValidPhone, 'error');
    return;
  }
  const noPhone = entries.length - validPhones;
  const providerLabel = (SMS_PROVIDERS.find((p) => p.key === provider) || {}).label || provider;

  showModal({
    title: CFG.texts.smsConfirmTitle,
    body:
      '<p class="confirm-text">' + escapeHtml(CFG.texts.smsConfirmLine(rows.length)) + '</p>' +
      '<p><b>' + escapeHtml(CFG.texts.smsAsk) + '</b></p>' +
      '<ul class="export-summary">' +
        '<li>طريقة الإرسال: <b>' + escapeHtml(providerLabel) + '</b>' +
          (provider === 'api' ? ' ← <code>' + escapeHtml(gatewayUrl(app.settings)) + '</code>' : '') + '</li>' +
        '<li>أرقام جوال صالحة: <b>' + validPhones + '</b>' +
          (noPhone ? ' · بلا رقم صالح (لن تُرسل لهم): <b>' + noPhone + '</b>' : '') + '</li>' +
        '<li class="muted">رسالة مستقلة باسم كل مشرف — لا يُرسل إلا إلى المحددين.</li>' +
      '</ul>',
    actions: [
      { label: CFG.texts.cancel, cls: 'btn-ghost' },
      {
        label: CFG.texts.smsConfirmAction,
        cls: 'btn-primary',
        onClick: async () => {
          await runBatch(app, entries, provider, { opId: uid(), attempt: 1 });
          return false;
        },
      },
    ],
  });
}

/* إرسال متسلسل مع نافذة تقدّم حيّة — تعطيل زر الإرسال ضد الضغط المكرر (§7) */
async function runBatch(app, entries, provider, opts) {
  const o = opts || { opId: uid(), attempt: 1 };
  sending = true;
  const sendBtn = document.querySelector('#tab-sms #s-send');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ ' + CFG.texts.smsSending; }

  let prog = null;
  try {
    prog = showModal({
      title: CFG.texts.smsSending,
      body:
        '<div id="sms-prog">' +
        '<p class="prog-line"><b id="sms-prog-done">' + escapeHtml(CFG.texts.smsProgress(0, entries.length)) + '</b></p>' +
        '<ul class="export-summary">' +
          '<li>تم الإرسال: <b id="sms-prog-sent" class="t-green">0</b></li>' +
          '<li>فشل الإرسال: <b id="sms-prog-failed">0</b></li>' +
          '<li>متبقٍ: <b id="sms-prog-left">' + entries.length + '</b></li>' +
        '</ul>' +
        '<p class="muted" id="sms-prog-current">—</p>' +
        '<div class="progress"><div class="progress-bar" id="sms-prog-bar" style="width:0%"></div></div>' +
        '</div>',
      actions: [{ label: 'إغلاق', cls: 'btn-ghost', keepOpen: true }],
    });

    const set = (id, v) => { const el = prog.body.querySelector('#' + id); if (el) el.textContent = v; };
    const res = await sendBatch({
      provider,
      entries,
      settings: app.settings,
      /* مفتاح العملية + المحاولة: ثابت لكل رسالة داخلها ويختلف بين المحاولات (§7/§17) */
      idempotencyKey: o.opId + '-a' + o.attempt,
      onProgress: (p) => {
        set('sms-prog-done', CFG.texts.smsProgress(p.index, p.total));
        set('sms-prog-sent', p.sent);
        set('sms-prog-failed', p.failed);
        set('sms-prog-left', p.remaining);
        const cur = prog.body.querySelector('#sms-prog-current');
        if (cur && p.item) cur.textContent = p.item.name;
        const bar = prog.body.querySelector('#sms-prog-bar');
        if (bar) bar.style.width = Math.round((p.index / Math.max(1, p.total)) * 100) + '%';
      },
    });

    /* سجل بعد كل رسالة: المستخدم والاسم والهاتف المموّه والوقت والنص والحالة وMessage ID وسبب الخطأ (§11) */
    const userName = App.role === 'admin' ? 'مدير' : 'عارض';
    (res.results || []).forEach((r, i) => {
      const item = entries[i] || {};
      smsLogAdd({
        name: r.name || item.name || '',
        phone: r.phone || item.phone || '',
        body: item.body || '',
        status: r.status || (r.ok ? 'SENT' : 'FAILED'),
        ok: r.ok,
        messageId: r.messageId || '',
        user: userName,
        provider: 'gateway',
        error: r.ok ? '' : failureReason(r, item),
      });
    });
    logAdd('إرسال SMS',
      (res.total || 0) + ' رسالة · تم الإرسال=' + res.sent + ' · فشل=' + res.failed + ' · ' + typeLabel(local.type),
      { op: 'إرسال SMS', count: res.total, user: userName, status: res.failed ? 'جزئي' : 'ناجح' });

    prog.close();
    prog = null;

    const allOk = res.failed === 0;
    const failLines = (res.results || [])
      .map((r, i) => {
        if (r.ok) return null;
        const item = entries[i] || {};
        if (r.code === 'NO_PHONES') return CFG.texts.smsNoPhoneLine(r.name || item.name || '—');
        return CFG.texts.smsFailSentence(r.name || item.name || '—', failureReason(r, item));
      })
      .filter(Boolean);

    const resModal = showModal({
      title: allOk ? CFG.texts.smsDoneTitle : CFG.texts.smsPartialTitle,
      body:
        '<ul class="export-summary">' +
          '<li>' + escapeHtml(CFG.texts.smsResultTotal) + ': <b>' + res.total + '</b></li>' +
          '<li>' + escapeHtml(CFG.texts.smsResultSent) + ': <b class="t-green">' + res.sent + '</b></li>' +
          '<li>' + escapeHtml(CFG.texts.smsResultFailed) + ': <b class="' + (res.failed ? 't-red' : '') + '">' + res.failed + '</b></li>' +
        '</ul>' +
        (failLines.length
          ? '<div class="banner orphan-banner"><ul class="export-summary">' +
            failLines.map((t) => '<li class="t-red">' + escapeHtml(t) + '</li>').join('') + '</ul></div>'
          : '<p class="t-green">✅ ' + escapeHtml(CFG.texts.smsProviderNotice) + '</p>') +
        (allOk ? '' : '<p class="muted">' + escapeHtml(CFG.texts.smsProviderNotice) + '</p>'),
      actions: [
        { label: 'حسنًا', cls: 'btn-primary' },
        (res.failed > 0 && provider !== 'copy'
          ? {
              label: CFG.texts.smsRetryFailed + ' (' + res.failed + ')',
              cls: 'btn-danger',
              onClick: async () => {
                resModal.close();
                const failedEntries = (res.results || [])
                  .map((r, i) => (r.ok ? null : entries[i]))
                  .filter(Boolean);
                if (!failedEntries.length) return false;
                await runBatch(app, failedEntries, provider, { opId: o.opId, attempt: o.attempt + 1 });
                return false;
              },
            }
          : null),
      ].filter(Boolean),
    });
    renderLog();

    if (allOk && res.sent > 0) {
      app.selected.clear();
      render(document.querySelector('#tab-sms'), app);
    }
  } catch (e) {
    if (prog) prog.close();
    toast('تعذّر إكمال الإرسال: ' + String((e && e.message) || e), 'error');
  } finally {
    sending = false;
    const b = document.querySelector('#tab-sms #s-send');
    if (b) {
      b.disabled = false;
      const n = local.mode === 'all' ? app.status.rows.length
        : app.status.rows.filter((r) => app.selected.has(r.nameNorm)).length;
      b.textContent = n ? '📱 إرسال SMS إلى ' + n + ' مشرفين' : '📱 إرسال SMS';
    }
  }
}
