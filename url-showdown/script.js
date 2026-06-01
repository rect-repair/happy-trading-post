/* ============================================================
   URL SHOWDOWN: WIN98 EDITION — script.js
   Complete game logic. Zero framework dependencies.
   ============================================================ */

/* ============================================================
   FIREBASE CONFIG
   Replace FIREBASE_URL with your own Firebase Realtime Database
   URL, e.g.: 'https://your-project-default-rtdb.firebaseio.com'
   Leave as-is to use the local in-memory fallback leaderboard.
   ============================================================ */
const FIREBASE_URL = 'YOUR_FIREBASE_URL_HERE';

/* ============================================================
   BATTLE RULES POOL
   ============================================================ */
const BATTLE_RULES = [
  {
    id: 'library_crawl',
    emoji: '📚',
    name: 'THE LIBRARY CRAWL',
    desc: 'The website with the most raw text characters wins.',
    metric: 'Measuring: textContent character count',
    key: 'textLength',
    label: 'Characters',
    unit: 'chars'
  },
  {
    id: 'gallery_exhibition',
    emoji: '🖼',
    name: 'THE GALLERY EXHIBITION',
    desc: 'The website with the most visual assets (img, picture, svg tags) wins.',
    metric: 'Measuring: count of <img>, <picture>, and <svg> elements',
    key: 'imageCount',
    label: 'Visual Assets',
    unit: 'assets'
  },
  {
    id: 'ad_blocker_nightmare',
    emoji: '📢',
    name: 'AD-BLOCKER NIGHTMARE',
    desc: 'The website with the most advertising elements wins.',
    metric: 'Measuring: elements with ad/banner/sponsor/promo in class or id',
    key: 'adCount',
    label: 'Ad Elements',
    unit: 'ads'
  },
  {
    id: 'deep_hierarchy',
    emoji: '🌳',
    name: 'DEEP HIERARCHY',
    desc: 'The website with the deepest nested DOM tree architecture wins.',
    metric: 'Measuring: maximum DOM nesting depth level',
    key: 'domDepth',
    label: 'Nesting Depth',
    unit: 'levels'
  },
  {
    id: 'hyperlink_highway',
    emoji: '🔗',
    name: 'HYPERLINK HIGHWAY',
    desc: 'The website with the most outbound <a> anchor links wins.',
    metric: 'Measuring: count of <a href> anchor elements',
    key: 'linkCount',
    label: 'Anchor Links',
    unit: 'links'
  }
];

/* ============================================================
   PROGRESS BAR STEP LABELS
   ============================================================ */
const PROGRESS_STEPS = [
  { pct: 8,  label: 'Initializing battle systems...',  detail: 'Loading BATTLE.EXE modules...' },
  { pct: 18, label: 'Establishing proxy connection...', detail: 'Contacting api.allorigins.win...' },
  { pct: 32, label: 'Fetching Player 1 site...',        detail: '' },
  { pct: 52, label: 'Fetching Player 2 site...',        detail: '' },
  { pct: 66, label: 'Sites loaded. Parsing HTML...',    detail: 'Running DOMParser...' },
  { pct: 78, label: 'Analysing DOM structures...',      detail: 'Counting elements & depth...' },
  { pct: 90, label: 'Computing battle metrics...',      detail: '' },
  { pct: 98, label: 'Calculating winner...',            detail: 'Comparing scores...' },
  { pct: 100, label: 'Battle complete!',                detail: 'Preparing results...' }
];

/* ============================================================
   GAME STATE
   ============================================================ */
const state = {
  scores:      { p1: 0, p2: 0 },
  round:       1,
  isBattling:  false,
  currentRule: null,
  pendingUrl1: '',
  pendingUrl2: '',
  localBoard:  {}   // in-memory fallback leaderboard
};

