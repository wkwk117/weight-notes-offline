'use strict';
// Pure calendar and backup logic; no personal defaults, network or storage.
(function (root) {
  const DAY = 86400000;
  const ms = d => Date.parse(d + 'T00:00:00Z');
  const add = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((ms(a) - ms(b)) / DAY);
  const round = (v, d = 1) => Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON * Math.max(1, Math.abs(v))) * 10 ** d) / 10 ** d;
  const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(ms(d)) && new Date(ms(d)).toISOString().slice(0, 10) === d;
  const normalize = s => s.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[．，,]/g, '.');
  function parseWeight(raw) {
    const s = normalize(raw);
    if (!s) return null;
    if (!/^\d{1,3}(?:\.\d)?$/.test(s)) throw Error('请输入 kg 数值，最多1位小数；临时输入已保留为草稿。');
    const n = Number(s);
    if (n <= 0 || n > 500) throw Error('请输入大于0、不超过500的 kg 数值。');
    return round(n);
  }
  function validatePlan(p) {
    if (!p || !validDate(p.startDate) || !validDate(p.endDate)) throw Error('参考线日期无效。');
    const days = diffDays(p.endDate, p.startDate);
    if (days < 1 || days > 3660) throw Error('结束日期须晚于开始日期，范围不超过10年。');
    for (const k of ['startWeight', 'endWeight']) {
      if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] <= 0 || p[k] > 500 || Math.abs(round(p[k]) - p[k]) > 1e-7) throw Error('参考体重须为有效 kg 数值，最多1位小数。');
    }
    return { startDate: p.startDate, endDate: p.endDate, startWeight: p.startWeight, endWeight: p.endWeight };
  }
  const dates = p => Array.from({ length: diffDays(p.endDate, p.startDate) + 1 }, (_, i) => add(p.startDate, i));
  const target = (p, d) => round(p.startWeight + (p.endWeight - p.startWeight) * diffDays(d, p.startDate) / diffDays(p.endDate, p.startDate));
  const hasWeight = r => !!r && typeof r.weight === 'number' && Number.isFinite(r.weight);
  function today(now = Date.now()) { return new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10); }
  const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const time = t => typeof t === 'string' && Number.isFinite(Date.parse(t)) ? t : '1970-01-01T00:00:00.000Z';
  function validate(raw) {
    if (!object(raw) || raw.schema !== 'offline-weight-log' || raw.version !== 1) throw Error('不是本工具支持的 JSON 备份。');
    const plan = validatePlan(raw.plan), allowed = new Set(dates(plan));
    if (!object(raw.records)) throw Error('备份缺少有效的记录。');
    const records = Object.create(null), drafts = Object.create(null);
    for (const [d, r] of Object.entries(raw.records)) {
      if (!allowed.has(d) || !object(r)) throw Error('备份包含范围外日期或无效记录。');
      if (r.weight !== null && (typeof r.weight !== 'number' || !Number.isFinite(r.weight) || r.weight <= 0 || r.weight > 500 || Math.abs(round(r.weight) - r.weight) > 1e-7)) throw Error('备份体重格式无效。');
      if (typeof r.note !== 'string' || r.note.length > 120) throw Error('备份备注格式无效。');
      records[d] = { weight: r.weight, note: r.note, updatedAt: time(r.updatedAt) };
    }
    if (raw.drafts !== undefined) {
      if (!object(raw.drafts)) throw Error('备份草稿格式无效。');
      for (const [d, r] of Object.entries(raw.drafts)) {
        if (!allowed.has(d) || !object(r) || typeof r.text !== 'string' || r.text.length > 20 || typeof r.note !== 'string' || r.note.length > 120) throw Error('备份草稿日期或内容无效。');
        drafts[d] = { text: r.text, note: r.note };
      }
    }
    return { schema: 'offline-weight-log', version: 1, plan, records, drafts, updatedAt: time(raw.updatedAt), lastBackupAt: raw.lastBackupAt ? time(raw.lastBackupAt) : null };
  }
  function windowStats(state, end) {
    const start = add(end, -6) < state.plan.startDate ? state.plan.startDate : add(end, -6);
    const ds = dates(state.plan).filter(d => d >= start && d <= end && hasWeight(state.records[d]));
    if (!ds.length) return { start, end, n: 0, actual: null, reference: null, delta: null };
    const actual = ds.reduce((s, d) => s + state.records[d].weight, 0) / ds.length;
    const reference = ds.reduce((s, d) => s + target(state.plan, d), 0) / ds.length;
    return { start, end, n: ds.length, actual, reference, delta: actual - reference };
  }
  const api = { add, diffDays, round, validDate, normalize, parseWeight, validatePlan, dates, target, hasWeight, today, validate, windowStats };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WeightCore = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
