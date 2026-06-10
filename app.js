const SHEET_ID = '1ozLGMxdJxZXPbhVnxn_iVXaNOulMM5kXxygTLOjfjPE';
const MAX_COMPLETED_TENDERS = 2;

function sheetCsvUrl(tabName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      field += c;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\n' || (c === '\r' && text[i+1] === '\n')) {
        row.push(field); field = '';
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
        i += (c === '\r') ? 2 : 1;
        continue;
      }
      if (c === '\r') { row.push(field); field = ''; if (row.some(v => v.trim())) rows.push(row); row = []; i++; continue; }
      field += c;
    }
    i++;
  }
  if (field || row.length) { row.push(field); if (row.some(v => v.trim())) rows.push(row); }
  return rows;
}

function csvToObjects(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
}

const SITE_BEDS = {
  Godagama:     ['Bed 1','Bed 2','Bed 3','Bed 4'],
  Kanabediara:  ['Bed 1','Bed 2'],
  Balangoda:    ['Bed 1','Bed 2'],
  Bataatha:     ['Bed 1','Bed 2','Bed 3'],
  Embilipitiya: ['Bed 1','Bed 2','Bed 3'],
};

const SITE_ACCENT = {
  Godagama:     '#22c55e',
  Kanabediara:  '#a855f7',
  Balangoda:    '#f97316',
  Bataatha:     '#06b6d4',
  Embilipitiya: '#f59e0b',
};

const COL = {
  tenderNo:'Tender No', product:'Product', castingDate:'Casting Date ',
  productionStatus:'Production Status', bedNo:'Bed No', lineNo:'Line No',
  dailyQty:'Daily Production Qty', slump:'Slump Test Result', ageToDays:'Age to Date',
  test1Age:'1st Test Age', test1Result:'1st Test Result',
  test2Age:'2nd Test Age', test2Result:'2nd Test Result',
  test3Age:'3rd Test Age', test3Result:'3rd Test Result',
  approval:'Approval to Line Release', lineReleasedDate:'Line Released Date',
  internalTestDate:'Internal Test Date', internalTestPoleNo:'Internal Test Pole No',
};

let activeSite = null;
let chartInstances = {};
let sortState = {};
let siteCache = {};