/* ============================================================
   UTILITIES
   ============================================================ */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitizeUrl(url) {
  url = url.trim();
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

function truncateUrl(url, maxLen = 32) {
  try {
    const u = new URL(url);
    let s = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + '…' : url;
  }
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

/* Firebase key: base64 encode then strip forbidden chars */
function urlToFirebaseKey(url) {
  try {
    return btoa(unescape(encodeURIComponent(url)))
      .replace(/[.#$/\[\]]/g, '_')
      .substring(0, 64);
  } catch {
    return 'unknown_' + Math.abs(hashStr(url)).toString(36);
  }
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/* ============================================================
   SIMULATED SITE TELEMETRY (fallback when proxy fails)
   Values are deterministic per URL so reruns are consistent.
   ============================================================ */
function generateSimulatedMetrics(url) {
  let h = hashStr(url);
  const rand = (min, max) => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return min + (h % (max - min));
  };
  return {
    textLength: rand(4000,  85000),
    imageCount: rand(3,     140),
    adCount:    rand(0,     55),
    domDepth:   rand(7,     30),
    linkCount:  rand(10,    400),
    simulated:  true
  };
}

/* ============================================================
   DOM ANALYSIS HELPERS
   ============================================================ */
function getMaxDomDepth(el, depth, limit) {
  depth = depth || 0;
  limit = limit || 60;
  if (!el || !el.children || el.children.length === 0 || depth >= limit) return depth;
  let max = depth;
  for (let i = 0; i < el.children.length; i++) {
    const d = getMaxDomDepth(el.children[i], depth + 1, limit);
    if (d > max) max = d;
  }
  return max;
}

const AD_PATTERN = /(?:^|\s)(ad|ads|advert|advertisement|adunit|adslot|banner|sponsor|sponsored|sponsorship|promo|promotion|promoted)(?:\s|$|-|_)/i;

function countAdElements(doc) {
  let count = 0;
  const all = doc.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const cls  = typeof el.className === 'string' ? el.className : '';
    const id   = el.id   || '';
    const slot = el.getAttribute('data-ad-slot') || el.getAttribute('data-ad') || '';
    if (AD_PATTERN.test(' ' + cls + ' ') ||
        AD_PATTERN.test(' ' + id   + ' ') ||
        slot) {
      count++;
    }
  }
  return count;
}

function extractMetrics(doc) {
  const body = doc.body || doc.documentElement;
  return {
    textLength: (body.textContent || '').replace(/\s+/g, ' ').trim().length,
    imageCount: doc.querySelectorAll('img, picture, svg').length,
    adCount:    countAdElements(doc),
    domDepth:   getMaxDomDepth(body),
    linkCount:  doc.querySelectorAll('a[href]').length,
    simulated:  false
  };
}

/* ============================================================
   FETCH SITE METRICS
   ============================================================ */
async function fetchSiteMetrics(url) {
  const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
  try {
    const ctrl    = new AbortController();
    const timer   = setTimeout(() => ctrl.abort(), 10000);
    const res     = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    if (!html || html.length < 80) throw new Error('Empty response');
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');
    return extractMetrics(doc);
  } catch (err) {
    console.warn('[URL Showdown] Proxy failed for', url, '—', err.message, '→ using simulated data');
    return generateSimulatedMetrics(url);
  }
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function showModal(id) {
  const el = document.getElementById(id);
  el.style.display = 'flex';
  // Force reflow then add class so CSS transition can fire if desired
  el.offsetHeight;
  el.classList.add('visible');
}

function hideModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('visible');
  el.style.display = 'none';
}

/* ============================================================
   STATUS BAR HELPERS
   ============================================================ */
function setStatus(txt) {
  document.getElementById('status-text').textContent = txt;
}

function setBattleStatus(txt) {
  document.getElementById('battle-status').textContent = txt;
}

function setPlayerStatus(player, txt) {
  document.getElementById(player === 1 ? 'p1-status' : 'p2-status').textContent = txt;
}

function setPlayerLast(player, txt) {
  document.getElementById(player === 1 ? 'p1-last' : 'p2-last').textContent = txt;
}

/* ============================================================
   PROGRESS BAR
   ============================================================ */
function resetProgressBar() {
  document.getElementById('progress-track').innerHTML = '';
  document.getElementById('progress-pct').textContent    = '0%';
  document.getElementById('progress-label').textContent  = 'Initializing...';
  document.getElementById('progress-detail').textContent = '';
}

async function animateProgressTo(targetPct, label, detail, durationMs) {
  durationMs = durationMs || 400;
  const track   = document.getElementById('progress-track');
  const pctEl   = document.getElementById('progress-pct');
  const labelEl = document.getElementById('progress-label');
  const detailEl= document.getElementById('progress-detail');

  if (label)  labelEl.textContent  = label;
  if (detail !== undefined) detailEl.textContent = detail;

  // Calculate how many blocks fit in the bar
  const barInner   = track.parentElement.clientWidth - 6;  // padding
  const blockWidth = 14; // 12px + 2px gap
  const totalBlocks= Math.max(1, Math.floor(barInner / blockWidth));
  const targetBlks = Math.round((targetPct / 100) * totalBlocks);
  const currentBlks= track.children.length;
  const toAdd      = Math.max(0, targetBlks - currentBlks);

  if (toAdd === 0) return;
  const delay = Math.max(8, durationMs / toAdd);

  for (let i = 0; i < toAdd; i++) {
    const block = document.createElement('div');
    block.className = 'progress-block';
    track.appendChild(block);
    const pct = Math.round(((currentBlks + i + 1) / totalBlocks) * 100);
    pctEl.textContent = Math.min(100, pct) + '%';
    await sleep(delay);
  }
}

/* ============================================================
   BATTLE RULE MODAL
   ============================================================ */
function showBattleRuleModal(rule) {
  document.getElementById('rule-emoji').textContent  = rule.emoji;
  document.getElementById('rule-name').textContent   = rule.name;
  document.getElementById('rule-desc').textContent   = rule.desc;
  document.getElementById('rule-metric').textContent = rule.metric;
  showModal('rule-modal');
}

function closeRuleModal() {
  hideModal('rule-modal');
}

/* ============================================================
   RESULTS MODAL
   ============================================================ */
function showResultsModal(cfg) {
  const { winner, url1, url2, p1Val, p2Val, rule, p1Sim, p2Sim } = cfg;
  const winnerLabel = winner === 'p1' ? 'PLAYER 1' : 'PLAYER 2';
  const winnerUrl   = winner === 'p1' ? url1 : url2;

  document.getElementById('winner-banner').textContent = '🏆  WINNER: ' + winnerLabel + '  🏆';
  document.getElementById('winner-url').textContent    = winnerUrl;

  const diff     = Math.abs(p1Val - p2Val);
  const tieNote  = p1Val === p2Val ? '  (TIE — P1 wins by convention)' : '';
  const p1Arrow  = winner === 'p1' ? '  <-- WINNER' : '';
  const p2Arrow  = winner === 'p2' ? '  <-- WINNER' : '';

  const log = [
    '> RULE   : ' + rule.emoji + ' ' + rule.name,
    '> METRIC : ' + rule.label + ' (' + rule.unit + ')',
    '> ─────────────────────────────────',
    '  P1  [' + truncateUrl(url1, 24) + ']',
    '  ' + rule.label.toUpperCase().padEnd(14) + ': ' + fmtNum(p1Val) + p1Arrow,
    '',
    '  P2  [' + truncateUrl(url2, 24) + ']',
    '  ' + rule.label.toUpperCase().padEnd(14) + ': ' + fmtNum(p2Val) + p2Arrow,
    '> ─────────────────────────────────',
    '> MARGIN : ' + fmtNum(diff) + ' ' + rule.unit + tieNote,
    '> SESSION: P1=' + state.scores.p1 + 'pts   P2=' + state.scores.p2 + 'pts'
  ].join('\n');

  document.getElementById('battle-stats').textContent = log;

  const simNotice = document.getElementById('simulated-notice');
  simNotice.style.display = (p1Sim || p2Sim) ? 'block' : 'none';

  showModal('results-modal');
}

function closeResultsModal() {
  hideModal('results-modal');
  setBattleStatus('READY');
  setStatus('Ready for Round ' + state.round + '. Click RUN BATTLE.EXE to continue.');
}

/* ============================================================
   MAIN BATTLE FLOW — Entry point (bound to button)
   ============================================================ */
async function runBattle() {
  if (state.isBattling) return;

  const raw1 = document.getElementById('url1').value.trim();
  const raw2 = document.getElementById('url2').value.trim();

  if (!raw1 || !raw2) {
    alert('Please enter URLs for both players before running the battle!');
    return;
  }

  const url1 = sanitizeUrl(raw1);
  const url2 = sanitizeUrl(raw2);

  // Validate basic URL shape
  try { new URL(url1); } catch { alert('Player 1 URL is not valid.\nExample: https://example.com'); return; }
  try { new URL(url2); } catch { alert('Player 2 URL is not valid.\nExample: https://example.com'); return; }

  state.isBattling  = true;
  state.pendingUrl1 = url1;
  state.pendingUrl2 = url2;

  // Pick a random rule
  state.currentRule = BATTLE_RULES[Math.floor(Math.random() * BATTLE_RULES.length)];

  document.getElementById('run-battle-btn').disabled = true;
  setBattleStatus('BRIEFING...');
  setStatus('Battle rule assigned. Awaiting confirmation...');

  showBattleRuleModal(state.currentRule);
}

/* ============================================================
   BATTLE EXECUTION — triggered by "OK" in rule modal
   ============================================================ */
async function startBattleExecution() {
  closeRuleModal();

  const url1 = state.pendingUrl1;
  const url2 = state.pendingUrl2;
  const rule = state.currentRule;

  setBattleStatus('FIGHTING!');
  setPlayerStatus(1, 'FETCHING...');
  setPlayerStatus(2, 'FETCHING...');
  setStatus('Executing: ' + rule.emoji + ' ' + rule.name + '...');

  showModal('progress-modal');
  resetProgressBar();

  // Fire both fetches immediately so they run in parallel with the animation
  const fetchP1 = fetchSiteMetrics(url1);
  const fetchP2 = fetchSiteMetrics(url2);

  // Animate progress while fetches are in flight
  await animateProgressTo(12, PROGRESS_STEPS[0].label, PROGRESS_STEPS[0].detail, 280);
  await animateProgressTo(22, PROGRESS_STEPS[1].label, PROGRESS_STEPS[1].detail, 320);
  await animateProgressTo(35,
    'Fetching ' + truncateUrl(url1, 28) + '...',
    'Contacting proxy server...', 450);
  await animateProgressTo(52,
    'Fetching ' + truncateUrl(url2, 28) + '...',
    'Contacting proxy server...', 450);

  // Wait for actual fetch results
  const [p1Metrics, p2Metrics] = await Promise.all([fetchP1, fetchP2]);

  const p1Tag = p1Metrics.simulated ? 'SIMULATED' : 'LIVE DATA';
  const p2Tag = p2Metrics.simulated ? 'SIMULATED' : 'LIVE DATA';

  await animateProgressTo(66,
    'Sites received! Parsing HTML...',
    'P1: ' + p1Tag + '  |  P2: ' + p2Tag, 350);

  await animateProgressTo(80, PROGRESS_STEPS[5].label, PROGRESS_STEPS[5].detail, 400);
  await animateProgressTo(90, 'Computing ' + rule.label + '...', 'Rule: ' + rule.name, 300);
  await animateProgressTo(100, 'Calculating winner!', 'Preparing battle results...', 250);

  await sleep(420);
  hideModal('progress-modal');

  // ── Determine winner ──
  const p1Val = p1Metrics[rule.key];
  const p2Val = p2Metrics[rule.key];
  let winner;
  if (p1Val >= p2Val) {
    winner = 'p1';
    state.scores.p1++;
  } else {
    winner = 'p2';
    state.scores.p2++;
  }

  // Update UI
  document.getElementById('score1').textContent = 'SCORE: ' + state.scores.p1;
  document.getElementById('score2').textContent = 'SCORE: ' + state.scores.p2;
  document.getElementById('round-display').innerHTML = 'ROUND<br>' + state.round;
  document.getElementById('status-round').textContent = 'Round ' + state.round;

  setPlayerStatus(1, p1Metrics.simulated ? 'SIMULATED' : 'LIVE');
  setPlayerStatus(2, p2Metrics.simulated ? 'SIMULATED' : 'LIVE');
  setPlayerLast(1, fmtNum(p1Val) + ' ' + rule.unit);
  setPlayerLast(2, fmtNum(p2Val) + ' ' + rule.unit);

  // Flash winner panel
  const winPanel = document.getElementById(winner === 'p1' ? 'player1-panel' : 'player2-panel');
  winPanel.classList.add('winner-flash-anim');
  setTimeout(() => winPanel.classList.remove('winner-flash-anim'), 1700);

  // Show results
  showResultsModal({ winner, url1, url2, p1Val, p2Val, rule,
    p1Sim: p1Metrics.simulated, p2Sim: p2Metrics.simulated });

  // Push winner to leaderboard
  await pushWinToLeaderboard(winner === 'p1' ? url1 : url2);

  state.round++;
  state.isBattling = false;
  document.getElementById('run-battle-btn').disabled = false;
}

/* ============================================================
   RESET SESSION
   ============================================================ */
function resetSession() {
  if (!confirm('Reset session scores to 0–0?\nThis does not clear the global leaderboard.')) return;
  state.scores   = { p1: 0, p2: 0 };
  state.round    = 1;
  state.isBattling = false;
  document.getElementById('score1').textContent             = 'SCORE: 0';
  document.getElementById('score2').textContent             = 'SCORE: 0';
  document.getElementById('round-display').innerHTML        = 'ROUND<br>1';
  document.getElementById('status-round').textContent       = 'Round 1';
  document.getElementById('run-battle-btn').disabled        = false;
  document.getElementById('p1-status').textContent          = 'STANDBY';
  document.getElementById('p2-status').textContent          = 'STANDBY';
  document.getElementById('p1-last').textContent            = '---';
  document.getElementById('p2-last').textContent            = '---';
  setBattleStatus('READY');
  setStatus('Session reset. Enter URLs and click RUN BATTLE.EXE to begin.');
}

/* ============================================================
   FIREBASE LEADERBOARD
   ============================================================ */
function isFirebaseConfigured() {
  return FIREBASE_URL &&
         FIREBASE_URL !== 'YOUR_FIREBASE_URL_HERE' &&
         FIREBASE_URL.startsWith('http');
}

async function pushWinToLeaderboard(url) {
  if (!isFirebaseConfigured()) {
    // Local fallback
    state.localBoard[url] = (state.localBoard[url] || 0) + 1;
    renderLeaderboardData(
      Object.entries(state.localBoard)
        .map(([u, wins]) => ({ url: u, wins }))
        .sort((a, b) => b.wins - a.wins)
    );
    return;
  }

  const key      = urlToFirebaseKey(url);
  const endpoint = FIREBASE_URL.replace(/\/$/, '') + '/leaderboard/' + key + '.json';

  try {
    // Read current wins
    const getRes  = await fetch(endpoint);
    const current = await getRes.json();
    const wins    = (current && typeof current.wins === 'number') ? current.wins + 1 : 1;

    await fetch(endpoint, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url, wins, updatedAt: Date.now() })
    });

    await loadLeaderboard();
  } catch (err) {
    console.warn('[URL Showdown] Firebase write failed:', err.message);
    // Fallback gracefully
    state.localBoard[url] = (state.localBoard[url] || 0) + 1;
    renderLeaderboardData(
      Object.entries(state.localBoard)
        .map(([u, wins]) => ({ url: u, wins }))
        .sort((a, b) => b.wins - a.wins)
    );
  }
}

