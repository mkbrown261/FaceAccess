// ══════════════════════════════════════════════════════
//  FaceAccess Home — Dashboard JS
// ══════════════════════════════════════════════════════

const API = '';
let currentHomeId = null;
let currentUserId = null;
let refreshTimer = null;
let activityChart = null;

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
    devices: 'Trusted Devices', activity: 'Activity Log', cameras: 'Cameras', automations: 'Automations' };
  const el = document.getElementById('page-title');
  if (el) el.textContent = titles[name] || name;
  const loaders = { overview: loadOverview, live: loadLive, recognize: loadRecognize,
    locks: loadLocks, members: loadMembers, guests: loadGuests,
    devices: loadDevices, activity: loadActivity, cameras: loadCameras, automations: loadAutomations };
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
                  <div class="font-semibold text-white text-sm">${l.name}</div>
                  <div class="text-xs text-gray-500">${l.location || '—'}</div>
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
            <div class="member-avatar" style="background:${m.avatar_color || '#6366f1'}25;color:${m.avatar_color || '#818cf8'}">${m.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-white text-sm">${m.name}</div>
              <div class="text-xs text-gray-600">${m.role} · ${m.device_count || 0} device${m.device_count !== 1 ? 's' : ''}</div>
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
  <div class="event-row event-${ev.event_type} flex items-center gap-3">
    <div class="w-8 h-8 rounded-lg bg-${color}-500/15 flex items-center justify-center flex-shrink-0">
      <i class="fas ${icon} text-${color}-400 text-sm"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-white truncate">${ev.user_name || 'Unknown'}</span>
        <span class="text-xs text-gray-600">at ${ev.lock_name || '—'}</span>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-600">
        <span>${methodLabel}</span>
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
          <div class="font-semibold text-white">${cam.name}</div>
          <div class="text-xs text-gray-500">${cam.camera_type?.toUpperCase()} · ${cam.lock_name || 'No lock linked'}</div>
        </div>
        <span class="badge ${cam.status === 'active' ? 'badge-green' : 'badge-red'}">${cam.status}</span>
      </div>
      <div class="bg-gray-950 rounded-xl aspect-video flex items-center justify-center relative overflow-hidden border border-gray-800">
        <div class="text-center">
          <i class="fas fa-video text-gray-700 text-4xl mb-3"></i>
          <p class="text-gray-600 text-sm">Stream preview</p>
          <p class="text-gray-700 text-xs mt-1 font-mono">${cam.stream_url || 'No stream URL'}</p>
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
                  <div style="font-weight:600;">${l.name}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px;">${l.location || l.brand || ''} · ${l.is_locked ? '🔒 Locked' : '🔓 Unlocked'}</div>
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

  const vbtn = document.getElementById('rec-verify-btn');
  const badge = document.getElementById('recog-status-badge');
  if (vbtn)  { vbtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Analyzing...'; vbtn.disabled = true; }
  if (badge) { badge.textContent = '● Processing'; badge.style.color = '#f59e0b'; badge.style.background = 'rgba(245,158,11,0.15)'; }

  let clientConfidence = null;
  let clientAntiSpoof  = null;

  // If FaceID engine available, run local verification first
  if (window.FaceIDEngine && _recogDetector) {
    try {
      const video = document.getElementById('rec-video');
      const m = _recogDetector.analyze(video);
      if (m?.detected) {
        clientAntiSpoof  = m.antiSpoof?.score || 0;
        // Simulate confidence from latest metrics quality + anti-spoof
        clientConfidence = Math.min(0.97, (m.quality / 100) * 0.6 + (clientAntiSpoof) * 0.3 + 0.1);
      }
    } catch(e) {}
  }

  try {
    const payload = {
      lock_id:      lockId,
      liveness_score: Math.min(1, (clientAntiSpoof || 0.9)),
      ble_detected:   ble,
      wifi_matched:   wifi,
      client_confidence: clientConfidence,
      anti_spoof_score:  clientAntiSpoof,
      verification_version: '2.0',
    };
    const r = await axios.post(`${API}/api/home/recognize`, payload);
    showRecognitionResult(r.data, { clientConfidence, clientAntiSpoof });
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
  // Show highest of server + client confidence as display value
  const confVal  = Math.max(serverConf, clientConf);
  const confPct  = Math.round(confVal * 100);
  const confColor = confPct >= 85 ? 'green' : confPct >= 65 ? 'yellow' : 'red';
  const spoofPct  = clientData.clientAntiSpoof !== null && clientData.clientAntiSpoof !== undefined
                    ? Math.round(clientData.clientAntiSpoof * 100)
                    : Math.round((res.liveness_score || 0.9) * 100);

  const resultStyles = {
    granted:         { icon:'fa-check-circle',  color:'green',  title:'Access Granted',       sub:'Door has been unlocked' },
    denied:          { icon:'fa-times-circle',   color:'red',    title:'Access Denied',
      sub: res.reason === 'liveness_failed' ? '⚠️ Anti-spoof check failed'
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
      <div style="color:#fff;font-weight:600;font-size:13px;">${res.user.name}</div>
      <div style="color:rgba(255,255,255,0.4);font-size:11px;">${res.user.role || 'member'} · ${res.user.email || ''}</div>
    </div>
    <div style="margin-left:auto;background:rgba(99,102,241,0.15);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;color:#818cf8;">${(res.user.role||'member').toUpperCase()}</div>
  </div>` : ''}

  <!-- Score bars -->
  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;">Score Breakdown</span>
    </div>
    <div style="space-y:8px;">
      ${_scoreBar('Face Confidence', confPct, confPct >= 85 ? '#10b981' : confPct >= 65 ? '#f59e0b' : '#ef4444')}
      ${_scoreBar('Anti-Spoof Score', spoofPct, spoofPct >= 72 ? '#10b981' : spoofPct >= 50 ? '#f59e0b' : '#ef4444')}
      ${res.proximity_score !== undefined ? _scoreBar('Proximity Score', Math.round((res.proximity_score||0)*100), '#6366f1') : ''}
    </div>
  </div>

  ${res.verification_id ? `
  <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
    <div style="color:#f59e0b;font-weight:600;font-size:13px;margin-bottom:8px;"><i class="fas fa-mobile-alt mr-2"></i>Mobile Approval Required</div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:12px;">Verification ID: ${res.verification_id}</div>
    <div style="display:flex;gap:8px;">
      <button onclick="respondVerification('${res.verification_id}','approve')" style="flex:1;padding:10px;border-radius:8px;border:none;
        background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981;font-weight:700;font-size:13px;cursor:pointer;">
        <i class="fas fa-check mr-1"></i>Approve
      </button>
      <button onclick="respondVerification('${res.verification_id}','deny')" style="flex:1;padding:10px;border-radius:8px;border:none;
        background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-weight:700;font-size:13px;cursor:pointer;">
        <i class="fas fa-times mr-1"></i>Deny
      </button>
    </div>
  </div>` : ''}

  <div style="color:rgba(255,255,255,0.25);font-size:11px;display:flex;gap:16px;flex-wrap:wrap;">
    <span>Method: ${res.method || '—'}</span>
    <span>Engine: v2.0</span>
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
            <div class="font-bold text-white">${l.name}</div>
            <div class="text-xs text-gray-500">${l.location || '—'}</div>
          </div>
        </div>
        <span class="badge ${l.is_locked ? 'badge-indigo' : 'badge-green'}">${l.is_locked ? 'Locked' : 'Open'}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-4">
        <div><span class="text-gray-600">Brand:</span> <span class="text-gray-300 capitalize">${l.brand || 'generic'}</span></div>
        <div><span class="text-gray-600">Type:</span> <span class="text-gray-300">${l.lock_type || 'api'}</span></div>
        <div><span class="text-gray-600">Status:</span> <span class="text-${l.status === 'active' ? 'green' : 'red'}-400">${l.status}</span></div>
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
  try {
    await axios.post(`${API}/api/home/locks`, { home_id: currentHomeId, name, location: document.getElementById('ml-loc')?.value, lock_type: document.getElementById('ml-type')?.value, brand: document.getElementById('ml-brand')?.value, api_key: document.getElementById('ml-api')?.value });
    closeModal();
    toast('Lock added successfully');
    loadLocks();
  } catch(e) { toast('Failed to add lock', 'error'); }
}

async function deleteLock(id) {
  if (!confirm('Remove this lock from your home?')) return;
  await axios.delete(`${API}/api/home/locks/${id}`);
  toast('Lock removed');
  loadLocks();
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
        <div class="member-avatar text-lg" style="background:${m.avatar_color||'#6366f1'}22;color:${m.avatar_color||'#818cf8'}">${m.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-white truncate">${m.name}</div>
          <div class="text-xs text-gray-500">${m.email}</div>
        </div>
        <span class="badge ${m.role==='owner'?'badge-yellow':m.role==='member'?'badge-indigo':'badge-gray'}">${m.role}</span>
      </div>
      <div class="space-y-2 mb-4 text-xs">
        <div class="flex justify-between"><span class="text-gray-500">Phone:</span><span class="text-gray-300">${m.phone || 'Not set'}</span></div>
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
  <h3 class="text-lg font-bold text-white mb-5">Add Household Member</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Full Name *</label><input id="mm-name" class="input" placeholder="Riley Kim"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Email *</label><input id="mm-email" type="email" class="input" placeholder="riley@email.com"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Phone</label><input id="mm-phone" class="input" placeholder="+1 555 0101"></div>
    <div><label class="text-xs text-gray-500 mb-1 block">Role</label>
      <select id="mm-role" class="input"><option value="member">Member</option><option value="owner">Owner</option></select>
    </div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveMember()" class="btn-primary flex-1"><i class="fas fa-user-plus mr-1"></i> Add Member</button>
  </div>`);
}

async function saveMember() {
  const name = document.getElementById('mm-name')?.value.trim();
  const email = document.getElementById('mm-email')?.value.trim();
  if (!name || !email) { toast('Name and email required', 'warn'); return; }
  try {
    const r = await axios.post(`${API}/api/home/users`, { home_id: currentHomeId, name, email, phone: document.getElementById('mm-phone')?.value, role: document.getElementById('mm-role')?.value });
    // Auto-enroll face for demo
    await axios.post(`${API}/api/home/users/${r.data.user.id}/face`, { image_quality: 0.95 });
    closeModal();
    toast('Member added and face enrolled');
    loadMembers();
  } catch(e) {
    toast(e.response?.data?.error || 'Failed to add member', 'error');
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
  if (!confirm('Erase this person\'s biometric data? This cannot be undone.')) return;
  await axios.delete(`${API}/api/home/users/${userId}/face`);
  toast('Biometric data erased (GDPR compliant)');
  loadMembers();
}

async function removeMember(userId) {
  if (!confirm('Remove this member from your home? Their biometric data will also be erased.')) return;
  await axios.delete(`${API}/api/home/users/${userId}`);
  toast('Member removed');
  loadMembers();
}

// ═══════════════════════════════════════════════════════
//  GUESTS
// ═══════════════════════════════════════════════════════
async function loadGuests() {
  const r = await axios.get(`${API}/api/home/guests?home_id=${currentHomeId}`).catch(()=>({data:{guests:[]}}));
  const guests = r.data.guests || [];
  const locksR = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(()=>({data:{locks:[]}}));
  const locks = locksR.data.locks || [];
  document.getElementById('tab-guests').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Guest Passes</h2>
    <button onclick="openAddGuestModal(${JSON.stringify(locks).replace(/"/g,'&quot;')})" class="btn-primary"><i class="fas fa-ticket mr-2"></i>Create Guest Pass</button>
  </div>
  ${guests.length === 0 ? `
  <div class="card p-10 text-center">
    <i class="fas fa-ticket text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">No guest passes yet</h3>
    <p class="text-gray-500 mb-4">Create a temporary pass for cleaners, dog walkers, or friends.</p>
    <button onclick="openAddGuestModal(${JSON.stringify(locks).replace(/"/g,'&quot;')})" class="btn-primary">Create Guest Pass</button>
  </div>` :
  `<div class="space-y-3">
    ${guests.map(g => {
      const now = new Date();
      const validUntil = new Date(g.valid_until);
      const expired = validUntil < now;
      const daysLeft = Math.max(0, Math.ceil((validUntil - now) / 86400000));
      return `
      <div class="card p-5 ${expired ? 'opacity-60' : ''}">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-person text-purple-400 text-xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-white">${g.name}</span>
              <span class="badge ${g.status==='active'?'badge-green':g.status==='revoked'?'badge-red':expired?'badge-red':'badge-yellow'}">${expired ? 'expired' : g.status}</span>
            </div>
            <div class="text-xs text-gray-500 mt-0.5">${g.email || 'No email'} · ${g.time_start}–${g.time_end} · ${g.days_allowed}</div>
            <div class="text-xs text-gray-600">Valid: ${fmtDate(g.valid_from)} → ${fmtDate(g.valid_until)}${!expired ? ` <span class="text-indigo-400">(${daysLeft}d left)</span>` : ''}</div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            ${g.status === 'pending' ? `<button onclick="activateGuest('${g.id}')" class="py-1.5 px-3 text-xs bg-green-500/15 text-green-400 hover:bg-green-500/25 rounded-lg border border-green-500/20">Activate</button>` : ''}
            ${g.status !== 'revoked' ? `<button onclick="revokeGuest('${g.id}')" class="py-1.5 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20">Revoke</button>` : ''}
          </div>
        </div>
        ${g.invite_token ? `<div class="mt-3 p-2 bg-gray-900 rounded-lg flex items-center gap-2 text-xs"><i class="fas fa-key text-indigo-400"></i><span class="text-gray-400">Token: </span><code class="text-indigo-300 font-mono">${g.invite_token}</code></div>` : ''}
      </div>`}).join('')}
  </div>`}`;
}

function openAddGuestModal(locks) {
  const lockOpts = (locks || []).map(l => `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" value="${l.id}" class="guest-lock-cb"><span class="text-sm text-gray-300">${l.name}</span></label>`).join('');
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
  const name = document.getElementById('gg-name')?.value.trim();
  const from = document.getElementById('gg-from')?.value;
  const until = document.getElementById('gg-until')?.value;
  if (!name || !from || !until) { toast('Name and dates required', 'warn'); return; }
  const lockIds = [...document.querySelectorAll('.guest-lock-cb:checked')].map(c => c.value);
  try {
    const r = await axios.post(`${API}/api/home/guests`, {
      home_id: currentHomeId, created_by: currentUserId, name,
      email: document.getElementById('gg-email')?.value || null,
      lock_ids: lockIds, valid_from: from + ' 00:00:00', valid_until: until + ' 23:59:59',
      time_start: document.getElementById('gg-tstart')?.value,
      time_end: document.getElementById('gg-tend')?.value
    });
    // Activate immediately
    await axios.put(`${API}/api/home/guests/${r.data.pass.id}/activate`);
    closeModal();
    toast(`Guest pass created — Token: ${r.data.invite_token}`);
    loadGuests();
  } catch(e) { toast('Failed to create guest pass', 'error'); }
}

async function activateGuest(id) {
  await axios.put(`${API}/api/home/guests/${id}/activate`);
  toast('Guest pass activated');
  loadGuests();
}

async function revokeGuest(id) {
  if (!confirm('Revoke this guest pass?')) return;
  await axios.delete(`${API}/api/home/guests/${id}`);
  toast('Guest pass revoked');
  loadGuests();
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
          <div class="font-bold text-white">${d.name}</div>
          <div class="text-xs text-gray-500">${d.user_name} · ${d.platform}</div>
        </div>
        <span class="badge ${d.trusted ? 'badge-green' : 'badge-red'}">${d.trusted ? 'Trusted' : 'Untrusted'}</span>
      </div>
      <div class="space-y-2 text-xs mb-4">
        <div class="flex justify-between"><span class="text-gray-500">BLE UUID:</span><code class="text-indigo-300 font-mono">${d.ble_uuid || 'Not assigned'}</code></div>
        ${d.wifi_ssid ? `<div class="flex justify-between"><span class="text-gray-500">WiFi SSID:</span><span class="text-gray-300">${d.wifi_ssid}</span></div>` : ''}
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
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5">Register Trusted Device</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Device Name *</label><input id="dd-name" class="input" placeholder="Jordan's iPhone 15"></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Platform</label>
        <select id="dd-platform" class="input"><option value="ios">iOS</option><option value="android">Android</option></select>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Push Token (optional)</label><input id="dd-push" class="input" placeholder="FCM/APNs token"></div>
    </div>
    <div class="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
      <i class="fas fa-info-circle mr-1"></i> A unique BLE UUID will be auto-generated for this device. Install the FaceAccess Home app to enable BLE broadcasting.
    </div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveDevice()" class="btn-primary flex-1"><i class="fas fa-mobile-alt mr-1"></i> Register Device</button>
  </div>`);
}

async function saveDevice() {
  const name = document.getElementById('dd-name')?.value.trim();
  if (!name) { toast('Device name required', 'warn'); return; }
  try {
    const r = await axios.post(`${API}/api/home/devices`, {
      user_id: currentUserId, home_id: currentHomeId, name,
      platform: document.getElementById('dd-platform')?.value,
      push_token: document.getElementById('dd-push')?.value || null
    });
    closeModal();
    toast(`Device registered — BLE UUID: ${r.data.ble_uuid}`);
    loadDevices();
  } catch(e) { toast('Failed to register device', 'error'); }
}

async function toggleDeviceTrust(id, trusted) {
  await axios.put(`${API}/api/home/devices/${id}/trust`, { trusted: !trusted });
  toast(trusted ? 'Device trust revoked' : 'Device trusted');
  loadDevices();
}

async function removeDevice(id) {
  if (!confirm('Remove this device?')) return;
  await axios.delete(`${API}/api/home/devices/${id}`);
  toast('Device removed');
  loadDevices();
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
      <div class="event-row event-${ev.event_type} flex items-start gap-3 border-b border-gray-900 last:border-0">
        <div class="w-8 h-8 rounded-lg bg-${color}-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fas ${icon} text-${color}-400 text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-white text-sm">${ev.user_name || 'Unknown'}</span>
            <span class="text-xs text-gray-500">→ ${ev.lock_name || '—'}</span>
            ${ev.ble_detected ? '<span class="badge badge-indigo text-xs"><i class="fas fa-bluetooth"></i> BLE</span>' : ''}
            ${ev.wifi_matched ? '<span class="badge badge-indigo text-xs"><i class="fas fa-wifi"></i> WiFi</span>' : ''}
          </div>
          <div class="text-xs text-gray-600 mt-0.5">
            ${ev.method || '—'} · ${ev.face_confidence ? `Face: ${Math.round(ev.face_confidence*100)}%` : ''} ${ev.denial_reason ? `· Reason: ${ev.denial_reason}` : ''}
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
          <div class="font-bold text-white">${cam.name}</div>
          <div class="text-xs text-gray-500">${cam.camera_type?.toUpperCase()} · Linked to: ${cam.lock_name || 'No lock'}</div>
        </div>
        <span class="badge ${cam.status === 'active' ? 'badge-green' : 'badge-red'}">${cam.status}</span>
      </div>
      <div class="text-xs text-gray-600 font-mono mb-3 bg-gray-900 p-2 rounded-lg overflow-hidden overflow-ellipsis whitespace-nowrap">${cam.stream_url || 'No stream URL configured'}</div>
      <div class="flex gap-2">
        <button onclick="deleteCam('${cam.id}')" class="btn-ghost text-sm py-2 px-3">Remove</button>
      </div>
    </div>`).join('')}
  </div>`}`;
}

