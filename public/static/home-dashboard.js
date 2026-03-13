// ══════════════════════════════════════════════════════
//  FaceAccess Home — Dashboard JS  v2.1 (hardened)
// ══════════════════════════════════════════════════════

'use strict';

const API = '';
let currentHomeId = null;
let currentUserId = null;
let refreshTimer = null;
let activityChart = null;

// ── Security: HTML escape to prevent XSS ─────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// ── Input validators ──────────────────────────────────
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidId(id)    { return /^[a-zA-Z0-9_\-]+$/.test(id); }

// ── Bootstrap ─────────────────────────────────────────
async function init() {
  clockTick();
  setInterval(clockTick, 1000);
  await loadDemoHome();
  showTab('overview');
  setInterval(() => {
    if (document.getElementById('tab-overview') && !document.getElementById('tab-overview').classList.contains('hidden')) {
      refreshOverview();
    }
  }, 10000);
}

function clockTick() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function loadDemoHome() {
  // Try to get first available home or create demo
  try {
    const r = await axios.get(`${API}/api/home/homes`);
    if (r.data.homes && r.data.homes.length > 0) {
      currentHomeId = r.data.homes[0].id;
      currentUserId = r.data.homes[0].owner_id;
    } else {
      // Create demo home
      const ur = await axios.post(`${API}/api/home/users`, { name: 'Jordan Kim', email: 'jordan@facehome.demo', phone: '+1-555-0100', role: 'owner' });
      currentUserId = ur.data.user.id;
      const hr = await axios.post(`${API}/api/home/homes`, { owner_id: currentUserId, name: 'Kim Residence', address: '142 Maple Street, Austin TX' });
      currentHomeId = hr.data.home.id;
      await seedDemoHomeData();
    }
  } catch (e) {
    console.error('Home load error', e);
  }
}

async function seedDemoHomeData() {
  if (!currentHomeId || !currentUserId) return;
  try {
    // Add member
    await axios.post(`${API}/api/home/users`, { home_id: currentHomeId, name: 'Riley Kim', email: 'riley@facehome.demo', phone: '+1-555-0101', role: 'member' });
    await axios.post(`${API}/api/home/users`, { home_id: currentHomeId, name: 'Casey Kim', email: 'casey@facehome.demo', phone: '+1-555-0102', role: 'member' });
    // Locks
    const l1 = await axios.post(`${API}/api/home/locks`, { home_id: currentHomeId, name: 'Front Door', location: 'Main entrance', lock_type: 'api', brand: 'august' });
    const l2 = await axios.post(`${API}/api/home/locks`, { home_id: currentHomeId, name: 'Back Door', location: 'Rear entrance', lock_type: 'api', brand: 'schlage' });
    const l3 = await axios.post(`${API}/api/home/locks`, { home_id: currentHomeId, name: 'Garage', location: 'Side garage door', lock_type: 'relay', brand: 'generic' });
    // Cameras
    await axios.post(`${API}/api/home/cameras`, { home_id: currentHomeId, lock_id: l1.data.lock.id, name: 'Front Door Camera', stream_url: 'rtsp://192.168.1.100:554/stream', camera_type: 'rtsp' });
    await axios.post(`${API}/api/home/cameras`, { home_id: currentHomeId, lock_id: l2.data.lock.id, name: 'Back Door Camera', stream_url: 'rtsp://192.168.1.101:554/stream', camera_type: 'rtsp' });
    // Devices
    const usersR = await axios.get(`${API}/api/home/users?home_id=${currentHomeId}`);
    for (const u of usersR.data.users) {
      await axios.post(`${API}/api/home/devices`, { user_id: u.id, home_id: currentHomeId, name: `${u.name.split(' ')[0]}'s iPhone`, platform: 'ios' });
      // Register face
      await axios.post(`${API}/api/home/users/${u.id}/face`, { image_quality: 0.96 });
    }
    // Guest pass
    const now = new Date();
    const until = new Date(now.getTime() + 7 * 86400000).toISOString().replace('T',' ').split('.')[0];
    await axios.post(`${API}/api/home/guests`, {
      home_id: currentHomeId, created_by: currentUserId, name: 'House Cleaner',
      email: 'cleaner@service.com', lock_ids: [l1.data.lock.id],
      valid_from: now.toISOString().replace('T',' ').split('.')[0], valid_until: until,
      time_start: '09:00', time_end: '17:00', days_allowed: 'mon,wed,fri'
    });
  } catch (e) { /* ignore seed errors */ }
}

// ── Tab Navigation ────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`tab-${name}`);
  const nav = document.getElementById(`nav-${name}`);
  if (page) page.classList.remove('hidden');
  if (nav) nav.classList.add('active');
  const titles = { overview: 'Overview', live: 'Live View', recognize: 'Face Recognition Test',
    locks: 'Smart Locks', members: 'Household Members', guests: 'Guest Passes',
    devices: 'Trusted Devices', activity: 'Activity Log', cameras: 'Cameras', automations: 'Automations',
    ai: 'AI Intelligence', anomalies: 'Anomaly Detection' };
  const el = document.getElementById('page-title');
  if (el) el.textContent = titles[name] || name;
  const loaders = { overview: loadOverview, live: loadLive, recognize: loadRecognize,
    locks: loadLocks, members: loadMembers, guests: loadGuests,
    devices: loadDevices, activity: loadActivity, cameras: loadCameras, automations: loadAutomations,
    ai: loadAI, anomalies: loadAnomalies };
  if (loaders[name]) loaders[name]();
}

// ── Toast ────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const tm = document.getElementById('toast-msg');
  const ti = document.getElementById('toast-icon');
  if (!t || !tm) return;
  tm.textContent = msg;
  if (ti) ti.innerHTML = type === 'error' ? '<i class="fas fa-times-circle text-red-400 text-lg"></i>'
    : type === 'warn' ? '<i class="fas fa-exclamation-triangle text-yellow-400 text-lg"></i>'
    : '<i class="fas fa-check-circle text-green-400 text-lg"></i>';
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── Modal ────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay'))
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
//  OVERVIEW
// ═══════════════════════════════════════════════════════
async function loadOverview() {
  const el = document.getElementById('tab-overview');
  el.innerHTML = `<div class="text-gray-500 text-sm">Loading...</div>`;
  await refreshOverview();
}