async function loadLeaderboard() {
  if (!isFirebaseConfigured()) {
    const entries = Object.entries(state.localBoard)
      .map(([u, wins]) => ({ url: u, wins }))
      .sort((a, b) => b.wins - a.wins);
    renderLeaderboardData(entries);
    return;
  }

  const endpoint = FIREBASE_URL.replace(/\/$/, '') + '/leaderboard.json';
  const list     = document.getElementById('leaderboard-list');
  list.innerHTML = '<div class="lb-empty">Loading scores...</div>';

  try {
    const res  = await fetch(endpoint);
    const data = await res.json();

    if (!data || typeof data !== 'object') {
      renderLeaderboardData([]);
      return;
    }

    const entries = Object.values(data)
      .filter(e => e && e.url && typeof e.wins === 'number')
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 25);

    renderLeaderboardData(entries);
  } catch (err) {
    console.warn('[URL Showdown] Firebase read failed:', err.message);
    list.innerHTML = '<div class="lb-empty">⚠ Could not load scores.<br>Check Firebase config.</div>';
    document.getElementById('leaderboard-status').textContent = 'Error loading';
  }
}

function renderLeaderboardData(entries) {
  const list   = document.getElementById('leaderboard-list');
  const status = document.getElementById('leaderboard-status');

  if (!entries || entries.length === 0) {
    list.innerHTML = '<div class="lb-empty">No scores yet.<br>Battle to earn glory!</div>';
    status.textContent = '0 entries';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  list.innerHTML = '';

  entries.forEach((entry, i) => {
    const row    = document.createElement('div');
    row.className = 'lb-row';

    const rank = document.createElement('span');
    rank.className   = 'lr-rank';
    rank.textContent = medals[i] || ('#' + (i + 1));

    const urlEl = document.createElement('span');
    urlEl.className   = 'lr-url';
    urlEl.textContent = truncateUrl(entry.url, 28);
    urlEl.title       = entry.url;

    const wins = document.createElement('span');
    wins.className   = 'lr-wins';
    wins.textContent = entry.wins;

    row.appendChild(rank);
    row.appendChild(urlEl);
    row.appendChild(wins);
    list.appendChild(row);
  });

  status.textContent = entries.length + (entries.length === 1 ? ' entry' : ' entries') +
    (isFirebaseConfigured() ? ' (global)' : ' (local session)');
}

/* ============================================================
   WINDOW DRAG
   ============================================================ */
function makeDraggable(winEl, handleEl) {
  let dragging = false;
  let ox = 0, oy = 0;

  handleEl.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('title-btn')) return;
    dragging = true;
    const rect = winEl.getBoundingClientRect();
    // Switch to fixed positioning so the element detaches from the flex layout
    winEl.style.position = 'fixed';
    winEl.style.left     = rect.left + 'px';
    winEl.style.top      = rect.top  + 'px';
    winEl.style.margin   = '0';
    winEl.style.zIndex   = '400';
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    winEl.style.left = (e.clientX - ox) + 'px';
    winEl.style.top  = (e.clientY - oy) + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (dragging) {
      dragging = false;
      winEl.style.zIndex = '';
    }
  });
}

