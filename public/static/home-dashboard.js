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
//  FACE RECOGNITION TEST
// ═══════════════════════════════════════════════════════
async function loadRecognize() {
  const el = document.getElementById('tab-recognize');
  const locksR = await axios.get(`${API}/api/home/locks?home_id=${currentHomeId}`).catch(() => ({data:{locks:[]}}));
  const locks = locksR.data.locks || [];
  el.innerHTML = `
  <div class="max-w-2xl">
    <h2 class="text-xl font-bold text-white mb-6">Face Recognition Test Console</h2>
    <div class="card p-6 mb-5">
      <div class="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label class="text-xs text-gray-500 mb-1.5 block font-medium">Target Lock</label>
          <select id="recog-lock" class="input">
            ${locks.map(l => `<option value="${l.id}">${l.name} — ${l.location || ''}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1.5 block font-medium">Liveness Score</label>
          <input id="recog-liveness" type="range" min="0" max="1" step="0.01" value="0.95" class="w-full mt-2" oninput="document.getElementById('liveness-val').textContent=parseFloat(this.value).toFixed(2)">
          <div class="text-xs text-gray-500 mt-1">Value: <span id="liveness-val">0.95</span></div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-5">
        <div class="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <input type="checkbox" id="recog-ble" checked class="w-4 h-4">
          <label for="recog-ble" class="text-sm text-blue-300 cursor-pointer"><i class="fas fa-bluetooth mr-1"></i>BLE Detected</label>
        </div>
        <div class="flex items-center gap-3 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
          <input type="checkbox" id="recog-wifi" class="w-4 h-4">
          <label for="recog-wifi" class="text-sm text-cyan-300 cursor-pointer"><i class="fas fa-wifi mr-1"></i>WiFi Matched</label>
        </div>
      </div>

      <!-- Camera preview -->
      <div class="relative mb-5">
        <div class="face-ring mx-auto" style="width:200px;height:200px">
          <video id="rec-video" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;border-radius:50%"></video>
          <div class="scan-line" id="rec-scanline" style="display:none"></div>
          <div id="rec-placeholder" class="absolute inset-0 flex items-center justify-center bg-gray-950 rounded-full">
            <div class="text-center">
              <i class="fas fa-face-meh-blank text-gray-700 text-5xl"></i>
              <p class="text-xs text-gray-600 mt-2">Camera preview</p>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <button onclick="startRecognizeCamera()" class="btn-ghost text-sm py-2.5"><i class="fas fa-camera mr-1"></i> Open Camera</button>
        <button onclick="runRecognition()" class="btn-primary col-span-2 py-2.5"><i class="fas fa-fingerprint mr-2"></i> Run Recognition</button>
      </div>
    </div>

    <!-- Result panel -->
    <div id="recog-result" class="hidden card p-6">
      <h3 class="font-bold text-white mb-4">Recognition Result</h3>
      <div id="recog-result-inner"></div>
    </div>

    <div class="card p-5 mt-5">
      <h3 class="font-semibold text-white mb-3 text-sm">How Two-Factor Authentication Works</h3>
      <div class="space-y-3">
        <div class="flex items-start gap-3 text-sm">
          <div class="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400 text-xs font-bold mt-0.5">1</div>
          <div><span class="text-white font-medium">Face match</span> — Camera identifies you using FaceNet embeddings (confidence threshold: 88%)</div>
        </div>
        <div class="flex items-start gap-3 text-sm">
          <div class="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 text-blue-400 text-xs font-bold mt-0.5">2</div>
          <div><span class="text-white font-medium">Phone proximity</span> — BLE beacon or home WiFi confirms your phone is within 5 meters</div>
        </div>
        <div class="flex items-start gap-3 text-sm">
          <div class="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 text-green-400 text-xs font-bold mt-0.5">3</div>
          <div><span class="text-white font-medium">Auto-unlock</span> — Both factors confirmed → door unlocks instantly, no interaction needed</div>
        </div>
        <div class="flex items-start gap-3 text-sm">
          <div class="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 text-yellow-400 text-xs font-bold mt-0.5">4</div>
          <div><span class="text-white font-medium">Remote approval fallback</span> — Medium confidence or phone not nearby → push notification to approve/deny</div>
        </div>
      </div>
    </div>
  </div>`;
}

let recStream = null;
async function startRecognizeCamera() {
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    const v = document.getElementById('rec-video');
    v.srcObject = recStream;
    document.getElementById('rec-placeholder').style.display = 'none';
    document.getElementById('rec-scanline').style.display = 'block';
  } catch(e) {
    toast('Camera access denied', 'error');
  }
}

async function runRecognition() {
  const lockId = document.getElementById('recog-lock')?.value;
  const liveness = parseFloat(document.getElementById('recog-liveness')?.value || '0.95');
  const ble = document.getElementById('recog-ble')?.checked || false;
  const wifi = document.getElementById('recog-wifi')?.checked || false;
  if (!lockId) { toast('Select a lock first', 'warn'); return; }

  const btn = document.querySelector('[onclick="runRecognition()"]');
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processing...'; btn.disabled = true; }

  try {
    const payload = { lock_id: lockId, liveness_score: liveness, ble_detected: ble, wifi_matched: wifi };
    const r = await axios.post(`${API}/api/home/recognize`, payload);
    showRecognitionResult(r.data);
  } catch(e) {
    toast('Recognition error', 'error');
  } finally {
    if (btn) { btn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i> Run Recognition'; btn.disabled = false; }
  }
}

function showRecognitionResult(res) {
  const panel = document.getElementById('recog-result');
  const inner = document.getElementById('recog-result-inner');
  panel.classList.remove('hidden');

  const confPct = Math.round((res.confidence || 0) * 100);
  const confColor = confPct >= 88 ? 'green' : confPct >= 65 ? 'yellow' : 'red';
  const resultMap = {
    granted: ['fa-check-circle', 'green', 'Access Granted', 'Door has been unlocked'],
    denied: ['fa-times-circle', 'red', 'Access Denied', res.reason === 'liveness_failed' ? '⚠️ Liveness check failed — spoof attempt detected' : res.reason === 'no_match' ? 'Face not recognized' : 'No permission for this door'],
    pending_approval: ['fa-clock', 'yellow', 'Approval Requested', 'Push notification sent to your phone']
  };
  const [icon, color, title, subtitle] = resultMap[res.result] || ['fa-question-circle', 'gray', 'Unknown', ''];

  inner.innerHTML = `
  <div class="flex items-center gap-4 mb-5 p-4 bg-${color}-500/10 border border-${color}-500/20 rounded-xl">
    <div class="w-14 h-14 rounded-2xl bg-${color}-500/20 flex items-center justify-center">
      <i class="fas ${icon} text-${color}-400 text-3xl"></i>
    </div>
    <div>
      <div class="text-xl font-black text-${color}-300">${title}</div>
      <div class="text-sm text-gray-400">${subtitle}</div>
    </div>
  </div>
  ${res.user ? `<div class="mb-4 p-3 bg-gray-900 rounded-xl text-sm"><span class="text-gray-500">Matched: </span><span class="text-white font-semibold">${res.user.name}</span> <span class="badge badge-gray ml-2">${res.user.role || 'member'}</span></div>` : ''}
  <div class="space-y-3">
    <div>
      <div class="flex justify-between text-xs mb-1"><span class="text-gray-500">Face Confidence</span><span class="text-${confColor}-400 font-bold">${confPct}%</span></div>
      <div class="conf-bar"><div class="conf-fill bg-${confColor}-500" style="width:${confPct}%"></div></div>
    </div>
    ${res.proximity_score !== undefined ? `
    <div>
      <div class="flex justify-between text-xs mb-1"><span class="text-gray-500">Proximity Score</span><span class="text-blue-400 font-bold">${Math.round((res.proximity_score||0)*100)}%</span></div>
      <div class="conf-bar"><div class="conf-fill bg-blue-500" style="width:${Math.round((res.proximity_score||0)*100)}%"></div></div>
    </div>` : ''}
  </div>
  ${res.verification_id ? `
  <div class="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
    <p class="text-sm text-yellow-300 font-medium mb-2"><i class="fas fa-mobile-alt mr-1"></i> Approval request sent to mobile app</p>
    <p class="text-xs text-gray-500">Verification ID: ${res.verification_id}</p>
    <div class="flex gap-2 mt-3">
      <button onclick="respondVerification('${res.verification_id}','approve')" class="flex-1 py-2 text-sm bg-green-500/20 border border-green-500/30 text-green-300 rounded-lg hover:bg-green-500/30 transition-colors font-semibold">
        <i class="fas fa-check mr-1"></i> Approve
      </button>
      <button onclick="respondVerification('${res.verification_id}','deny')" class="flex-1 py-2 text-sm bg-red-500/20 border border-red-500/30 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors font-semibold">
        <i class="fas fa-times mr-1"></i> Deny
      </button>
    </div>
  </div>` : ''}
  <div class="mt-4 text-xs text-gray-600 space-y-1">
    <div><span class="text-gray-500">Method:</span> ${res.method || '—'}</div>
    <div><span class="text-gray-500">Timestamp:</span> ${new Date().toLocaleString()}</div>
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
          <i class="fas fa-face-smile mr-1"></i> Enroll Face
        </button>` : `<button onclick="deleteFace('${m.id}')" class="flex-1 py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors">
          <i class="fas fa-trash mr-1"></i> Erase Face
        </button>`}
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
  await axios.post(`${API}/api/home/users/${userId}/face`, { image_quality: 0.96 });
  toast('Face enrolled successfully');
  loadMembers();
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
