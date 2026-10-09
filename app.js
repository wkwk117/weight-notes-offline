'use strict';
(() => {
  const $ = id => document.getElementById(id), C = window.WeightCore;
  const { add, diffDays, round, hasWeight, parseWeight, today } = C;
  const KEY = 'weight-notes:pwa:v1';
  const LEGACY_KEY = 'offline-weight-log:20261008-20261230:v1';
  const BUILD = '3.0.0';
  let state = null, PLAN = null, DATES = [], DATE_SET = new Set();
  let storageOK = true, loadBlocked = false, loadWarning = '', selected = '', activeTab = 'home', monthFilter = 'all', chartRange = 'all', toastTimer;
  let offlineReady = false, cacheMessage = '离线缓存尚未完成，首次打开需要网络。';
  const fixed = (n, d = 1) => n == null ? '—' : round(Number(n), d).toFixed(d);
  const signed = (n, d = 1) => n == null ? '—' : (round(n, d) > 0 ? '+' : '') + fixed(Object.is(n, -0) ? 0 : n, d);
  const short = d => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`;
  const weekday = d => '周' + '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()];
  const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const target = d => C.target(PLAN, d);
  const clampDate = d => d < PLAN.startDate ? PLAN.startDate : d > PLAN.endDate ? PLAN.endDate : d;
  const windowStats = d => C.windowStats(state, d);
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
  function diagnostics() {
    $('diagnostics').textContent = `版本：${BUILD}\n脚本：已启动\n本地存储：${storageOK ? '读写可用' : '失败，需备份'}\nHTTPS/安全上下文：${window.isSecureContext ? '是' : '否'}\n页面受控：${!!navigator.serviceWorker?.controller}\n离线缓存核验：${offlineReady ? '已就绪' : '未就绪'}\n入口：${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '主屏幕' : /MicroMessenger/i.test(navigator.userAgent) ? '微信网页' : '浏览器'}\n浏览器：${navigator.userAgent}`;
  }
  function storageNotice() {
    $('storage-warning').hidden = storageOK && !loadWarning;
    $('storage-warning').textContent = loadWarning || '本地存储失败；修改只在本次页面。请立即到「备份」导出 JSON 或复制备份文字，避免关闭后丢失。';
    $('storage-pill').lastElementChild.textContent = storageOK ? '本机记录' : '需备份';
    $('runtime-title').textContent = '交互已启动 · ' + (storageOK ? '本地存储可用' : '关闭前请备份');
    diagnostics();
  }
  function persist() {
    state.updatedAt = new Date().toISOString();
    if (loadBlocked) { storageOK = false; storageNotice(); return false; }
    try { const text = JSON.stringify(state); localStorage.setItem(KEY, text); if (localStorage.getItem(KEY) !== text) throw Error('write mismatch'); storageOK = true; storageNotice(); return true; }
    catch (_) { storageOK = false; storageNotice(); return false; }
  }
  function updateDraftNotice() {
    const ds = state ? Object.keys(state.drafts).sort() : [];
    $('draft-notice').hidden = !ds.length;
    $('draft-text').textContent = ds.length ? `${ds.length}条草稿未计入比较；同日有效记录保留。` : '';
  }
  function savedStatus() {
    $('save-status').textContent = !storageOK ? '未保存到本机，请备份' : state.drafts[selected] ? '草稿已保留，未计入比较' : state.records[selected] ? '已保存到当前浏览器' : '填写后立即保存';
    $('save-status').classList.toggle('status-danger', !storageOK);
  }
  function updateEntryCompare() {
    if (!state) return;
    $('day-target').textContent = fixed(target(selected));
    const r = state.records[selected];
    $('day-delta').textContent = signed(hasWeight(r) ? r.weight - target(selected) : null);
  }
  // All input writes happen synchronously, before a later tap/navigation can occur.
  // Never rebuild the active form or table while an input has focus.
  function saveInput(d, text, note) {
    let weight, error = '';
    try { weight = parseWeight(text); if (weight === null && hasWeight(state.records[d])) throw Error('空白保留为草稿；要移除已有记录请使用删除。'); }
    catch (e) { error = e.message; }
    if (error) state.drafts[d] = { text, note };
    else {
      delete state.drafts[d];
      if (weight === null && !note) delete state.records[d];
      else state.records[d] = { weight, note, updatedAt: new Date().toISOString() };
    }
    const ok = persist(); updateDraftNotice();
    return { ok, error };
  }
  function captureEntry() {
    if (!state || activeTab !== 'home') return;
    const result = saveInput(selected, $('entry-weight').value, $('entry-note').value.slice(0, 120));
    $('entry-error').textContent = result.error;
    $('entry-weight').setAttribute('aria-invalid', result.error ? 'true' : 'false');
    savedStatus(); updateEntryCompare(); renderStats();
    $('delete-record').disabled = !state.records[selected] && !state.drafts[selected];
  }
  function loadEntry() {
    if (!state) return;
    const r = state.records[selected], draft = state.drafts[selected];
    $('entry-date').value = selected;
    $('entry-weight').value = draft ? draft.text : hasWeight(r) ? fixed(r.weight) : '';
    $('entry-note').value = draft ? draft.note : r?.note || '';
    $('day-detail').textContent = `${selected === today() ? '今天' : weekday(selected)} · 第${diffDays(selected, PLAN.startDate) + 1}天`;
    $('prev-day').disabled = selected === PLAN.startDate; $('next-day').disabled = selected === PLAN.endDate;
    $('to-today').hidden = selected === clampDate(today()); $('delete-record').disabled = !r && !draft;
    $('entry-error').textContent = draft ? '这条输入已保留为草稿，同日有效记录未被覆盖。' : '';
    $('entry-weight').setAttribute('aria-invalid', draft ? 'true' : 'false');
    savedStatus(); updateEntryCompare();
  }
  function goDate(d) { if (!DATE_SET.has(d)) return; selected = d; loadEntry(); renderStats(); }
  function renderStats() {
    if (!state) return;
    const w = windowStats(selected);
    $('avg-weight').textContent = fixed(w.actual, 2); $('avg-delta').textContent = signed(w.delta, 2);
    $('avg-count').textContent = `${short(w.start)}—${short(w.end)} · 已记${w.n}天`;
    $('avg-ref').textContent = w.n ? `同期参考 ${fixed(w.reference, 2)} kg` : '仅比较已记录日期';
    const count = DATES.filter(d => hasWeight(state.records[d])).length;
    $('record-count').textContent = count; $('record-bar').style.width = `${count / DATES.length * 100}%`;
    $('window-description').textContent = `均值截至所选日期 ${short(selected)}，包含当天。按这个窗口内已填写日期计算。`;
  }
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
    document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('setup-card').hidden = !!state || tab !== 'home';
    if (tab === 'home' && state) loadEntry();
    if (tab === 'records') renderRecords();
    if (tab === 'trend') { renderWeeks(); requestAnimationFrame(renderChart); }
    if (tab === 'backup') renderBackup();
    window.scrollTo(0, 0);
  }
  function configure() {
    PLAN = state?.plan || null; DATES = PLAN ? C.dates(PLAN) : []; DATE_SET = new Set(DATES);
    $('home-grid').hidden = !state;
    if (!state) { switchTab(activeTab); return; }
    selected = DATE_SET.has(selected) ? selected : clampDate(today()); monthFilter = selected.slice(0, 7);
    $('entry-date').innerHTML = DATES.map(d => `<option value="${d}">${d} · ${weekday(d)}</option>`).join('');
    $('plan-values').innerHTML = `${fixed(PLAN.startWeight)}<span>→</span>${fixed(PLAN.endWeight)} <small>kg</small>`;
    $('plan-dates').textContent = `${PLAN.startDate}—${PLAN.endDate} · ${DATES.length}个日期`;
    $('total-days').textContent = DATES.length;
    const months = [...new Set(DATES.map(d => d.slice(0, 7)))];
    $('month-tabs').innerHTML = months.map(m => `<button type="button" data-month="${m}">${m.slice(2, 4)}年${Number(m.slice(5))}月</button>`).join('') + '<button type="button" data-month="all">全部</button>';
    loadEntry(); renderStats(); updateDraftNotice(); switchTab(activeTab);
  }
  function renderRecords() {
    document.querySelectorAll('[data-month]').forEach(b => b.classList.toggle('active', b.dataset.month === monthFilter));
    let ds = DATES.filter(d => monthFilter === 'all' || d.startsWith(monthFilter));
    if ($('recorded-only').checked) ds = ds.filter(d => hasWeight(state.records[d]));
    $('records-body').innerHTML = ds.map(d => {
      const r = state.records[d], v = hasWeight(r) ? r.weight : null, draft = state.drafts[d];
      return `<tr><td><button type="button" class="date-btn" data-edit="${d}">${short(d)}<small>${weekday(d)}${draft ? ' · 草稿' : r?.note ? ' · 有备注' : ''}</small></button></td><td>${fixed(target(d))}</td><td><input type="text" inputmode="decimal" maxlength="20" autocomplete="off" data-weight-date="${d}" value="${escapeHTML(draft ? draft.text : v == null ? '' : fixed(v))}" aria-invalid="${!!draft}" placeholder="未记录" aria-label="${d}实际体重（kg）"></td><td data-delta-date="${d}">${signed(v == null ? null : v - target(d))}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty-row">请先设置参考线或导入备份。</td></tr>';
    $('table-count').textContent = `当前显示${ds.length}个日期。计划共${DATES.length}个日期。`;
  }
  function renderWeeks() {
    let html = '';
    for (let i = 0; i < DATES.length; i += 7) {
      const ds = DATES.slice(i, i + 7), available = ds.filter(d => hasWeight(state.records[d])), n = available.length;
      const a = n ? available.reduce((s, d) => s + state.records[d].weight, 0) / n : null;
      const r = n ? available.reduce((s, d) => s + target(d), 0) / n : null;
      html += `<tr><td>${short(ds[0])}—${short(ds[ds.length - 1])}<small>已记${n}/${ds.length}天</small></td><td>${fixed(a, 2)}</td><td>${fixed(r, 2)}</td><td>${signed(n ? a - r : null, 2)}</td></tr>`;
    }
    $('weekly-body').innerHTML = html;
  }
    function chartDates(){
    if(chartRange==='month')return DATES.filter(d=>d.startsWith(selected.slice(0,7)));
    if(chartRange==='recent')return DATES.filter(d=>d>=add(selected,-13)&&d<=selected);
    return DATES;
  }
  function renderChart(){
    if(activeTab!=='trend')return;if(!state){$('chart').textContent='请先设置参考线或导入备份。';return;}
    const dates=chartDates(),W=Math.max(280,$('chart').clientWidth),H=$('chart').clientHeight||276;
    const L=43,R=17,T=20,B=35,PW=W-L-R,PH=H-T-B;
    const records=dates.map(d=>hasWeight(state.records[d])?state.records[d].weight:null);
    const refs=dates.map(target),avgs=dates.map(d=>hasWeight(state.records[d])?windowStats(d).actual:null);
    const values=[...refs,...records.filter(v=>v!==null),...avgs.filter(v=>v!==null)];
    let low=Math.min(...values),high=Math.max(...values);const pad=Math.max(.4,(high-low)*.09);low-=pad;high+=pad;
    const x=i=>dates.length===1?L+PW/2:L+PW*i/(dates.length-1),y=v=>T+(high-v)/(high-low)*PH;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${dates[0]}至${dates[dates.length-1]}的实际体重、参考与近7天均值。完整数字可在全部日期和周表查看。"><text x="${L}" y="11" fill="#7b867c" font-size="10">kg</text>`;
    for(let i=0;i<5;i++){const value=low+(high-low)*i/4,Y=y(value);svg+=`<line x1="${L}" y1="${Y}" x2="${W-R}" y2="${Y}" stroke="#e7eae1" stroke-width="1"/><text x="${L-8}" y="${Y+3.5}" text-anchor="end" font-size="10.5" fill="#7b867c">${value.toFixed(1)}</text>`;}
    const ticks=Array.from(new Set([0,Math.round((dates.length-1)/3),Math.round((dates.length-1)*2/3),dates.length-1]));
    for(const i of ticks)svg+=`<text x="${x(i)}" y="${H-8}" text-anchor="${i===0&&dates.length>1?'start':i===dates.length-1&&dates.length>1?'end':'middle'}" font-size="11" fill="#7b867c">${short(dates[i])}</text>`;
    const selectedIndex=dates.indexOf(selected);if(selectedIndex>=0)svg+=`<line x1="${x(selectedIndex)}" y1="${T}" x2="${x(selectedIndex)}" y2="${H-B}" stroke="#e1e6dc" stroke-dasharray="2 5"/>`;
    function path(vals,color,width,dash){let p='',pen=false;vals.forEach((v,i)=>{if(v===null){pen=false;return;}p+=`${pen?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;pen=true;});return `<path d="${p.trim()}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash?` stroke-dasharray="${dash}"`:''}/>`;}
    svg+=path(refs,'#b0ad96',1.6,'5 5')+path(avgs,'#8e9ac0',1.8,'')+path(records,'#245d54',2.6,'');
    if(dates.length===1)svg+=`<circle cx="${x(0)}" cy="${y(refs[0])}" r="3" fill="#b0ad96"/>`;
    records.forEach((v,i)=>{if(v!==null)svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="${dates.length>35?3:4}" fill="#245d54" stroke="#fffefa" stroke-width="1.5"><title>${dates[i]} 实际 ${fixed(v)} kg；参考 ${fixed(refs[i])} kg；差值 ${signed(v-refs[i])} kg</title></circle>`;});
    svg+='</svg>';$('chart').innerHTML=svg;
    const count=records.filter(v=>v!==null).length;
    $('chart-caption').textContent=`${short(dates[0])}—${short(dates[dates.length-1])} · ${count}条实际记录。${count<2?'添加更多日期后会形成实际趋势线。':'缺失日期不补值；只连接连续日期。'}`;
  }
  function renderTrend(){renderWeeks();renderChart();}

  function renderBackup() {
    $('backup-time').textContent = state?.lastBackupAt ? `最近发起导出：${new Date(state.lastBackupAt).toLocaleString('zh-CN', { timeZone: 'Asia/Singapore' })}（请确认文件已保存）` : '尚未发起过备份导出。';
    diagnostics();
  }
  function backupText() { if (!state) throw Error('请先设置参考线或导入备份。'); return JSON.stringify(state, null, 2); }
  function deliver(blob, name) {
    function download() {
      try { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('已发起导出，请确认文件已保存；也可用备份文字。'); }
      catch (_) { toast('无法下载，请使用「显示备份文字」。'); }
    }
    try { const file = new File([blob], name, { type: blob.type }); if (navigator.canShare?.({ files: [file] }) && navigator.share) { navigator.share({ files: [file], title: '体重记录备份' }).then(() => toast('已交给系统，请确认已保存到文件。')).catch(e => e.name === 'AbortError' ? toast('已取消分享') : download()); return; } } catch (_) {}
    download();
  }
  function markExport() { state.lastBackupAt = new Date().toISOString(); persist(); renderBackup(); }
  function exportJSON() { try { const text = backupText(); markExport(); deliver(new Blob([text], { type: 'application/json' }), `weight-backup-${today()}.json`); } catch (e) { toast(e.message); } }
  function csvCell(v) { let s = String(v ?? ''); if (/^[=+@\-\t\r\n]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
  function exportCSV() {
    if (!state) return toast('请先设置参考线或导入备份。');
    const rows = [['日期', '参考体重_kg', '实际体重_kg', '实际减参考_kg', '近7天均值_kg', '近7天已记天数', '备注']];
    DATES.forEach(d => { const r = state.records[d], w = windowStats(d); rows.push([d, fixed(target(d)), hasWeight(r) ? fixed(r.weight) : '', hasWeight(r) ? signed(r.weight - target(d)) : '', fixed(w.actual, 2), w.n, r?.note || '']); });
    markExport(); deliver(new Blob(['\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `weight-records-${today()}.csv`);
  }
  function importBackupText(text, options = {}) {
    const status = $('import-status');
    try {
      if (text.length > 1024 * 1024) throw Error('备份超过1 MB，未导入。');
      const incoming = C.validate(JSON.parse(text));
      const samePlan = !state || JSON.stringify(state.plan) === JSON.stringify(incoming.plan);
      if (!samePlan && (Object.keys(state.records).length || Object.keys(state.drafts).length)) throw Error('当前已有不同计划的记录。为避免覆盖，未导入；请先导出当前备份，使用另一浏览器入口恢复。');
      const overlaps = state && samePlan ? [...new Set([...Object.keys(incoming.records), ...Object.keys(incoming.drafts)])].filter(d => state.records[d] || state.drafts[d]).length : 0;
      // A private restore link may initialize an empty browser without an extra tap.
      // Existing records always keep the normal conflict confirmation.
      if (!(options.initializeEmpty && !state && !loadBlocked) && !confirm(`导入${Object.keys(incoming.records).length}个日期和${Object.keys(incoming.drafts).length}条草稿。${overlaps}个重复日期以备份为准，其余保留。确认导入？`)) { status.textContent = '已取消导入，原记录保留。'; return; }
      if (state && samePlan) {
        const records = { ...state.records }, drafts = { ...state.drafts };
        Object.keys(incoming.records).forEach(d => { records[d] = incoming.records[d]; delete drafts[d]; });
        Object.assign(drafts, incoming.drafts);
        state = { ...state, records, drafts };
      } else state = incoming;
      const ok = persist(); configure();
      status.textContent = ok ? '已导入并保存到当前浏览器，请核对记录。' : '已读入本次页面，但本地保存失败；请立即导出备份。'; toast(status.textContent);
    } catch (e) { status.textContent = e instanceof SyntaxError ? 'JSON 损坏，没有修改记录。' : e.message; toast(status.textContent); }
  }
  function restoreFromLink() {
    if (!location.hash.startsWith('#restore=')) return;
    const encoded = location.hash.slice(9);
    // Fragments stay in the browser; remove the payload before rendering or caching.
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (_) { toast('无法清除恢复链接，请改用备份文件导入。'); return; }
    try {
      if (encoded.length > 1400000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error('恢复链接无效或过长，没有修改记录。');
      const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
      importBackupText(text, { initializeEmpty: true });
    } catch (_) { toast('恢复链接损坏，没有修改记录。请使用原备份导入。'); }
  }
  async function checkCache() {
    offlineReady = false; cacheMessage = '正在核验离线缓存…'; updateOffline();
    if (!window.isSecureContext || !('serviceWorker' in navigator)) { cacheMessage = '当前入口不支持离线缓存；请联网在 Safari 打开正式 HTTPS 网址。'; updateOffline(); return; }
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 15000))]);
      if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => { const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', on); reject(Error('control timeout')); }, 10000); function on() { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', on); resolve(); } } navigator.serviceWorker.addEventListener('controllerchange', on); on(); });
      const report = await new Promise((resolve, reject) => { const channel = new MessageChannel(), timer = setTimeout(() => reject(Error('cache timeout')), 5000); channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); }; navigator.serviceWorker.controller.postMessage({ type: 'VERIFY_CACHE' }, [channel.port2]); });
      if (!report?.ready || report.version !== BUILD) throw Error('incomplete');
      offlineReady = true; cacheMessage = '离线已就绪';
    } catch (_) { cacheMessage = '离线缓存未完成。保持联网，点「备份 → 运行状态 → 重新检查」。'; }
    updateOffline();
  }
  function updateOffline() { $('offline-status').textContent = cacheMessage + (offlineReady ? ` · ${navigator.onLine ? '可断网使用' : '当前离线，可继续记录'}` : ''); diagnostics(); }
  function loadStorage() {
    try {
      const raw = localStorage.getItem(KEY), legacy = raw ? null : localStorage.getItem(LEGACY_KEY);
      if (raw || legacy) state = C.validate(JSON.parse(raw || legacy));
      const probe = KEY + ':probe'; localStorage.setItem(probe, '1'); if (localStorage.getItem(probe) !== '1') throw Error('probe'); localStorage.removeItem(probe);
      if (legacy) persist();
    } catch (_) { storageOK = false; loadBlocked = true; loadWarning = '本地读取失败或记录损坏，已停止写入以保留原数据。请勿清除网站数据；可以在此导入已有 JSON 并导出本次备份。'; }
  }
  loadStorage();
  document.querySelectorAll('[data-needs-js]').forEach(e => e.disabled = false);
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('entry-date').addEventListener('change', e => goDate(e.target.value));
  $('prev-day').addEventListener('click', () => goDate(add(selected, -1))); $('next-day').addEventListener('click', () => goDate(add(selected, 1))); $('to-today').addEventListener('click', () => goDate(clampDate(today())));
  for (const id of ['entry-weight', 'entry-note']) $(id).addEventListener('input', captureEntry);
  $('entry-weight').addEventListener('keydown', e => { if (e.key === 'Enter') { captureEntry(); e.target.blur(); } });
  $('save-record').addEventListener('click', () => { captureEntry(); if (!state.drafts[selected]) loadEntry(); toast(!storageOK ? '未保存到本机，请立即备份' : state.drafts[selected] ? '草稿已保留，请检查数字' : '已保存'); });
  $('delete-record').addEventListener('click', () => { if (!confirm(`删除${selected}的实际记录、备注和草稿？参考线保留。`)) return; delete state.records[selected]; delete state.drafts[selected]; const ok = persist(); loadEntry(); renderStats(); updateDraftNotice(); toast(ok ? '已删除这一天的记录' : '本次页面已删除，保存失败，请备份'); });
  $('open-trend').addEventListener('click', () => switchTab('trend'));
  $('open-draft').addEventListener('click', () => { const d = Object.keys(state.drafts).sort()[0]; if (d) { goDate(d); switchTab('home'); $('entry-weight').focus(); } });
  $('month-tabs').addEventListener('click', e => { const b = e.target.closest('[data-month]'); if (b) { monthFilter = b.dataset.month; renderRecords(); } });
  $('recorded-only').addEventListener('change', renderRecords);
  $('records-body').addEventListener('input', e => {
    const input = e.target, d = input.dataset.weightDate; if (!d) return;
    const note = state.drafts[d]?.note ?? state.records[d]?.note ?? '';
    const result = saveInput(d, input.value, note); input.setAttribute('aria-invalid', result.error ? 'true' : 'false');
    input.closest('tr').querySelector('[data-delta-date]').textContent = signed(hasWeight(state.records[d]) ? state.records[d].weight - target(d) : null);
    $('table-count').textContent = !result.ok ? '未保存到本机，请立即导出备份。' : result.error || '已保存到当前浏览器。';
    renderStats();
  });
  $('records-body').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) { goDate(b.dataset.edit); switchTab('home'); } });
  document.querySelectorAll('[data-chart]').forEach(b => b.addEventListener('click', () => { chartRange = b.dataset.chart; document.querySelectorAll('[data-chart]').forEach(x => x.classList.toggle('active', x === b)); renderChart(); }));
  $('export-json').addEventListener('click', exportJSON); $('export-csv').addEventListener('click', exportCSV);
  $('show-backup-text').addEventListener('click', () => { try { $('backup-text').value = backupText(); $('backup-text').hidden = false; $('backup-text').focus(); $('backup-text').select(); } catch (e) { toast(e.message); } });
  $('import-json').addEventListener('click', () => $('import-file').click());
  $('import-text-button').addEventListener('click', () => importBackupText($('import-text').value));
  $('import-file').addEventListener('change', e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { $('import-status').textContent = '请选择不超过1 MB的 JSON。'; e.target.value = ''; return; } const r = new FileReader(); r.onload = () => { importBackupText(String(r.result)); e.target.value = ''; }; r.onerror = () => { $('import-status').textContent = '读取失败，可粘贴 JSON 文字恢复。'; e.target.value = ''; }; r.readAsText(file); });
  $('setup-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const plan = C.validatePlan({ startDate: $('plan-start').value, endDate: $('plan-end').value, startWeight: parseWeight($('plan-start-weight').value), endWeight: parseWeight($('plan-end-weight').value) });
      state = C.validate({ schema: 'offline-weight-log', version: 1, plan, records: {}, drafts: {} }); persist(); configure();
    } catch (err) { $('setup-error').textContent = err.message; }
  });
  $('plan-start').value = today(); $('plan-end').value = add(today(), 83);
  $('retry-cache').addEventListener('click', checkCache);
  window.addEventListener('online', updateOffline); window.addEventListener('offline', updateOffline);
  window.addEventListener('resize', () => { if (activeTab === 'trend') renderChart(); });
  // Inputs are already persisted. Lifecycle events only retry pending writes; no DOM replacement.
  function retryPending() { if (state && !storageOK && !loadBlocked) persist(); }
  window.addEventListener('pagehide', retryPending); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') retryPending(); });
  window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { try { state = C.validate(JSON.parse(e.newValue)); if (document.activeElement?.matches('input,textarea')) { toast('另一个页面更新了记录，请结束当前输入后重新打开本页核对。'); return; } configure(); } catch (_) { toast('另一个页面的记录格式无效，当前数据保留。'); } } });
  configure(); storageNotice(); renderBackup(); updateDraftNotice();
  restoreFromLink();
  window.addEventListener('hashchange', restoreFromLink);
  $('runtime-box').className = 'runtime-box ready'; window.weightTrackerReady = true;
  checkCache();
})();