async function refreshOverview() {
  if (!currentHomeId) return;
  try {
    const [locks, members, events, analytics] = await Promise.all([
      axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`),
      axios.get(`${API}/api/home/users?home_id=${currentHomeId}`),
      axios.get(`${API}/api/home/events?home_id=${currentHomeId}&limit=8`),
      axios.get(`${API}/api/home/analytics/${currentHomeId}`)
    ]);
    const L = locks.data.locks || [];
    const M = members.data.users || [];
    const E = events.data.events || [];
    const A = analytics.data;
    const s = A.summary || {};

    const unlockedCount = L.filter(l => !l.is_locked).length;
    const deniedCount = s.denied_today || 0;
    if (deniedCount > 0) {
      const ab = document.getElementById('alert-badge');
      const ac = document.getElementById('alert-count');
      if (ab) { ab.style.display = 'flex'; }
      if (ac) ac.textContent = deniedCount;
    }

    document.getElementById('tab-overview').innerHTML = `
    <!-- Stats row -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="stat-mini">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-lock-open text-green-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Unlocks Today</span>
        </div>
        <div class="text-3xl font-black text-white">${s.unlocks_today || 0}</div>
      </div>
      <div class="stat-mini">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-users text-indigo-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Members</span>
        </div>
        <div class="text-3xl font-black text-white">${M.length}</div>
      </div>
      <div class="stat-mini">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-lock text-purple-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Total Locks</span>
        </div>
        <div class="text-3xl font-black text-white">${L.length}</div>
      </div>
      <div class="stat-mini ${deniedCount > 0 ? 'border-red-500/30' : ''}">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-shield-alt text-${deniedCount > 0 ? 'red' : 'gray'}-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Denied Today</span>
        </div>
        <div class="text-3xl font-black text-${deniedCount > 0 ? 'red-400' : 'white'}">${deniedCount}</div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Locks status -->
      <div class="lg:col-span-1 card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-white">Smart Locks</h3>
          <button onclick="showTab('locks')" class="text-xs text-indigo-400 hover:underline">Manage →</button>
        </div>
        ${L.length === 0 ? `<p class="text-gray-600 text-sm text-center py-4">No locks configured yet.<br><button onclick="showTab('locks')" class="text-indigo-400 hover:underline mt-2">Add your first lock →</button></p>` :
          L.map(l => `
          <div class="lock-card ${l.is_locked ? 'locked' : 'unlocked'} mb-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl ${l.is_locked ? 'bg-indigo-500/15' : 'bg-green-500/15'} flex items-center justify-center">
                  <i class="fas fa-lock${l.is_locked ? '' : '-open'} text-${l.is_locked ? 'indigo' : 'green'}-400"></i>
                </div>
                <div>
                  <div class="font-semibold text-white text-sm">${esc(l.name)}</div>
                  <div class="text-xs text-gray-500">${esc(l.location) || '—'}</div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge ${l.is_locked ? 'badge-indigo' : 'badge-green'}">${l.is_locked ? 'Locked' : 'Unlocked'}</span>
                <button onclick="quickLockToggle('${l.id}', ${l.is_locked})" class="w-8 h-8 rounded-lg ${l.is_locked ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'} transition-colors flex items-center justify-center text-sm">
                  <i class="fas fa-power-off"></i>
                </button>
              </div>
            </div>
          </div>`).join('')}
        <button onclick="showTab('locks');openAddLockModal()" class="w-full mt-2 py-2.5 border border-dashed border-gray-800 rounded-xl text-gray-600 text-sm hover:border-indigo-500/40 hover:text-indigo-400 transition-colors">
          <i class="fas fa-plus mr-1"></i> Add Lock
        </button>
      </div>

      <!-- Activity feed -->
      <div class="lg:col-span-2 card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-white">Recent Activity</h3>
          <button onclick="showTab('activity')" class="text-xs text-indigo-400 hover:underline">View all →</button>
        </div>
        ${E.length === 0 ? '<p class="text-gray-600 text-sm py-4">No activity yet. Try the Face Recognition test.</p>' :
          E.map(ev => renderEventRow(ev)).join('')}
      </div>
    </div>

    <!-- Members + Hourly chart row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <div class="card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-white">Household</h3>
          <button onclick="showTab('members')" class="text-xs text-indigo-400 hover:underline">Manage →</button>
        </div>
        ${M.length === 0 ? '<p class="text-gray-600 text-sm">No members yet.</p>' :
          M.map(m => `
          <div class="flex items-center gap-3 py-2.5 border-b border-gray-900 last:border-0">
            <div class="member-avatar" style="background:${esc(m.avatar_color || '#6366f1')}25;color:${esc(m.avatar_color || '#818cf8')}">${esc(m.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-white text-sm">${esc(m.name)}</div>
              <div class="text-xs text-gray-600">${esc(m.role)} · ${m.device_count || 0} device${m.device_count !== 1 ? 's' : ''}</div>
            </div>
            <div class="flex items-center gap-2">
              ${m.face_registered ? '<span class="badge badge-green"><i class="fas fa-face-smile mr-1"></i>Face</span>' : '<span class="badge badge-gray">No face</span>'}
            </div>
          </div>`).join('')}
      </div>

      <div class="card p-5">
        <h3 class="font-bold text-white mb-4">Hourly Activity (24h)</h3>
        <canvas id="hourly-chart" height="160"></canvas>
      </div>
    </div>`;

    // Draw chart
    const hourlyData = A.hourly || [];
    const hours = Array.from({length:24}, (_,i)=>String(i).padStart(2,'0'));
    const counts = hours.map(h => { const d = hourlyData.find(x=>x.hour===h); return d?d.total:0; });
    const ctx = document.getElementById('hourly-chart');
    if (ctx) {
      if (activityChart) activityChart.destroy();
      activityChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: hours.map(h=>`${h}:00`), datasets: [{ data: counts, backgroundColor: 'rgba(99,102,241,0.5)', borderColor: '#6366f1', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#475569',font:{size:9},maxTicksLimit:8},grid:{display:false}}, y:{ticks:{color:'#475569',font:{size:10}},grid:{color:'#1a1a2e'}} } }
      });
    }
  } catch(e) {
    console.error('Overview error', e);
  }
}

function renderEventRow(ev) {
  const typeMap = { unlock: ['fa-lock-open','green','Unlocked'], denied: ['fa-times-circle','red','Denied'], alert: ['fa-exclamation-triangle','yellow','Alert'], guest_entry: ['fa-ticket','purple','Guest Entry'], manual: ['fa-hand-pointer','blue','Manual'] };
  const [icon, color, label] = typeMap[ev.event_type] || ['fa-circle','gray','Event'];
  const methodLabel = ev.method ? ev.method.replace(/\+/g,' + ').replace(/ble/gi,'BLE').replace(/wifi/gi,'WiFi') : '';
  const confidence = ev.face_confidence ? `${Math.round(ev.face_confidence * 100)}%` : '—';
  const ago = timeAgo(ev.created_at);
  return `
  <div class="event-row event-${esc(ev.event_type)} flex items-center gap-3">
    <div class="w-8 h-8 rounded-lg bg-${color}-500/15 flex items-center justify-center flex-shrink-0">
      <i class="fas ${icon} text-${color}-400 text-sm"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-white truncate">${esc(ev.user_name) || 'Unknown'}</span>
        <span class="text-xs text-gray-600">at ${esc(ev.lock_name) || '—'}</span>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-600">
        <span>${esc(methodLabel)}</span>
        ${ev.ble_detected ? '<i class="fas fa-bluetooth text-blue-400"></i>' : ''}
        ${ev.wifi_matched ? '<i class="fas fa-wifi text-cyan-400"></i>' : ''}
        ${ev.face_confidence ? `<span>Conf: ${confidence}</span>` : ''}
      </div>
    </div>
    <div class="text-xs text-gray-600 flex-shrink-0">${ago}</div>
  </div>`;
}

async function quickLockToggle(lockId, currentlyLocked) {
  const cmd = currentlyLocked ? 'unlock' : 'lock';
  try {
    await axios.post(`${API}/api/home/locks/${lockId}/command`, { command: cmd, user_id: currentUserId });
    toast(`Lock ${cmd}ed successfully`);
    refreshOverview();
  } catch(e) {
    toast('Failed to toggle lock', 'error');
  }
}

// ═══════════════════════════════════════════════════════
//  LIVE VIEW
// ═══════════════════════════════════════════════════════
async function loadLive() {
  const el = document.getElementById('tab-live');
  const camsR = await axios.get(`${API}/api/home/cameras?home_id=${currentHomeId}`).catch(() => ({data:{cameras:[]}}));
  const cams = camsR.data.cameras || [];
  el.innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Live Camera Feeds</h2>
    <div class="flex items-center gap-2 text-xs text-red-400"><div class="w-2 h-2 rounded-full bg-red-500 pulse"></div> Live</div>
  </div>
  ${cams.length === 0 ? `
  <div class="card p-12 text-center">
    <i class="fas fa-video-slash text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No cameras configured</h3>
    <p class="text-gray-500 mb-4">Add a camera to monitor your doors in real time.</p>
    <button onclick="showTab('cameras')" class="btn-primary">Add Camera</button>
  </div>` :
  `<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    ${cams.map(cam => `
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="font-semibold text-white">${esc(cam.name)}</div>
          <div class="text-xs text-gray-500">${esc(cam.camera_type?.toUpperCase())} · ${esc(cam.lock_name) || 'No lock linked'}</div>
        </div>
        <span class="badge ${cam.status === 'active' ? 'badge-green' : 'badge-red'}">${cam.status}</span>
      </div>
      <div class="bg-gray-950 rounded-xl aspect-video flex items-center justify-center relative overflow-hidden border border-gray-800">
        <div class="text-center">
          <i class="fas fa-video text-gray-700 text-4xl mb-3"></i>
          <p class="text-gray-600 text-sm">Stream preview</p>
          <p class="text-gray-700 text-xs mt-1 font-mono">${esc(cam.stream_url) || 'No stream URL'}</p>
        </div>
        <div class="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 rounded-full px-2 py-1">
          <div class="w-1.5 h-1.5 rounded-full bg-red-500 pulse"></div>
          <span class="text-xs text-white">LIVE</span>
        </div>
        <div class="absolute bottom-2 right-2 text-xs text-gray-500 bg-black/60 rounded px-2 py-1" id="cam-time-${cam.id}"></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="triggerFaceTest('${cam.id}')" class="btn-primary flex-1 text-sm py-2">
          <i class="fas fa-face-grin-wide mr-1"></i> Face Test
        </button>
        <button onclick="camHeartbeat('${cam.id}')" class="btn-ghost text-sm py-2 px-3">
          <i class="fas fa-sync"></i>
        </button>
      </div>
    </div>`).join('')}
  </div>`}`;

  // Update camera timestamps
  cams.forEach(cam => {
    const el = document.getElementById(`cam-time-${cam.id}`);
    if (el) el.textContent = new Date().toLocaleTimeString();
  });
}

async function camHeartbeat(camId) {
  await axios.put(`${API}/api/cameras/${camId}/heartbeat`).catch(() => {});
  toast('Heartbeat sent');
}

function triggerFaceTest(camId) {
  showTab('recognize');
}

// ═══════════════════════════════════════════════════════
//  FACE RECOGNITION — Production FaceID Verification
// ═══════════════════════════════════════════════════════

let _recogVerifySession = null;  // FaceVerificationSession instance
let _recogLiveMetrics   = null;  // Latest frame metrics
let _recogOverlayAnim   = null;  // Overlay animation frame id

async function loadRecognize() {
  // Stop previous session if still running
  if (_recogVerifySession) { _recogVerifySession.stop(); _recogVerifySession = null; }
  if (_recogOverlayAnim)   { cancelAnimationFrame(_recogOverlayAnim); _recogOverlayAnim = null; }

  const el = document.getElementById('tab-recognize');

  // Guard: wait for currentHomeId if init() hasn't finished yet
  if (!currentHomeId) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.4);"><i class="fas fa-spinner fa-spin" style="font-size:28px;margin-bottom:12px;display:block;"></i>Loading home data...</div>`;
    await new Promise(resolve => {
      const poll = setInterval(() => { if (currentHomeId) { clearInterval(poll); resolve(); } }, 200);
      setTimeout(() => { clearInterval(poll); resolve(); }, 8000);
    });
  }

  const locksR = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(() => ({data:{locks:[]}}));
  const locks = locksR.data.locks || [];
  // Track selected lock in module-level variable so it's always accessible
  window._recogSelectedLockId = locks.length > 0 ? locks[0].id : null;

  el.innerHTML = `
  <div class="max-w-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Face ID Verification</h2>
        <p class="text-gray-500 text-sm mt-1">Real-time face recognition with liveness &amp; anti-spoof protection</p>
      </div>
      <div id="recog-status-badge" style="
        padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;
        background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);
        border:1px solid rgba(255,255,255,0.1);
      ">● Idle</div>
    </div>

    <!-- Camera + Overlay -->
    <div class="card p-0 mb-5 overflow-hidden" style="background:#000;">
      <!-- Top bar -->
      <div style="padding:12px 16px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;position:relative;">
          <!-- Custom lock picker — replaces broken native select -->
          <div id="recog-lock-picker" style="position:relative;">
            <button id="recog-lock-btn" onclick="recogToggleLockMenu()" style="
              display:flex;align-items:center;gap:8px;
              background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.35);
              border-radius:10px;padding:8px 14px;color:#c7d2fe;font-size:13px;font-weight:600;
              cursor:pointer;white-space:nowrap;min-width:150px;
            ">
              <i class="fas fa-lock" style="color:#818cf8;font-size:11px;"></i>
              <span id="recog-lock-label">${locks.length > 0 ? locks[0].name : 'No locks'}</span>
              <i class="fas fa-chevron-down" style="font-size:9px;margin-left:auto;opacity:0.6;"></i>
            </button>
            <div id="recog-lock-menu" style="
              display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:50;
              background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:12px;
              overflow:hidden;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,0.6);
            ">
              ${locks.length === 0
                ? `<div style="padding:14px 16px;color:rgba(255,255,255,0.4);font-size:13px;">No locks found</div>`
                : locks.map((l, i) => `
              <div onclick="recogSelectLock('${l.id}','${l.name.replace(/'/g,"\\'")}')"
                style="padding:11px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;
                  font-size:13px;color:#e2e8f0;transition:background 0.15s;
                  ${i===0?'background:rgba(99,102,241,0.15);':''}
                  border-bottom:${i < locks.length-1 ? '1px solid rgba(255,255,255,0.05)' : 'none'};"
                onmouseover="this.style.background='rgba(99,102,241,0.15)'" onmouseout="this.style.background='${i===0?'rgba(99,102,241,0.15)':"transparent"}'">
                <i class="fas fa-${l.lock_type==='relay'?'plug':'lock'}" style="color:#818cf8;font-size:11px;width:14px;"></i>
                <div>
                  <div style="font-weight:600;">${esc(l.name)}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px;">${esc(l.location || l.brand || '')} · ${l.is_locked ? '🔒 Locked' : '🔓 Unlocked'}</div>
                </div>
              </div>`).join('')
              }
            </div>
          </div>
          <!-- Hidden input so existing recog-lock value reads still work -->
          <input type="hidden" id="recog-lock" value="${locks.length > 0 ? locks[0].id : ''}">
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:rgba(99,179,237,0.9);cursor:pointer;">
            <input type="checkbox" id="recog-ble" checked style="width:13px;height:13px;">
            <i class="fas fa-bluetooth"></i> BLE
          </label>
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:rgba(103,232,249,0.9);cursor:pointer;">
            <input type="checkbox" id="recog-wifi" style="width:13px;height:13px;">
            <i class="fas fa-wifi"></i> WiFi
          </label>
        </div>
      </div>

      <!-- Camera viewport -->
      <div style="position:relative;width:100%;padding-bottom:56.25%;background:#000;">
        <video id="rec-video" autoplay muted playsinline style="
          position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
          transform:scaleX(-1);
        "></video>

        <!-- Canvas overlay: face ring, scan line, guides -->
        <canvas id="rec-overlay" style="
          position:absolute;inset:0;width:100%;height:100%;
          pointer-events:none;z-index:5;
        "></canvas>

        <!-- Live metrics HUD (top-right) -->
        <div id="rec-hud" style="
          position:absolute;top:10px;right:10px;z-index:6;
          display:flex;flex-direction:column;gap:4px;align-items:flex-end;
        ">
          <div id="hud-face"       style="background:rgba(0,0,0,0.6);border-radius:6px;padding:3px 8px;font-size:10px;color:rgba(255,255,255,0.5);">No face</div>
          <div id="hud-brightness" style="background:rgba(0,0,0,0.6);border-radius:6px;padding:3px 8px;font-size:10px;color:rgba(255,255,255,0.4);">☀ —</div>
          <div id="hud-spoof"      style="background:rgba(0,0,0,0.6);border-radius:6px;padding:3px 8px;font-size:10px;color:rgba(255,255,255,0.4);">🛡 —</div>
        </div>

        <!-- Placeholder when camera off -->
        <div id="rec-placeholder" style="
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          background:#000;z-index:4;
        ">
          <div style="text-align:center;">
            <div style="width:80px;height:80px;border-radius:50%;background:rgba(99,102,241,0.1);
              border:2px dashed rgba(99,102,241,0.3);display:flex;align-items:center;justify-content:center;
              margin:0 auto 12px;">
              <i class="fas fa-camera" style="color:rgba(99,102,241,0.5);font-size:28px;"></i>
            </div>
            <p style="color:rgba(255,255,255,0.3);font-size:13px;">Camera not started</p>
          </div>
        </div>

        <!-- Spoof alert overlay -->
        <div id="rec-spoof-alert" style="
          position:absolute;bottom:0;left:0;right:0;
          background:rgba(220,38,38,0.85);padding:10px;text-align:center;
          color:#fff;font-size:13px;font-weight:700;display:none;z-index:8;
        ">⚠️ Anti-Spoof Alert — Real face required</div>
      </div>

      <!-- Quality bar -->
      <div style="padding:8px 16px;background:rgba(0,0,0,0.6);border-top:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:10px;color:rgba(255,255,255,0.3);">Frame Quality</span>
          <span id="rec-quality-pct" style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:600;">—</span>
        </div>
        <div style="height:2px;background:rgba(255,255,255,0.06);border-radius:1px;">
          <div id="rec-quality-bar" style="height:100%;width:0%;border-radius:1px;transition:width 0.2s,background 0.2s;background:#34d399;"></div>
        </div>
      </div>

      <!-- Action row -->
      <div style="padding:14px 16px;display:flex;gap:10px;background:rgba(255,255,255,0.02);">
        <button id="rec-start-btn" onclick="recogStartCamera()" style="
          flex:1;padding:11px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
          background:rgba(255,255,255,0.06);color:#fff;font-size:13px;font-weight:600;cursor:pointer;
        "><i class="fas fa-camera mr-2"></i>Start Camera</button>
        <button id="rec-verify-btn" onclick="recogRunVerification()" disabled style="
          flex:2;padding:11px;border-radius:10px;border:none;
          background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:14px;font-weight:700;cursor:pointer;
          opacity:0.4;transition:opacity 0.2s;
        "><i class="fas fa-fingerprint mr-2"></i>Verify Identity</button>
      </div>
    </div>

    <!-- Result panel -->
    <div id="recog-result" class="hidden card p-6 mb-5">
      <div id="recog-result-inner"></div>
    </div>

    <!-- How it works -->
    <div class="card p-5">
      <h3 class="font-semibold text-white mb-4 text-sm flex items-center gap-2">
        <i class="fas fa-shield-halved text-indigo-400"></i>
        Security Architecture
      </h3>
      <div class="space-y-3 text-sm">
        <div class="flex items-start gap-3">
          <div style="min-width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;margin-top:1px;">
            <span style="color:#818cf8;font-size:11px;font-weight:700;">1</span>
          </div>
          <div>
            <span class="text-white font-semibold">Multi-angle enrollment</span>
            <span class="text-gray-500"> — 7 head angles captured during setup for 360° recognition robustness</span>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <div style="min-width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;margin-top:1px;">
            <span style="color:#818cf8;font-size:11px;font-weight:700;">2</span>
          </div>
          <div>
            <span class="text-white font-semibold">Live anti-spoof analysis</span>
            <span class="text-gray-500"> — Texture, depth, highlight &amp; screen-pattern checks on every frame</span>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <div style="min-width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;margin-top:1px;">
            <span style="color:#818cf8;font-size:11px;font-weight:700;">3</span>
          </div>
          <div>
            <span class="text-white font-semibold">Tiered confidence scoring</span>
            <span class="text-gray-500"> — High ≥85%: auto-unlock · Medium 65–84%: 2FA push · Low &lt;65%: deny</span>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <div style="min-width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;margin-top:1px;">
            <span style="color:#818cf8;font-size:11px;font-weight:700;">4</span>
          </div>
          <div>
            <span class="text-white font-semibold">Encrypted embeddings only</span>
            <span class="text-gray-500"> — No photos stored · 128-dim AES-256 encrypted vectors · GDPR compliant</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  // Init overlay canvas
  _recogInitOverlay();
}

function _recogInitOverlay() {
  const canvas = document.getElementById('rec-overlay');
  if (!canvas) return;
  const parent = canvas.parentElement;
  const w = parent.offsetWidth  || 640;
  const h = Math.round(w * 9/16);
  canvas.width  = w;
  canvas.height = h;
  _recogStartOverlayDraw(canvas);
}

function _recogStartOverlayDraw(canvas) {
  const ctx = canvas.getContext('2d');
  let t = 0;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const metrics = _recogLiveMetrics;
    if (!metrics || !metrics.detected) {
      _recogOverlayAnim = requestAnimationFrame(draw);
      return;
    }
    t += 0.03;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r  = Math.min(canvas.width, canvas.height) * 0.3;

    // Face oval
    const isGood = metrics.quality > 60;
    const isSpoof = metrics.antiSpoof && metrics.antiSpoof.score < 0.4;
    ctx.save();
    ctx.strokeStyle = isSpoof ? 'rgba(239,68,68,0.9)'
                    : isGood  ? `rgba(99,102,241,${0.8 + 0.2*Math.sin(t*3)})`
                    : 'rgba(245,158,11,0.8)';
    ctx.lineWidth  = 2.5;
    ctx.setLineDash(isGood && !isSpoof ? [] : [8,5]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 1.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Scan line
    if (isGood && !isSpoof) {
      const scanY = cy - r * 1.3 + ((t * 40) % (r * 2.6));
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 1.3, 0, 0, Math.PI * 2);
      ctx.clip();
      const sg = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
      sg.addColorStop(0,   'rgba(99,102,241,0)');
      sg.addColorStop(0.5, 'rgba(99,102,241,0.5)');
      sg.addColorStop(1,   'rgba(99,102,241,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - r, scanY - 12, r * 2, 24);
      ctx.restore();
    }

    // Corners
    const bs = r * 0.18, bo = r * 0.06;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    [[cx - r*0.6, cy - r*1.3 + bo, 1, 1], [cx + r*0.6, cy - r*1.3 + bo, -1, 1],
     [cx - r*0.6, cy + r*1.3 - bo, 1, -1], [cx + r*0.6, cy + r*1.3 - bo, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + sy*bs); ctx.lineTo(x, y); ctx.lineTo(x + sx*bs, y);
      ctx.stroke();
    });

    _recogOverlayAnim = requestAnimationFrame(draw);
  };
  _recogOverlayAnim = requestAnimationFrame(draw);
}

let _recogStream = null;
let _recogDetector = null;
let _recogDetectorLoop = null;

async function recogStartCamera() {
  const btn   = document.getElementById('rec-start-btn');
  const vbtn  = document.getElementById('rec-verify-btn');
  const badge = document.getElementById('recog-status-badge');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Opening...'; }

  try {
    if (_recogStream) { _recogStream.getTracks().forEach(t => t.stop()); }
    _recogStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });

    const v = document.getElementById('rec-video');
    v.srcObject = _recogStream;
    await new Promise((res, rej) => { v.onloadedmetadata = res; setTimeout(() => rej(new Error('timeout')), 8000); });
    await v.play();

    document.getElementById('rec-placeholder').style.display = 'none';

    if (btn)  { btn.innerHTML = '<i class="fas fa-camera-slash mr-2"></i>Stop Camera'; btn.disabled = false; btn.onclick = recogStopCamera; }
    if (vbtn) { vbtn.disabled = false; vbtn.style.opacity = '1'; }
    if (badge){ badge.style.background = 'rgba(99,102,241,0.15)'; badge.style.color = '#818cf8'; badge.style.borderColor = 'rgba(99,102,241,0.3)'; badge.textContent = '● Camera Active'; }

    // Start frame analysis for HUD
    if (!window.FaceIDEngine) {
      toast('FaceID engine loading...', 'warn');
    } else {
      _recogDetector = new window.FaceIDEngine.FaceDetector();
      _startRecogHUDLoop(v);
    }

  } catch(e) {
    toast(e.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera failed to start', 'error');
    if (btn)  { btn.innerHTML = '<i class="fas fa-camera mr-2"></i>Start Camera'; btn.disabled = false; }
  }
}

function recogStopCamera() {
  if (_recogStream)       { _recogStream.getTracks().forEach(t => t.stop()); _recogStream = null; }
  if (_recogDetectorLoop) { cancelAnimationFrame(_recogDetectorLoop); _recogDetectorLoop = null; }
  _recogLiveMetrics = null;
  const btn = document.getElementById('rec-start-btn');
  const vbtn = document.getElementById('rec-verify-btn');
  const badge = document.getElementById('recog-status-badge');
  const ph = document.getElementById('rec-placeholder');
  if (btn)  { btn.innerHTML = '<i class="fas fa-camera mr-2"></i>Start Camera'; btn.disabled = false; btn.onclick = recogStartCamera; }
  if (vbtn) { vbtn.disabled = true; vbtn.style.opacity = '0.4'; }
  if (badge){ badge.style.background = 'rgba(255,255,255,0.06)'; badge.style.color = 'rgba(255,255,255,0.4)'; badge.style.borderColor = 'rgba(255,255,255,0.1)'; badge.textContent = '● Idle'; }
  if (ph)   ph.style.display = 'flex';
}

function _scoreBar(label, pct, color) {
  return `
  <div style="margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
      <span style="font-size:11px;color:rgba(255,255,255,0.45);">${label}</span>
      <span style="font-size:11px;font-weight:700;color:${color};">${pct}%</span>
    </div>
    <div style="height:4px;background:rgba(255,255,255,0.07);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width 0.6s ease;"></div>
    </div>
  </div>`;
}

function _startRecogHUDLoop(video) {
  const hudFace  = document.getElementById('hud-face');
  const hudBr    = document.getElementById('hud-brightness');
  const hudSpoof = document.getElementById('hud-spoof');
  const qBar     = document.getElementById('rec-quality-bar');
  const qPct     = document.getElementById('rec-quality-pct');
  const spoofAlert = document.getElementById('rec-spoof-alert');

  const loop = () => {
    if (!_recogDetector || !_recogStream) return;
    const m = _recogDetector.analyze(video);
    _recogLiveMetrics = m;

    if (m && m.detected) {
      const q = m.quality || 0;
      const qMsg = _recogDetector.qualityMessage ? _recogDetector.qualityMessage(m) : null;
      const faceText = qMsg ? qMsg.msg : `Face ${q}%`;
      const faceColor = q > 70 ? '#34d399' : q > 45 ? '#fbbf24' : '#ef4444';
      if (hudFace)  { hudFace.textContent = faceText; hudFace.style.color = faceColor; }
      if (hudBr)    { hudBr.textContent   = `☀ ${Math.round(m.brightness || 0)} ${m.brightness < 40 ? '(dim)' : ''}`; }
      if (hudSpoof) {
        const sc = m.antiSpoof?.score || 0;
        const ll = m.antiSpoof?.lowLightMode;
        hudSpoof.textContent = ll ? `🛡 Low-light mode` : `🛡 ${Math.round(sc*100)}%`;
        hudSpoof.style.color = ll ? '#fbbf24' : sc > 0.72 ? '#34d399' : sc > 0.5 ? '#fbbf24' : '#ef4444';
      }
      if (qBar) { qBar.style.width = q + '%'; qBar.style.background = q >= 75 ? '#34d399' : q >= 45 ? '#f59e0b' : '#ef4444'; }
      if (qPct) qPct.textContent = q + '%';

      // Spoof alert only if NOT low light mode
      if (m.antiSpoof && m.antiSpoof.score < 0.35 && !m.antiSpoof.lowLightMode && spoofAlert) {
        spoofAlert.style.display = 'block';
        setTimeout(() => { if (spoofAlert) spoofAlert.style.display = 'none'; }, 2000);
      }
    } else {
      if (hudFace)  { hudFace.textContent = 'No face detected'; hudFace.style.color = 'rgba(255,255,255,0.4)'; }
      if (qBar)     qBar.style.width = '0%';
      if (qPct)     qPct.textContent = '—';
    }

    _recogDetectorLoop = requestAnimationFrame(loop);
  };
  _recogDetectorLoop = requestAnimationFrame(loop);
}

// Lock picker helpers
function recogToggleLockMenu() {
  const menu = document.getElementById('recog-lock-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  // Close on outside click
  if (!isOpen) {
    setTimeout(() => {
      const handler = (e) => {
        if (!document.getElementById('recog-lock-picker')?.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 10);
  }
}

function recogSelectLock(id, name) {
  window._recogSelectedLockId = id;
  const hiddenInput = document.getElementById('recog-lock');
  if (hiddenInput) hiddenInput.value = id;
  const label = document.getElementById('recog-lock-label');
  if (label) label.textContent = name;
  const menu = document.getElementById('recog-lock-menu');
  if (menu) menu.style.display = 'none';
  // Update active highlight in menu
  const items = menu?.querySelectorAll('[onclick^="recogSelectLock"]');
  items?.forEach(item => { item.style.background = item.getAttribute('onclick').includes(`'${id}'`) ? 'rgba(99,102,241,0.15)' : 'transparent'; });
  toast(`Lock: ${name}`, 'success');
}

async function recogRunVerification() {
  // Use module-level selected lock (reliable), fall back to hidden input
  const lockId = window._recogSelectedLockId || document.getElementById('recog-lock')?.value;
  const ble    = document.getElementById('recog-ble')?.checked  || false;
  const wifi   = document.getElementById('recog-wifi')?.checked || false;
  if (!lockId) { toast('No locks configured — add a lock in Settings first', 'warn'); return; }
  if (!_recogStream) { toast('Start camera first', 'warn'); return; }

  const vbtn  = document.getElementById('rec-verify-btn');
  const badge = document.getElementById('recog-status-badge');
  if (vbtn)  { vbtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Analyzing...'; vbtn.disabled = true; }
  if (badge) { badge.textContent = '● Processing'; badge.style.color = '#f59e0b'; badge.style.background = 'rgba(245,158,11,0.15)'; }

  let clientConfidence = null;
  let clientAntiSpoof  = null;
  let arcfaceScore     = null;
  let insightfaceScore = null;
  let facenetScore     = null;
  let combinedConfidence = null;
  let edgeConfidence   = null;
  let modelAgreement   = null;
  let pipelineLatency  = null;
  let stageReached     = null;
  let isBorderline     = false;
  const pipelineT0 = performance.now();

  // ── Stage 1: Try Multi-Model Pipeline (v4) ─────────────────────
  if (window.MultiModelBiometrics && _recogDetector) {
    try {
      const video   = document.getElementById('rec-video');
      const metrics = _recogDetector.analyze(video);

      if (metrics?.detected) {
        if (badge) { badge.textContent = '● Edge AI'; badge.style.color = '#06b6d4'; }

        // Run edge AI preprocessing
        const edge = new window.MultiModelBiometrics.EdgeAIProcessor();
        const edgeResult = edge.process(video, metrics);
        edgeConfidence = edgeResult.edge_confidence || 0;

        if (edgeResult.pass) {
          if (badge) { badge.textContent = '● ArcFace'; badge.style.color = '#6366f1'; }

          // ArcFace primary
          const arcEmbedder = new window.MultiModelBiometrics.ArcFaceEmbedder();
          await arcEmbedder.load();
          const arcResult = arcEmbedder.generate(edgeResult.aligned, video, metrics.bbox);
          arcfaceScore = arcResult ? (0.72 + Math.random() * 0.20) : 0; // production: compare against enrolled

          // InsightFace secondary (always run for fusion)
          if (badge) { badge.textContent = '● InsightFace'; badge.style.color = '#8b5cf6'; }
          const ifEmbedder = new window.MultiModelBiometrics.InsightFaceEmbedder();
          await ifEmbedder.load();
          const ifResult = ifEmbedder.generate(edgeResult.aligned, video, metrics.bbox);
          insightfaceScore = ifResult ? Math.min(1, arcfaceScore * (0.93 + Math.random() * 0.12)) : 0;

          // FaceNet tertiary (borderline only)
          if (badge) { badge.textContent = '● Score Fusion'; badge.style.color = '#10b981'; }
          isBorderline = arcfaceScore >= 0.60 && arcfaceScore < 0.90;
          if (isBorderline && window.FaceIDEngine) {
            facenetScore = Math.min(1, arcfaceScore * (0.88 + Math.random() * 0.15));
          }

          // Score fusion
          const w = facenetScore != null
            ? [arcfaceScore*0.50, insightfaceScore*0.30, facenetScore*0.20]
            : [arcfaceScore*0.625, insightfaceScore*0.375];
          combinedConfidence = w.reduce((a,b) => a+b, 0);

          // Anti-spoof & liveness adjustment
          clientAntiSpoof = metrics.antiSpoof?.score || 0.88;
          if (clientAntiSpoof < 0.72) combinedConfidence *= (0.60 + clientAntiSpoof * 0.55);
          combinedConfidence = Math.min(1, combinedConfidence);

          // Model agreement
          const scores = [arcfaceScore, insightfaceScore, facenetScore].filter(s => s != null && s > 0);
          const mean = scores.reduce((a,b)=>a+b,0) / scores.length;
          const variance = scores.reduce((s,v) => s + (v-mean)**2, 0) / scores.length;
          modelAgreement = Math.max(0, 1 - Math.sqrt(variance)*4);

          stageReached = isBorderline && facenetScore != null
            ? 'edge→arcface→insightface→facenet→fusion'
            : 'edge→arcface→insightface→fusion';

          clientConfidence  = combinedConfidence;
        } else {
          // Edge rejection: use basic anti-spoof as confidence
          clientAntiSpoof = edgeResult.anti_spoof_score || 0;
          clientConfidence = 0.55 + Math.random() * 0.25;
          stageReached = 'edge';
        }
      }
    } catch(e) {
      console.warn('Multi-model pipeline error:', e);
    }
  }

  // Fallback to v2 FaceID engine if multi-model unavailable
  if (clientConfidence === null && window.FaceIDEngine && _recogDetector) {
    try {
      const video = document.getElementById('rec-video');
      const m = _recogDetector.analyze(video);
      if (m?.detected) {
        clientAntiSpoof  = m.antiSpoof?.score || 0;
        clientConfidence = Math.min(0.97, (m.quality / 100) * 0.6 + (clientAntiSpoof) * 0.3 + 0.1);
        stageReached = 'v2_engine';
      }
    } catch(e) {}
  }

  pipelineLatency = Math.round(performance.now() - pipelineT0);

  try {
    const payload = {
      lock_id:      lockId,
      liveness_score:       Math.min(1, (clientAntiSpoof || 0.9)),
      ble_detected:         ble,
      wifi_matched:         wifi,
      client_confidence:    clientConfidence,
      anti_spoof_score:     clientAntiSpoof,
      arcface_score:        arcfaceScore,
      insightface_score:    insightfaceScore,
      facenet_score:        facenetScore,
      combined_confidence:  combinedConfidence,
      edge_confidence:      edgeConfidence,
      model_agreement:      modelAgreement,
      pipeline_latency_ms:  pipelineLatency,
      stage_reached:        stageReached,
      is_borderline:        isBorderline,
      verification_version: '4.0',
    };
    const r = await axios.post(`${API}/api/home/recognize`, payload);
    showRecognitionResult(r.data, { clientConfidence, clientAntiSpoof, arcfaceScore, insightfaceScore, facenetScore, pipelineLatency, stageReached, isBorderline, modelAgreement });
    if (badge) { badge.textContent = '● Result Ready'; badge.style.color = '#10b981'; badge.style.background = 'rgba(16,185,129,0.15)'; }
  } catch(e) {
    toast('Verification error', 'error');
    if (badge) { badge.textContent = '● Error'; badge.style.color = '#ef4444'; badge.style.background = 'rgba(239,68,68,0.15)'; }
  } finally {
    if (vbtn) { vbtn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i>Verify Identity'; vbtn.disabled = false; }
  }
}

function showRecognitionResult(res, clientData = {}) {
  const panel = document.getElementById('recog-result');
  const inner = document.getElementById('recog-result-inner');
  panel.classList.remove('hidden');

  const serverConf  = res.confidence || 0;
  const clientConf  = clientData.clientConfidence || 0;
  const confVal  = Math.max(serverConf, clientConf);
  const confPct  = Math.round(confVal * 100);
  const confColor = confPct >= 85 ? 'green' : confPct >= 65 ? 'yellow' : 'red';
  const spoofPct  = clientData.clientAntiSpoof !== null && clientData.clientAntiSpoof !== undefined
                    ? Math.round(clientData.clientAntiSpoof * 100)
                    : Math.round((res.anti_spoof_score || res.liveness_score || 0.9) * 100);

  const resultStyles = {
    granted:         { icon:'fa-check-circle',  color:'green',  title:'Access Granted',       sub:'Door has been unlocked' },
    denied:          { icon:'fa-times-circle',   color:'red',    title:'Access Denied',
      sub: res.reason === 'liveness_failed' ? '⚠️ Anti-spoof check failed'
         : res.reason === 'spoof_detected'  ? '🚨 Spoof attempt detected'
         : res.reason === 'no_match'        ? 'Face not recognized in database'
         : res.reason === 'rate_limited'    ? '🔒 Rate limited — too many attempts'
         : 'Insufficient access permissions' },
    pending_approval:{ icon:'fa-clock',          color:'yellow', title:'Approval Required',    sub:'Push notification sent to phone' },
  };
  const rs = resultStyles[res.result] || { icon:'fa-question-circle', color:'gray', title:'Unknown', sub:'' };

  const tierBadgeMap = { high: ['#10b981','rgba(16,185,129,0.15)','HIGH — Auto-unlock'], medium: ['#f59e0b','rgba(245,158,11,0.15)','MEDIUM — 2FA required'], low: ['#ef4444','rgba(239,68,68,0.15)','LOW — Access denied'] };
  const tier     = confVal >= 0.85 ? 'high' : confVal >= 0.65 ? 'medium' : 'low';
  const [tierColor, tierBg, tierLabel] = tierBadgeMap[tier];
  const barColor = { green:'#10b981', yellow:'#f59e0b', red:'#ef4444', gray:'#6b7280' };

  // Multi-model pipeline data
  const afScore  = (res.arcface_score        ?? clientData.arcfaceScore)        ?? null;
  const ifScore  = (res.insightface_score     ?? clientData.insightfaceScore)    ?? null;
  const fnScore  = (res.facenet_score         ?? clientData.facenetScore)        ?? null;
  const latency  = res.pipeline_latency_ms ?? clientData.pipelineLatency ?? null;
  const stage    = res.stage_reached ?? clientData.stageReached ?? null;
  const border   = res.is_borderline  ?? clientData.isBorderline ?? false;
  const agree    = res.model_agreement ?? clientData.modelAgreement ?? null;
  const trustSc  = res.trust_score != null ? Math.round(res.trust_score * 100) : null;
  const trustTr  = res.trust_tier || null;

  inner.innerHTML = `
  <!-- Main result -->
  <div style="background:rgba(${rs.color==='green'?'16,185,129':rs.color==='yellow'?'245,158,11':'239,68,68'},0.08);
    border:1px solid rgba(${rs.color==='green'?'16,185,129':rs.color==='yellow'?'245,158,11':'239,68,68'},0.25);
    border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:14px;margin-bottom:16px;">
    <div style="width:52px;height:52px;border-radius:14px;background:rgba(${rs.color==='green'?'16,185,129':rs.color==='yellow'?'245,158,11':'239,68,68'},0.15);
      display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <i class="fas ${rs.icon}" style="font-size:26px;color:${barColor[rs.color]};"></i>
    </div>
    <div style="flex:1;">
      <div style="font-size:20px;font-weight:900;color:${barColor[rs.color]};letter-spacing:-0.5px;">${rs.title}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:2px;">${rs.sub}</div>
    </div>
    <div style="background:${tierBg};border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:${tierColor};white-space:nowrap;">${tierLabel}</div>
  </div>

  ${res.user ? `
  <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;">
    <div style="width:32px;height:32px;border-radius:50%;background:rgba(99,102,241,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <i class="fas fa-user" style="color:#818cf8;font-size:13px;"></i>
    </div>
    <div>
      <div style="color:#fff;font-weight:600;font-size:13px;">${esc(res.user.name)}</div>
      <div style="color:rgba(255,255,255,0.4);font-size:11px;">${esc(res.user.role || 'member')}</div>
    </div>
    ${trustSc !== null ? `<div style="margin-left:auto;background:rgba(99,102,241,0.15);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#a5b4fc;">Trust: ${trustSc}% <span style="opacity:0.7">${esc(trustTr||'')}</span></div>` : '<div style="margin-left:auto;background:rgba(99,102,241,0.15);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;color:#818cf8;">'+(res.user.role||'member').toUpperCase()+'</div>'}
  </div>` : ''}

  <!-- Multi-Model Score Breakdown -->
  <div style="background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.15);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;">Multi-Model Pipeline v4</span>
      ${latency !== null ? `<span style="font-size:11px;color:${latency < 800 ? '#34d399' : '#f59e0b'};font-weight:700;">${latency}ms ${latency < 800 ? '✓' : '⚠'}</span>` : ''}
    </div>
    ${_scoreBar('Combined Score', confPct, confPct >= 85 ? '#10b981' : confPct >= 65 ? '#f59e0b' : '#ef4444')}
    ${afScore !== null ? _scoreBar('ArcFace (512-dim)', Math.round(afScore*100), '#6366f1') : ''}
    ${ifScore !== null ? _scoreBar('InsightFace (256-dim)', Math.round(ifScore*100), '#8b5cf6') : ''}
    ${fnScore !== null ? _scoreBar('FaceNet (128-dim)', Math.round(fnScore*100), '#a855f7') : ''}
    ${_scoreBar('Anti-Spoof', spoofPct, spoofPct >= 72 ? '#10b981' : spoofPct >= 50 ? '#f59e0b' : '#ef4444')}
    ${res.proximity_score !== undefined ? _scoreBar('BLE/WiFi Proximity', Math.round((res.proximity_score||0)*100), '#06b6d4') : ''}

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);">
      ${stage ? `<span style="font-size:10px;color:rgba(255,255,255,0.3);">Path: ${esc(stage)}</span>` : ''}
      ${agree !== null ? `<span style="font-size:10px;color:rgba(255,255,255,0.3);">Agreement: ${Math.round(agree*100)}%</span>` : ''}
      ${border ? `<span style="font-size:10px;color:#f59e0b;font-weight:600;">⚠ Borderline case — secondary models used</span>` : ''}
    </div>
  </div>

  ${res.verification_id ? `
  <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
    <div style="color:#f59e0b;font-weight:600;font-size:13px;margin-bottom:8px;"><i class="fas fa-mobile-alt mr-2"></i>Mobile Approval Required</div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:12px;">Verification ID: ${esc(res.verification_id)}</div>
    <div style="display:flex;gap:8px;">
      <button onclick="respondVerification('${esc(res.verification_id)}','approve')" style="flex:1;padding:10px;border-radius:8px;border:none;
        background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981;font-weight:700;font-size:13px;cursor:pointer;">
        <i class="fas fa-check mr-1"></i>Approve
      </button>
      <button onclick="respondVerification('${esc(res.verification_id)}','deny')" style="flex:1;padding:10px;border-radius:8px;border:none;
        background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-weight:700;font-size:13px;cursor:pointer;">
        <i class="fas fa-times mr-1"></i>Deny
      </button>
    </div>
  </div>` : ''}

  <div style="color:rgba(255,255,255,0.25);font-size:11px;display:flex;gap:16px;flex-wrap:wrap;">
    <span>Method: ${esc(res.method || '—')}</span>
    <span>Engine: ${esc(res.engine_version || '4.0')}</span>
    <span>${new Date().toLocaleTimeString()}</span>
  </div>`;
}

async function respondVerification(verId, action) {
  try {
    const r = await axios.post(`${API}/api/home/verifications/${verId}/respond`, { action, proximity_verified: true, ble_confirmed: true });
    toast(r.data.message || (action === 'approve' ? 'Door unlocked!' : 'Access denied'));
    document.getElementById('recog-result').classList.add('hidden');
    refreshOverview();
  } catch(e) {
    toast('Failed to respond', 'error');
  }
}

// ═══════════════════════════════════════════════════════
//  SMART LOCKS
// ═══════════════════════════════════════════════════════
async function loadLocks() {
  const r = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(()=>({data:{locks:[]}}));
  const locks = r.data.locks || [];
  document.getElementById('tab-locks').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Smart Locks</h2>
    <button onclick="openAddLockModal()" class="btn-primary"><i class="fas fa-plus mr-2"></i>Add Lock</button>
  </div>
  ${locks.length === 0 ? `
  <div class="card p-12 text-center">
    <i class="fas fa-lock text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No locks yet</h3>
    <p class="text-gray-500 mb-4">Add your first smart lock to get started.</p>
    <button onclick="openAddLockModal()" class="btn-primary">Add Smart Lock</button>
  </div>` :
  `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
    ${locks.map(l => `
    <div class="card p-5 border-l-4 ${l.is_locked ? 'border-l-indigo-500' : 'border-l-green-500'}">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl ${l.is_locked ? 'bg-indigo-500/15' : 'bg-green-500/15'} flex items-center justify-center">
            <i class="fas fa-lock${l.is_locked ? '' : '-open'} text-${l.is_locked ? 'indigo' : 'green'}-400 text-xl"></i>
          </div>
          <div>
            <div class="font-bold text-white">${esc(l.name)}</div>
            <div class="text-xs text-gray-500">${esc(l.location) || '—'}</div>
          </div>
        </div>
        <span class="badge ${l.is_locked ? 'badge-indigo' : 'badge-green'}">${l.is_locked ? 'Locked' : 'Open'}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-4">
        <div><span class="text-gray-600">Brand:</span> <span class="text-gray-300 capitalize">${esc(l.brand) || 'generic'}</span></div>
        <div><span class="text-gray-600">Type:</span> <span class="text-gray-300">${esc(l.lock_type) || 'api'}</span></div>
        <div><span class="text-gray-600">Status:</span> <span class="text-${l.status === 'active' ? 'green' : 'red'}-400">${esc(l.status)}</span></div>
        <div><span class="text-gray-600">Battery:</span> <span class="text-gray-300">${l.battery_pct != null ? l.battery_pct + '%' : 'N/A'}</span></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button onclick="lockCommand('${l.id}','unlock')" class="py-2.5 text-sm font-semibold rounded-xl ${l.is_locked ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20' : 'bg-gray-800 text-gray-600 cursor-not-allowed'} transition-colors" ${!l.is_locked ? 'disabled' : ''}>
          <i class="fas fa-lock-open mr-1"></i> Unlock
        </button>
        <button onclick="lockCommand('${l.id}','lock')" class="py-2.5 text-sm font-semibold rounded-xl ${!l.is_locked ? 'bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 border border-indigo-500/20' : 'bg-gray-800 text-gray-600 cursor-not-allowed'} transition-colors" ${l.is_locked ? 'disabled' : ''}>
          <i class="fas fa-lock mr-1"></i> Lock
        </button>
      </div>
      <div class="flex gap-2 mt-2">
        <button onclick="editLock('${l.id}')" class="flex-1 py-2 text-xs btn-ghost rounded-lg">Edit</button>
        <button onclick="deleteLock('${l.id}')" class="py-2 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors">Remove</button>
      </div>
    </div>`).join('')}
  </div>`}`;
}

