/* الإعدادات — الربط، الرسائل، الهواتف، الصلاحيات، السجل، البيانات */

import { CFG } from '../config.js';
import { escapeHtml, storeGet, storeSet, formatDateTime, csvParse, normName, downloadBlob, csvSerialize } from '../utils.js';
import { tableHtml, toast, showModal, confirmModal, emptyState, htmlCell } from './components.js';
import { logList, logClear, logAdd } from '../services/logService.js';
import { App, saveSettings, savePhones, saveTemplate, isAdmin, go, templateFor } from './app.js';

function card(title, body, id) {
  return '<div class="card settings-card"' + (id ? ' id="' + id + '"' : '') + '><h3>' + title + '</h3>' + body + '</div>';
}

export function render(root, app) {
  const s = app.settings;
  const logs = logList();
  const phoneCount = Object.keys(app.phones).length;
  const cache = storeGet(CFG.storage.cache, null);

  root.innerHTML =
    card('🔗 ربط الخدمات',
      '<div class="settings-grid">' +
        '<label class="field"><span>رابط Google Apps Script (ويب أب) للكتابة في الأرشيف</span>' +
          '<input type="url" id="set-script" placeholder="https://script.google.com/macros/s/…/exec" value="' + escapeHtml(s.appsScriptUrl || '') + '">' +
          '<small>انشر الملف <code>apps-script/AppendRows.gs</code> كتطبيق ويب ثم الصق الرابط. بدونه تبقى القراءة تعمل والكتابة معطّلة.</small></label>' +
        '<label class="field"><span>رابط مزوّد SMS عبر API (اختياري)</span>' +
          '<input type="url" id="set-smsapi" placeholder="https://provider.example/api/send" value="' + escapeHtml(s.smsApiUrl || '') + '">' +
          '<small>يُستقبل POST بصيغة {to:[…], body}. إن لم يُضبط، استخدم فتح تطبيق الرسائل/واتساب.</small></label>' +
      '</div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="set-save-conn">💾 حفظ الربط</button></div>' +
      '<p class="muted">لا تضع مفاتيح أو أسرار داخل المستودع — روابط الويب أب تُحفظ محلياً في هذا المتصفح فقط.</p>',
      'card-conn') +

    card('✉️ الرسائل الافتراضية',
      ['planning:رسالة التخطيط', 'actual:رسالة الفعلي', 'both:رسالة كلاهما', 'none:رسالة (لم يرسلوا)', 'complete:رسالة (مكتمل)'].map((x) => {
        const i = x.indexOf(':');
        const k = x.slice(0, i), lab = x.slice(i + 1);
        const cur = app.settings.templates[k] || CFG.messages[k];
        return '<label class="field"><span>' + lab + '</span><textarea data-tpl="' + k + '" rows="3">' + escapeHtml(cur) + '</textarea></label>';
      }).join('') +
      '<div class="btn-row"><button class="btn btn-primary" id="set-save-tpls">💾 حفظ الرسائل</button>' +
      '<button class="btn btn-ghost" id="set-reset-tpls">↩ استعادة الافتراضية</button></div>' +
      '<p class="muted">المتغيرات المتاحة: {المشرف} {الاسبوع} {النوع}</p>') +

    card('📱 أرقام الهواتف',
      '<p class="muted">لا توجد أعمدة هواتف في مصادر البيانات الحالية. استورد ملف CSV بأعمدة: <code>اسم المشرف, رقم الهوية, رقم الهاتف</code> لتفعيل إدراج الأرقام تلقائياً في التنبيهات.</p>' +
      '<div class="btn-row">' +
        '<label class="btn btn-primary file-btn">📂 استيراد CSV هواتف<input type="file" id="set-phones-file" accept=".csv,text/csv" hidden></label>' +
        '<button class="btn" id="set-phones-tpl">⬇ تنزيل قالب الهواتف</button>' +
        '<button class="btn btn-ghost" id="set-phones-clear">مسح القائمة</button>' +
      '</div>' +
      '<p>الأرقام المحفوظة: <b>' + phoneCount + '</b></p>') +

    card('🔐 الصلاحيات',
      (s.pin
        ? '<p>رمز المدير مُفعّل. الوضع الحالي: <b>' + (isAdmin() ? 'مدير ✅' : 'عارض 🔒') + '</b></p>' +
          '<div class="btn-row"><button class="btn" id="set-pin-change">تغيير الرمز</button>' +
          '<button class="btn btn-ghost" id="set-pin-clear">إلغاء الرمز</button></div>'
        : '<p class="muted">لا يوجد رمز — كل الوظائف مفتوحة (وضع مدير). ضع رمزاً لتفعيل وضع العارض وفصل العمليات الإدارية.</p>' +
          '<div class="btn-row"><button class="btn btn-primary" id="set-pin-set">تعيين رمز المدير</button></div>')) +

    card('🧾 سجل العمليات',
      (logs.length
        ? tableHtml(['الوقت', 'العملية', 'التفاصيل'],
            logs.slice(0, 100).map((l) => [l.time, l.type, l.detail])) +
          '<div class="btn-row"><button class="btn btn-ghost" id="set-log-clear">🗑 مسح السجل</button></div>'
        : emptyState('لا توجد عمليات بعد'))) +

    card('💾 البيانات والتحديث',
      '<div class="settings-grid">' +
        '<div><p>آخر تحديث: <b>' + (app.data && app.data.ts ? formatDateTime(new Date(app.data.ts)) : '—') + '</b></p>' +
        '<p>الحالة: <b>' + (app.data && app.data.offline ? '⚠ بيانات محفوظة (بلا اتصال)' : 'متصل') + '</b></p></div>' +
        '<div><p>المصادر:</p><ul class="src-list">' +
          Object.entries((app.data && app.data.sources) || {}).map(([k, v]) =>
            '<li>' + k + ': ' + (v.ok ? '✅' : '❌ ' + escapeHtml(v.error || '')) + '</li>').join('') +
          (app.data && app.data.ts ? '' : '<li>لا كاش</li>') +
        '</ul></div>' +
      '</div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="set-refresh">🔄 تحديث البيانات</button>' +
      '<button class="btn btn-ghost" id="set-clear-cache">حذف الكاش المحفوظ</button></div>');

  /* ربط */
  root.querySelector('#set-save-conn').addEventListener('click', () => {
    if (!guardAdmin('تعديل الربط')) return;
    saveSettings({
      appsScriptUrl: root.querySelector('#set-script').value.trim(),
      smsApiUrl: root.querySelector('#set-smsapi').value.trim(),
    });
    logAdd('تحديث الإعدادات', 'حفظ روابط الربط');
    toast('تم حفظ إعدادات الربط', 'ok');
  });

  /* رسائل */
  root.querySelector('#set-save-tpls').addEventListener('click', () => {
    if (!guardAdmin('تعديل الرسائل')) return;
    root.querySelectorAll('[data-tpl]').forEach((ta) => saveTemplate(ta.dataset.tpl, ta.value));
    toast('تم حفظ الرسائل الافتراضية', 'ok');
  });
  root.querySelector('#set-reset-tpls').addEventListener('click', () => {
    if (!guardAdmin('استعادة الرسائل')) return;
    root.querySelectorAll('[data-tpl]').forEach((ta) => saveTemplate(ta.dataset.tpl, ''));
    render(root, app);
    toast('تمت الاستعادة', 'ok');
  });

  /* هواتف */
  root.querySelector('#set-phones-file').addEventListener('change', (e) => {
    if (!guardAdmin('استيراد الهواتف')) return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = csvParse(String(reader.result));
        if (!rows.length) { toast('ملف فارغ', 'error'); return; }
        const header = rows[0].map((h) => String(h).trim());
        let iName = header.findIndex((h) => h.includes('اسم'));
        let iId = header.findIndex((h) => h.includes('هوي') || h.toLowerCase().includes('id'));
        let iPhone = header.findIndex((h) => h.includes('هات') || h.includes('جوال') || h.toLowerCase().includes('phone'));
        if (iPhone < 0) iPhone = header.length - 1;
        if (iName < 0) iName = 0;
        const map = { ...app.phones };
        let n = 0;
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const name = (r[iName] || '').trim();
          const phone = (r[iPhone] || '').trim().replace(/[^\d+]/g, '');
          const id = iId >= 0 ? (r[iId] || '').trim() : '';
          if (!name && !id) continue;
          if (!phone) continue;
          if (name) map[normName(name)] = phone;
          if (id) map[id] = phone;
          n++;
        }
        savePhones(map);
        logAdd('تحديث الإعدادات', 'استيراد هواتف: ' + n);
        render(root, app);
        toast('تم استيراد ' + n + ' رقم هاتف', 'ok');
      } catch (err) {
        toast('تعذّر قراءة الملف: ' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  root.querySelector('#set-phones-tpl').addEventListener('click', () => {
    const rows = [['اسم المشرف', 'رقم الهوية', 'رقم الهاتف']];
    for (const sup of (app.data.master || [])) rows.push([sup.name, sup.id, app.phones[sup.id] || app.phones[sup.nameNorm] || '']);
    downloadBlob('phones-template.csv', new Blob(['\uFEFF' + csvSerialize(rows)], { type: 'text/csv;charset=utf-8' }));
  });

  root.querySelector('#set-phones-clear').addEventListener('click', () => {
    if (!guardAdmin('مسح الهواتف')) return;
    confirmModal('سيتم حذف كل أرقام الهواتف المحفوظة في هذا المتصفح. متابعة؟', () => {
      savePhones({});
      render(root, app);
      toast('تم المسح', 'ok');
      return true;
    });
  });

  /* صلاحيات */
  const pinSet = root.querySelector('#set-pin-set');
  if (pinSet) pinSet.addEventListener('click', () => pinFlow(app, root, false));
  const pinChange = root.querySelector('#set-pin-change');
  if (pinChange) pinChange.addEventListener('click', () => pinFlow(app, root, true));
  const pinClear = root.querySelector('#set-pin-clear');
  if (pinClear) pinClear.addEventListener('click', () => {
    if (!guardAdmin('إلغاء رمز المدير')) return;
    saveSettings({ pin: '' });
    render(root, app);
    toast('تم إلغاء الرمز — الوضع مدير دائماً', 'ok');
  });

  /* سجل */
  const logBtn = root.querySelector('#set-log-clear');
  if (logBtn) logBtn.addEventListener('click', () => {
    if (!guardAdmin('مسح السجل')) return;
    confirmModal('مسح سجل العمليات بالكامل؟', () => {
      logClear();
      render(root, app);
      toast('تم مسح السجل', 'ok');
      return true;
    });
  });

  /* بيانات */
  root.querySelector('#set-refresh').addEventListener('click', () => {
    document.querySelector('#btn-refresh').click();
  });
  root.querySelector('#set-clear-cache').addEventListener('click', () => {
    if (!guardAdmin('حذف الكاش')) return;
    confirmModal('حذف نسخة البيانات المحفوظة؟ (ستحتاج اتصالاً عند إعادة الفتح)', () => {
      localStorage.removeItem(CFG.storage.cache);
      render(root, app);
      toast('تم حذف الكاش', 'ok');
      return true;
    });
  });
}

function guardAdmin(label) {
  if (isAdmin()) return true;
  toast('عملية إدارية: ' + label + ' — تتطلب صلاحية مدير', 'warn');
  return false;
}

function pinFlow(app, root, change) {
  if (!guardAdmin('إعدادات الصلاحيات')) return;
  showModal({
    title: change ? 'تغيير رمز المدير' : 'تعيين رمز المدير',
    body: (change ? '<label class="field-label">الرمز الحالي</label><input type="password" id="pin-old" class="input">' : '') +
      '<label class="field-label">رمز جديد (4 أرقام أو أكثر)</label><input type="password" id="pin-new" class="input" inputmode="numeric">' +
      '<label class="field-label">تأكيد الرمز</label><input type="password" id="pin-confirm" class="input" inputmode="numeric">',
    actions: [
      { label: 'إلغاء', cls: 'btn-ghost' },
      {
        label: 'حفظ',
        cls: 'btn-primary',
        keepOpen: true,
        onClick: () => {
          const oldV = change ? document.querySelector('#pin-old').value : null;
          const nv = document.querySelector('#pin-new').value.trim();
          const cv = document.querySelector('#pin-confirm').value.trim();
          if (change && oldV !== app.settings.pin) { toast('الرمز الحالي غير صحيح', 'error'); return false; }
          if (nv.length < 4) { toast('الرمز قصير (4 أحرف على الأقل)', 'error'); return false; }
          if (nv !== cv) { toast('التأكيد غير مطابق', 'error'); return false; }
          saveSettings({ pin: nv });
          document.querySelector('#modal-root').innerHTML = '';
          render(root, app);
          logAdd('تحديث الإعدادات', 'تعيين/تغيير رمز المدير');
          toast('تم حفظ الرمز', 'ok');
          return true;
        },
      },
    ],
  });
}