/* ============================================================
   TASKBAR CLOCK
   ============================================================ */
function updateClock() {
  const n = new Date();
  const h = n.getHours().toString().padStart(2, '0');
  const m = n.getMinutes().toString().padStart(2, '0');
  document.getElementById('taskbar-clock').textContent = h + ':' + m;
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', function() {
  // Draggable windows
  makeDraggable(
    document.getElementById('arena-window'),
    document.getElementById('arena-title-bar')
  );
  makeDraggable(
    document.getElementById('leaderboard-window'),
    document.getElementById('leaderboard-title-bar')
  );

  // Clock
  updateClock();
  setInterval(updateClock, 15000);

  // Load leaderboard
  loadLeaderboard();

  // Initial status
  setStatus('System ready. Enter URLs and click RUN BATTLE.EXE to begin the battle.');

  // Keyboard shortcut: Enter on input fields triggers battle
  ['url1', 'url2'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !state.isBattling) runBattle();
    });
  });

  // Leaderboard status shows config state
  if (!isFirebaseConfigured()) {
    document.getElementById('leaderboard-status').textContent =
      'Local session mode (no Firebase)';
    document.getElementById('status-conn').textContent = 'FIREBASE: NOT SET';
  } else {
    document.getElementById('status-conn').textContent = 'FIREBASE: CONNECTED';
  }
});