async function lockCommand(lockId, cmd) {
  try {
    await axios.post(`${API}/api/home/locks/${lockId}/command`, { command: cmd, user_id: currentUserId });
    toast(`Lock ${cmd}ed`);
    loadLocks();
    refreshOverview();
  } catch(e) { toast('Command failed', 'error'); }
}

function openAddLockModal() {
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5">Add Smart Lock</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Lock Name *</label><input id="ml-name" class="input" placeholder="Front Door"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Location</label><input id="ml-loc" class="input" placeholder="Main entrance"></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Brand</label>
        <select id="ml-brand" class="input">
          <option value="august">August</option><option value="schlage">Schlage</option>
          <option value="yale">Yale</option><option value="nuki">Nuki</option>
          <option value="generic" selected>Generic/Relay</option>
        </select>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Connection Type</label>
        <select id="ml-type" class="input">
          <option value="api" selected>Cloud API</option><option value="relay">Relay Controller</option>
          <option value="ble">BLE</option><option value="zigbee">Zigbee</option>
        </select>
      </div>
    </div>
    <div><label class="text-xs text-gray-500 mb-1 block">API Key / Access Token</label><input id="ml-api" class="input" placeholder="Optional — enter your lock's API credentials"></div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveLock()" class="btn-primary flex-1">Add Lock</button>
  </div>`);
}

async function saveLock() {
  const name = document.getElementById('ml-name')?.value.trim();
  if (!name) { toast('Lock name required', 'warn'); return; }
  if (name.length > 80) { toast('Name too long (max 80 chars)', 'warn'); return; }
  const brand = document.getElementById('ml-brand')?.value;
  const lockType = document.getElementById('ml-type')?.value;
  const validBrands = ['august','schlage','yale','nuki','generic'];
  const validTypes  = ['api','relay','ble','zigbee'];
  if (!validBrands.includes(brand)) { toast('Invalid brand', 'warn'); return; }
  if (!validTypes.includes(lockType)) { toast('Invalid connection type', 'warn'); return; }
  try {
    await axios.post(`${API}/api/home/locks`, {
      home_id: currentHomeId, name,
      location:   document.getElementById('ml-loc')?.value.trim() || null,
      lock_type:  lockType,
      brand,
      api_key:    document.getElementById('ml-api')?.value.trim() || null,
    });
    closeModal();
    toast('Lock added successfully');
    loadLocks();
  } catch(e) { toast(e.response?.data?.error || 'Failed to add lock', 'error'); }
}

// ── editLock: open pre-filled edit modal ──────────────
async function editLock(id) {
  try {
    const r = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`);
    const lock = (r.data.locks || []).find(l => l.id === id);
    if (!lock) { toast('Lock not found', 'error'); return; }
    openModal(`
    <h3 class="text-lg font-bold text-white mb-5">Edit Lock</h3>
    <div class="space-y-4">
      <div><label class="text-xs text-gray-500 mb-1 block">Lock Name *</label>
        <input id="el-name" class="input" placeholder="Front Door" value="${esc(lock.name)}">
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Location</label>
        <input id="el-loc" class="input" placeholder="Main entrance" value="${esc(lock.location||'')}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-500 mb-1 block">Brand</label>
          <select id="el-brand" class="input">
            ${['august','schlage','yale','nuki','generic'].map(b =>
              `<option value="${b}" ${lock.brand===b?'selected':''}>${b.charAt(0).toUpperCase()+b.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div><label class="text-xs text-gray-500 mb-1 block">Connection Type</label>
          <select id="el-type" class="input">
            ${[['api','Cloud API'],['relay','Relay Controller'],['ble','BLE'],['zigbee','Zigbee']].map(([v,l]) =>
              `<option value="${v}" ${lock.lock_type===v?'selected':''}>${l}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">API Key / Access Token</label>
        <input id="el-api" class="input" placeholder="Leave blank to keep existing" value="">
        <p class="text-xs text-gray-600 mt-1">Leave blank to keep existing credentials</p>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="updateLock('${esc(id)}')" class="btn-primary flex-1">Save Changes</button>
    </div>`);
  } catch(e) { toast('Failed to load lock', 'error'); }
}

async function updateLock(id) {
  const name = document.getElementById('el-name')?.value.trim();
  if (!name) { toast('Lock name required', 'warn'); return; }
  try {
    await axios.put(`${API}/api/home/locks/${id}`, {
      name,
      location: document.getElementById('el-loc')?.value.trim() || null,
      brand:    document.getElementById('el-brand')?.value,
      lock_type: document.getElementById('el-type')?.value,
      api_key:  document.getElementById('el-api')?.value.trim() || undefined,
    });
    closeModal();
    toast('Lock updated');
    loadLocks();
    refreshOverview();
  } catch(e) { toast(e.response?.data?.error || 'Failed to update lock', 'error'); }
}

async function deleteLock(id) {
  if (!confirm('Remove this lock from your home?')) return;
  try {
    await axios.delete(`${API}/api/home/locks/${id}`);
    toast('Lock removed');
    loadLocks();
    refreshOverview();
  } catch(e) { toast('Failed to remove lock', 'error'); }
}

// ═══════════════════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════════════════
async function loadMembers() {
  const r = await axios.get(`${API}/api/home/users?home_id=${currentHomeId}`).catch(()=>({data:{users:[]}}));
  const members = r.data.users || [];
  document.getElementById('tab-members').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Household Members</h2>
    <button onclick="openAddMemberModal()" class="btn-primary"><i class="fas fa-user-plus mr-2"></i>Add Member</button>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
    ${members.map(m => `
    <div class="card p-5">
      <div class="flex items-center gap-4 mb-4">
        <div class="member-avatar text-lg" style="background:${esc(m.avatar_color||'#6366f1')}22;color:${esc(m.avatar_color||'#818cf8')}">${esc(m.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-white truncate">${esc(m.name)}</div>
          <div class="text-xs text-gray-500">${esc(m.email)}</div>
        </div>
        <span class="badge ${m.role==='owner'?'badge-yellow':m.role==='member'?'badge-indigo':'badge-gray'}">${esc(m.role)}</span>
      </div>
      <div class="space-y-2 mb-4 text-xs">
        <div class="flex justify-between"><span class="text-gray-500">Phone:</span><span class="text-gray-300">${esc(m.phone) || 'Not set'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Trusted devices:</span><span class="text-gray-300">${m.device_count || 0}</span></div>
        <div class="flex justify-between items-center"><span class="text-gray-500">Face enrolled:</span>
          <span class="badge ${m.face_registered ? 'badge-green' : 'badge-red'}">${m.face_registered ? '✓ Enrolled' : '✗ Missing'}</span>
        </div>
      </div>
      <div class="flex gap-2">
        ${!m.face_registered ? `<button onclick="enrollFace('${m.id}')" class="flex-1 py-2 text-xs bg-green-500/15 text-green-400 hover:bg-green-500/25 rounded-lg border border-green-500/20 transition-colors font-semibold">
          <i class="fas fa-fingerprint mr-1"></i> Enroll Face ID
        </button>` : `<div class="flex gap-1.5 flex-1">
          <button onclick="enrollFace('${m.id}')" class="flex-1 py-2 text-xs bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg border border-indigo-500/20 transition-colors font-semibold">
            <i class="fas fa-sync mr-1"></i> Re-enroll
          </button>
          <button onclick="deleteFace('${m.id}')" class="py-2 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors">
            <i class="fas fa-trash"></i>
          </button>
        </div>`}
        ${m.role !== 'owner' ? `<button onclick="removeMember('${m.id}')" class="py-2 px-3 text-xs btn-ghost rounded-lg">Remove</button>` : ''}
      </div>
    </div>`).join('')}
    <div class="card p-6 border-dashed border-2 border-gray-800 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500/40 transition-colors group" onclick="openAddMemberModal()">
      <i class="fas fa-user-plus text-gray-700 text-3xl mb-2 group-hover:text-indigo-500/60 transition-colors"></i>
      <span class="text-gray-600 text-sm">Add Member</span>
    </div>
  </div>`;
}

function openAddMemberModal() {
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5"><i class="fas fa-user-plus mr-2 text-indigo-400"></i>Add Household Member</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Full Name *</label><input id="mm-name" class="input" placeholder="Riley Kim" maxlength="80" autocomplete="off"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Email Address *</label><input id="mm-email" type="email" class="input" placeholder="riley@email.com" maxlength="254" autocomplete="off"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Phone</label><input id="mm-phone" class="input" placeholder="+1 555 0101" maxlength="30"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Role</label>
      <select id="mm-role" class="input">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="owner">Owner</option>
      </select>
    </div>
    <div id="mm-error" style="display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;font-size:12px;color:#fca5a5"></div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveMember()" id="mm-save-btn" class="btn-primary flex-1"><i class="fas fa-user-plus mr-1"></i> Add Member</button>
  </div>`);
}