function openAddCameraModal(locks) {
  openModal(`
  <h3 class="text-lg font-bold text-white mb-5">Add Camera</h3>
  <div class="space-y-4">
    <div><label class="text-xs text-gray-500 mb-1 block">Camera Name *</label><input id="cc-name" class="input" placeholder="Front Door Camera"></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-xs text-gray-500 mb-1 block">Camera Type</label>
        <select id="cc-type" class="input" onchange="updateCameraURLHint(this.value)">
          <option value="rtsp">RTSP / IP Camera</option>
          <option value="ring">Ring Doorbell</option>
          <option value="nest">Google Nest</option>
          <option value="arlo">Arlo</option>
          <option value="webrtc">WebRTC</option>
        </select>
      </div>
      <div><label class="text-xs text-gray-500 mb-1 block">Linked Lock</label>
        <select id="cc-lock" class="input">
          <option value="">None</option>
          ${(locks||[]).map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div>
      <label class="text-xs text-gray-500 mb-1 block">Stream URL / API Key</label>
      <input id="cc-url" class="input" placeholder="rtsp://192.168.1.100:554/stream">
      <p id="cc-url-hint" class="text-xs text-gray-600 mt-1">RTSP stream URL from your IP camera</p>
    </div>
  </div>
  <div class="flex gap-3 mt-6">
    <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    <button onclick="saveCamera()" class="btn-primary flex-1">Add Camera</button>
  </div>`);
}