// ── Clock ──
function updateClock() {
  const now = new Date();
  document.getElementById('tb-clock').textContent =
    now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' }) +
    ' · ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Accent ──
function applyAccent(site) {
  const color = SITE_ACCENT[site] || '#22c55e';
  document.documentElement.style.setProperty('--site-color', color);
  document.getElementById('site-accent-bar').style.background = color;
  document.getElementById('site-accent-bar').style.boxShadow = `0 0 12px ${color}`;
  document.getElementById('site-dot').style.background = color;
  document.getElementById('site-dot').style.boxShadow = `0 0 6px ${color}`;
  document.getElementById('site-select').style.borderColor = color;
}

// ── Dropdown change ──
document.getElementById('site-select').addEventListener('change', function() {
  activeSite = this.value;
  applyAccent(activeSite);
  // Reset status + tender dropdowns
  activeStatus = 'ALL';
  activeTender = 'ALL';
  document.getElementById('status-selector-wrap').style.display = 'none';
  document.getElementById('tender-selector-wrap').style.display = 'none';
  if (siteCache[activeSite]) {
    renderAll(activeSite, siteCache[activeSite]);
  } else {
    fetchSite(activeSite);
  }
});

// ── Helpers ──
function flexGet(row, colName) {
  if (row[colName] !== undefined) return row[colName];
  const trimmed = colName.trim().toLowerCase();
  for (const k of Object.keys(row)) {
    const kt = k.trim().toLowerCase();
    if (kt === trimmed) return row[k];
    if (kt.startsWith(trimmed)) return row[k];
    if (trimmed.startsWith(kt)) return row[k];
    const wa = trimmed.split(/\s+/), wb = kt.split(/\s+/);
    if (wa.length >= 3 && wb.length >= 3 && wa.slice(0,3).join(' ') === wb.slice(0,3).join(' ')) return row[k];
  }
  return null;
}

const LK_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function parseDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  const n = Number(s);
  if (!isNaN(n) && n > 1000) {
    const d = new Date(Date.UTC(1970,0,1) + Math.floor(n - 25569) * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const lk = new Date(new Date(s).getTime() + LK_OFFSET_MS);
    return lk.getUTCFullYear() + '-' + String(lk.getUTCMonth()+1).padStart(2,'0') + '-' + String(lk.getUTCDate()).padStart(2,'0');
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + String(m[1]).padStart(2,'0') + '-' + String(m[2]).padStart(2,'0');
  if (s.length >= 10 && /^\d{4}/.test(s)) return s.slice(0,10);
  return s;
}

function normalizeRows(raw) {
  return raw.map(r => {
    const g = key => flexGet(r, key);
    const pn = v => { if (v===null||v===''||v===undefined) return null; const n=parseFloat(v); return isNaN(n)?null:n; };
    const pp = v => { if (v===null||v===undefined||String(v).trim()==='') return ''; const n=parseFloat(v); return isNaN(n)?String(v).trim():String(Math.round(n)); };
    return {
      tenderNo: g(COL.tenderNo)||'—', product: g(COL.product)||'—',
      castingDate: parseDate(g(COL.castingDate)),
      productionStatus: String(g(COL.productionStatus)||'').toUpperCase(),
      bedNo: g(COL.bedNo)||'—', lineNo: g(COL.lineNo)||'—',
      dailyQty: pn(g(COL.dailyQty))||0, slump: g(COL.slump)||'',
      ageToDays: pn(g(COL.ageToDays)),
      test1Age: pn(g(COL.test1Age)), test1Result: pn(g(COL.test1Result)),
      test2Age: pn(g(COL.test2Age)), test2Result: pn(g(COL.test2Result)),
      test3Age: pn(g(COL.test3Age)), test3Result: pn(g(COL.test3Result)),
      approval: g(COL.approval)||'',
      lineReleasedDate: parseDate(g(COL.lineReleasedDate)),
      internalTestDate: parseDate(g(COL.internalTestDate)),
      internalTestPoleNo: pp(g(COL.internalTestPoleNo)),
      __tabLabel: r.__tabLabel || '',
      __tabName:  r.__tabName  || '',
    };
  }).filter(r => r.castingDate || r.tenderNo !== '—');
}

// ── Fetch ──
// Fetches one CSV tab; returns null if tab doesn't exist (404 / error page / empty)
// seenTexts: a Set of full CSV strings already seen (ongoing tab, prior tabs) — used to detect
// Google Sheets silently returning another tab's data for a missing tab name
async function fetchTab(tabName, tagLabel, seenTexts) {
  try {
    const url = sheetCsvUrl(tabName);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[fetchTab] HTTP ${res.status} for tab: "${tabName}"`);
      return null;
    }
    const text = await res.text();
    if (text.trim().startsWith('<!')) {
      console.warn(`[fetchTab] HTML error page for tab: "${tabName}" — tab may not exist`);
      return null;
    }
    // If this response matches any previously seen tab — it's a Sheets fallback, not a real tab
    if (seenTexts && seenTexts.has(text)) {
      console.warn(`[fetchTab] Tab "${tabName}" returned duplicate content — treating as non-existent`);
      return null;
    }
    const objs = csvToObjects(text);
    if (!objs.length) {
      console.warn(`[fetchTab] Empty data for tab: "${tabName}"`);
      return null;
    }
    console.info(`[fetchTab] ✓ Loaded ${objs.length} rows from tab: "${tabName}"`);
    objs.forEach(r => { r.__tabLabel = tagLabel; r.__tabName = tabName; });
    objs.__rawText = text; // stored so caller can add to seenTexts
    return objs;
  } catch(e) {
    console.error(`[fetchTab] Exception for tab "${tabName}":`, e);
    return null;
  }
}

// Fetch completed tender tabs with fallback-dupe detection
async function fetchCompletedTabs(site) {
  const completedRaws = [];
  const seenTexts = new Set(); // track all full texts seen so far

  // Also fetch the ongoing tab text to exclude it as a false positive
  try {
    const ongoingRes = await fetch(sheetCsvUrl(`${site} - Ongoing`));
    if (ongoingRes.ok) {
      const t = await ongoingRes.text();
      if (t && !t.trim().startsWith('<!')) seenTexts.add(t);
    }
  } catch(e) {}

  for (let i = 1; i <= MAX_COMPLETED_TENDERS; i++) {
    const tabA = `${site} - Completed-Tender ${i}`;
    const tabB = `${site} - Completed- Tender ${i}`;
    let rows = await fetchTab(tabA, `completed-${i}`, seenTexts);
    if (!rows) rows = await fetchTab(tabB, `completed-${i}`, seenTexts);
    if (rows) {
      seenTexts.add(rows.__rawText); // register this tab's content
      completedRaws.push(rows);
    } else {
      break;
    }
  }
  return completedRaws;
}

async function fetchSite(site) {
  const el = document.getElementById('main-content');
  document.getElementById('table-section').style.display = 'none';
  el.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><div class="loading-text">Loading ${site} data...</div></div>`;
  try {
    const ongoingRaw = await fetchTab(`${site} - Ongoing`, 'ongoing');
    const completedRaws = await fetchCompletedTabs(site);

    const allRaw = [
      ...(ongoingRaw || []),
      ...completedRaws.flat()
    ];

    if (!allRaw.length) throw new Error(`No data found for site: ${site}`);

    siteCache[site] = normalizeRows(allRaw);
    renderAll(site, siteCache[site]);
  } catch (err) {
    el.innerHTML = `<div class="error-wrap">
      <div class="error-title">⚠ Data load failed</div>
      <div class="error-msg">Error: ${err.message}<br><br>
        Please check:<br>• Sheet is shared as <strong>"Anyone with the link can view"</strong><br>
        • Tab names follow the pattern: <em>${site} - Ongoing</em>, <em>${site} - Completed-Tender 1</em><br>
        • Internet connection is active
      </div>
    </div>`;
  }
}

function refreshSite() {
  delete siteCache[activeSite];
  fetchSite(activeSite);
}

// ── Render All ──
function renderAll_orig(site, rows) {
  const beds = SITE_BEDS[site] || [];
  const bedOptions = beds.map(b => `<option value="${b}">${b}</option>`).join('');

  document.getElementById('main-content').innerHTML = `
    <div class="pg-header">
      <h2 style="font-size:1.2rem;font-weight:700">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:.4rem">
          <polygon points="10,2 18,6 18,14 10,18 2,14 2,6" fill="#6b7280" stroke="#9ca3af" stroke-width="1"/>
          <polygon points="10,2 18,6 10,10 2,6" fill="#9ca3af"/>
          <polygon points="10,10 18,6 18,14 10,18" fill="#4b5563"/>
          <polygon points="10,10 2,6 2,14 10,18" fill="#374151"/>
        </svg>
        <span style="color:var(--site-color)">${site}</span> — Cube Test Analysis
      </h2>
      <p style="font-size:.75rem;color:var(--text2);margin-top:.25rem">Production quality tracking · Cube strength results · Age analysis</p>
    </div>

    <div class="kpi-row" id="kpi-wrap"></div>

    <div class="filter-bar">
      <label>Production Status:
        <select class="filter-sel" id="filt-status">
          <option value="">All</option>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
        </select>
      </label>
      <label>Bed:
        <select class="filter-sel" id="filt-bed">
          <option value="">All Beds</option>
          ${bedOptions}
        </select>
      </label>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">Daily Production Qty</div>
        <div class="chart-sub">Casting quantity per day</div>
        <div class="chart-box" style="height:220px"><canvas id="ch-daily"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">1st Test Cube Strength</div>
        <div class="chart-sub">MPa by casting date (min target 33.5 MPa)</div>
        <div class="chart-box" style="height:220px"><canvas id="ch-strength"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">1st vs 2nd vs 3rd Test</div>
        <div class="chart-sub">Parallel strength comparison per casting date</div>
        <div class="cmp-legend">
          <div class="cmp-legend-item"><span class="cmp-swatch-bar" style="background:rgba(251,191,36,0.85)"></span>1st Test MPa</div>
          <div class="cmp-legend-item"><span class="cmp-swatch-bar" style="background:rgba(16,185,129,0.85)"></span>2nd Test MPa</div>
          <div class="cmp-legend-item"><span class="cmp-swatch-bar" style="background:rgba(6,182,212,0.85)"></span>3rd Test MPa</div>
          <div class="cmp-legend-item"><span class="cmp-swatch-line" style="border-top-color:#22c55e"></span>33.5 MPa</div>
          <div class="cmp-legend-item"><span class="cmp-swatch-line" style="border-top-color:#f97316"></span>43.7 MPa</div>
          <div class="cmp-legend-item"><span class="cmp-swatch-line" style="border-top-color:#ef4444"></span>50.0 MPa</div>
        </div>
        <div class="chart-box" style="height:200px"><canvas id="ch-compare"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Production by Bed</div>
        <div class="chart-sub">Slot utilisation per bed</div>
        <div class="chart-box" style="height:220px"><canvas id="ch-bed"></canvas></div>
      </div>
      <div class="chart-card wide">
        <div class="chart-title">Casting Date vs Slump Test Result</div>
        <div class="chart-sub">Slump (mm) recorded per casting date</div>
        <div class="chart-box" style="height:180px"><canvas id="ch-slump"></canvas></div>
      </div>
    </div>`;

  document.getElementById('table-section').style.display = 'block';
  document.getElementById('tbl-site-label').textContent = `Production Register — ${site}`;

  window._currentRows = rows;
  window._allRows = rows;

  // ── Build Tender Tabs ──
  buildTenderTabs(rows);

  renderKPIs(rows);
  renderCharts(rows);
  renderTable(getFiltered(rows));

  document.getElementById('filt-status').onchange = () => rerender();
  document.getElementById('filt-bed').onchange    = () => rerender();
  document.getElementById('tbl-srch').oninput     = () => renderTable(getFiltered(window._currentRows));
}

function rerender() {
  const filtered = getFiltered(window._currentRows);
  renderCharts(filtered);
  renderTable(filtered);
}

// ── Status + Tender Dropdowns ──
let activeTender = 'ALL';
let activeStatus = 'ALL';
let _ongoingTenders = [], _completedTenders = [];

function isTenderCompleted(tenderRows) {
  if (!tenderRows.length) return false;
  // If rows came from a "Completed" tab, trust the tab label
  if (tenderRows.some(r => r.__tabLabel && r.__tabLabel.startsWith('completed'))) return true;
  // Fallback: all YES-cast rows have Approval=YES and a release date
  const castYes = tenderRows.filter(r => r.productionStatus === 'YES');
  if (!castYes.length) return false;
  return castYes.every(r => String(r.approval).toUpperCase() === 'YES' && r.lineReleasedDate);
}

function buildTenderTabs(allRows) {
  const statusWrap = document.getElementById('status-selector-wrap');
  const tenderWrap = document.getElementById('tender-selector-wrap');
  const tenderSel  = document.getElementById('tender-select');
  const statusSel  = document.getElementById('status-select');
  if (!statusWrap || !tenderWrap || !tenderSel || !statusSel) return;

  activeStatus = 'ALL';
  activeTender = 'ALL';

  // Use __tabLabel (set during fetch) to reliably identify ongoing vs completed tabs
  // __tabLabel is: 'ongoing', 'completed-1', 'completed-2', etc.
  const hasOngoing   = allRows.some(r => r.__tabLabel === 'ongoing');
  const completedNums = [...new Set(
    allRows
      .filter(r => r.__tabLabel && r.__tabLabel.startsWith('completed-'))
      .map(r => parseInt(r.__tabLabel.split('-')[1]))
  )].sort((a,b) => a-b);

  _ongoingTenders   = hasOngoing ? ['ongoing'] : [];
  // _completedTenders stores tab numbers like [1, 2, 3] mapped to tab names
  _completedTenders = completedNums.map(n => ({
    num: n,
    label: `Completed-Tender ${n}`,
    tabLabel: `completed-${n}`
  }));

  // Always show Status dropdown if ANY tabs were loaded
  // Hide only if there's literally just one tab and it's ongoing-only
  const totalTabs = (hasOngoing ? 1 : 0) + _completedTenders.length;
  if (totalTabs <= 1 && !(_completedTenders.length > 0 && hasOngoing)) {
    statusWrap.style.display = hasOngoing || _completedTenders.length ? 'flex' : 'none';
    tenderWrap.style.display = 'none';
    // Still wire up status sel even for single-type
  }

  // Always show status dropdown when data loaded
  statusWrap.style.display = 'flex';
  tenderWrap.style.display = 'none';

  // Rebuild status select
  const newStatusSel = statusSel.cloneNode(true);
  statusSel.parentNode.replaceChild(newStatusSel, statusSel);
  newStatusSel.value = 'ALL';

  newStatusSel.querySelector('option[value="ONGOING"]').style.display   = hasOngoing ? '' : 'none';
  newStatusSel.querySelector('option[value="COMPLETED"]').style.display = _completedTenders.length ? '' : 'none';

  updateStatusDot('ALL');

  newStatusSel.addEventListener('change', function() {
    activeStatus = this.value;
    activeTender = 'ALL';
    updateStatusDot(activeStatus);
    applyStatusFilter();
  });

  // Build tender sub-select for completed tenders
  tenderSel.innerHTML = '<option value="ALL">All Completed</option>';
  _completedTenders.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.tabLabel;
    opt.textContent = `Tender ${t.num}`;
    tenderSel.appendChild(opt);
  });

  const newTenderSel = tenderSel.cloneNode(true);
  tenderSel.parentNode.replaceChild(newTenderSel, tenderSel);
  newTenderSel.value = 'ALL';

  newTenderSel.addEventListener('change', function() {
    activeTender = this.value;
    applyStatusFilter();
  });
}

function applyStatusFilter() {
  const tenderWrap = document.getElementById('tender-selector-wrap');
  let filtered;
  const label = document.getElementById('tbl-site-label');

  if (activeStatus === 'ALL') {
    filtered = window._allRows;
    if (tenderWrap) tenderWrap.style.display = 'none';
    label.textContent = `Production Register — ${activeSite}`;

  } else if (activeStatus === 'ONGOING') {
    filtered = window._allRows.filter(r => r.__tabLabel === 'ongoing');
    if (tenderWrap) tenderWrap.style.display = 'none';
    label.innerHTML = `Production Register — ${activeSite}&nbsp;<span class="tender-section-badge tsb-ongoing">⏳ Ongoing</span>`;

  } else {
    // COMPLETED — filter by tabLabel starting with 'completed-'
    if (_completedTenders.length > 1 && tenderWrap) tenderWrap.style.display = 'flex';
    else if (tenderWrap) tenderWrap.style.display = 'none';

    if (activeTender === 'ALL') {
      filtered = window._allRows.filter(r => r.__tabLabel && r.__tabLabel.startsWith('completed-'));
      label.innerHTML = `Production Register — ${activeSite}&nbsp;<span class="tender-section-badge tsb-completed">✓ All Completed</span>`;
    } else {
      // activeTender is like 'completed-1', 'completed-2'
      filtered = window._allRows.filter(r => r.__tabLabel === activeTender);
      const num = activeTender.split('-')[1];
      label.innerHTML = `Production Register — ${activeSite}&nbsp;<span class="tender-section-badge tsb-completed">✓ Completed Tender ${num}</span>`;
    }
  }

  window._currentRows = filtered;
  renderKPIs(filtered);
  renderCharts(filtered);
  renderTable(getFiltered(filtered));
}

function updateStatusDot(status) {
  const dot = document.getElementById('status-dot');
  const sel = document.getElementById('status-select');
  if (!dot || !sel) return;
  if (status === 'ALL') {
    dot.className = 'tender-status-dot all';
    sel.className = '';
  } else if (status === 'COMPLETED') {
    dot.className = 'tender-status-dot completed';
    sel.className = 'status-completed';
  } else {
    dot.className = 'tender-status-dot';
    sel.className = '';
  }
}

function escAttr(s) { return String(s).replace(/"/g,'&quot;'); }


// ── Filter ──
function getFiltered(rows) {
  const status = document.getElementById('filt-status')?.value || '';
  const bed    = document.getElementById('filt-bed')?.value    || '';
  const srch   = (document.getElementById('tbl-srch')?.value   || '').toLowerCase();
  return rows.filter(r =>
    (!status || r.productionStatus === status) &&
    (!bed    || r.bedNo === bed) &&
    (!srch   || Object.values(r).join(' ').toLowerCase().includes(srch))
  );
}

// ── KPIs ──
function renderKPIs(rows) {
  const castYes    = rows.filter(r => r.productionStatus === 'YES');
  const uniqueDates = new Set(rows.map(r => r.castingDate).filter(Boolean));
  const totalQty   = castYes.reduce((a, r) => a + (r.dailyQty||0), 0);
  const with1st    = castYes.filter(r => r.test1Result !== null);
  const with3rd    = castYes.filter(r => r.test3Result !== null);
  const approved   = rows.filter(r => String(r.approval).toUpperCase() === 'YES').length;
  const released   = rows.filter(r => r.lineReleasedDate).length;
  const tenderNo   = rows[0]?.tenderNo || '—';
  const product    = rows[0]?.product  || '—';

  const intDates = [...new Set(rows.map(r => r.internalTestDate).filter(Boolean))].sort();
  const intDateDisplay = intDates.length === 0 ? '—' : intDates.length === 1 ? intDates[0] : `${intDates.length} dates`;
  const intDateSub = intDates.length === 0 ? 'No data yet' : intDates.length === 1 ? 'All rows match' : intDates[0] + ' … ' + intDates[intDates.length-1];

  const intPoles = [...new Set(rows.map(r => String(r.internalTestPoleNo||'').trim()).filter(p => p && p !== '—'))];
  const poleDisplay = intPoles.length === 0 ? '—' : intPoles.length === 1 ? intPoles[0] : intPoles.length + ' values';

  document.getElementById('kpi-wrap').innerHTML = `
    <div class="kpi-card blue"><div class="kpi-label">Tender No</div><div class="kpi-text-sm">${tenderNo}</div></div>
    <div class="kpi-card site"><div class="kpi-label">Product</div><div class="kpi-text-product">${product}</div></div>
    <div class="kpi-card blue"><div class="kpi-label">Total Cast Days</div><div class="kpi-val">${uniqueDates.size}</div></div>
    <div class="kpi-card green"><div class="kpi-label">Total Production Qty</div><div class="kpi-val">${totalQty}</div></div>
    <div class="kpi-card green"><div class="kpi-label">Approved</div><div class="kpi-val">${approved}</div><div class="kpi-sub">Line release approved</div></div>
    <div class="kpi-card cyan"><div class="kpi-label">Lines Released</div><div class="kpi-val">${released}</div><div class="kpi-sub">Released to date</div></div>
    <div class="kpi-card int-date" style="min-width:160px">
      <div class="kpi-label">🗓 Internal Test Date</div>
      <div class="kpi-int-date">${intDateDisplay}</div>
      <div class="kpi-sub" style="margin-top:.4rem">${intDateSub}</div>
    </div>
    <div class="kpi-card int-pole" style="min-width:160px">
      <div class="kpi-label">🔖 Internal Test Pole No</div>
      <div class="kpi-int-pole">${poleDisplay}</div>
      <div class="kpi-sub" style="margin-top:.3rem">${intPoles.length===1?'Pole number':intPoles.length===0?'No data yet':'Multiple values'}</div>
    </div>`;
}

// ── Charts ──
const CD = {
  plugins: {
    legend: { display: false },
    tooltip: { bodyColor:'#e2e8f0', titleColor:'#e2e8f0', backgroundColor:'#1f2940', borderColor:'#2a3550', borderWidth:1 }
  },
  scales: {
    x: { ticks:{ color:'#64748b', font:{size:10}, maxRotation:60 }, grid:{ color:'#1e2d45' } },
    y: { ticks:{ color:'#64748b', font:{size:10} }, grid:{ color:'#1e2d45' } }
  }
};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function renderCharts(rows) {
  const castYes = rows.filter(r => r.productionStatus === 'YES');

  destroyChart('daily');
  const dailyDates = [...new Set(rows.map(r => r.castingDate))].sort().filter(Boolean);
  const dailyQtys  = dailyDates.map(d => rows.filter(r => r.castingDate === d).reduce((a,r)=>a+r.dailyQty,0));
  const siteColor  = SITE_ACCENT[activeSite] || '#22c55e';
  if (document.getElementById('ch-daily')) {
    chartInstances['daily'] = new Chart(document.getElementById('ch-daily'), {
      type:'bar',
      data:{ labels: dailyDates.map(d=>d.slice(5)), datasets:[{ label:'Units Cast', data:dailyQtys, backgroundColor: siteColor+'b3', borderRadius:4 }] },
      options:{ ...CD, scales:{ x:CD.scales.x, y:{...CD.scales.y, beginAtZero:true} } }
    });
  }

  destroyChart('strength');
  const withS = castYes.filter(r => r.test1Result !== null);
  if (document.getElementById('ch-strength')) {
    chartInstances['strength'] = new Chart(document.getElementById('ch-strength'), {
      type:'line',
      data:{
        labels: withS.map(r=>r.castingDate.slice(5)),
        datasets:[{
          label:'1st Test MPa', data: withS.map(r=>r.test1Result),
          borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.1)',
          pointBackgroundColor: withS.map(r=>r.test1Result>=33.5?'#10b981':'#ef4444'),
          tension:.3, fill:true, pointRadius:4
        },{
          label:'Target (33.5)', data: withS.map(()=>33.5),
          borderColor:'rgba(245,158,11,.6)', borderDash:[5,4], pointRadius:0
        }]
      },
      options:{
        plugins:{...CD.plugins, legend:{display:true, labels:{color:'#94a3b8',font:{size:10},boxWidth:10}}},
        scales:{ x:CD.scales.x, y:{...CD.scales.y, min:20} }
      }
    });
  }

  destroyChart('compare');
  const allDates = [...new Set(castYes.map(r=>r.castingDate).filter(Boolean))].sort();
  const withTests = allDates.map(d => {
    const cands = castYes.filter(r=>r.castingDate===d);
    return cands.find(r=>r.test1Result!==null||r.test2Result!==null||r.test3Result!==null)||cands[0]||{castingDate:d,test1Result:null,test2Result:null,test3Result:null};
  });
  const n = allDates.length || 2;
  if (document.getElementById('ch-compare')) {
    chartInstances['compare'] = new Chart(document.getElementById('ch-compare'), {
      type:'bar',
      data:{
        labels: allDates.map(d=>d.slice(5)),
        datasets:[
          {type:'bar',  label:'1st',data:withTests.map(r=>r.test1Result??null),backgroundColor:'rgba(251,191,36,0.75)',borderColor:'rgba(251,191,36,0.9)',borderWidth:1,borderRadius:3,order:2},
          {type:'bar',  label:'2nd',data:withTests.map(r=>r.test2Result??null),backgroundColor:'rgba(16,185,129,0.75)',borderColor:'rgba(16,185,129,0.9)',borderWidth:1,borderRadius:3,order:2},
          {type:'bar',  label:'3rd',data:withTests.map(r=>r.test3Result??null),backgroundColor:'rgba(6,182,212,0.75)',borderColor:'rgba(6,182,212,0.9)',borderWidth:1,borderRadius:3,order:2},
          {type:'line', label:'33.5',data:Array(n).fill(33.5),borderColor:'#22c55e',borderWidth:2,pointRadius:0,pointHoverRadius:0,tension:0,fill:false,order:1,spanGaps:true},
          {type:'line', label:'43.7',data:Array(n).fill(43.7),borderColor:'#f97316',borderWidth:2,pointRadius:0,pointHoverRadius:0,tension:0,fill:false,order:1,spanGaps:true},
          {type:'line', label:'50.0',data:Array(n).fill(50.0),borderColor:'#ef4444',borderWidth:2,pointRadius:0,pointHoverRadius:0,tension:0,fill:false,order:1,spanGaps:true},
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{bodyColor:'#e2e8f0',titleColor:'#e2e8f0',backgroundColor:'#1f2940',borderColor:'#2a3550',borderWidth:1, callbacks:{label:ctx=>ctx.raw!==null?` ${ctx.dataset.label}: ${ctx.raw} MPa`:null, filter:item=>item.raw!==null}} },
        scales:{ x:{offset:false,ticks:{color:'#64748b',font:{size:10},maxRotation:60,autoSkip:true},grid:{color:'#1e2d45',offset:false}}, y:{min:0,max:60,ticks:{color:'#64748b',font:{size:10},stepSize:10,callback:v=>v+' MPa'},grid:{color:'#1e2d45'}} }
      }
    });
  }

  destroyChart('bed');
  const bedGroups = {};
  castYes.forEach(r => { bedGroups[r.bedNo] = (bedGroups[r.bedNo]||0) + r.dailyQty; });
  if (document.getElementById('ch-bed')) {
    chartInstances['bed'] = new Chart(document.getElementById('ch-bed'), {
      type:'doughnut',
      data:{
        labels: Object.keys(bedGroups),
        datasets:[{data:Object.values(bedGroups), backgroundColor:['rgba(59,130,246,.8)','rgba(6,182,212,.8)','rgba(16,185,129,.8)','rgba(245,158,11,.8)','rgba(239,68,68,.8)'], borderWidth:2, borderColor:'#1a2235'}]
      },
      options:{ plugins:{legend:{display:true,labels:{color:'#94a3b8',font:{size:10},boxWidth:10}}, tooltip:CD.plugins.tooltip}, cutout:'65%' }
    });
  }

  destroyChart('slump');
  const slumpRows  = rows.filter(r=>r.castingDate&&r.slump&&String(r.slump).trim()!==''&&String(r.slump).trim()!=='—');
  const slumpDates = [...new Set(slumpRows.map(r=>r.castingDate))].sort();
  const slumpVals  = slumpDates.map(d => { const v=parseFloat(String(slumpRows.find(r=>r.castingDate===d)?.slump||'').replace(/[^\d.]/g,'')); return isNaN(v)?null:v; });
  if (document.getElementById('ch-slump')) {
    chartInstances['slump'] = new Chart(document.getElementById('ch-slump'), {
      type:'bar',
      data:{
        labels: slumpDates.map(d=>d.slice(5)),
        datasets:[{
          label:'Slump (mm)', data:slumpVals,
          backgroundColor:slumpVals.map(v=>v===null?'rgba(100,116,139,0.4)':v<=75?'rgba(16,185,129,0.75)':v<=100?'rgba(245,158,11,0.75)':'rgba(239,68,68,0.75)'),
          borderColor:slumpVals.map(v=>v===null?'rgba(100,116,139,0.6)':v<=75?'rgba(16,185,129,1)':v<=100?'rgba(245,158,11,1)':'rgba(239,68,68,1)'),
          borderWidth:1, borderRadius:4
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{bodyColor:'#e2e8f0',titleColor:'#e2e8f0',backgroundColor:'#1f2940',borderColor:'#2a3550',borderWidth:1, callbacks:{label:ctx=>ctx.raw!==null?` Slump: ${ctx.raw} mm`:' No data'}}},
        scales:{ x:{ticks:{color:'#64748b',font:{size:10},maxRotation:60},grid:{color:'#1e2d45'}}, y:{beginAtZero:true,ticks:{color:'#64748b',font:{size:10},callback:v=>v+' mm'},grid:{color:'#1e2d45'}} }
      }
    });
  }
}

// ── Table ──
function renderTable_orig(rows) {
  const tbody = document.getElementById('main-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(r => {
    const castBadge = r.productionStatus === 'YES'
      ? '<span class="badge badge-yes">YES</span>'
      : '<span class="badge badge-no">NO</span>';
    const approvalBadge = r.approval
      ? (String(r.approval).toUpperCase()==='YES'
          ? '<span class="badge badge-approved">Approved</span>'
          : `<span class="badge badge-pending">${r.approval}</span>`)
      : '—';
    return `<tr>
      <td>${r.castingDate}</td><td>${castBadge}</td><td>${r.bedNo}</td><td>${r.lineNo}</td>
      <td class="num">${r.dailyQty||'—'}</td><td>${r.slump||'—'}</td>
      <td class="num">${r.ageToDays??'—'}</td><td class="num">${r.test1Age??'—'}</td>
      <td class="num">${r.test1Result!==null?r.test1Result+' MPa':'—'}</td>
      <td class="num">${r.test2Age??'—'}</td>
      <td class="num">${r.test2Result!==null?r.test2Result+' MPa':'—'}</td>
      <td class="num">${r.test3Age??'—'}</td>
      <td class="num">${r.test3Result!==null?r.test3Result+' MPa':'—'}</td>
      <td>${approvalBadge}</td><td>${r.lineReleasedDate||'—'}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('#main-tbl th').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col; if (!col) return;
      sortState[col] = !sortState[col];
      const sorted = [...rows].sort((a,b) => {
        const va=a[col], vb=b[col];
        if (va===null||va===undefined||va==='') return 1;
        if (vb===null||vb===undefined||vb==='') return -1;
        return sortState[col]?(va>vb?1:-1):(va<vb?1:-1);
      });
      renderTable(sorted);
    };
  });
}

// ════════════════════ DASHBOARD TABS ════════════════════
function setActiveTab(tabId) {
  document.querySelectorAll('.side-tab').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');
}

function switchDashTab(tabKey) {
  let status, tender;
  if (tabKey === 'ONGOING') {
    status = 'ONGOING'; tender = null;
    setActiveTab('tab-ongoing');
  } else if (tabKey === 'completed-1') {
    status = 'COMPLETED'; tender = 'completed-1';
    setActiveTab('tab-completed-1');
  } else if (tabKey === 'completed-2') {
    status = 'COMPLETED'; tender = 'completed-2';
    setActiveTab('tab-completed-2');
  }
  wizStatus = status; wizTender = tender;
  if (activeSite && siteCache[activeSite]) {
    renderAll(activeSite, siteCache[activeSite]);
    setTimeout(() => syncTopbarLabels(status, tender), 120);
  } else if (activeSite) {
    fetchSiteWithFilter(activeSite, status, tender);
  }
}

function syncTopbarLabels(status, tender) {
  const statusSel  = document.getElementById('status-select');
  const tenderSel  = document.getElementById('tender-select');
  const statusWrap = document.getElementById('status-selector-wrap');
  const tenderWrap = document.getElementById('tender-selector-wrap');
  const statusDisp = document.getElementById('status-display');
  const tenderDisp = document.getElementById('tender-display');
  if (status === 'ONGOING') {
    if (statusSel) statusSel.value = 'ONGOING';
    if (statusWrap) statusWrap.style.display = 'flex';
    if (statusDisp) { statusDisp.textContent = '⏳ Ongoing'; statusDisp.style.color = '#f59e0b'; }
    activeStatus = 'ONGOING'; updateStatusDot('ONGOING'); applyStatusFilter();
  } else if (status === 'COMPLETED') {
    if (statusSel) statusSel.value = 'COMPLETED';
    if (statusWrap) statusWrap.style.display = 'flex';
    if (statusDisp) { statusDisp.textContent = '✓ Completed'; statusDisp.style.color = '#10b981'; }
    activeStatus = 'COMPLETED'; updateStatusDot('COMPLETED');
    if (tender && tenderSel) {
      activeTender = tender; tenderSel.value = tender;
      if (tenderWrap) tenderWrap.style.display = 'flex';
      if (tenderDisp) { const m = tender.match(/completed-(\d+)/); tenderDisp.textContent = m ? `Tender ${m[1]}` : tender; }
    }
    applyStatusFilter();
  }
}

// ════════════════════ LANDING WIZARD ════════════════════
const SITE_ACCENT_MAP = {
  Godagama:'#22c55e', Kanabediara:'#a855f7', Balangoda:'#f97316',
  Bataatha:'#06b6d4', Embilipitiya:'#f59e0b'
};

let wizSite = null, wizStatus = null, wizTender = null;

function wizSetStep(n) { /* no-op — single step now */ }

function wizSelectSite(site) {
  wizSite = site;
  activeSite = site;
  wizStatus = 'ONGOING'; // default tab when landing
  wizTender = null;
  applyAccent(site);
  document.getElementById('site-select').value = site;
  const disp = document.getElementById('site-display');
  if (disp) disp.textContent = site.toUpperCase();

  // Show sidebar
  const tbl = document.getElementById('sidebar');
  if (tbl) { tbl.style.display = 'flex'; }
  setActiveTab('tab-ongoing');

  // Fade overlay
  const overlay = document.getElementById('landing-overlay');
  overlay.classList.add('fade-out');
  overlay.addEventListener('transitionend', () => { overlay.style.display = 'none'; }, { once: true });

  fetchSiteWithFilter(site, 'ONGOING', null);
}

function goBackToLanding() {
  const overlay = document.getElementById('landing-overlay');
  overlay.style.display = 'flex'; overlay.style.opacity = '1';
  overlay.style.transform = ''; overlay.classList.remove('fade-out');

  // Hide sidebar
  const tbl = document.getElementById('sidebar');
  if (tbl) tbl.style.display = 'none';

  wizSite = null; wizStatus = null; wizTender = null; activeSite = null;
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('table-section').style.display = 'none';
  const sw = document.getElementById('status-selector-wrap');
  const tw = document.getElementById('tender-selector-wrap');
  if (sw) sw.style.display = 'none';
  if (tw) tw.style.display = 'none';
  const disp = document.getElementById('site-display');
  if (disp) disp.textContent = '';
  const statusDisp = document.getElementById('status-display');
  if (statusDisp) statusDisp.textContent = '';
  const tenderDisp = document.getElementById('tender-display');
  if (tenderDisp) tenderDisp.textContent = '';
}

async function fetchSiteWithFilter(site, status, tenderChoice) {
  const el = document.getElementById('main-content');
  document.getElementById('table-section').style.display = 'none';
  el.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><div class="loading-text">Loading ${site} data…</div></div>`;

  try {
    const ongoingRaw = await fetchTab(`${site} - Ongoing`, 'ongoing');
    const completedRaws = await fetchCompletedTabs(site);

    const allRaw = [...(ongoingRaw || []), ...completedRaws.flat()];
    if (!allRaw.length) throw new Error(`No data found for site: ${site}`);

    const allRows = normalizeRows(allRaw);
    siteCache[site] = allRows;

    // Apply filter from wizard selection
    let filtered = allRows;
    if (status === 'ONGOING') {
      filtered = allRows.filter(r => r.__tabLabel === 'ongoing');
    } else if (status === 'COMPLETED') {
      if (tenderChoice && tenderChoice !== 'ALL_COMPLETED') {
        filtered = allRows.filter(r => r.__tabLabel === tenderChoice);
      } else {
        filtered = allRows.filter(r => r.__tabLabel && r.__tabLabel.startsWith('completed-'));
      }
    }

    renderAll(site, allRows);

    // After renderAll, sync topbar labels to match choice
    setTimeout(() => syncTopbarLabels(status, tenderChoice), 120);

  } catch (err) {
    el.innerHTML = `<div class="error-wrap">
      <div class="error-title">⚠ Data load failed</div>
      <div class="error-msg">${err.message}<br><br>
        Please check the sheet is shared as "Anyone with the link can view".</div>
    </div>`;
  }
}

// ════════════════════ WARNING: 1st Test < 33.5 MPa ════════════════════
// Email alerts are now handled automatically by Google Apps Script.
// This section only shows the warning modal in the dashboard UI.
const WARN_THRESHOLD = 33.5;

let _warnRows = [];

function checkAndShowWarnings(rows) {
  _warnRows = rows.filter(r => r.test1Result !== null && r.test1Result < WARN_THRESHOLD);
  if (!_warnRows.length) return;

  const tbody = document.getElementById('warn-rows-tbody');
  if (!tbody) return;
  tbody.innerHTML = _warnRows.map(r => `
    <tr>
      <td class="td-tender">${r.tenderNo || '—'}</td>
      <td>${r.castingDate || '—'}</td>
      <td>${r.bedNo || '—'}</td>
      <td>${r.lineNo || '—'}</td>
      <td>${r.test1Age ?? '—'}</td>
      <td><span class="warn-result-val">${r.test1Result} MPa</span></td>
    </tr>`).join('');

  document.getElementById('warn-modal-overlay').style.display = 'flex';
}

function closeWarnModal() {
  document.getElementById('warn-modal-overlay').style.display = 'none';
}

// ── Hook warning check into renderAll ──
const _origRenderAll = renderAll_orig;
function renderAll(site, rows) {
  _origRenderAll(site, rows);

  // Only warn on rows belonging to the currently active tab
  let pageRows = rows;
  if (wizStatus === 'ONGOING') {
    pageRows = rows.filter(r => r.__tabLabel === 'ongoing');
  } else if (wizStatus === 'COMPLETED') {
    if (wizTender && wizTender !== 'ALL_COMPLETED') {
      pageRows = rows.filter(r => r.__tabLabel === wizTender);
    } else {
      pageRows = rows.filter(r => r.__tabLabel && r.__tabLabel.startsWith('completed-'));
    }
  }

  const warnCandidates = pageRows.filter(r => r.productionStatus === 'YES');
  checkAndShowWarnings(warnCandidates);
}

// ── Highlight warning rows in table ──
const _origRenderTable = renderTable_orig;
function renderTable(rows) {
  const tbody = document.getElementById('main-tbody');
  if (!tbody) return _origRenderTable(rows);

  tbody.innerHTML = rows.map(r => {
    const isLow = r.test1Result !== null && r.test1Result < WARN_THRESHOLD;
    const castBadge = r.productionStatus === 'YES'
      ? '<span class="badge badge-yes">YES</span>'
      : '<span class="badge badge-no">NO</span>';
    const approvalBadge = r.approval
      ? (String(r.approval).toUpperCase()==='YES'
          ? '<span class="badge badge-approved">Approved</span>'
          : `<span class="badge badge-pending">${r.approval}</span>`)
      : '—';
    const res1Html = r.test1Result !== null
      ? `<span class="${isLow ? 'result-warn' : ''}">${r.test1Result} MPa</span>`
      : '—';
    return `<tr class="${isLow ? 'warn-row' : ''}">
      <td>${r.castingDate}</td><td>${castBadge}</td><td>${r.bedNo}</td><td>${r.lineNo}</td>
      <td class="num">${r.dailyQty||'—'}</td><td>${r.slump||'—'}</td>
      <td class="num">${r.ageToDays??'—'}</td><td class="num">${r.test1Age??'—'}</td>
      <td class="num">${res1Html}</td>
      <td class="num">${r.test2Age??'—'}</td>
      <td class="num">${r.test2Result!==null?r.test2Result+' MPa':'—'}</td>
      <td class="num">${r.test3Age??'—'}</td>
      <td class="num">${r.test3Result!==null?r.test3Result+' MPa':'—'}</td>
      <td>${approvalBadge}</td><td>${r.lineReleasedDate||'—'}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('#main-tbl th').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col; if (!col) return;
      sortState[col] = !sortState[col];
      const sorted = [...rows].sort((a,b) => {
        const va=a[col], vb=b[col];
        if (va===null||va===undefined||va==='') return 1;
        if (vb===null||vb===undefined||vb==='') return -1;
        return sortState[col]?(va>vb?1:-1):(va<vb?1:-1);
      });
      renderTable(sorted);
    };
  });
}
// ══════════════════════════════════════════════════════════════
// Do NOT auto-fetch — wait for wizard completion