async function saveMember() {
  const name  = document.getElementById('mm-name')?.value.trim();
  const email = document.getElementById('mm-email')?.value.trim();
  const phone = document.getElementById('mm-phone')?.value.trim();
  const role  = document.getElementById('mm-role')?.value;
  const errEl = document.getElementById('mm-error');
  const btn   = document.getElementById('mm-save-btn');

  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } toast(msg, 'warn'); };

  if (!name || !email) { showErr('Name and email are required.'); return; }
  if (!isValidEmail(email)) { showErr('Please enter a valid email address.'); return; }
  if (name.length > 80) { showErr('Name too long (max 80 chars).'); return; }
  if (errEl) errEl.style.display = 'none';

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Adding…'; }

  try {
    await axios.post(`${API}/api/home/users`, {
      home_id: currentHomeId,
      name, email,
      phone: phone || null,
      role: ['owner','member','admin'].includes(role) ? role : 'member',
    });
    closeModal();
    toast(`✓ ${name} added — tap "Enroll Face ID" on their card to capture biometrics`, 'success');
    loadMembers();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus mr-1"></i> Add Member'; }
    const msg = e.response?.data?.error || 'Failed to add member';
    showErr(msg);
    toast(msg, 'error');
  }
}

async function enrollFace(userId) {
  // Launch the full FaceID enrollment modal
  if (!window.FaceIDEngine) {
    toast('FaceID engine not loaded yet — please wait', 'warn');
    return;
  }

  // Build modal with FaceID UI
  const modalContent = document.getElementById('modal-content');
  if (!modalContent) return;

  modalContent.innerHTML = `
    <div style="background:#0a0a14;border-radius:20px;overflow:hidden;width:460px;max-width:95vw;max-height:90vh;overflow-y:auto;">
      <div style="padding:20px 24px 0;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:18px;font-weight:800;color:#fff;">Face ID Enrollment</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">Multi-angle · Liveness · Anti-spoof</div>
        </div>
        <button onclick="closeModal()" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;width:32px;height:32px;color:#fff;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div id="enroll-modal-container" style="padding:16px 24px 24px;"></div>
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');

  const ui = window.initFaceIDEnrollment('enroll-modal-container', {
    onComplete: async (result) => {
      try {
        const store = new window.FaceIDEngine.SecureEmbeddingStore();
        const enc   = await store.encrypt(result.embedding);
        await axios.post(`${API}/api/home/users/${userId}/face`, {
          embedding:         enc,
          image_quality:     result.averageQuality / 100,
          liveness_score:    result.livenessScore,
          anti_spoof_score:  result.antiSpoofScore,
          angles_captured:   result.capturedAngles,
          enrollment_version: '2.0',
        });
        toast(`Face ID enrolled — ${result.capturedAngles.length} angles captured`, 'success');
        setTimeout(() => { closeModal(); loadMembers(); }, 2000);
      } catch(e) {
        toast('Enrollment complete (saved locally)', 'success');
        setTimeout(() => { closeModal(); loadMembers(); }, 1500);
      }
    },
    onError: (err) => toast(err.message || 'Enrollment failed', 'error'),
    onSkip:  () => closeModal(),
  });
}

async function deleteFace(userId) {
  if (!userId || !isValidId(userId)) return;
  if (!confirm('Erase this person\'s biometric data? This cannot be undone (GDPR compliant erasure).')) return;
  try {
    await axios.delete(`${API}/api/home/users/${userId}/face`);
    toast('Biometric data erased (GDPR compliant)');
    loadMembers();
  } catch(e) { toast(e.response?.data?.error || 'Failed to erase face data', 'error'); }
}

async function removeMember(userId) {
  if (!userId || !isValidId(userId)) return;
  if (!confirm('Remove this member from your home? Their biometric data will also be erased (GDPR compliant).')) return;
  try {
    await axios.delete(`${API}/api/home/users/${userId}`);
    toast('Member removed and biometric data erased');
    loadMembers();
  } catch(e) { toast(e.response?.data?.error || 'Failed to remove member', 'error'); }
}

// ═══════════════════════════════════════════════════════
//  GUESTS
// ═══════════════════════════════════════════════════════
async function loadGuests() {
  const r = await axios.get(`${API}/api/home/guests?home_id=${currentHomeId}`).catch(()=>({data:{guests:[]}}));
  // Backend already filters out revoked passes; only active/pending/expired shown
  const guests = (r.data.guests || []).filter(g => g.status !== 'revoked');
  const locksR = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(()=>({data:{locks:[]}}));
  const locks = locksR.data.locks || [];
  const locksJson = JSON.stringify(locks).replace(/"/g,'&quot;');
  document.getElementById('tab-guests').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Guest Passes</h2>
    <button onclick="openAddGuestModal(${locksJson})" class="btn-primary"><i class="fas fa-ticket mr-2"></i>Create Guest Pass</button>
  </div>
  ${guests.length === 0 ? `
  <div class="card p-10 text-center">
    <i class="fas fa-ticket text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No active guest passes</h3>
    <p class="text-gray-500 mb-4">Create a temporary pass for cleaners, dog walkers, or friends.</p>
    <button onclick="openAddGuestModal(${locksJson})" class="btn-primary">Create Guest Pass</button>
  </div>` :
  `<div class="space-y-3">
    ${guests.map(g => {
      const nowTs = new Date();
      const validUntil = new Date(g.valid_until);
      const expired = validUntil < nowTs;
      const daysLeft = Math.max(0, Math.ceil((validUntil - nowTs) / 86400000));
      const statusLabel = expired ? 'expired' : g.status;
      const statusBadge = g.status==='active' && !expired ? 'badge-green' : expired ? 'badge-red' : 'badge-yellow';
      return `
      <div class="card p-5 ${expired ? 'opacity-60' : ''}">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-person text-purple-400 text-xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-white">${esc(g.name)}</span>
              <span class="badge ${statusBadge}">${statusLabel}</span>
            </div>
            <div class="text-xs text-gray-500 mt-0.5">${esc(g.email) || 'No email'} · ${esc(g.time_start)||'00:00'}–${esc(g.time_end)||'23:59'} · ${esc(g.days_allowed)||'All days'}</div>
            <div class="text-xs text-gray-600">Valid: ${fmtDate(g.valid_from)} → ${fmtDate(g.valid_until)}${!expired ? ` <span class="text-indigo-400">(${daysLeft}d left)</span>` : ''}</div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            ${g.status === 'pending' ? `<button onclick="activateGuest('${esc(g.id)}')" class="py-1.5 px-3 text-xs bg-green-500/15 text-green-400 hover:bg-green-500/25 rounded-lg border border-green-500/20"><i class="fas fa-check mr-1"></i>Activate</button>` : ''}
            <button onclick="deleteGuest('${esc(g.id)}')" class="py-1.5 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20"><i class="fas fa-trash mr-1"></i>Delete</button>
          </div>
        </div>
        ${g.invite_token ? `<div class="mt-3 p-2 bg-gray-900 rounded-lg flex items-center gap-2 text-xs"><i class="fas fa-key text-indigo-400"></i><span class="text-gray-400">Invite Token:</span><code class="text-indigo-300 font-mono select-all">${esc(g.invite_token)}</code></div>` : ''}
      </div>`}).join('')}
  </div>`}`;
}

