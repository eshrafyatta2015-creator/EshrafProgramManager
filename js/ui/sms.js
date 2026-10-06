/* تنبيه SMS — اختيار المشرفين + رسالة قابلة للتعديل + تأكيد + إرسال عبر طبقة SMSService */

import { CFG } from '../config.js';
import { escapeHtml } from '../utils.js';
import { showModal, confirmModal, toast, emptyState } from './components.js';
import { SMS_PROVIDERS, buildMessage, resolveRecipients, send, confirmText, typeLabel, templateFor } from '../services/smsService.js';
import { logAdd } from '../services/logService.js';
import { App, templateFor as appTemplateFor, saveTemplate, go } from './app.js';

let local = {
  type: CFG.typePlanning,
  mode: 'selected',
  provider: 'device',
  body: '',
  query: '',
};

export function render(root, app) {
  if (App.smsPrefill) {
    local.mode = App.smsPrefill.mode || local.mode;
    App.smsPrefill = null;
  }
  if (!local.body) local.body = appTemplateFor(local.type);
  local.provider = app.settings.smsProvider || local.provider;

  const allRows = app.status.rows;
  const selectedRows = allRows.filter((r) => app.selected.has(r.nameNorm));
  const listRows = local.query
    ? allRows.filter((r) => r.nameNorm.includes(local.query))
    : allRows;

  root.innerHTML =
    '<div class="sms-layout">' +
      '<div class="card sms-compose">' +
        '<h3>✉️ تحرير الرسالة</h3>' +
        '<div class="field-row">' +
          '<div class="field mode-field"><span>نوع التنبيه:</span>' +
            [CFG.typePlanning + ':البرنامج التخطيطي', CFG.typeActual + ':البرنامج الفعلي', 'both:كلاهما'].map((x) => {
              const i = x.indexOf(':');
              const k = x.slice(0, i), lab = x.slice(i + 1);
              return '<label class="radio"><input type="radio" name="s-type" value="' + k + '"' + (local.type === k || (k === 'both' && local.type === 'both') ? ' checked' : '') + '> ' + lab + '</label>';
            }).join('') +
          '</div>' +
          '<label class="field"><span>طريقة الإرسال</span><select id="s-provider">' +
            SMS_PROVIDERS.map((p) => '<option value="' + p.key + '"' + (local.provider === p.key ? ' selected' : '') + '>' + p.label + '</option>').join('') +
          '</select></label>' +
        '</div>' +
        '<label class="field"><span>نص الرسالة (قابل للتعديل — المتغيرات: {المشرف} {الاسبوع} {النوع})</span>' +
          '<textarea id="s-body" rows="4">' + escapeHtml(local.body) + '</textarea></label>' +
        '<div class="btn-row">' +
          '<button class="btn btn-sm" id="s-save-tpl">💾 حفظ كافتراضي</button>' +
          '<button class="btn btn-sm btn-ghost" id="s-reset-tpl">↩ استعادة الافتراضي</button>' +
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
      '<button class="btn btn-primary btn-lg" id="s-send">📱 إرسال الرسائل</button>' +
    '</div>';

  const preview = () => {
    const body = root.querySelector('#s-body').value;
    const target = local.mode === 'all' ? allRows : selectedRows;
    const name = target.length === 1 ? target[0].name : 'المشرف الكريم';
    root.querySelector('#s-preview').textContent = buildMessage(body, { week: app.week, type: local.type, supervisor: name });
    const cnt = root.querySelector('#s-count');
    cnt.innerHTML = 'المستلمون: <b>' + (local.mode === 'all' ? allRows.length : selectedRows.length) + '</b> مشرف · النوع: <b>' +
      typeLabel(local.type) + '</b>' +
      (local.mode === 'all' && selectedRows.length ? '' : '');
  };

  root.querySelectorAll('input[name="s-type"]').forEach((r) => r.addEventListener('change', () => {
    local.type = r.value;
    root.querySelector('#s-body').value = appTemplateFor(local.type);
    preview();
  }));

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
    const key = local.type === CFG.typePlanning ? 'planning' : local.type === CFG.typeActual ? 'actual' : 'both';
    saveTemplate(key, root.querySelector('#s-body').value);
    toast('تم حفظ الرسالة الافتراضية', 'ok');
  });

  root.querySelector('#s-reset-tpl').addEventListener('click', () => {
    if (!requireAdminLocal()) return;
    const key = local.type === CFG.typePlanning ? 'planning' : local.type === CFG.typeActual ? 'actual' : 'both';
    saveTemplate(key, '');
    root.querySelector('#s-body').value = appTemplateFor(local.type);
    preview();
    toast('تمت استعادة الرسالة الافتراضية', 'ok');
  });

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

  root.querySelector('#s-send').addEventListener('click', () => doSend(app));

  preview();
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
    toast('لم يتم اختيار أي مشرف', 'error');
    return;
  }
  if (!body.trim()) {
    toast('نص الرسالة فارغ', 'error');
    return;
  }
  const provider = local.provider;
  confirmModal(confirmText(rows.length), async () => {
    const resolved = resolveRecipients(rows, app.phones);
    const name = rows.length === 1 ? rows[0].name : 'المشرف الكريم';
    const finalBody = buildMessage(body, { week: app.week, type: local.type, supervisor: name });
    const res = await send({ provider, recipients: resolved, body: finalBody, settings: app.settings });
    logAdd('إرسال تنبيه', provider + ' · ' + rows.length + ' مشرفين · ' + typeLabel(local.type) + ' · ' + (res.ok ? 'نجاح' : 'فشل: ' + (res.error || res.code || '')));
    if (provider === 'device' || provider === 'whatsapp' || provider === 'copy') {
      showModal({
        title: res.ok ? 'تمت العملية' : 'فشلت العملية',
        body: '<p class="' + (res.ok ? 't-green' : 't-red') + '">' + escapeHtml(res.notice || res.error || '') + '</p>' +
          '<p class="muted">ملاحظة: على الويب لا يمكن الإرسال الصامت — يُفتح تطبيق الرسائل/واتساب برسالة جاهزة، والإرسال الفعلي يُنفَّذ من التطبيق. الأرقام المدرجة: ' +
          (res.phonesIncluded != null ? res.phonesIncluded : 0) + ' من ' + rows.length + '.</p>',
        actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
      });
    } else {
      showModal({
        title: res.ok ? 'أكد المزوّد' : 'فشلت العملية',
        body: '<p class="' + (res.ok ? 't-green' : 't-red') + '">' + escapeHtml(res.notice || res.error || '') + '</p>' +
          (res.providerResponse ? '<pre class="code-block">' + escapeHtml(JSON.stringify(res.providerResponse, null, 2)) + '</pre>' : ''),
        actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
      });
    }
    if (res.ok) {
      app.selected.clear();
      render(document.querySelector('#tab-sms'), app);
    }
    return false;
  }, { title: 'تأكيد إرسال التنبيه' });
}
