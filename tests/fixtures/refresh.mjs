/* تحديث الثوابت الحية من الملفات الثلاثة — يُشغَّل يدوياً بعد كل ترحيل فعلي */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
const { CFG } = await import("../../js/config.js");
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const NC = "&nc=" + Date.now();
const jobs = [
  ["lists.csv", CFG.sheets.lists],
  ["admin.csv", CFG.sheets.admin],
  ["programs.csv", CFG.sheets.programs],
];
for (const [name, u] of jobs) {
  const r = await fetch(u + NC);
  const t = await r.text();
  fs.writeFileSync(path.join(dir, name), t);
  console.log("wrote", name, t.length, "chars");
}