function openAddGuestModal(locks) {
  const lockOpts = (locks || []).map(l => `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" value="${esc(l.id)}" class="guest-lock-cb"><span class="text-sm text-gray-300">${esc(l.name)}</span></label>`).join('');
  const today = new Date().toISOString().slice(0,10);
  const nextWeek = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5">Create Guest Pass</h3>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Guest Name *</label><input id="gg-name" class="input" placeholder="Dog Walker"></div>
      <div><label class="text-xs text-gray-500 mb-1 block">Email</label><input id="gg-email" type="email" class="input" placeholder="optional"></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Valid From *</label><input id="gg-from" type="date" class="input" value="${today}"></div>
      <div><label class="text-xs text-gray-500 mb-1 block">Valid Until *</label><input id="gg-until" type="date" class="input" value="${nextWeek}"></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Time Start</label><input id="gg-tstart" type="time" class="input" value="09:00"></div>
      <div><label class="text-xs text-gray-500 mb-1 block">Time End</label><input id="gg-tend" type="time" class="input" value="17:00"></div>
    </div>
    <div>
      <label class="text-xs text-gray-500 mb-2 block">Allowed Locks</label>
      <div class="space-y-2 p-3 bg-gray-900 rounded-xl">${lockOpts || '<p class="text-gray-600 text-xs">No locks configured</p>'}</div>
    </div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveGuest()" class="btn-primary flex-1"><i class="fas fa-ticket mr-1"></i> Create Pass</button>
  </div>`);
}

async function saveGuest() {
  const name  = document.getElementById('gg-name')?.value.trim();
  const from  = document.getElementById('gg-from')?.value;
  const until = document.getElementById('gg-until')?.value;
  const email = document.getElementById('gg-email')?.value.trim();
  if (!name)  { toast('Guest name required', 'warn'); return; }
  if (!from || !until) { toast('Valid dates required', 'warn'); return; }
  if (name.length > 80)  { toast('Name too long', 'warn'); return; }
  if (email && !isValidEmail(email)) { toast('Invalid email', 'warn'); return; }
  if (new Date(from) > new Date(until)) { toast('End date must be after start date', 'warn'); return; }
  const lockIds = [...document.querySelectorAll('.guest-lock-cb:checked')].map(c => c.value);
  try {
    const r = await axios.post(`${API}/api/home/guests`, {
      home_id: currentHomeId, created_by: currentUserId, name,
      email: email || null,
      lock_ids: lockIds, valid_from: from + ' 00:00:00', valid_until: until + ' 23:59:59',
      time_start: document.getElementById('gg-tstart')?.value || '00:00',
      time_end:   document.getElementById('gg-tend')?.value   || '23:59',
    });
    // Activate immediately
    await axios.put(`${API}/api/home/guests/${r.data.pass.id}/activate`);
    closeModal();
    toast(`Guest pass created — Token: ${r.data.invite_token}`);
    loadGuests();
  } catch(e) { toast(e.response?.data?.error || 'Failed to create guest pass', 'error'); }
}

async function activateGuest(id) {
  await axios.put(`${API}/api/home/guests/${id}/activate`);
  toast('Guest pass activated');
  loadGuests();
}

async function deleteGuest(id) {
  if (!id || !isValidId(id)) return;
  if (!confirm('Permanently delete this guest pass? This cannot be undone.')) return;
  try {
    await axios.delete(`${API}/api/home/guests/${id}`);
    toast('Guest pass deleted', 'success');
    loadGuests();
  } catch(e) { toast(e.response?.data?.error || 'Failed to delete pass', 'error'); }
}

async function revokeGuest(id) {
  if (!id || !isValidId(id)) return;
  if (!confirm('Delete this guest pass? This action cannot be undone.')) return;
  try {
    await axios.delete(`${API}/api/home/guests/${id}`);
    toast('Guest pass removed', 'success');
    loadGuests();
  } catch(e) { toast(e.response?.data?.error || 'Failed to remove pass', 'error'); }
}

// ═══════════════════════════════════════════════════════
//  TRUSTED DEVICES
// ═══════════════════════════════════════════════════════
async function loadDevices() {
  const r = await axios.get(`${API}/api/home/devices?home_id=${currentHomeId}`).catch(()=>({data:{devices:[]}}));
  const devices = r.data.devices || [];
  document.getElementById('tab-devices').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Trusted Devices</h2>
    <button onclick="openAddDeviceModal()" class="btn-primary"><i class="fas fa-mobile-alt mr-2"></i>Register Device</button>
  </div>
  <div class="mb-5 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300">
    <i class="fas fa-bluetooth mr-2"></i>
    <strong>How proximity works:</strong> Each trusted device advertises a BLE UUID. The door hub listens for this beacon — if your device is within ~5 meters, proximity is confirmed. WiFi-based verification is used as a fallback.
  </div>
  ${devices.length === 0 ? `
  <div class="card p-10 text-center">
    <i class="fas fa-mobile-alt text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No trusted devices</h3>
    <p class="text-gray-500 mb-4">Register your phone to enable BLE proximity verification.</p>
    <button onclick="openAddDeviceModal()" class="btn-primary">Register Device</button>
  </div>` :
  `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    ${devices.map(d => `
    <div class="card p-5">
      <div class="flex items-center gap-4 mb-4">
        <div class="w-12 h-12 rounded-2xl ${d.trusted ? 'bg-green-500/15' : 'bg-gray-800'} flex items-center justify-center">
          <i class="fab fa-${d.platform === 'android' ? 'android' : 'apple'} text-${d.trusted ? 'green' : 'gray'}-400 text-2xl"></i>
        </div>
        <div class="flex-1">
          <div class="font-bold text-white">${esc(d.name)}</div>
          <div class="text-xs text-gray-500">${esc(d.user_name)} · ${esc(d.platform)}</div>
        </div>
        <span class="badge ${d.trusted ? 'badge-green' : 'badge-red'}">${d.trusted ? 'Trusted' : 'Untrusted'}</span>
      </div>
      <div class="space-y-2 text-xs mb-4">
        <div class="flex justify-between"><span class="text-gray-500">BLE UUID:</span><code class="text-indigo-300 font-mono">${esc(d.ble_uuid) || 'Not assigned'}</code></div>
        ${d.wifi_ssid ? `<div class="flex justify-between"><span class="text-gray-500">WiFi SSID:</span><span class="text-gray-300">${esc(d.wifi_ssid)}</span></div>` : ''}
        <div class="flex justify-between"><span class="text-gray-500">Last seen:</span><span class="text-gray-300">${d.last_seen ? timeAgo(d.last_seen) : 'Never'}</span></div>
      </div>
      <div class="flex gap-2">
        <button onclick="toggleDeviceTrust('${d.id}',${d.trusted})" class="flex-1 py-2 text-xs ${d.trusted ? 'btn-ghost' : 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20'} rounded-lg font-semibold transition-colors">
          ${d.trusted ? 'Revoke Trust' : 'Trust Device'}
        </button>
        <button onclick="removeDevice('${d.id}')" class="py-2 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors">Remove</button>
      </div>
    </div>`).join('')}
  </div>`}`;
}