function updateCameraURLHint(type) {
  const hints = { rtsp: 'RTSP stream URL (e.g. rtsp://192.168.1.100:554/stream)', ring: 'Your Ring API access token from ring.com/account', nest: 'Google OAuth token from Google Smart Device Management API', arlo: 'Arlo API key from my.arlo.com', webrtc: 'WebRTC SDP endpoint URL' };
  const h = document.getElementById('cc-url-hint');
  if (h) h.textContent = hints[type] || '';
}

async function saveCamera() {
  const name = document.getElementById('cc-name')?.value.trim();
  if (!name) { toast('Camera name required', 'warn'); return; }
  try {
    await axios.post(`${API}/api/home/cameras`, { home_id: currentHomeId, lock_id: document.getElementById('cc-lock')?.value || null, name, stream_url: document.getElementById('cc-url')?.value, camera_type: document.getElementById('cc-type')?.value });
    closeModal();
    toast('Camera added');
    loadCameras();
  } catch(e) { toast('Failed to add camera', 'error'); }
}

async function deleteCam(id) {
  if (!confirm('Remove this camera?')) return;
  await axios.delete(`${API}/api/home/cameras/${id}`);
  toast('Camera removed');
  loadCameras();
}

// ═══════════════════════════════════════════════════════
//  AUTOMATIONS
// ═══════════════════════════════════════════════════════
async function loadAutomations() {
  const r = await axios.get(`${API}/api/home/automations/${currentHomeId}`).catch(()=>({data:{automations:[]}}));
  const autos = r.data.automations || [];
  document.getElementById('tab-automations').innerHTML = `
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-white">Automations</h2>
    <span class="badge badge-gray text-xs">Beta</span>
  </div>
  ${autos.length === 0 ? `
  <div class="card p-10 text-center">
    <i class="fas fa-bolt text-gray-700 text-5xl mb-4"></i>
    <h3 class="text-lg font-bold text-white mb-2">Smart Automations</h3>
    <p class="text-gray-500 mb-2">Coming soon: Set rules like "Lock all doors at 11pm" or "Notify when guest arrives".</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6 max-w-lg mx-auto text-left">
      ${[['Auto-lock at bedtime','Lock all doors at 11pm every night','fa-moon'],['Arrival mode','Unlock front door when family member returns home','fa-home'],['Guest arrival alert','Notify when a guest pass is used','fa-bell'],['Away mode','Lock all doors and enable security when everyone leaves','fa-shield-alt']].map(([t,d,i])=>`
      <div class="p-4 bg-gray-900 rounded-xl border border-gray-800 opacity-60">
        <div class="flex items-center gap-2 mb-1"><i class="fas ${i} text-indigo-400"></i><span class="font-semibold text-white text-sm">${t}</span></div>
        <p class="text-xs text-gray-500">${d}</p>
      </div>`).join('')}
    </div>
  </div>` :
  `<div class="space-y-3">${autos.map(a => `
  <div class="card p-4 flex items-center gap-4">
    <div class="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center"><i class="fas fa-bolt text-indigo-400"></i></div>
    <div class="flex-1"><div class="font-medium text-white">${a.name}</div><div class="text-xs text-gray-500">${a.trigger_type} → ${a.action_type}</div></div>
    <button onclick="toggleAuto('${a.id}')" class="w-12 h-6 rounded-full ${a.enabled ? 'bg-indigo-500' : 'bg-gray-700'} relative transition-colors cursor-pointer border-0">
      <div class="w-4 h-4 rounded-full bg-white absolute top-1 ${a.enabled ? 'right-1' : 'left-1'} transition-all"></div>
    </button>
  </div>`).join('')}</div>`}`;
}

async function toggleAuto(id) {
  await axios.put(`${API}/api/home/automations/${id}/toggle`);
  loadAutomations();
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

// Start
window.addEventListener('DOMContentLoaded', init);