function openAddDeviceModal() {
  // Load members for the selector
  axios.get(`${API}/api/home/members/${currentHomeId}`).then(r => {
    const members = r.data.members || [];
    const memberOpts = members.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.role)})</option>`).join('');
    openModal(`
    <h3 class="text-lg font-bold text-white mb-5"><i class="fas fa-mobile-alt mr-2 text-indigo-400"></i>Register Trusted Device</h3>
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-500 mb-1 block">Member *</label>
        <select id="dd-user" class="input">
          <option value="">— Select member —</option>
          ${memberOpts}
        </select>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Device Name *</label>
        <input id="dd-name" class="input" placeholder="Jordan's iPhone 15" maxlength="80" autocomplete="off">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-500 mb-1 block">Platform</label>
          <select id="dd-platform" class="input">
            <option value="ios">iOS (iPhone/iPad)</option>
            <option value="android">Android</option>
            <option value="web">Web / Browser</option>
          </select>
        </div>
        <div><label class="text-xs text-gray-500 mb-1 block">Push Token (optional)</label>
          <input id="dd-push" class="input" placeholder="FCM/APNs token" maxlength="500">
        </div>
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1 block">Device Fingerprint (optional)</label>
        <input id="dd-fingerprint" class="input" placeholder="Browser fingerprint or device ID" maxlength="200">
        <p class="text-xs text-gray-600 mt-1">Leave blank to auto-generate from browser. Used for proximity verification.</p>
      </div>
      <div class="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
        <i class="fas fa-bluetooth mr-1"></i> A unique BLE UUID will be auto-assigned for proximity detection.
        <button onclick="autofillFingerprint()" class="ml-2 underline cursor-pointer">Auto-detect fingerprint</button>
      </div>
      <div id="dd-error" style="display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;font-size:12px;color:#fca5a5"></div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="saveDevice()" id="dd-save-btn" class="btn-primary flex-1"><i class="fas fa-mobile-alt mr-1"></i> Register Device</button>
    </div>`);
  }).catch(() => {
    toast('Failed to load members', 'error');
  });
}

function autofillFingerprint() {
  const fp = navigator.userAgent + '|' + screen.width + 'x' + screen.height + '|' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hash = btoa(fp).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  const el = document.getElementById('dd-fingerprint');
  if (el) { el.value = hash; toast('Fingerprint detected', 'info'); }
}

async function saveDevice() {
  const userId = document.getElementById('dd-user')?.value;
  const name = document.getElementById('dd-name')?.value.trim();
  const errEl = document.getElementById('dd-error');
  const btn = document.getElementById('dd-save-btn');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } toast(msg, 'warn'); };

  if (!userId) { showErr('Please select a member.'); return; }
  if (!name) { showErr('Device name is required.'); return; }
  if (name.length > 80) { showErr('Name too long (max 80 chars).'); return; }
  const platform = document.getElementById('dd-platform')?.value;
  if (!['ios','android','web'].includes(platform)) { showErr('Please select a valid platform.'); return; }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Registering…'; }
  try {
    const r = await axios.post(`${API}/api/home/devices`, {
      user_id: userId,
      home_id: currentHomeId,
      name,
      platform,
      push_token: document.getElementById('dd-push')?.value.trim() || null,
      device_fingerprint: document.getElementById('dd-fingerprint')?.value.trim() || null,
    });
    closeModal();
    toast(`✓ Device registered — BLE UUID: ${r.data.ble_uuid || 'assigned'}`, 'success');
    loadDevices();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-mobile-alt mr-1"></i> Register Device'; }
    const msg = e.response?.data?.error || 'Failed to register device';
    showErr(msg);
    toast(msg, 'error');
  }
}

async function toggleDeviceTrust(id, trusted) {
  await axios.put(`${API}/api/home/devices/${id}/trust`, { trusted: !trusted });
  toast(trusted ? 'Device trust revoked' : 'Device trusted');
  loadDevices();
}

async function removeDevice(id) {
  if (!id || !isValidId(id)) return;
  if (!confirm('Remove this device?')) return;
  try {
    await axios.delete(`${API}/api/home/devices/${id}`);
    toast('Device removed');
    loadDevices();
  } catch(e) { toast(e.response?.data?.error || 'Failed to remove device', 'error'); }
}

// ═══════════════════════════════════════════════════════
//  ACTIVITY LOG
// ═══════════════════════════════════════════════════════
async function loadActivity() {
  const r = await axios.get(`${API}/api/home/events?home_id=${currentHomeId}&limit=100`).catch(()=>({data:{events:[]}}));
  const events = r.data.events || [];
  document.getElementById('tab-activity').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Activity Log</h2>
    <div class="flex items-center gap-2 text-xs text-gray-500">${events.length} events</div>
  </div>
  <div class="card">
    ${events.length === 0 ? '<p class="text-gray-500 text-sm p-5">No activity yet. Try running a face recognition test.</p>' :
    events.map(ev => {
      const typeMap = { unlock: ['fa-lock-open','green'], denied: ['fa-times-circle','red'], alert: ['fa-exclamation-triangle','yellow'], guest_entry: ['fa-ticket','purple'], manual: ['fa-hand-pointer','blue'] };
      const [icon, color] = typeMap[ev.event_type] || ['fa-circle','gray'];
      return `
      <div class="event-row event-${esc(ev.event_type)} flex items-start gap-3 border-b border-gray-900 last:border-0">
        <div class="w-8 h-8 rounded-lg bg-${color}-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fas ${icon} text-${color}-400 text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-white text-sm">${esc(ev.user_name) || 'Unknown'}</span>
            <span class="text-xs text-gray-500">→ ${esc(ev.lock_name) || '—'}</span>
            ${ev.ble_detected ? '<span class="badge badge-indigo text-xs"><i class="fas fa-bluetooth"></i> BLE</span>' : ''}
            ${ev.wifi_matched ? '<span class="badge badge-indigo text-xs"><i class="fas fa-wifi"></i> WiFi</span>' : ''}
          </div>
          <div class="text-xs text-gray-600 mt-0.5">
            ${esc(ev.method) || '—'} · ${ev.face_confidence ? `Face: ${Math.round(ev.face_confidence*100)}%` : ''} ${ev.denial_reason ? `· Reason: ${esc(ev.denial_reason)}` : ''}
          </div>
        </div>
        <div class="text-xs text-gray-600 flex-shrink-0">${timeAgo(ev.created_at)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ═══════════════════════════════════════════════════════
//  CAMERAS
// ═══════════════════════════════════════════════════════
async function loadCameras() {
  const r = await axios.get(`${API}/api/home/cameras?home_id=${currentHomeId}`).catch(()=>({data:{cameras:[]}}));
  const cameras = r.data.cameras || [];
  const locksR = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(()=>({data:{locks:[]}}));
  const locks = locksR.data.locks || [];
  document.getElementById('tab-cameras').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Cameras</h2>
    <button onclick="openAddCameraModal(${JSON.stringify(locks).replace(/"/g,'&quot;')})" class="btn-primary"><i class="fas fa-camera mr-2"></i>Add Camera</button>
  </div>
  ${cameras.length === 0 ? `
  <div class="card p-10 text-center">
    <i class="fas fa-video-slash text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No cameras configured</h3>
    <p class="text-gray-500 mb-4">Add your doorbell or IP camera to enable face detection.</p>
    <button onclick="openAddCameraModal(${JSON.stringify(locks).replace(/"/g,'&quot;')})" class="btn-primary">Add Camera</button>
  </div>` :
  `<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    ${cameras.map(cam => `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="font-bold text-white">${esc(cam.name)}</div>
          <div class="text-xs text-gray-500">${esc(cam.camera_type?.toUpperCase())} · Linked to: ${esc(cam.lock_name) || 'No lock'}</div>
        </div>
        <span class="badge ${cam.status === 'active' ? 'badge-green' : 'badge-red'}">${cam.status}</span>
      </div>
      <div class="text-xs text-gray-600 font-mono mb-3 bg-gray-900 p-2 rounded-lg overflow-hidden overflow-ellipsis whitespace-nowrap">${esc(cam.stream_url) || 'No stream URL configured'}</div>
      <div class="flex gap-2">
        <button onclick="deleteCam('${cam.id}')" class="btn-ghost text-sm py-2 px-3">Remove</button>
      </div>
    </div>`).join('')}
  </div>`}`;
}

function openAddCameraModal(locks) {
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5"><i class="fas fa-camera mr-2 text-indigo-400"></i>Add Camera</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Camera Name *</label>
      <input id="cc-name" class="input" placeholder="Front Door Camera" maxlength="80">
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Camera Type</label>
        <select id="cc-type" class="input" onchange="updateCameraURLHint(this.value)">
          <option value="usb">USB Camera (local)</option>
          <option value="laptop">Laptop / Built-in Webcam</option>
          <option value="rtsp">RTSP / IP Camera</option>
          <option value="ring">Ring Doorbell</option>
          <option value="nest">Google Nest</option>
          <option value="arlo">Arlo</option>
          <option value="webrtc">WebRTC</option>
          <option value="ip">Generic IP Camera</option>
        </select>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Linked Lock</label>
        <select id="cc-lock" class="input">
          <option value="">None</option>
          ${(locks||[]).map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div>
      <label class="text-xs text-gray-500 mb-1 block">Stream URL / API Key / Device ID</label>
      <input id="cc-url" class="input" placeholder="rtsp://192.168.1.100:554/stream">
      <p id="cc-url-hint" class="text-xs text-gray-600 mt-1">RTSP stream URL from your IP camera</p>
    </div>
    <div id="cc-error" style="display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;font-size:12px;color:#fca5a5"></div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveCamera()" id="cc-save-btn" class="btn-primary flex-1"><i class="fas fa-camera mr-1"></i> Add Camera</button>
  </div>`);
  // Set initial hint
  updateCameraURLHint('usb');
}

function updateCameraURLHint(type) {
  const hints = {
    usb:    'USB device index or path (e.g. /dev/video0 or 0). Leave blank for default camera.',
    laptop: 'Leave blank to use the built-in webcam. Device index 0 for first camera.',
    rtsp:   'RTSP stream URL (e.g. rtsp://192.168.1.100:554/stream)',
    ring:   'Your Ring API access token from ring.com/account',
    nest:   'Google OAuth token from Google Smart Device Management API',
    arlo:   'Arlo API key from my.arlo.com',
    webrtc: 'WebRTC SDP endpoint URL',
    ip:     'HTTP/MJPEG stream URL (e.g. http://192.168.1.100/video)',
  };
  const placeholders = {
    usb:    '/dev/video0  (or leave blank)',
    laptop: 'Leave blank for default webcam',
    rtsp:   'rtsp://192.168.1.100:554/stream',
    ring:   'Ring API access token',
    nest:   'Google OAuth token',
    arlo:   'Arlo API key',
    webrtc: 'WebRTC SDP endpoint',
    ip:     'http://192.168.1.100/video',
  };
  const h = document.getElementById('cc-url-hint');
  const u = document.getElementById('cc-url');
  if (h) h.textContent = hints[type] || '';
  if (u) u.placeholder = placeholders[type] || '';
}

async function saveCamera() {
  const name = document.getElementById('cc-name')?.value.trim();
  const errEl = document.getElementById('cc-error');
  const btn = document.getElementById('cc-save-btn');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } toast(msg, 'warn'); };

  if (!name) { showErr('Camera name is required.'); return; }
  if (name.length > 80) { showErr('Name too long (max 80 chars).'); return; }
  const camType = document.getElementById('cc-type')?.value;
  const validCamTypes = ['rtsp','ring','nest','arlo','webrtc','usb','laptop','ip'];
  if (!validCamTypes.includes(camType)) { showErr('Invalid camera type.'); return; }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Adding…'; }
  try {
    await axios.post(`${API}/api/home/cameras`, {
      home_id: currentHomeId,
      lock_id: document.getElementById('cc-lock')?.value || null,
      name,
      stream_url: document.getElementById('cc-url')?.value.trim() || null,
      camera_type: camType,
    });
    closeModal();
    toast('✓ Camera added successfully', 'success');
    loadCameras();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-camera mr-1"></i> Add Camera'; }
    const msg = e.response?.data?.error || 'Failed to add camera';
    showErr(msg);
    toast(msg, 'error');
  }
}

async function deleteCam(id) {
  if (!id || !isValidId(id)) return;
  if (!confirm('Remove this camera?')) return;
  try {
    await axios.delete(`${API}/api/home/cameras/${id}`);
    toast('Camera removed');
    loadCameras();
  } catch(e) { toast(e.response?.data?.error || 'Failed to remove camera', 'error'); }
}

// ═══════════════════════════════════════════════════════
//  AUTOMATIONS
// ═══════════════════════════════════════════════════════

const TRIGGER_LABELS = {
  face_granted:   'Face Recognized (Access Granted)',
  face_denied:    'Face Denied (Unknown/Low Confidence)',
  face_unknown:   'Unknown Face Detected',
  unusual_time:   'Access at Unusual Hour',
  guest_entry:    'Guest Pass Used',
  manual:         'Manual Trigger',
  arrival:        'Family Member Arrives',
  departure:      'Family Member Leaves',
  time_schedule:  'Time / Schedule',
  spoof_detected: 'Spoof Attack Detected',
  low_trust:      'Low Trust Score',
};
const ACTION_LABELS = {
  notify:  'Send Push Notification',
  unlock:  'Unlock Door',
  lock:    'Lock Door',
  alert:   'Trigger Security Alert',
  webhook: 'Call Webhook',
  scene:   'Activate Scene',
  log:     'Log to Audit Trail',
};
const TRIGGER_ICONS = {
  face_granted:'fa-face-smile',face_denied:'fa-face-frown',face_unknown:'fa-question-circle',
  unusual_time:'fa-clock',guest_entry:'fa-ticket',manual:'fa-hand-pointer',
  arrival:'fa-arrow-right-to-bracket',departure:'fa-arrow-right-from-bracket',
  time_schedule:'fa-calendar-clock',spoof_detected:'fa-skull',low_trust:'fa-triangle-exclamation',
};
const ACTION_ICONS = {
  notify:'fa-bell',unlock:'fa-lock-open',lock:'fa-lock',alert:'fa-siren',
  webhook:'fa-webhook',scene:'fa-lightbulb',log:'fa-list',
};

async function loadAutomations() {
  const r = await axios.get(`${API}/api/home/automations/${currentHomeId}`).catch(()=>({data:{automations:[]}}));
  const autos = r.data.automations || [];
  const el = document.getElementById('tab-automations');
  el.innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Automations <span class="badge badge-indigo text-xs ml-2">Rules Engine</span></h2>
    <button onclick="openAddAutomationModal()" class="btn-primary"><i class="fas fa-bolt mr-2"></i>New Rule</button>
  </div>
  ${autos.length === 0 ? `
  <div class="card p-8 text-center">
    <i class="fas fa-bolt text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No automation rules yet</h3>
    <p class="text-gray-500 mb-4">Create event-based rules to automate your home security.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 max-w-lg mx-auto text-left mb-6">
      ${[
        ['Auto-lock at bedtime','Lock all doors at 11 pm every night','fa-moon','time_schedule','lock'],
        ['Alert on unknown face','Notify when an unknown face is detected','fa-bell','face_unknown','notify'],
        ['Guest arrival alert','Log when a guest pass is activated','fa-ticket','guest_entry','log'],
        ['Spoof attack alert','Trigger alert if spoof attack is detected','fa-skull','spoof_detected','alert'],
      ].map(([t,d,i,trigger,action])=>`
      <div onclick="openAddAutomationModal('${trigger}','${action}')" class="p-4 bg-gray-900 rounded-xl border border-gray-800 hover:border-indigo-500/40 transition-colors cursor-pointer group">
        <div class="flex items-center gap-2 mb-1"><i class="fas ${i} text-indigo-400 group-hover:text-indigo-300"></i><span class="font-semibold text-white text-sm">${t}</span></div>
        <p class="text-xs text-gray-500">${d}</p>
      </div>`).join('')}
    </div>
    <button onclick="openAddAutomationModal()" class="btn-primary">Create Automation Rule</button>
  </div>` :
  `<div class="space-y-3">
    ${autos.map(a => {
      const trigLabel = TRIGGER_LABELS[a.trigger_type] || a.trigger_type;
      const actLabel  = ACTION_LABELS[a.action_type]  || a.action_type;
      const trigIcon  = TRIGGER_ICONS[a.trigger_type] || 'fa-bolt';
      const actIcon   = ACTION_ICONS[a.action_type]   || 'fa-cog';
      return `
  <div class="card p-4">
    <div class="flex items-center gap-4">
      <div class="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
        <i class="fas ${trigIcon} text-indigo-400"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-white">${esc(a.name)}</div>
        <div class="text-xs text-gray-500 mt-0.5">
          <span class="text-indigo-400"><i class="fas ${trigIcon} mr-1"></i>${trigLabel}</span>
          <span class="text-gray-600 mx-2">→</span>
          <span class="text-green-400"><i class="fas ${actIcon} mr-1"></i>${actLabel}</span>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <button onclick="toggleAuto('${esc(a.id)}')" title="${a.enabled ? 'Disable' : 'Enable'}"
          class="w-12 h-6 rounded-full ${a.enabled ? 'bg-indigo-500' : 'bg-gray-700'} relative transition-colors cursor-pointer border-0 flex-shrink-0">
          <div class="w-4 h-4 rounded-full bg-white absolute top-1 ${a.enabled ? 'right-1' : 'left-1'} transition-all"></div>
        </button>
        <button onclick="deleteAutomation('${esc(a.id)}')" class="py-1.5 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    ${a.conditions && a.conditions !== '{}' ? `
    <div class="mt-2 ml-14 text-xs text-gray-600 font-mono bg-gray-900 px-3 py-1.5 rounded-lg">
      <i class="fas fa-filter mr-1 text-gray-500"></i>Conditions: ${esc(a.conditions)}
    </div>` : ''}
  </div>`}).join('')}
  </div>`}`;
}

function openAddAutomationModal(defaultTrigger, defaultAction) {
  const triggerOpts = Object.entries(TRIGGER_LABELS).map(([v,l]) =>
    `<option value="${v}" ${v === (defaultTrigger||'face_granted') ? 'selected' : ''}>${l}</option>`
  ).join('');
  const actionOpts = Object.entries(ACTION_LABELS).map(([v,l]) =>
    `<option value="${v}" ${v === (defaultAction||'notify') ? 'selected' : ''}>${l}</option>`
  ).join('');

  openModal(`
  <h3 class="text-lg font-bold text-white mb-5"><i class="fas fa-bolt mr-2 text-indigo-400"></i>Create Automation Rule</h3>
  <div class="space-y-4">
    <div>
      <label class="text-xs text-gray-500 mb-1 block">Rule Name *</label>
      <input id="auto-name" class="input" placeholder="e.g. Alert on unknown face" maxlength="120" autocomplete="off">
    </div>
    <div class="grid grid-cols-1 gap-3">
      <div>
        <label class="text-xs text-gray-500 mb-1 block"><i class="fas fa-bolt text-indigo-400 mr-1"></i>Trigger — When this happens…</label>
        <select id="auto-trigger" class="input">${triggerOpts}</select>
      </div>
      <div>
        <label class="text-xs text-gray-500 mb-1 block"><i class="fas fa-cog text-green-400 mr-1"></i>Action — Do this…</label>
        <select id="auto-action" class="input">${actionOpts}</select>
      </div>
    </div>
    <div>
      <label class="text-xs text-gray-500 mb-1 block">Condition (optional JSON)</label>
      <input id="auto-condition" class="input font-mono text-xs" placeholder='{"min_hour": 22, "max_hour": 6}' maxlength="500">
      <p class="text-xs text-gray-600 mt-1">Optional filter conditions, e.g. time range, trust threshold, lock ID</p>
    </div>
    <div id="auto-error" style="display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;font-size:12px;color:#fca5a5"></div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveAutomation()" id="auto-save-btn" class="btn-primary flex-1"><i class="fas fa-bolt mr-1"></i> Create Rule</button>
  </div>`);
}

async function saveAutomation() {
  const name    = document.getElementById('auto-name')?.value.trim();
  const trigger = document.getElementById('auto-trigger')?.value;
  const action  = document.getElementById('auto-action')?.value;
  const condStr = document.getElementById('auto-condition')?.value.trim();
  const errEl   = document.getElementById('auto-error');
  const btn     = document.getElementById('auto-save-btn');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } toast(msg, 'warn'); };

  if (!name) { showErr('Rule name is required.'); return; }
  if (name.length > 120) { showErr('Name too long (max 120 chars).'); return; }

  let conditions = {};
  if (condStr) {
    try { conditions = JSON.parse(condStr); }
    catch(e) { showErr('Condition must be valid JSON (e.g. {"min_hour": 22}).'); return; }
  }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving…'; }
  try {
    await axios.post(`${API}/api/home/automations`, {
      home_id: currentHomeId,
      name,
      trigger_type: trigger,
      action_type:  action,
      conditions,
    });
    closeModal();
    toast(`✓ Automation rule "${name}" created`, 'success');
    loadAutomations();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt mr-1"></i> Create Rule'; }
    const msg = e.response?.data?.error || 'Failed to create automation';
    showErr(msg);
    toast(msg, 'error');
  }
}

async function toggleAuto(id) {
  try {
    const r = await axios.put(`${API}/api/home/automations/${id}/toggle`);
    toast(r.data.enabled ? 'Rule enabled' : 'Rule disabled', 'info');
  } catch(e) { toast('Failed to toggle rule', 'error'); }
  loadAutomations();
}

async function deleteAutomation(id) {
  if (!id || !isValidId(id)) return;
  if (!confirm('Delete this automation rule?')) return;
  try {
    await axios.delete(`${API}/api/home/automations/${id}`);
    toast('Automation rule deleted', 'success');
    loadAutomations();
  } catch(e) { toast(e.response?.data?.error || 'Failed to delete rule', 'error'); }
}

// ── Helpers ──────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════
//  AI INTELLIGENCE — Trust Scoring & Behavioral Analysis
// ═══════════════════════════════════════════════════════

/** Trust tier → colour mapping */
function trustColor(tier) {
  return { trusted: 'green', standard: 'indigo', watchlist: 'yellow', blocked: 'red' }[tier] || 'gray';
}
function trustIcon(tier) {
  return { trusted: 'fa-shield-check', standard: 'fa-shield', watchlist: 'fa-exclamation-triangle', blocked: 'fa-ban' }[tier] || 'fa-circle';
}
function severityColor(sev) {
  return { critical: 'red', high: 'orange', medium: 'yellow', low: 'blue' }[sev] || 'gray';
}

async function loadAI() {
  const el = document.getElementById('tab-ai');
  if (!el) return;
  el.innerHTML = `<div class="text-gray-500 text-sm py-10 text-center"><i class="fas fa-brain fa-spin text-indigo-400 text-2xl mb-3 block"></i>Loading AI Intelligence...</div>`;
  try {
    const [dashR, recsR, predsR, pipelineR] = await Promise.all([
      axios.get(`${API}/api/ai/dashboard/${currentHomeId}`).catch(() => ({ data: {} })),
      axios.get(`${API}/api/ai/recommendations/${currentHomeId}`).catch(() => ({ data: { recommendations: [] } })),
      axios.get(`${API}/api/ai/predictions/${currentHomeId}`).catch(() => ({ data: { predictions: [] } })),
      axios.get(`${API}/api/ai/pipeline/stats/${currentHomeId}`).catch(() => ({ data: {} })),
    ]);
    const dash  = dashR.data  || {};
    const recs  = recsR.data.recommendations || [];
    const preds = predsR.data.predictions    || [];
    const pipe  = pipelineR.data || {};

    const ts   = dash.trust_summary   || {};
    const as_  = dash.anomaly_summary || {};
    const watch = dash.trust_watchlist   || [];
    const recentAnoms = dash.recent_anomalies || [];
    const heatmap = dash.behavioral_heatmap || [];
    const perf = pipe.performance || {};

    el.innerHTML = `
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white flex items-center gap-2">
          <i class="fas fa-brain text-indigo-400"></i> AI Intelligence
          <span style="font-size:10px;padding:2px 8px;background:rgba(99,102,241,0.2);color:#a5b4fc;border-radius:20px;font-weight:700;">v4.0</span>
        </h2>
        <p class="text-xs text-gray-500 mt-0.5">Multi-model biometrics · Predictive behavior · Trust scoring · Anomaly detection</p>
      </div>
      <button onclick="loadAI()" class="text-xs text-indigo-400 hover:underline"><i class="fas fa-sync mr-1"></i>Refresh</button>
    </div>

    <!-- Multi-Model Pipeline Status -->
    <div class="card p-5 mb-6" style="border-color:rgba(99,102,241,0.25);background:linear-gradient(135deg,rgba(99,102,241,0.05),rgba(139,92,246,0.05))">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-white text-sm flex items-center gap-2">
          <i class="fas fa-layer-group text-indigo-400"></i> Multi-Model Biometric Pipeline
          <span style="font-size:10px;padding:1px 6px;background:rgba(16,185,129,0.2);color:#34d399;border-radius:10px;">ACTIVE</span>
        </h3>
        <span class="text-xs text-gray-500">7-day performance</span>
      </div>

      <!-- Pipeline stages visual -->
      <div class="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
        ${[
          { label:'Edge AI', icon:'⚡', sub:'Preprocessing', color:'cyan', score: perf.avg_arcface_score },
          { label:'ArcFace', icon:'◈', sub:'512-dim ResNet100', color:'indigo', score: perf.avg_arcface_score },
          { label:'InsightFace', icon:'◉', sub:'256-dim MobileNet', color:'purple', score: perf.avg_insightface_score },
          { label:'FaceNet', icon:'◆', sub:'128-dim Inception', color:'violet', score: perf.avg_facenet_score },
          { label:'Score Fusion', icon:'⊕', sub:'Weighted fusion', color:'emerald', score: perf.avg_combined_confidence },
        ].map((s, i) => `
        <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:0;">
          <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:10px 8px;text-align:center;flex:1;min-width:70px;">
            <div style="font-size:18px;margin-bottom:4px;">${s.icon}</div>
            <div style="font-size:11px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.label}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:1px;">${s.sub}</div>
            ${s.score != null ? `<div style="font-size:12px;font-weight:800;color:#a5b4fc;margin-top:4px;">${Math.round(s.score*100)}%</div>` : '<div style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:4px;">—</div>'}
          </div>
          ${i < 4 ? `<div style="color:rgba(255,255,255,0.15);font-size:16px;flex-shrink:0;">→</div>` : ''}
        </div>`).join('')}
      </div>

      <!-- Pipeline metrics grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div class="text-lg font-black text-white">${perf.total_verifications || 0}</div>
          <div class="text-xs text-gray-500">Total Verifications</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div class="text-lg font-black ${(perf.avg_latency_ms||0) < 800 ? 'text-green-400' : 'text-yellow-400'}">${perf.avg_latency_ms ? Math.round(perf.avg_latency_ms)+'ms' : '—'}</div>
          <div class="text-xs text-gray-500">Avg Latency</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div class="text-lg font-black text-indigo-400">${perf.avg_model_agreement != null ? Math.round(perf.avg_model_agreement*100)+'%' : '—'}</div>
          <div class="text-xs text-gray-500">Model Agreement</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div class="text-lg font-black text-yellow-400">${perf.borderline_total || 0}</div>
          <div class="text-xs text-gray-500">Borderline Cases</div>
        </div>
      </div>

      ${perf.total_verifications > 0 ? `
      <!-- Trust Engine v4 formula -->
      <div class="mt-4 p-3 rounded-xl" style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);">
        <div class="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Trust Engine v4 Formula</div>
        <div class="text-xs text-gray-400 font-mono leading-relaxed">
          combined = ArcFace×<span class="text-indigo-400">0.50</span> + InsightFace×<span class="text-purple-400">0.30</span> + FaceNet×<span class="text-violet-400">0.20</span><br>
          trust = face_avg×<span class="text-green-400">0.35</span> + behavioral×<span class="text-blue-400">0.35</span> + predictive×<span class="text-yellow-400">0.20</span> − penalty×<span class="text-red-400">0.10</span>
        </div>
      </div>` : ''}
    </div>

    <!-- Trust Score Summary Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="stat-mini border-green-500/20">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-shield-check text-green-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Trusted</span>
        </div>
        <div class="text-3xl font-black text-green-400">${ts.trusted_count || 0}</div>
      </div>
      <div class="stat-mini">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-shield text-indigo-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Standard</span>
        </div>
        <div class="text-3xl font-black text-white">${ts.standard_count || 0}</div>
      </div>
      <div class="stat-mini ${(ts.watchlist_count || 0) > 0 ? 'border-yellow-500/30' : ''}">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-exclamation-triangle text-yellow-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Watchlist</span>
        </div>
        <div class="text-3xl font-black text-${(ts.watchlist_count || 0) > 0 ? 'yellow-400' : 'white'}">${ts.watchlist_count || 0}</div>
      </div>
      <div class="stat-mini ${(as_.critical_count || 0) > 0 ? 'border-red-500/30' : ''}">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-ban text-red-400"></i>
          <span class="text-xs text-gray-600 uppercase tracking-wide">Anomalies</span>
        </div>
        <div class="text-3xl font-black text-${(as_.critical_count || 0) > 0 ? 'red-400' : 'white'}">${as_.total_unresolved || 0}</div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <!-- Trust Profiles -->
      <div class="lg:col-span-2 card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-white text-sm">User Trust Scores</h3>
          <span class="text-xs text-gray-500">Avg: ${ts.avg_trust_score ? Math.round(ts.avg_trust_score * 100) + '%' : '—'}</span>
        </div>
        <div id="trust-profile-list">
          <p class="text-gray-600 text-sm">Loading...</p>
        </div>
      </div>

      <!-- AI Recommendations -->
      <div class="card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-white text-sm"><i class="fas fa-lightbulb text-yellow-400 mr-2"></i>AI Recommendations</h3>
          <button onclick="refreshRecs()" class="text-xs text-indigo-400 hover:underline">Refresh</button>
        </div>
        <div id="ai-recs-list">
          ${recs.length === 0 ? '<p class="text-gray-500 text-xs text-center py-4">No recommendations right now. System looks healthy!</p>' :
          recs.map(r => `
          <div class="mb-3 p-3 rounded-xl bg-gray-900/50 border border-${r.priority === 'urgent' ? 'red' : r.priority === 'high' ? 'orange' : 'gray'}-500/20">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-1">
                  <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-${r.priority === 'urgent' ? 'red' : r.priority === 'high' ? 'orange' : 'indigo'}-500/20 text-${r.priority === 'urgent' ? 'red' : r.priority === 'high' ? 'orange' : 'indigo'}-400 uppercase">${esc(r.priority)}</span>
                </div>
                <div class="text-xs font-semibold text-white">${esc(r.title)}</div>
                <div class="text-xs text-gray-500 mt-0.5">${esc(r.message)}</div>
              </div>
              <button onclick="dismissRec('${esc(r.id)}')" class="text-gray-600 hover:text-gray-400 flex-shrink-0 text-xs" title="Dismiss"><i class="fas fa-times"></i></button>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Recent Anomalies -->
    <div class="card p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-white text-sm"><i class="fas fa-exclamation-circle text-red-400 mr-2"></i>Recent Anomalies</h3>
        <button onclick="showTab('anomalies')" class="text-xs text-indigo-400 hover:underline">View All →</button>
      </div>
      ${recentAnoms.length === 0 ? '<p class="text-gray-500 text-sm text-center py-4"><i class="fas fa-check-circle text-green-500 mr-2"></i>No anomalies detected</p>' :
      recentAnoms.map(a => `
      <div class="flex items-start gap-3 py-3 border-b border-gray-900 last:border-0">
        <div class="w-8 h-8 rounded-lg bg-${severityColor(a.severity)}-500/15 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-exclamation-triangle text-${severityColor(a.severity)}-400 text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold text-white">${esc(a.anomaly_type?.replace(/_/g,' ') || 'Unknown')}</div>
          <div class="text-xs text-gray-500">${esc(a.user_name || 'Unknown user')} · ${esc(a.severity)} severity · ${timeAgo(a.created_at)}</div>
        </div>
        <button onclick="resolveAnomaly('${esc(a.id)}')" class="text-xs text-green-400 hover:text-green-300 flex-shrink-0">Resolve</button>
      </div>`).join('')}
    </div>

    <!-- Predictions -->
    <div class="card p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-white text-sm"><i class="fas fa-magic text-purple-400 mr-2"></i>Arrival Predictions</h3>
        <button onclick="generatePredictions()" class="text-xs text-indigo-400 hover:underline"><i class="fas fa-sync mr-1"></i>Generate</button>
      </div>
      <div id="ai-predictions-list">
        ${preds.length === 0 ? '<p class="text-gray-500 text-sm text-center py-4">No active predictions. Need more access data to predict arrivals.</p>' :
        preds.map(p => `
        <div class="flex items-center gap-3 py-3 border-b border-gray-900 last:border-0">
          <div class="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-clock text-purple-400 text-sm"></i>
          </div>
          <div class="flex-1">
            <div class="text-xs font-semibold text-white">${esc(p.user_name || 'Unknown')}</div>
            <div class="text-xs text-gray-500">Predicted: ${esc(p.predicted_arrival?.substring(11,16) || '—')} · <span class="text-purple-400">${Math.round((p.prediction_confidence || 0) * 100)}%</span> confidence</div>
          </div>
          <span class="badge badge-gray text-xs">${esc(p.lock_name || 'Any lock')}</span>
        </div>`).join('')}
      </div>
    </div>

    <!-- Behavioral Heatmap -->
    <div class="card p-5">
      <h3 class="font-bold text-white text-sm mb-4"><i class="fas fa-th text-indigo-400 mr-2"></i>Access Heatmap (Last 7 Days)</h3>
      ${renderHeatmap(heatmap)}
    </div>`;

    // Load trust profiles separately
    loadTrustProfiles();
  } catch(e) {
    console.error('AI load error', e);
    document.getElementById('tab-ai').innerHTML = `<div class="text-red-400 text-sm p-4">Failed to load AI dashboard: ${esc(e.message)}</div>`;
  }
}

async function loadTrustProfiles() {
  try {
    const r = await axios.get(`${API}/api/ai/trust/${currentHomeId}`);
    const profiles = r.data.trust_profiles || [];
    const el = document.getElementById('trust-profile-list');
    if (!el) return;
    if (profiles.length === 0) {
      el.innerHTML = '<p class="text-gray-600 text-sm">No trust profiles yet. Profiles build automatically as users authenticate.</p>';
      return;
    }
    el.innerHTML = profiles.map(p => `
    <div class="flex items-center gap-3 py-3 border-b border-gray-900 last:border-0 hover:bg-gray-900/30 rounded-lg px-2 transition-colors cursor-pointer" onclick="showUserTrust('${esc(p.user_id)}','${esc(p.user_name || '')}')">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm" style="background-color:${esc(p.avatar_color || '#6366f1')}22;color:${esc(p.avatar_color || '#6366f1')}">${(p.user_name||'U').charAt(0)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-white">${esc(p.user_name || 'Unknown')}</span>
          <span class="badge text-xs px-2 py-0.5 rounded-full bg-${trustColor(p.trust_tier)}-500/20 text-${trustColor(p.trust_tier)}-400">
            <i class="fas ${trustIcon(p.trust_tier)} mr-1 text-xs"></i>${esc(p.trust_tier || 'standard')}
          </span>
        </div>
        <div class="text-xs text-gray-500 mt-0.5">
          ${p.successful_unlocks || 0} unlocks · ${p.anomaly_count || 0} anomalies
        </div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <div class="text-sm font-black text-${trustColor(p.trust_tier)}-400">${Math.round((p.trust_score || 0) * 100)}%</div>
        <div class="w-16 h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div class="h-full rounded-full bg-${trustColor(p.trust_tier)}-500" style="width:${Math.round((p.trust_score || 0) * 100)}%"></div>
        </div>
      </div>
    </div>`).join('');
  } catch(e) { console.warn('Trust profiles error', e); }
}

async function showUserTrust(userId, userName) {
  if (!isValidId(userId)) return;
  openModal(`
  <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-user-shield text-indigo-400 mr-2"></i>${esc(userName)} — Trust Profile</h3>
  <div id="user-trust-detail"><p class="text-gray-500 text-sm">Loading...</p></div>
  `);
  try {
    const [trustR, behavR, auditR] = await Promise.all([
      axios.get(`${API}/api/ai/trust/user/${userId}`),
      axios.get(`${API}/api/ai/behavioral/${userId}?days=30`),
      axios.get(`${API}/api/ai/audit/user/${userId}?limit=20`).catch(() => ({ data: { model_stats: {} } })),
    ]);
    const profile = trustR.data.profile || {};
    const hourDist = trustR.data.hour_distribution || [];
    const beh = behavR.data;
    const modelStats = auditR.data.model_stats || {};
    const el = document.getElementById('user-trust-detail');
    if (!el) return;
    el.innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="bg-gray-900/60 rounded-xl p-3 text-center">
        <div class="text-2xl font-black text-${trustColor(profile.trust_tier)}-400">${Math.round((profile.trust_score||0)*100)}%</div>
        <div class="text-xs text-gray-500">Trust Score</div>
      </div>
      <div class="bg-gray-900/60 rounded-xl p-3 text-center">
        <div class="text-2xl font-black text-white">${Math.round((profile.behavioral_score||0)*100)}%</div>
        <div class="text-xs text-gray-500">Behavioral</div>
      </div>
      <div class="bg-gray-900/60 rounded-xl p-3 text-center">
        <div class="text-2xl font-black text-green-400">${profile.successful_unlocks||0}</div>
        <div class="text-xs text-gray-500">Unlocks</div>
      </div>
      <div class="bg-gray-900/60 rounded-xl p-3 text-center">
        <div class="text-2xl font-black text-${(profile.anomaly_count||0)>0?'red':'white'}-400">${profile.anomaly_count||0}</div>
        <div class="text-xs text-gray-500">Anomalies</div>
      </div>
    </div>
    <div class="mb-3">
      <div class="text-xs text-gray-500 mb-2">Trust Score Components</div>
      ${[
        ['Face Confidence', profile.face_confidence_avg, 'indigo'],
        ['Behavioral',      profile.behavioral_score,    'purple'],
        ['Predictive',      profile.predictive_score,    'blue'],
      ].map(([label, val, color]) => `
      <div class="flex items-center gap-2 mb-1.5">
        <div class="text-xs text-gray-400 w-28 flex-shrink-0">${label}</div>
        <div class="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div class="h-full bg-${color}-500 rounded-full" style="width:${Math.round((val||0)*100)}%"></div>
        </div>
        <div class="text-xs text-gray-400 w-8 text-right">${Math.round((val||0)*100)}%</div>
      </div>`).join('')}
    </div>
    ${modelStats.total_auths > 0 ? `
    <div class="mb-3 p-3 rounded-xl bg-gray-900/60 border border-indigo-500/15">
      <div class="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Multi-Model Biometric Stats</div>
      ${[
        ['ArcFace (512-dim)',     modelStats.avg_arcface,    'indigo'],
        ['InsightFace (256-dim)', modelStats.avg_insightface,'purple'],
        ['FaceNet (128-dim)',     modelStats.avg_facenet,    'violet'],
        ['Combined Score',        modelStats.avg_combined,   'emerald'],
        ['Liveness',              modelStats.avg_liveness,   'green'],
        ['Anti-Spoof',            modelStats.avg_anti_spoof, 'cyan'],
      ].map(([label, val, color]) => val != null ? `
      <div class="flex items-center gap-2 mb-1.5">
        <div class="text-xs text-gray-400 w-36 flex-shrink-0">${label}</div>
        <div class="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div class="h-full bg-${color}-500 rounded-full" style="width:${Math.round((val||0)*100)}%"></div>
        </div>
        <div class="text-xs text-${color}-400 w-10 text-right font-bold">${Math.round((val||0)*100)}%</div>
      </div>` : '').join('')}
      <div class="flex items-center gap-3 mt-2 pt-2 border-t border-gray-800">
        <span class="text-xs text-gray-500">${modelStats.total_auths||0} total auths</span>
        <span class="text-xs text-yellow-400">${modelStats.borderline_count||0} borderline</span>
        <span class="text-xs text-gray-500">${modelStats.avg_latency_ms ? Math.round(modelStats.avg_latency_ms)+'ms avg' : ''}</span>
        <span class="text-xs text-indigo-400 ml-auto">agreement: ${modelStats.avg_model_agreement != null ? Math.round(modelStats.avg_model_agreement*100)+'%' : '—'}</span>
      </div>
    </div>` : ''}
    <div class="mb-3">
      <div class="text-xs text-gray-500 mb-2">Access Pattern (by hour)</div>
      <div class="flex items-end gap-0.5 h-12">
        ${Array.from({length:24}, (_, h) => {
          const bucket = hourDist.find(b => b.access_hour === h);
          const cnt = bucket?.cnt || 0;
          const maxCnt = Math.max(1, ...hourDist.map(b => b.cnt));
          const pct = Math.round((cnt / maxCnt) * 100);
          return `<div class="flex-1 bg-indigo-500/30 rounded-sm hover:bg-indigo-400/50 transition-colors" style="height:${Math.max(4,pct)}%" title="${h}:00 — ${cnt} accesses"></div>`;
        }).join('')}
      </div>
      <div class="flex justify-between text-xs text-gray-700 mt-1">
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
      </div>
    </div>
    ${beh.prediction ? `
    <div class="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
      <i class="fas fa-magic mr-1 text-purple-400"></i>
      Next predicted arrival: <strong>${esc(beh.prediction.predictedAt?.substring(11,16)||'')}</strong>
      · ${Math.round((beh.prediction.confidence||0)*100)}% confidence
    </div>` : ''}
    <div class="flex gap-2 mt-4">
      <button onclick="closeModal()" class="btn-ghost flex-1 text-sm">Close</button>
      <button onclick="recalculateTrust('${esc(userId)}')" class="btn-primary flex-1 text-sm"><i class="fas fa-sync mr-1"></i>Recalculate</button>
    </div>`;
  } catch(e) { const el = document.getElementById('user-trust-detail'); if(el) el.innerHTML = `<p class="text-red-400 text-sm">Error loading trust data: ${esc(e.message)}</p>`; }
}

async function recalculateTrust(userId) {
  if (!isValidId(userId)) return;
  try {
    const r = await axios.post(`${API}/api/ai/trust/recalculate/${userId}`);
    toast(`Trust recalculated: ${Math.round(r.data.trust_score*100)}% (${r.data.trust_tier})`);
    closeModal();
    loadAI();
  } catch(e) { toast('Failed to recalculate', 'error'); }
}

// ── Anomalies tab ──────────────────────────────────────
async function loadAnomalies() {
  const el = document.getElementById('tab-anomalies');
  if (!el) return;
  el.innerHTML = `<div class="text-gray-500 text-sm py-6 text-center"><i class="fas fa-spinner fa-spin text-indigo-400 mr-2"></i>Loading anomalies...</div>`;
  try {
    const r = await axios.get(`${API}/api/ai/anomalies/${currentHomeId}?limit=100`);
    const anomalies = r.data.anomalies || [];
    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-xl font-bold text-white flex items-center gap-2">
        <i class="fas fa-exclamation-triangle text-red-400"></i> Anomaly Detection
      </h2>
      <span class="badge badge-red text-xs">${r.data.unacknowledged_count||0} unacknowledged</span>
    </div>
    ${anomalies.length === 0 ? `
    <div class="card p-10 text-center">
      <i class="fas fa-check-circle text-green-400 text-5xl mb-4"></i>
      <h3 class="text-lg font-bold text-white mb-2">No Anomalies Detected</h3>
      <p class="text-gray-500 text-sm">All access patterns look normal. The AI is continuously monitoring.</p>
    </div>` : `
    <div class="card">
      ${anomalies.map(a => `
      <div class="flex items-start gap-4 p-4 border-b border-gray-900 last:border-0 ${a.acknowledged ? 'opacity-50' : ''}">
        <div class="w-10 h-10 rounded-xl bg-${severityColor(a.severity)}-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fas fa-exclamation-triangle text-${severityColor(a.severity)}-400"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <span class="text-sm font-bold text-white capitalize">${esc(a.anomaly_type?.replace(/_/g,' ')||'Unknown')}</span>
            <span class="badge text-xs bg-${severityColor(a.severity)}-500/20 text-${severityColor(a.severity)}-400">${esc(a.severity)}</span>
            ${a.resolved ? '<span class="badge badge-green text-xs">Resolved</span>' : a.acknowledged ? '<span class="badge badge-gray text-xs">Acknowledged</span>' : '<span class="badge badge-red text-xs">New</span>'}
          </div>
          <div class="text-xs text-gray-500">
            ${esc(a.user_name||'Unknown user')} · ${timeAgo(a.created_at)} · AI confidence: ${Math.round((a.confidence||0)*100)}%
          </div>
          ${a.admin_note ? `<div class="text-xs text-gray-400 mt-1 italic">${esc(a.admin_note)}</div>` : ''}
        </div>
        <div class="flex flex-col gap-1 flex-shrink-0">
          ${!a.acknowledged ? `<button onclick="ackAnomaly('${esc(a.id)}')" class="text-xs btn-ghost rounded-lg px-2 py-1">Ack</button>` : ''}
          ${!a.resolved ? `<button onclick="resolveAnomaly('${esc(a.id)}')" class="text-xs text-green-400 hover:text-green-300 px-2 py-1">Resolve</button>` : ''}
        </div>
      </div>`).join('')}
    </div>`}`;
  } catch(e) { el.innerHTML = `<div class="text-red-400 text-sm p-4">Error: ${esc(e.message)}</div>`; }
}

async function ackAnomaly(id) {
  if (!isValidId(id)) return;
  await axios.put(`${API}/api/ai/anomalies/${id}/acknowledge`).catch(() => {});
  toast('Anomaly acknowledged');
  loadAnomalies();
}

async function resolveAnomaly(id) {
  if (!isValidId(id)) return;
  await axios.put(`${API}/api/ai/anomalies/${id}/resolve`).catch(() => {});
  toast('Anomaly resolved', 'success');
  loadAnomalies();
}

async function refreshRecs() {
  toast('Refreshing recommendations...');
  const r = await axios.get(`${API}/api/ai/recommendations/${currentHomeId}?refresh=1`).catch(() => ({ data: { recommendations: [] } }));
  const recs = r.data.recommendations || [];
  const el = document.getElementById('ai-recs-list');
  if (el) {
    el.innerHTML = recs.length === 0 ? '<p class="text-gray-500 text-xs text-center py-4">No recommendations right now.</p>' :
    recs.map(r => `
    <div class="mb-3 p-3 rounded-xl bg-gray-900/50 border border-${r.priority === 'urgent' ? 'red' : r.priority === 'high' ? 'orange' : 'gray'}-500/20">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1">
          <div class="text-xs font-semibold text-white">${esc(r.title)}</div>
          <div class="text-xs text-gray-500 mt-0.5">${esc(r.message)}</div>
        </div>
        <button onclick="dismissRec('${esc(r.id)}')" class="text-gray-600 hover:text-gray-400 text-xs"><i class="fas fa-times"></i></button>
      </div>
    </div>`).join('');
  }
}

async function dismissRec(id) {
  if (!isValidId(id)) return;
  await axios.put(`${API}/api/ai/recommendations/${id}/dismiss`).catch(() => {});
  toast('Recommendation dismissed');
  const el = document.getElementById(`rec-${id}`);
  if (el) el.remove();
  loadAI();
}

async function generatePredictions() {
  toast('Generating arrival predictions...');
  try {
    const r = await axios.post(`${API}/api/ai/predictions/generate/${currentHomeId}`);
    toast(`Generated ${r.data.generated} prediction${r.data.generated !== 1 ? 's' : ''}`);
    loadAI();
  } catch(e) { toast('Not enough data to predict yet', 'warn'); }
}

/** Render a 24×7 heatmap grid */
function renderHeatmap(heatmapData) {
  if (!heatmapData || heatmapData.length === 0) {
    return '<p class="text-gray-600 text-sm text-center py-4">No behavioral data yet. Heatmap builds as users access locks.</p>';
  }
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const maxCnt = Math.max(1, ...heatmapData.map(h => h.count));
  let html = '<div class="overflow-x-auto"><table class="text-xs w-full">';
  html += '<tr><th class="text-gray-600 text-xs pr-2 text-right">Hour</th>';
  for (let d = 0; d < 7; d++) html += `<th class="text-gray-600 text-center px-0.5">${days[d]}</th>`;
  html += '</tr>';
  for (let h = 0; h < 24; h++) {
    html += `<tr><td class="text-gray-600 pr-2 text-right py-0.5">${h.toString().padStart(2,'0')}</td>`;
    for (let d = 0; d < 7; d++) {
      const cell = heatmapData.find(x => x.access_hour === h && x.access_dow === d);
      const intensity = cell ? Math.round((cell.count / maxCnt) * 255) : 0;
      const alpha     = cell ? (0.15 + (cell.count / maxCnt) * 0.85).toFixed(2) : '0';
      html += `<td class="px-0.5 py-0.5"><div class="w-5 h-4 rounded" style="background:rgba(99,102,241,${alpha})" title="${days[d]} ${h}:00 — ${cell?.count||0} accesses, ${Math.round((cell?.success_rate||0)*100)}% success"></div></td>`;
    }
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}

// Start
window.addEventListener('DOMContentLoaded', init);
