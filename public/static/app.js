// FaceAccess Business — Dashboard App
// All business endpoints live under /api/business and require a bearer token.
const API = '/api/business'
let currentPage = 'dashboard'
let charts = {}
let liveRefreshInterval = null
let dashboardRefreshInterval = null
let cameraStream = null
let currentAccount = null   // { id, first_name, last_name, email, role, org:{...} }
let approvalsPoll = null

// Attach the business session token to every API call; on 401 drop back to the auth wall.
axios.interceptors.request.use(cfg => {
  if (cfg.url && cfg.url.startsWith('/api/')) {
    const t = FA_AUTH.getToken('business')
    if (t) { cfg.headers = cfg.headers || {}; cfg.headers.Authorization = `Bearer ${t}` }
  }
  return cfg
})
axios.interceptors.response.use(r => r, err => {
  if (err.response && err.response.status === 401 && err.config && err.config.url && err.config.url.startsWith(API)) {
    FA_AUTH.clearToken('business')
    const wall = document.getElementById('auth-wall')
    if (wall && wall.style.display === 'none') { wall.style.display = 'flex'; toast('Your session expired — please sign in again', 'warning') }
  }
  return Promise.reject(err)
})
const apiErr = (e, fallback = 'Request failed') => (e && e.response && e.response.data && e.response.data.error) || (e && e.message) || fallback
const isAdmin = () => currentAccount && currentAccount.role === 'admin'
const canOperate = () => currentAccount && (currentAccount.role === 'admin' || currentAccount.role === 'operator')
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))

// ─── Navigation ───────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('page-' + page)?.classList.remove('hidden')
  document.getElementById('nav-' + page)?.classList.add('active')
  currentPage = page
  const titles = { dashboard:'Dashboard', live:'Live Monitor', recognize:'Face ID Test',
    users:'User Management', doors:'Doors & Zones', permissions:'Access Permissions', approvals:'Pending Approvals',
    logs:'Access Logs', analytics:'Analytics', attendance:'Attendance', cameras:'Cameras', team:'Team', settings:'Settings' }
  document.getElementById('page-title').textContent = titles[page] || page

  if (dashboardRefreshInterval) { clearInterval(dashboardRefreshInterval); dashboardRefreshInterval = null }
  if (liveRefreshInterval) { clearInterval(liveRefreshInterval); liveRefreshInterval = null }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null }
  // Stop face ID sessions when navigating away
  if (page !== 'recognize' && typeof _recFaceSession !== 'undefined' && _recFaceSession) {
    try { _recFaceSession.stop() } catch(e){} _recFaceSession = null
  }

  if (page === 'dashboard') { loadDashboard(); dashboardRefreshInterval = setInterval(loadDashboard, 15000) }
  else if (page === 'live') { loadLiveMonitor(); liveRefreshInterval = setInterval(loadLiveMonitor, 5000) }
  else if (page === 'recognize') loadRecognize()
  else if (page === 'users') loadUsers()
  else if (page === 'doors') loadDoors()
  else if (page === 'permissions') loadPermissions()
  else if (page === 'approvals') { loadApprovals(); liveRefreshInterval = setInterval(loadApprovals, 5000) }
  else if (page === 'team') loadTeam()
  else if (page === 'logs') loadLogs()
  else if (page === 'analytics') loadAnalytics()
  else if (page === 'attendance') loadAttendance()
  else if (page === 'cameras') loadCameras()
  else if (page === 'settings') loadSettings()
}

// ─── Toast ────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = document.getElementById('toast')
  const icon = document.getElementById('toast-icon')
  document.getElementById('toast-msg').textContent = msg
  icon.className = type === 'success' ? 'text-green-400' : type === 'error' ? 'text-red-400' : 'text-yellow-400'
  icon.innerHTML = type === 'success' ? '<i class="fas fa-check-circle text-lg"></i>' :
    type === 'error' ? '<i class="fas fa-times-circle text-lg"></i>' : '<i class="fas fa-exclamation-circle text-lg"></i>'
  t.classList.remove('hidden'); t.style.opacity = '1'
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.classList.add('hidden'), 300) }, 3000)
}

// ─── Modal ────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html
  document.getElementById('modal-overlay').classList.remove('hidden')
}
function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.add('hidden')
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null }
    // Stop any face enrollment sessions
    if (window._enrollFaceSession) { try { window._enrollFaceSession.stop() } catch(ee){} window._enrollFaceSession = null }
    if (typeof _enrollFaceSession !== 'undefined' && _enrollFaceSession) {
      try { _enrollFaceSession.stop() } catch(ee){} 
      _enrollFaceSession = null
    }
  }
}

// ─── Utilities ───────────────────────────────────────────────
function roleBadge(role) {
  const map = { admin:'badge-admin', manager:'badge-manager', employee:'badge-employee', visitor:'badge-visitor' }
  const icons = { admin:'crown', manager:'briefcase', employee:'user', visitor:'id-badge' }
  return `<span class="badge ${map[role]||'badge-visitor'}"><i class="fas fa-${icons[role]||'user'}"></i> ${role}</span>`
}
function resultBadge(r) {
  return r === 'granted' ? '<span class="badge badge-granted"><i class="fas fa-check"></i> Granted</span>' :
    r === 'denied' ? '<span class="badge badge-denied"><i class="fas fa-times"></i> Denied</span>' :
    '<span class="badge badge-pending"><i class="fas fa-clock"></i> Pending</span>'
}
function secBadge(s) {
  return `<span class="badge badge-${s||'standard'}">${s||'standard'}</span>`
}
function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
}
function confBar(v) {
  const pct = Math.round((v||0) * 100)
  const color = v >= 0.85 ? '#10b981' : v >= 0.65 ? '#f59e0b' : '#ef4444'
  return `<div class="confidence-bar w-24"><div class="confidence-fill" style="width:${pct}%;background:${color}"></div></div>
    <span class="text-xs font-mono ml-1">${pct}%</span>`
}

// ─── DASHBOARD ───────────────────────────────────────────────
async function loadDashboard() {
  const el = document.getElementById('page-dashboard')
  try {
    const { data } = await axios.get(`${API}/analytics/summary`)
    const s = data.summary
    const alerts = s.today_denied + s.pending_2fa

    const alertEl = document.getElementById('alert-badge')
    document.getElementById('alert-count').textContent = alerts
    if (alerts > 0) alertEl.classList.remove('hidden'); else alertEl.classList.add('hidden')

    const orgName = currentAccount?.org?.name || 'your organization'
    const setupNeeded = s.total_users === 0 || s.total_doors === 0
    el.innerHTML = `
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-white">Welcome back, ${esc(currentAccount?.first_name || '')}</h2>
      <p class="text-gray-400 text-sm mt-1">Here's what's happening at ${esc(orgName)}</p>
    </div>
    ${setupNeeded ? `
    <div class="card p-5 mb-6 border-indigo-500/30" style="background:linear-gradient(135deg,rgba(99,102,241,.08),rgba(139,92,246,.05))">
      <h3 class="font-semibold text-white mb-3 flex items-center gap-2"><i class="fas fa-rocket text-indigo-400"></i> Get set up in 3 steps</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${setupStep(1, s.total_doors > 0, 'Add your doors', 'Define the access points you want to protect.', "showPage('doors')")}
        ${setupStep(2, s.total_users > 0, 'Add people', 'Create user records for employees, contractors and visitors.', "showPage('users')")}
        ${setupStep(3, s.registered_faces > 0, 'Enroll faces', 'Capture a face signature for each user from the Users page.', "showPage('users')")}
      </div>
    </div>` : ''}

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statCard('fas fa-users', s.total_users, 'Total Users', '#6366f1', `${s.registered_faces} with face ID`)}
      ${statCard('fas fa-door-open', s.total_doors, 'Active Doors', '#10b981', 'Access points')}
      ${statCard('fas fa-check-circle', s.today_granted, 'Granted Today', '#10b981', 'Access events')}
      ${statCard('fas fa-times-circle', s.today_denied, 'Denied Today', '#ef4444', `${s.pending_2fa} pending 2FA`)}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <!-- Hourly Chart -->
      <div class="card p-5 col-span-2">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-chart-bar text-indigo-400"></i> Access Activity (24h)
        </h3>
        <canvas id="hourlyChart" height="120"></canvas>
      </div>
      <!-- Door activity -->
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-door-open text-indigo-400"></i> Door Activity
        </h3>
        <div class="space-y-3">
          ${(data.by_door||[]).slice(0,5).map(d => `
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-white truncate">${d.door_name}</div>
              <div class="confidence-bar mt-1"><div class="confidence-fill" style="width:${Math.min(100, d.total * 8)}%;background:#6366f1"></div></div>
            </div>
            <div class="text-right">
              <span class="text-green-400 text-sm font-bold">${d.granted}</span>
              <span class="text-gray-500 text-xs">/${d.total}</span>
            </div>
          </div>`).join('') || '<p class="text-gray-500 text-sm text-center py-4">No door activity yet</p>'}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Recent denials -->
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-exclamation-triangle text-red-400"></i> Recent Denials
          <button onclick="showPage('logs')" class="ml-auto text-xs text-indigo-400 hover:text-indigo-300">View All →</button>
        </h3>
        <div class="space-y-2">
          ${(data.recent_denials||[]).map(l => `
          <div class="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
            <div class="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <i class="fas fa-times text-red-400 text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-white">${l.user_name || 'Unknown'}</div>
              <div class="text-xs text-gray-500">${l.door_name} · ${fmtTime(l.timestamp)}</div>
            </div>
            <div class="text-xs text-red-400 font-mono">${l.denial_reason || 'denied'}</div>
          </div>`).join('') || '<p class="text-gray-500 text-sm text-center py-4">No recent denials</p>'}
        </div>
      </div>

      <!-- Top users -->
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-star text-yellow-400"></i> Most Active Today
        </h3>
        <div class="space-y-2">
          ${(data.top_users||[]).map((u, i) => `
          <div class="flex items-center gap-3 p-3 rounded-lg bg-gray-800/30">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style="background:${['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe'][i]}20;color:${['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe'][i]}">
              ${i+1}
            </div>
            <div class="flex-1"><div class="text-sm font-medium text-white">${u.user_name}</div></div>
            <span class="text-xs font-bold text-indigo-400">${u.accesses} accesses</span>
          </div>`).join('') || '<p class="text-gray-500 text-sm text-center py-4">No data today</p>'}
        </div>
      </div>
    </div>`

    // Render hourly chart
    const hourlyData = data.hourly || []
    const labels = Array.from({length:24}, (_,i) => String(i).padStart(2,'0')+':00')
    const grantedData = labels.map((_,i) => {
      const h = hourlyData.find(r => parseInt(r.hour) === i)
      return h ? h.granted : 0
    })
    const totalData = labels.map((_,i) => {
      const h = hourlyData.find(r => parseInt(r.hour) === i)
      return h ? h.total : 0
    })
    const denied = totalData.map((t,i) => t - grantedData[i])

    if (charts.hourly) charts.hourly.destroy()
    const ctx = document.getElementById('hourlyChart').getContext('2d')
    charts.hourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Granted', data:grantedData, backgroundColor:'rgba(16,185,129,0.7)', borderRadius:4 },
          { label:'Denied', data:denied, backgroundColor:'rgba(239,68,68,0.6)', borderRadius:4 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:true,
        plugins:{ legend:{ labels:{ color:'#94a3b8', font:{size:11} } } },
        scales:{
          x:{ stacked:true, ticks:{ color:'#475569', font:{size:10}, maxTicksLimit:12 }, grid:{ color:'#1e293b' } },
          y:{ stacked:true, ticks:{ color:'#475569', font:{size:10} }, grid:{ color:'#1e293b' } }
        }
      }
    })
  } catch(e) { console.error(e); el.innerHTML = `<div class="text-red-400 p-4">Error loading dashboard: ${e.message}</div>` }
}

function setupStep(n, done, title, body, onclick) {
  return `<div onclick="${onclick}" class="p-3 rounded-lg border ${done ? 'border-green-500/30 bg-green-500/5' : 'border-gray-700 bg-gray-800/40 hover:border-indigo-500/50'} cursor-pointer transition-colors">
    <div class="flex items-center gap-2 mb-1">
      <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-green-500 text-black' : 'bg-indigo-500/20 text-indigo-300'}">${done ? '<i class="fas fa-check"></i>' : n}</div>
      <div class="text-sm font-semibold text-white">${title}</div>
    </div>
    <p class="text-xs text-gray-400">${body}</p>
  </div>`
}

function statCard(icon, value, label, color, sub) {
  return `<div class="stat-card">
    <div class="flex items-start justify-between">
      <div>
        <p class="text-gray-400 text-sm">${label}</p>
        <p class="text-3xl font-bold text-white mt-1">${value}</p>
        <p class="text-xs mt-2" style="color:${color}">${sub}</p>
      </div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:${color}20">
        <i class="${icon} text-lg" style="color:${color}"></i>
      </div>
    </div>
  </div>`
}

// ─── LIVE MONITOR ────────────────────────────────────────────
async function loadLiveMonitor() {
  const el = document.getElementById('page-live')
  try {
    const [logsRes, doorsRes] = await Promise.all([
      axios.get(`${API}/logs?limit=20`),
      axios.get(`${API}/doors`)
    ])
    const logs = logsRes.data.logs
    const doors = doorsRes.data.doors

    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Live Access Monitor</h2>
        <p class="text-gray-400 text-sm">Real-time access events · Auto-refresh every 5s</p>
      </div>
      <div class="flex items-center gap-2 text-red-400 text-sm">
        <div class="w-2 h-2 rounded-full bg-red-400 pulse"></div> LIVE
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Camera feeds -->
      <div class="lg:col-span-2 space-y-4">
        <h3 class="font-semibold text-gray-300 flex items-center gap-2">
          <i class="fas fa-video text-indigo-400"></i> Camera Feeds
        </h3>
        <div class="grid grid-cols-2 gap-4">
          ${doors.length === 0 ? '<div class="col-span-2 card p-6 text-center text-gray-500 text-sm">No doors configured. <a onclick="showPage(\'doors\')" class="text-indigo-400 cursor-pointer">Add a door</a></div>' : ''}
          ${doors.slice(0,4).map(d => `
          <div class="camera-feed group">
            <div class="text-center">
              <div class="relative">
                <div class="w-16 h-16 rounded-full bg-gray-800 mx-auto mb-3 flex items-center justify-center border-2 border-gray-700 group-hover:border-indigo-500 transition-colors">
                  <i class="fas fa-camera text-gray-500 text-xl"></i>
                </div>
                <div class="absolute -top-1 -right-1 w-3 h-3 rounded-full ${d.status === 'active' ? 'bg-green-400' : 'bg-red-400'} border-2 border-gray-900"></div>
              </div>
              <p class="text-sm font-medium text-white">${d.name}</p>
              <p class="text-xs text-gray-500">${d.location}</p>
              <div class="mt-2">${secBadge(d.security_level)}</div>
            </div>
            <div class="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-1 rounded-full">
              CAM ${d.id.slice(-3).toUpperCase()}
            </div>
            <div class="absolute top-2 right-2">
              <div class="w-2 h-2 rounded-full ${d.status === 'active' ? 'bg-red-500 pulse' : 'bg-gray-500'}"></div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- Live events feed -->
      <div class="card p-4">
        <h3 class="font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <i class="fas fa-bolt text-yellow-400"></i> Live Events
        </h3>
        <div class="space-y-2 max-h-96 overflow-y-auto pr-1">
          ${logs.map(l => `
          <div class="p-2.5 rounded-lg border-l-2 ${l.result === 'granted' ? 'log-row-granted bg-green-500/5' : 'log-row-denied bg-red-500/5'} mb-1">
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-xs font-bold ${l.result === 'granted' ? 'text-green-400' : 'text-red-400'}">${l.result?.toUpperCase()}</span>
              <span class="text-xs text-gray-600">${fmtTime(l.timestamp)}</span>
            </div>
            <div class="text-xs text-white font-medium">${l.user_name || 'Unknown'}</div>
            <div class="text-xs text-gray-500 truncate">${l.door_name}</div>
            ${l.confidence ? `<div class="flex items-center gap-1 mt-1">${confBar(l.confidence)}</div>` : ''}
          </div>`).join('') || '<p class="text-gray-500 text-sm text-center py-6">No access events yet</p>'}
        </div>
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

// ─── FACE RECOGNITION TEST (Unified FaceAccessCameraEngine) ────────────────
let _recFaceSession = null

function loadRecognize() {
  const el = document.getElementById('page-recognize')

  // Stop any existing session
  if (_recFaceSession) { try { _recFaceSession.stop() } catch(e){} _recFaceSession = null }
  _recCapturedEmbedding = null

  el.innerHTML = `
  <div class="max-w-3xl mx-auto">
    <div class="mb-6">
      <h2 class="text-xl font-bold text-white">Face ID Test Console</h2>
      <p class="text-gray-400 text-sm mt-1">Identify a person against your organization's enrolled faces, exactly as a door terminal would</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- FaceID Engine Panel -->
      <div class="card p-0 overflow-hidden">
        <div class="px-5 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
          <i class="fas fa-eye text-indigo-400 text-lg"></i>
          <div>
            <h3 class="font-semibold text-white text-sm">Face ID Scanner</h3>
            <p class="text-xs text-gray-500">On-device recognition · 128-d face signature · liveness challenge</p>
          </div>
          <div id="rec-engine-status" class="ml-auto flex items-center gap-1.5 text-xs">
            <div class="w-1.5 h-1.5 rounded-full bg-gray-500"></div>
            <span class="text-gray-500">Ready</span>
          </div>
        </div>
        <div id="rec-faceid-mount" class="bg-black"></div>
      </div>

      <!-- Result Panel -->
      <div class="card p-5 flex flex-col gap-4">
        <div>
          <label class="text-xs text-gray-400 mb-1.5 block font-medium">Test at Door</label>
          <select id="rec-door" class="input">
            <option value="">Loading doors…</option>
          </select>
        </div>

        <div id="rec-status-box" class="p-4 rounded-xl bg-gray-800/40 border border-gray-700/40 text-center">
          <div class="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
            <i class="fas fa-camera text-indigo-400 text-xl"></i>
          </div>
          <p class="text-white font-medium text-sm mb-1">Ready to Scan</p>
          <p class="text-gray-400 text-xs">Camera opens automatically. Hold still, then follow head-movement prompts. Click Identify when complete.</p>
        </div>

        <div id="rec-result-card" class="hidden"></div>

        <button onclick="runFaceRecognition()" id="rec-identify-btn" class="btn-primary w-full" disabled>
          <i class="fas fa-fingerprint mr-2"></i> Identify Face
        </button>

        <div class="p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
          <div class="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5">
            <i class="fas fa-info-circle text-indigo-400"></i> How it works
          </div>
          <ol class="text-xs text-gray-500 space-y-1 list-decimal pl-4">
            <li>Allow camera access and hold still inside the oval</li>
            <li>Follow the head-movement prompts (liveness check)</li>
            <li>Select a door above, then click "Identify Face"</li>
            <li>The face signature is compared against every enrolled user in your organization</li>
          </ol>
        </div>
      </div>
    </div>

    <div class="mt-6 card p-5">
      <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
        <i class="fas fa-history text-indigo-400"></i> Test History
      </h3>
      <div id="rec-history" class="space-y-2 max-h-56 overflow-y-auto">
        <p class="text-gray-500 text-sm text-center py-4">No tests run yet</p>
      </div>
    </div>
  </div>`

  // Load doors
  axios.get(`${API}/doors`).then(r => {
    const sel = document.getElementById('rec-door')
    if (sel) sel.innerHTML = '<option value="">— Select Door —</option>' +
      r.data.doors.map(d => `<option value="${d.id}">${d.name} — ${d.security_level}</option>`).join('')
  }).catch(() => {})

  // Mount engine
  _mountRecFaceEngine()
}

let _recCapturedEmbedding = null
let _recCapturedLiveness  = null
let _recCapturedAntiSpoof = null
let _recCapturedQuality   = null

function _mountRecFaceEngine() {
  const mount = document.getElementById('rec-faceid-mount')
  if (!mount) return

  if (!window.FaceAccessCameraEngine) {
    mount.innerHTML = `
      <div class="p-8 text-center">
        <i class="fas fa-exclamation-triangle text-yellow-400 text-3xl mb-3"></i>
        <p class="text-yellow-300 text-sm font-medium">FaceAccessCameraEngine not loaded</p>
        <p class="text-gray-500 text-xs mt-1">Reload the page to initialize the biometric engine</p>
      </div>`
    return
  }

  _recCapturedEmbedding = null
  if (_recFaceSession) { try { _recFaceSession.stop() } catch(e){} _recFaceSession = null }

  const es = document.getElementById('rec-engine-status')
  if (es) es.innerHTML = '<div class="w-1.5 h-1.5 rounded-full bg-indigo-400"></div><span class="text-indigo-400">Scanning…</span>'

  _recFaceSession = window.FaceAccessCameraEngine.createVerificationSession({
    containerId:    'rec-faceid-mount',
    title:          'Face ID Scanner',
    autoStart:      true,
    showRestartBtn: true,
    showCancelBtn:  false,
    onFaceFound: function() {
      if (es) es.innerHTML = '<div class="w-1.5 h-1.5 rounded-full bg-yellow-400"></div><span class="text-yellow-400">Face found — hold still</span>'
    },
    onProgress: function(step, total, stepDef) {
      if (es) es.innerHTML = `<div class="w-1.5 h-1.5 rounded-full bg-indigo-400"></div><span class="text-indigo-400">Step ${step+1}/${total}: ${stepDef && stepDef.label || ''}</span>`
      const sb = document.getElementById('rec-status-box')
      if (sb) sb.innerHTML = `
        <div class="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-sync fa-spin text-indigo-400 text-xl"></i>
        </div>
        <p class="text-indigo-300 font-medium text-sm mb-1">Step ${step+1} of ${total}</p>
        <p class="text-gray-400 text-xs">${stepDef && stepDef.instruction || ''}</p>`
    },
    onComplete: function(result) {
      _recCapturedEmbedding = result.descriptor || result.embedding
      _recCapturedLiveness  = result.livenessScore
      _recCapturedAntiSpoof = result.antiSpoofScore
      _recCapturedQuality   = result.quality

      const btn = document.getElementById('rec-identify-btn')
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i> Identify Face' }

      const sb = document.getElementById('rec-status-box')
      if (sb) sb.innerHTML = `
        <div class="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-check text-green-400 text-xl"></i>
        </div>
        <p class="text-green-400 font-semibold text-sm mb-1">✓ Biometric Scan Complete!</p>
        <p class="text-gray-400 text-xs">Quality: ${result.quality}% · Liveness: ${Math.round(result.livenessScore*100)}% · ${result.capturedAngles || 0} samples captured</p>`

      if (es) es.innerHTML = '<div class="w-1.5 h-1.5 rounded-full bg-green-400"></div><span class="text-green-400">Scan Ready</span>'
      toast('Biometric scan complete — select a door and click Identify!', 'success')
    },
    onError: function(err) {
      if (err && err.code === 'cancelled') return
      if (es) es.innerHTML = '<div class="w-1.5 h-1.5 rounded-full bg-red-400"></div><span class="text-red-400">Error</span>'
      toast('Camera error: ' + (err && err.message || 'unknown'), 'error')
    }
  })
}


async function runFaceRecognition() {
  const btn = document.getElementById('rec-identify-btn')
  const doorSel = document.getElementById('rec-door')
  const door_id = doorSel?.value

  if (!door_id) { toast('Please select a door first', 'error'); return }
  if (!_recCapturedEmbedding) { toast('Complete the face scan first', 'error'); return }

  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Analyzing…'

  try {
    const { data } = await axios.post(`${API}/recognize`, {
      door_id,
      descriptor:      _recCapturedEmbedding,
      liveness_score:  _recCapturedLiveness,
      image_quality:  (_recCapturedQuality || 0) / 100,
      device_info: { ua: navigator.userAgent, source: 'face_id_test_console' }
    })

    renderRecognitionResult(data, door_id)
    _addRecHistory(data, doorSel?.options[doorSel.selectedIndex]?.text)

    // Reset for next scan
    _recCapturedEmbedding = null
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i> Identify Face'

    setTimeout(() => _mountRecFaceEngine(), 1200)

  } catch(e) {
    toast('Recognition error: ' + apiErr(e), 'error')
    btn.disabled = !_recCapturedEmbedding
    btn.innerHTML = '<i class="fas fa-fingerprint mr-2"></i> Identify Face'
  }
}

function _addRecHistory(data, doorName) {
  const hist = document.getElementById('rec-history')
  if (!hist) return
  const pct   = Math.round((data.confidence || 0) * 100)
  const color = data.result === 'granted' ? '#10b981' : data.result === 'denied' ? '#ef4444' : '#f59e0b'
  const icon  = data.result === 'granted' ? 'fa-check-circle' : data.result === 'denied' ? 'fa-times-circle' : 'fa-clock'
  const time  = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
  const empty = hist.querySelector('p')
  if (empty) empty.remove()
  const item = document.createElement('div')
  item.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:${color}08;border:1px solid ${color}20;`
  item.innerHTML = `
    <i class="fas ${icon} text-sm" style="color:${color}"></i>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:700;color:${color}">${data.result?.toUpperCase().replace('_',' ')}</span>
        <span style="font-size:10px;color:#64748b">${time}</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${data.user?.name || 'No match'} · ${doorName || ''}</div>
    </div>
    <span style="font-size:12px;font-weight:700;font-family:monospace;color:${color}">${pct}%</span>`
  hist.insertBefore(item, hist.firstChild)
  while (hist.children.length > 10) hist.removeChild(hist.lastChild)
}


function renderRecognitionResult(data, doorId) {
  const sel = document.getElementById('rec-door')
  const doorName = sel ? sel.options[sel.selectedIndex]?.text : doorId
  // Support both old #rec-result and new #rec-result-card
  const el = document.getElementById('rec-result-card') || document.getElementById('rec-result')
  if (!el) return

  // Show the result card
  el.classList.remove('hidden')

  const pct = Math.round((data.confidence||0) * 100)
  const color = data.result === 'granted' ? '#10b981' : data.result === 'denied' ? '#ef4444' : '#f59e0b'
  const icon = data.result === 'granted' ? 'fa-check-circle' : data.result === 'denied' ? 'fa-times-circle' : 'fa-clock'

  let content = `
  <div class="p-4 rounded-xl border" style="background:${color}10;border-color:${color}30">
    <div class="flex items-center gap-3 mb-3">
      <i class="fas ${icon} text-2xl" style="color:${color}"></i>
      <div>
        <div class="font-bold text-white text-lg">${data.result?.toUpperCase().replace('_',' ')}</div>
        <div class="text-xs text-gray-400">${doorName}</div>
      </div>
    </div>`

  if (data.user) {
    content += `
    <div class="flex items-center gap-3 p-2 bg-gray-800/50 rounded-lg mb-3">
      <div class="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
        <i class="fas fa-user text-indigo-400 text-sm"></i>
      </div>
      <div>
        <div class="text-sm font-medium text-white">${data.user.name}</div>
        <div class="text-xs text-gray-400">${data.user.role} · ID: ${data.user.id}</div>
      </div>
    </div>`
  }

  if (data.confidence !== undefined) {
    content += `
    <div class="mb-2">
      <div class="flex justify-between text-xs text-gray-400 mb-1">
        <span>Match Confidence</span><span>${pct}%</span>
      </div>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`
  }

  if (data.reason) {
    const reasons = { no_match:'No enrolled user matches this face', ambiguous_match:'Two enrolled users are too similar — re-enroll with better lighting',
      no_enrolled_users:'No users have enrolled faces yet', no_permission:'Access not permitted for this door',
      outside_hours:'Outside allowed access hours', liveness_failed:'Liveness check failed — possible spoof attempt',
      door_inactive:'This door is inactive', rate_limited:'Too many attempts at this door — wait 60 seconds' }
    content += `<div class="text-xs mt-2 p-2 bg-gray-800/50 rounded" style="color:${color}">
      <i class="fas fa-info-circle mr-1"></i> ${reasons[data.reason] || data.reason}</div>`
  }

  if (data.result === 'pending_2fa') {
    content += `<div class="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
      <i class="fas fa-user-check mr-1"></i> Step-up verification required. An operator must approve this entry from the <a onclick="showPage('approvals')" class="underline cursor-pointer">Approvals</a> page.
      <div class="mt-1 text-gray-500">Verification ID: <code class="font-mono">${data.verification_id}</code></div>
      <button onclick="checkVerification('${data.verification_id}')" class="mt-2 w-full btn-ghost py-1 text-xs">Check Status</button>
    </div>`
  }

  content += `</div>`
  el.innerHTML = content
}

async function checkVerification(id) {
  try {
    const { data } = await axios.get(`${API}/verify/${id}`)
    toast(`Verification: ${data.status}${data.expired ? ' (expired)' : ''}`,
      data.status === 'approved' ? 'success' : data.status === 'pending' ? 'warning' : 'error')
  } catch(e) { toast('Error checking verification', 'error') }
}

// ─── USERS ───────────────────────────────────────────────────
async function loadUsers(filter = 'all') {
  const el = document.getElementById('page-users')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const params = filter !== 'all' ? `?role=${filter}` : ''
    const { data } = await axios.get(`${API}/users${params}`)
    const users = data.users
    const enrolled = users.filter(u => u.face_registered).length

    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">User Management</h2>
        <p class="text-gray-400 text-sm">${users.length} users · ${enrolled} with Face ID</p>
      </div>
      ${canOperate() ? `<button onclick="openAddUserModal()" class="btn-primary"><i class="fas fa-user-plus mr-2"></i> Add User</button>` : ''}
    </div>

    <!-- Filters -->
    <div class="flex gap-2 mb-5 flex-wrap">
      ${['all','employee','manager','admin','contractor','visitor'].map(r => `
      <button onclick="loadUsers('${r}')" class="btn-ghost text-sm py-1.5 px-4 ${filter===r?'border-indigo-500 text-indigo-400':''}">${r.charAt(0).toUpperCase()+r.slice(1)}</button>`).join('')}
    </div>

    <div class="card overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-800">
            <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">User</th>
            <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Role</th>
            <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden md:table-cell">Department</th>
            <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden lg:table-cell">Face ID</th>
            <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Status</th>
            <th class="text-right text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
          <tr class="table-row border-b border-gray-800/50">
            <td class="p-4">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0" style="background:${colorForRole(u.role)}20;color:${colorForRole(u.role)}">
                  ${esc(u.name.split(' ').map(n=>n[0]).join('').slice(0,2))}
                </div>
                <div>
                  <div class="font-medium text-white text-sm">${esc(u.name)}</div>
                  <div class="text-xs text-gray-500">${esc(u.email)}${u.employee_id ? ' · #' + esc(u.employee_id) : ''}</div>
                </div>
              </div>
            </td>
            <td class="p-4">${roleBadge(u.role)}</td>
            <td class="p-4 hidden md:table-cell text-sm text-gray-400">${esc(u.department||'—')}</td>
            <td class="p-4 hidden lg:table-cell">
              ${u.face_registered ? `<span class="text-green-400 text-xs"><i class="fas fa-check-circle mr-1"></i>Enrolled${u.face_sample_count ? ' · ' + u.face_sample_count + ' samples' : ''}</span>`
                : '<span class="text-gray-500 text-xs"><i class="fas fa-times-circle mr-1"></i>Not enrolled</span>'}
            </td>
            <td class="p-4">
              <span class="badge ${u.status==='active'?'badge-granted':'badge-denied'}">${u.status}</span>
            </td>
            <td class="p-4 text-right">
              ${canOperate() ? `<div class="flex items-center justify-end gap-2">
                <button onclick="openRegisterFaceModal('${u.id}',${JSON.stringify(u.name).replace(/"/g,'&quot;')})" class="text-indigo-400 hover:text-indigo-300 text-xs px-2 py-1 rounded border border-indigo-800 hover:border-indigo-600 transition-colors" title="${u.face_registered ? 'Re-enroll face' : 'Enroll face'}">
                  <i class="fas fa-camera mr-1"></i>${u.face_registered ? 'Re-enroll' : 'Enroll'}
                </button>
                ${u.face_registered ? `<button onclick="eraseFace('${u.id}',${JSON.stringify(u.name).replace(/"/g,'&quot;')})" class="text-yellow-400 hover:text-yellow-300 text-xs px-2 py-1 rounded border border-yellow-900 hover:border-yellow-700 transition-colors" title="Erase biometric data"><i class="fas fa-eraser"></i></button>` : ''}
                <button onclick="openEditUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})" class="text-gray-400 hover:text-white text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteUser('${u.id}',${JSON.stringify(u.name).replace(/"/g,'&quot;')})" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors">
                  <i class="fas fa-trash"></i>
                </button>
              </div>` : '<span class="text-xs text-gray-600">view only</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${users.length === 0 ? `<div class="text-center text-gray-500 py-10">
          <i class="fas fa-users text-3xl text-gray-700 mb-3"></i>
          <p class="text-sm">No users yet.</p>
          ${canOperate() ? '<p class="text-xs mt-1">Click <b>Add User</b> to create your first person, then enroll their face.</p>' : ''}
        </div>` : ''}
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

function colorForRole(role) {
  return { admin:'#f59e0b', manager:'#818cf8', employee:'#10b981', contractor:'#22d3ee', visitor:'#94a3b8' }[role] || '#6366f1'
}

async function eraseFace(id, name) {
  if (!confirm(`Erase the stored face signature for ${name}? They will need to re-enroll.`)) return
  try { await axios.delete(`${API}/users/${id}/face`); toast('Biometric data erased'); loadUsers() }
  catch(e) { toast(apiErr(e), 'error') }
}

function openAddUserModal() {
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5 flex items-center gap-2">
      <i class="fas fa-user-plus text-indigo-400"></i> Register New User
    </h3>
    <p class="text-xs text-gray-400 mb-4">Create the person record first, then enroll their face on the next step.</p>
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Full Name *</label>
        <input id="add-name" class="input" placeholder="e.g. John Smith" autofocus>
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Email *</label>
        <input id="add-email" type="email" class="input" placeholder="john.smith@company.com">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Role *</label>
          <select id="add-role" class="input">
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
            <option value="contractor">Contractor</option>
            <option value="visitor">Visitor</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Department</label>
          <input id="add-dept" class="input" placeholder="Engineering">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Phone</label>
          <input id="add-phone" type="tel" class="input" placeholder="+1-555-0100">
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Employee ID</label>
          <input id="add-empid" class="input" placeholder="EMP-0042">
        </div>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitAddUser()" class="btn-primary flex-1">
        <i class="fas fa-check mr-2"></i> Create & Enroll Face
      </button>
    </div>
  </div>`)
}

async function submitAddUser() {
  const name = document.getElementById('add-name').value.trim()
  const email = document.getElementById('add-email').value.trim()
  const role = document.getElementById('add-role').value
  const department = document.getElementById('add-dept').value.trim()
  const phone = document.getElementById('add-phone').value.trim()
  const employee_id = document.getElementById('add-empid').value.trim()
  if (!name || !email) { toast('Name and email required', 'error'); return }
  try {
    const { data } = await axios.post(`${API}/users`, { name, email, role, department, phone, employee_id })
    closeModal()
    toast(`${name} added`)
    loadUsers()
    setTimeout(() => openRegisterFaceModal(data.user.id, name), 400)
  } catch(e) { toast(apiErr(e), 'error') }
}

let _enrollFaceSession = null

function openRegisterFaceModal(userId, userName) {
  // Stop any existing session
  if (_enrollFaceSession) { try { _enrollFaceSession.stop() } catch(e){} _enrollFaceSession = null }

  openModal(`
  <div style="max-width:420px;width:100%">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center">
        <i class="fas fa-fingerprint text-indigo-400 text-lg"></i>
      </div>
      <div>
        <h3 class="text-lg font-bold text-white">Register Face ID</h3>
        <p class="text-xs text-gray-400">${userName}</p>
      </div>
    </div>

    <!-- FaceID Engine mounts here -->
    <div id="enroll-faceid-mount" class="rounded-xl overflow-hidden bg-black mb-4"></div>

    <div id="enroll-status" class="hidden p-3 rounded-xl text-sm text-center mb-4"></div>

    <div class="flex gap-3">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
    </div>
  </div>`)

  // Wait for modal DOM to render, then mount FaceID engine
  setTimeout(() => {
    if (!window.FaceAccessCameraEngine) {
      const mount = document.getElementById('enroll-faceid-mount')
      if (mount) mount.innerHTML = `
        <div class="p-6 text-center">
          <i class="fas fa-exclamation-triangle text-yellow-400 text-2xl mb-2"></i>
          <p class="text-yellow-300 text-sm">FaceAccessCameraEngine not loaded</p>
          <p class="text-gray-500 text-xs mt-1">Reload the page</p>
        </div>`
      return
    }

    _enrollFaceSession = window.FaceAccessCameraEngine.createEnrollmentSession({
      containerId:    'enroll-faceid-mount',
      title:          'Face ID Enrollment',
      autoStart:      true,
      showRestartBtn: true,
      showCancelBtn:  true,
      onSkip: function() { closeModal() },
      onComplete: async function(result) {
        const statusEl = document.getElementById('enroll-status')
        if (statusEl) {
          statusEl.className = 'p-3 rounded-xl text-sm text-center mb-4 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300'
          statusEl.textContent = 'Saving biometric data…'
          statusEl.classList.remove('hidden')
        }

        try {
          const { data } = await axios.post(`${API}/users/${userId}/face`, {
            descriptor:     result.descriptor,
            descriptors:    result.descriptors,
            quality:        result.averageQuality,
            liveness_score: result.livenessScore,
            engine:         result.engine
          })

          if (statusEl) {
            statusEl.className = 'p-3 rounded-xl text-sm text-center mb-4 bg-green-500/10 border border-green-500/20 text-green-400'
            statusEl.innerHTML = `<i class="fas fa-check-circle mr-1"></i> ${data.message} · ${data.sample_count} samples · Quality ${Math.round(result.averageQuality)}%`
          }

          toast(`Face enrolled for ${userName}`)
          if (currentPage === 'users') setTimeout(() => { closeModal(); loadUsers() }, 1400)
          else setTimeout(() => closeModal(), 1400)

        } catch(e) {
          if (statusEl) {
            statusEl.className = 'p-3 rounded-xl text-sm text-center mb-4 bg-red-500/10 border border-red-500/20 text-red-400'
            statusEl.innerHTML = `<i class="fas fa-times-circle mr-1"></i> ${esc(apiErr(e))}`
            statusEl.classList.remove('hidden')
          }
          toast('Enrollment failed: ' + apiErr(e), 'error')
        }
      },
      onError: function(err) {
        if (err && err.code === 'cancelled') { closeModal(); return }
        const statusEl = document.getElementById('enroll-status')
        if (statusEl && err) {
          statusEl.className = 'p-3 rounded-xl text-sm text-center mb-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300'
          statusEl.textContent = err.message || 'Scan interrupted'
          statusEl.classList.remove('hidden')
        }
      }
    })
  }, 100)
}

function openEditUserModal(user) {
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5 flex items-center gap-2">
      <i class="fas fa-edit text-indigo-400"></i> Edit User
    </h3>
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Full Name</label>
        <input id="edit-name" class="input" value="${user.name||''}">
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Email</label>
        <input id="edit-email" type="email" class="input" value="${user.email||''}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Role</label>
          <select id="edit-role" class="input">
            ${['employee','manager','admin','contractor','visitor'].map(r => `<option value="${r}" ${user.role===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Status</label>
          <select id="edit-status" class="input">
            <option value="active" ${user.status==='active'?'selected':''}>Active</option>
            <option value="inactive" ${user.status==='inactive'?'selected':''}>Inactive</option>
            <option value="suspended" ${user.status==='suspended'?'selected':''}>Suspended</option>
          </select>
        </div>
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Department</label>
        <input id="edit-dept" class="input" value="${user.department||''}">
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">Phone</label>
        <input id="edit-phone" class="input" value="${user.phone||''}">
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitEditUser('${user.id}')" class="btn-primary flex-1">Save Changes</button>
    </div>
  </div>`)
}

async function submitEditUser(id) {
  const name = document.getElementById('edit-name').value
  const email = document.getElementById('edit-email').value
  const role = document.getElementById('edit-role').value
  const status = document.getElementById('edit-status').value
  const department = document.getElementById('edit-dept').value
  const phone = document.getElementById('edit-phone').value
  try {
    await axios.put(`${API}/users/${id}`, { name, email, role, status, department, phone })
    closeModal(); toast('User updated'); loadUsers()
  } catch(e) { toast(apiErr(e), 'error') }
}

async function deleteUser(id, name) {
  if (!confirm(`Remove ${name}? Their biometric data will be erased.`)) return
  try {
    await axios.delete(`${API}/users/${id}`)
    toast(`${name} removed and biometric data erased`)
    loadUsers()
  } catch(e) { toast(apiErr(e), 'error') }
}

// ─── DOORS ───────────────────────────────────────────────────
async function loadDoors() {
  const el = document.getElementById('page-doors')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const { data } = await axios.get(`${API}/doors`)
    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Doors & Access Zones</h2>
        <p class="text-gray-400 text-sm">${data.doors.length} access points configured</p>
      </div>
      ${canOperate() ? `<button onclick="openAddDoorModal()" class="btn-primary"><i class="fas fa-plus mr-2"></i> Add Door</button>` : ''}
    </div>
    ${data.doors.length === 0 ? `<div class="card p-10 text-center text-gray-500">
        <i class="fas fa-door-open text-3xl text-gray-700 mb-3"></i>
        <p class="text-sm">No doors yet. A door is any access point you want to protect — a lobby entrance, server room, warehouse gate.</p>
      </div>` : ''}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${data.doors.map(d => `
      <div class="door-card ${d.status==='active'?'unlocked':'locked'}">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:${d.security_level==='critical'?'#ef444420':d.security_level==='high'?'#f59e0b20':'#6366f120'}">
            <i class="fas fa-door-open text-lg" style="color:${d.security_level==='critical'?'#ef4444':d.security_level==='high'?'#f59e0b':'#6366f1'}"></i>
          </div>
          <div class="flex items-center gap-2">
            ${secBadge(d.security_level)}
            ${d.requires_2fa ? '<span class="badge" style="background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.2)"><i class="fas fa-mobile-alt"></i> 2FA</span>' : ''}
          </div>
        </div>
        <h3 class="font-semibold text-white">${esc(d.name)}</h3>
        <p class="text-sm text-gray-400 mt-0.5">${esc(d.location)}</p>
        ${d.floor ? `<p class="text-xs text-gray-600 mt-0.5">Floor ${d.floor}${d.building ? ' · ' + d.building : ''}</p>` : ''}
        <div class="flex items-center justify-between mt-4 pt-3 border-t border-gray-800">
          <span class="badge ${d.status==='active'?'badge-granted':'badge-denied'}">${d.status}</span>
          <div class="flex gap-2">
            ${canOperate() ? `<button onclick="openEditDoorModal(${JSON.stringify(d).replace(/"/g,'&quot;')})" class="text-gray-400 hover:text-white text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-500"><i class="fas fa-edit"></i></button>` : ''}
            ${isAdmin() ? `<button onclick="deleteDoor('${d.id}',${JSON.stringify(d.name).replace(/"/g,'&quot;')})" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </div>
      </div>`).join('')}
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

function openAddDoorModal() {
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5"><i class="fas fa-door-open text-indigo-400 mr-2"></i>Add Door</h3>
    <div class="space-y-4">
      <div><label class="text-xs text-gray-400 mb-1 block">Door Name *</label><input id="d-name" class="input" placeholder="e.g. Server Room" autofocus></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Location *</label><input id="d-loc" class="input" placeholder="Building A - Basement"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Floor</label><input id="d-floor" class="input" placeholder="1st"></div>
        <div><label class="text-xs text-gray-400 mb-1 block">Building</label><input id="d-bldg" class="input" placeholder="Building A"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Security Level</label>
          <select id="d-sec" class="input">
            <option value="low">Low</option><option value="standard" selected>Standard</option>
            <option value="high">High</option><option value="critical">Critical</option>
          </select>
        </div>
        <div class="flex items-center gap-3 pt-5">
          <input type="checkbox" id="d-2fa" class="w-4 h-4">
          <label for="d-2fa" class="text-sm text-gray-300">Require 2FA</label>
        </div>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitAddDoor()" class="btn-primary flex-1"><i class="fas fa-plus mr-1"></i> Add Door</button>
    </div>
  </div>`)
}

async function submitAddDoor() {
  const name = document.getElementById('d-name').value.trim()
  const location = document.getElementById('d-loc').value.trim()
  if (!name || !location) { toast('Name and location required', 'error'); return }
  try {
    await axios.post(`${API}/doors`, {
      name, location,
      floor: document.getElementById('d-floor').value,
      building: document.getElementById('d-bldg').value,
      security_level: document.getElementById('d-sec').value,
      requires_2fa: document.getElementById('d-2fa').checked
    })
    closeModal(); toast('Door added'); loadDoors()
  } catch(e) { toast(apiErr(e), 'error') }
}

function openEditDoorModal(door) {
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5"><i class="fas fa-edit text-indigo-400 mr-2"></i>Edit Door</h3>
    <div class="space-y-4">
      <div><label class="text-xs text-gray-400 mb-1 block">Name</label><input id="ed-name" class="input" value="${door.name||''}"></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Location</label><input id="ed-loc" class="input" value="${door.location||''}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Security Level</label>
          <select id="ed-sec" class="input">
            ${['low','standard','high','critical'].map(s => `<option value="${s}" ${door.security_level===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs text-gray-400 mb-1 block">Status</label>
          <select id="ed-status" class="input">
            <option value="active" ${door.status==='active'?'selected':''}>Active</option>
            <option value="inactive" ${door.status!=='active'?'selected':''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <input type="checkbox" id="ed-2fa" class="w-4 h-4" ${door.requires_2fa?'checked':''}>
        <label for="ed-2fa" class="text-sm text-gray-300">Require Two-Factor Authentication</label>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitEditDoor('${door.id}')" class="btn-primary flex-1">Save</button>
    </div>
  </div>`)
}

async function submitEditDoor(id) {
  try {
    await axios.put(`${API}/doors/${id}`, {
      name: document.getElementById('ed-name').value,
      location: document.getElementById('ed-loc').value,
      security_level: document.getElementById('ed-sec').value,
      status: document.getElementById('ed-status').value,
      requires_2fa: document.getElementById('ed-2fa').checked
    })
    closeModal(); toast('Door updated'); loadDoors()
  } catch(e) { toast(apiErr(e), 'error') }
}

async function deleteDoor(id, name) {
  if (!confirm(`Deactivate door "${name}"?`)) return
  try {
    await axios.delete(`${API}/doors/${id}`)
    toast('Door deactivated'); loadDoors()
  } catch(e) { toast(apiErr(e), 'error') }
}

// ─── PERMISSIONS ─────────────────────────────────────────────
async function loadPermissions(role = 'all') {
  const el = document.getElementById('page-permissions')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const params = role !== 'all' ? `?role=${role}` : ''
    const { data } = await axios.get(`${API}/permissions${params}`)
    const perms = data.permissions
    const overrides = data.user_overrides || []

    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Access Permissions</h2>
        <p class="text-gray-400 text-sm">${perms.length} role rules · ${overrides.length} per-user overrides</p>
      </div>
      ${canOperate() ? `<div class="flex gap-2">
        <button onclick="openAddUserPermModal()" class="btn-ghost"><i class="fas fa-user-lock mr-2"></i> User Override</button>
        <button onclick="openAddPermModal()" class="btn-primary"><i class="fas fa-plus mr-2"></i> Add Rule</button>
      </div>` : ''}
    </div>
    <p class="text-xs text-gray-500 mb-4"><i class="fas fa-info-circle mr-1"></i> A person is granted access when a rule exists for their <b>role</b> at that door, or when they have a per-user override. No rule = no access.</p>

    <!-- Role filter tabs -->
    <div class="flex gap-2 mb-5 flex-wrap">
      ${['all','employee','manager','admin','contractor','visitor'].map(r => `
      <button onclick="loadPermissions('${r}')" class="btn-ghost text-sm py-1.5 px-4 ${role===r?'border-indigo-500 text-indigo-400':''}">${r==='all'?'All Roles':roleBadge(r)}</button>`).join('')}
    </div>

    <div class="card overflow-hidden">
      <table class="w-full">
        <thead><tr class="border-b border-gray-800">
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Role</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Door</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden md:table-cell">Access Hours</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden lg:table-cell">Days</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">2FA</th>
          <th class="text-right text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Action</th>
        </tr></thead>
        <tbody>
          ${perms.map(p => `
          <tr class="table-row border-b border-gray-800/50">
            <td class="p-4">${roleBadge(p.role)}</td>
            <td class="p-4">
              <div class="text-sm font-medium text-white">${p.door_name}</div>
              <div class="text-xs text-gray-500">${p.door_location||''}</div>
            </td>
            <td class="p-4 hidden md:table-cell">
              <span class="text-xs font-mono text-gray-300">${p.time_start}–${p.time_end}</span>
            </td>
            <td class="p-4 hidden lg:table-cell">
              <span class="text-xs text-gray-400">${formatDays(p.days_allowed)}</span>
            </td>
            <td class="p-4">
              ${p.requires_2fa ? '<span class="badge" style="background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.2)"><i class="fas fa-mobile-alt"></i> Required</span>'
                : '<span class="text-gray-600 text-xs">—</span>'}
            </td>
            <td class="p-4 text-right">
              ${canOperate() ? `<button onclick="deletePerm('${p.id}')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors"><i class="fas fa-trash mr-1"></i> Remove</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${perms.length === 0 ? '<div class="text-center text-gray-500 py-8">No role rules yet. Add a rule so people can be granted access.</div>' : ''}
    </div>

    ${overrides.length ? `
    <h3 class="font-semibold text-white mt-8 mb-3 flex items-center gap-2"><i class="fas fa-user-lock text-indigo-400"></i> Per-user overrides</h3>
    <div class="card overflow-hidden">
      <table class="w-full">
        <thead><tr class="border-b border-gray-800">
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">User</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Door</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden md:table-cell">Hours</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Valid</th>
          <th class="text-right text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Action</th>
        </tr></thead>
        <tbody>
          ${overrides.map(o => `
          <tr class="table-row border-b border-gray-800/50">
            <td class="p-4 text-sm text-white">${esc(o.user_name || o.user_id)}</td>
            <td class="p-4 text-sm text-gray-300">${esc(o.door_name || o.door_id)}</td>
            <td class="p-4 hidden md:table-cell text-xs font-mono text-gray-300">${o.time_start || '00:00'}–${o.time_end || '23:59'} · ${formatDays(o.days_allowed)}</td>
            <td class="p-4 text-xs text-gray-400">${o.valid_from ? fmtTime(o.valid_from) : 'now'} → ${o.valid_until ? fmtTime(o.valid_until) : 'no expiry'}</td>
            <td class="p-4 text-right">${canOperate() ? `<button onclick="deleteUserPerm('${o.id}')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700"><i class="fas fa-trash"></i></button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

async function openAddUserPermModal() {
  const [usersRes, doorsRes] = await Promise.all([axios.get(`${API}/users`), axios.get(`${API}/doors`)])
  const users = usersRes.data.users, doors = doorsRes.data.doors
  if (!users.length || !doors.length) { toast('Add at least one user and one door first', 'warning'); return }
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5"><i class="fas fa-user-lock text-indigo-400 mr-2"></i>Per-User Override</h3>
    <div class="space-y-4">
      <div><label class="text-xs text-gray-400 mb-1 block">User *</label>
        <select id="up-user" class="input">${users.map(u => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('')}</select></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Door *</label>
        <select id="up-door" class="input">${doors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">From</label><input id="up-start" type="time" class="input" value="00:00"></div>
        <div><label class="text-xs text-gray-400 mb-1 block">Until</label><input id="up-end" type="time" class="input" value="23:59"></div>
      </div>
      <div><label class="text-xs text-gray-400 mb-1 block">Expires (optional)</label><input id="up-until" type="datetime-local" class="input"></div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitUserPerm()" class="btn-primary flex-1">Save Override</button>
    </div>
  </div>`)
}
async function submitUserPerm() {
  try {
    const until = document.getElementById('up-until').value
    await axios.post(`${API}/permissions/user`, {
      user_id: document.getElementById('up-user').value,
      door_id: document.getElementById('up-door').value,
      time_start: document.getElementById('up-start').value,
      time_end: document.getElementById('up-end').value,
      days_allowed: 'mon,tue,wed,thu,fri,sat,sun',
      valid_until: until ? new Date(until).toISOString() : null
    })
    closeModal(); toast('Override saved'); loadPermissions()
  } catch(e) { toast(apiErr(e), 'error') }
}
async function deleteUserPerm(id) {
  if (!confirm('Remove this override?')) return
  try { await axios.delete(`${API}/permissions/user/${id}`); toast('Override removed'); loadPermissions() }
  catch(e) { toast(apiErr(e), 'error') }
}

function formatDays(days) {
  if (!days) return '—'
  const all = ['mon','tue','wed','thu','fri','sat','sun']
  const d = days.split(',')
  if (d.length === 7) return 'Every day'
  if (JSON.stringify(d) === JSON.stringify(['mon','tue','wed','thu','fri'])) return 'Weekdays'
  return d.map(x => x.charAt(0).toUpperCase()+x.slice(1)).join(', ')
}

async function openAddPermModal() {
  const [doorsRes] = await Promise.all([axios.get(`${API}/doors`)])
  const doors = doorsRes.data.doors
  if (!doors.length) { toast('Add a door first', 'warning'); return }

  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5"><i class="fas fa-shield-alt text-indigo-400 mr-2"></i>Add Permission Rule</h3>
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Role *</label>
          <select id="p-role" class="input">
            <option value="employee">Employee</option><option value="manager">Manager</option>
            <option value="admin">Admin</option><option value="contractor">Contractor</option><option value="visitor">Visitor</option>
          </select>
        </div>
        <div><label class="text-xs text-gray-400 mb-1 block">Door *</label>
          <select id="p-door" class="input">
            ${doors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">From</label><input id="p-start" type="time" class="input" value="07:00"></div>
        <div><label class="text-xs text-gray-400 mb-1 block">Until</label><input id="p-end" type="time" class="input" value="20:00"></div>
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-2 block">Days Allowed</label>
        <div class="flex gap-2 flex-wrap">
          ${['mon','tue','wed','thu','fri','sat','sun'].map(d => `
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" name="days" value="${d}" class="w-3 h-3" ${['mon','tue','wed','thu','fri'].includes(d)?'checked':''}>
            <span class="text-xs text-gray-300">${d.charAt(0).toUpperCase()+d.slice(1)}</span>
          </label>`).join('')}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <input type="checkbox" id="p-2fa" class="w-4 h-4">
        <label for="p-2fa" class="text-sm text-gray-300">Require 2FA for this rule</label>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitAddPerm()" class="btn-primary flex-1">Add Rule</button>
    </div>
  </div>`)
}

async function submitAddPerm() {
  const days = Array.from(document.querySelectorAll('input[name="days"]:checked')).map(c => c.value)
  try {
    await axios.post(`${API}/permissions`, {
      role: document.getElementById('p-role').value,
      door_id: document.getElementById('p-door').value,
      time_start: document.getElementById('p-start').value,
      time_end: document.getElementById('p-end').value,
      days_allowed: days.join(','),
      requires_2fa: document.getElementById('p-2fa').checked
    })
    closeModal(); toast('Permission saved'); loadPermissions()
  } catch(e) { toast(apiErr(e), 'error') }
}

async function deletePerm(id) {
  if (!confirm('Remove this permission rule?')) return
  try {
    await axios.delete(`${API}/permissions/${id}`)
    toast('Permission removed'); loadPermissions()
  } catch(e) { toast(apiErr(e), 'error') }
}

// ─── LOGS ────────────────────────────────────────────────────
let logsPage = 0
async function loadLogs(result = '') {
  const el = document.getElementById('page-logs')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const params = result ? `?result=${result}&limit=100` : '?limit=100'
    const { data } = await axios.get(`${API}/logs${params}`)
    const logs = data.logs

    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Access Logs</h2>
        <p class="text-gray-400 text-sm">${data.total} total entries</p>
      </div>
      <div class="flex gap-2">
        <button onclick="exportLogs()" class="btn-ghost text-sm"><i class="fas fa-file-csv mr-1"></i> Export CSV</button>
        <button onclick="loadLogs()" class="btn-ghost text-sm"><i class="fas fa-sync mr-1"></i> Refresh</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex gap-2 mb-5 flex-wrap">
      ${['','granted','denied'].map(r => `
      <button onclick="loadLogs('${r}')" class="btn-ghost text-sm py-1.5 px-4 ${result===r?'border-indigo-500 text-indigo-400':''}">${r||'All Events'}</button>`).join('')}
    </div>

    <div class="card overflow-hidden">
      <table class="w-full">
        <thead><tr class="border-b border-gray-800">
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Time</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">User</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Door</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden md:table-cell">Method</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden lg:table-cell">Confidence</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Result</th>
        </tr></thead>
        <tbody>
          ${logs.map(l => `
          <tr class="table-row border-b border-gray-800/50 ${l.result==='denied'?'log-row-denied':'log-row-granted'}">
            <td class="p-4 text-xs text-gray-400 font-mono whitespace-nowrap">${fmtTime(l.timestamp)}</td>
            <td class="p-4">
              <div class="text-sm font-medium text-white">${esc(l.user_name||'Unknown')}</div>
              ${l.denial_reason ? `<div class="text-xs text-red-400">${l.denial_reason}</div>` : ''}
            </td>
            <td class="p-4 text-sm text-gray-300">${esc(l.door_name||l.door_id)}</td>
            <td class="p-4 hidden md:table-cell">
              <span class="text-xs font-mono text-gray-400 bg-gray-800 px-2 py-0.5 rounded">${l.method||'face'}</span>
              ${l.requires_2fa ? '<span class="text-xs text-yellow-500 ml-1"><i class="fas fa-mobile-alt"></i></span>' : ''}
            </td>
            <td class="p-4 hidden lg:table-cell">
              <div class="flex items-center gap-2">
                ${l.confidence ? confBar(l.confidence) : '<span class="text-gray-600 text-xs">—</span>'}
              </div>
            </td>
            <td class="p-4">${resultBadge(l.result)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${logs.length === 0 ? '<div class="text-center text-gray-500 py-8">No access events yet. Events appear here when a face is scanned at a door.</div>' : ''}
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

async function exportLogs() {
  try {
    const r = await axios.get(`${API}/logs/export`, { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a'); a.href = url; a.download = `access-logs-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch(e) { toast(apiErr(e), 'error') }
}

// ─── ANALYTICS ───────────────────────────────────────────────
async function loadAnalytics() {
  const el = document.getElementById('page-analytics')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const { data } = await axios.get(`${API}/analytics/summary`)
    const s = data.summary

    el.innerHTML = `
    <div class="mb-6">
      <h2 class="text-xl font-bold text-white">Analytics Dashboard</h2>
      <p class="text-gray-400 text-sm">System performance and access insights</p>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statCard('fas fa-check-circle', s.today_granted, 'Granted Today', '#10b981', 'Successful entries')}
      ${statCard('fas fa-times-circle', s.today_denied, 'Denied Today', '#ef4444', 'Blocked attempts')}
      ${statCard('fas fa-chart-line', s.access_24h, 'Events (24h)', '#6366f1', 'Total activity')}
      ${statCard('fas fa-mobile-alt', s.pending_2fa, 'Pending 2FA', '#f59e0b', 'Awaiting approval')}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4"><i class="fas fa-chart-bar text-indigo-400 mr-2"></i>Hourly Activity</h3>
        <canvas id="analyticsHourly" height="140"></canvas>
      </div>
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4"><i class="fas fa-door-open text-indigo-400 mr-2"></i>Door Traffic</h3>
        <canvas id="analyticsDoor" height="140"></canvas>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="card p-5">
        <h3 class="font-semibold text-white mb-4"><i class="fas fa-chart-pie text-indigo-400 mr-2"></i>Access Rate</h3>
        <canvas id="analyticsRate" width="200" height="200"></canvas>
        <div class="flex justify-center gap-6 mt-4 text-sm">
          <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-green-500"></div><span class="text-gray-400">Granted ${s.today_granted}</span></div>
          <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-red-500"></div><span class="text-gray-400">Denied ${s.today_denied}</span></div>
        </div>
      </div>

      <div class="card p-5 col-span-2">
        <h3 class="font-semibold text-white mb-4"><i class="fas fa-exclamation-triangle text-red-400 mr-2"></i>Recent Security Events</h3>
        <div class="space-y-2">
          ${(data.recent_denials||[]).map(l => `
          <div class="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
            <i class="fas fa-times-circle text-red-400"></i>
            <div class="flex-1">
              <div class="text-sm font-medium text-white">${l.user_name||'Unknown'} — ${l.door_name}</div>
              <div class="text-xs text-gray-500">${fmtTime(l.timestamp)} · ${l.denial_reason||'denied'} · conf: ${Math.round((l.confidence||0)*100)}%</div>
            </div>
          </div>`).join('') || '<p class="text-gray-500 text-sm">No recent events</p>'}
        </div>
      </div>
    </div>`

    // Render charts
    const hourlyData = data.hourly || []
    const labels = Array.from({length:24}, (_,i) => String(i).padStart(2,'0'))
    const grantedData = labels.map((_,i) => { const h = hourlyData.find(r => parseInt(r.hour) === i); return h ? h.granted : 0 })
    const totalData = labels.map((_,i) => { const h = hourlyData.find(r => parseInt(r.hour) === i); return h ? h.total : 0 })

    if (charts.aHourly) charts.aHourly.destroy()
    charts.aHourly = new Chart(document.getElementById('analyticsHourly').getContext('2d'), {
      type:'line', data:{ labels, datasets:[
        { label:'Granted', data:grantedData, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.1)', fill:true, tension:0.4, pointRadius:0 },
        { label:'Total', data:totalData, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.05)', fill:true, tension:0.4, pointRadius:0 }
      ]},
      options:{ responsive:true, plugins:{ legend:{ labels:{ color:'#94a3b8', font:{size:11} } } },
        scales:{ x:{ ticks:{ color:'#475569', font:{size:9} }, grid:{ color:'#1e293b' } }, y:{ ticks:{ color:'#475569' }, grid:{ color:'#1e293b' } } } }
    })

    const doorData = data.by_door || []
    if (charts.aDoor) charts.aDoor.destroy()
    charts.aDoor = new Chart(document.getElementById('analyticsDoor').getContext('2d'), {
      type:'bar', data:{ labels: doorData.map(d => d.door_name.split(' ').slice(0,2).join(' ')),
        datasets:[
          { label:'Granted', data:doorData.map(d=>d.granted), backgroundColor:'rgba(16,185,129,0.7)', borderRadius:4 },
          { label:'Denied', data:doorData.map(d=>d.denied), backgroundColor:'rgba(239,68,68,0.6)', borderRadius:4 }
        ]},
      options:{ responsive:true, plugins:{ legend:{ labels:{ color:'#94a3b8', font:{size:11} } } },
        scales:{ x:{ ticks:{ color:'#475569', font:{size:10} }, grid:{ color:'#1e293b' } }, y:{ ticks:{ color:'#475569' }, grid:{ color:'#1e293b' } } } }
    })

    const total = s.today_granted + s.today_denied
    if (charts.aRate) charts.aRate.destroy()
    charts.aRate = new Chart(document.getElementById('analyticsRate').getContext('2d'), {
      type:'doughnut', data:{ labels:['Granted','Denied'], datasets:[{
        data:[ total > 0 ? s.today_granted : 1, total > 0 ? s.today_denied : 1 ],
        backgroundColor:['rgba(16,185,129,0.8)','rgba(239,68,68,0.8)'], borderWidth:0
      }]},
      options:{ cutout:'70%', responsive:false, plugins:{ legend:{ display:false } } }
    })
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

// ─── ATTENDANCE ───────────────────────────────────────────────
async function loadAttendance() {
  const el = document.getElementById('page-attendance')
  el.innerHTML = `<div class="text-gray-400 text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const { data } = await axios.get(`${API}/analytics/attendance`)
    el.innerHTML = `
    <div class="mb-6">
      <h2 class="text-xl font-bold text-white">Employee Attendance</h2>
      <p class="text-gray-400 text-sm">Attendance tracking from access log data</p>
    </div>
    <div class="card overflow-hidden">
      <table class="w-full">
        <thead><tr class="border-b border-gray-800">
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Employee</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Role</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden md:table-cell">Department</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Days Present</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4 hidden lg:table-cell">Last Access</th>
          <th class="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider p-4">Total Events</th>
        </tr></thead>
        <tbody>
          ${data.attendance.map(a => `
          <tr class="table-row border-b border-gray-800/50">
            <td class="p-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style="background:${colorForRole(a.role)}20;color:${colorForRole(a.role)}">
                  ${a.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
                </div>
                <span class="text-sm font-medium text-white">${a.name}</span>
              </div>
            </td>
            <td class="p-4">${roleBadge(a.role)}</td>
            <td class="p-4 hidden md:table-cell text-sm text-gray-400">${a.department||'—'}</td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <span class="text-lg font-bold text-white">${a.days_present||0}</span>
                <span class="text-xs text-gray-500">days</span>
              </div>
            </td>
            <td class="p-4 hidden lg:table-cell text-sm text-gray-400">${a.last_access ? fmtTime(a.last_access) : '—'}</td>
            <td class="p-4 text-sm font-bold text-indigo-400">${a.total_accesses||0}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${data.attendance.length === 0 ? '<div class="text-center text-gray-500 py-8">No attendance data yet — it is derived from granted access events.</div>' : ''}
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

// ─── CAMERAS ─────────────────────────────────────────────────
async function loadCameras() {
  const el = document.getElementById('page-cameras')
  try {
    const { data } = await axios.get(`${API}/cameras`)
    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Camera Management</h2>
        <p class="text-gray-400 text-sm">${data.cameras.length} cameras configured</p>
      </div>
      ${canOperate() ? `<button onclick="openAddCameraModal()" class="btn-primary"><i class="fas fa-plus mr-2"></i> Add Camera</button>` : ''}
    </div>
    ${data.cameras.length === 0 ? `<div class="card p-10 text-center text-gray-500 text-sm">
        <i class="fas fa-camera text-3xl text-gray-700 mb-3"></i>
        <p>No cameras registered. Register the terminals/cameras at each door so heartbeats and access events can be attributed to a device.</p>
        <p class="text-xs mt-2 text-gray-600">Recognition itself runs in the browser of the device at the door — any laptop, tablet or kiosk with a webcam works.</p>
      </div>` : ''}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${data.cameras.map(c => `
      <div class="card p-5">
        <div class="flex items-start gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-camera text-indigo-400"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-white text-sm truncate">${esc(c.name)}</h3>
            <p class="text-xs text-gray-400">${esc(c.location)}</p>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full ${c.status==='active'?'bg-green-400 pulse':'bg-gray-600'}"></div>
            <span class="text-xs text-gray-400">${c.status}</span>
          </div>
        </div>
        <div class="space-y-2 text-xs">
          <div class="flex justify-between"><span class="text-gray-500">Type</span><span class="text-gray-300 font-mono uppercase">${c.camera_type}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Linked Door</span><span class="text-gray-300">${c.door_name||'Unlinked'}</span></div>
          ${c.stream_url ? `<div class="flex justify-between"><span class="text-gray-500">Stream</span><span class="text-gray-300 font-mono truncate text-right ml-2" style="max-width:150px">${c.stream_url.replace('rtsp://','')}</span></div>` : ''}
          ${c.last_heartbeat ? `<div class="flex justify-between"><span class="text-gray-500">Last ping</span><span class="text-gray-300">${fmtTime(c.last_heartbeat)}</span></div>` : ''}
        </div>
        ${canOperate() ? `<div class="flex justify-end mt-4 pt-3 border-t border-gray-800">
          <button onclick="deleteCamera('${c.id}',${JSON.stringify(c.name).replace(/"/g,'&quot;')})" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700"><i class="fas fa-trash mr-1"></i> Remove</button>
        </div>` : ''}
      </div>`).join('')}
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

async function openAddCameraModal() {
  const { data } = await axios.get(`${API}/doors`)
  openModal(`
  <div>
    <h3 class="text-xl font-bold text-white mb-5"><i class="fas fa-camera text-indigo-400 mr-2"></i>Add Camera</h3>
    <div class="space-y-4">
      <div><label class="text-xs text-gray-400 mb-1 block">Camera Name *</label><input id="c-name" class="input" placeholder="Main Entrance Camera"></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Location *</label><input id="c-loc" class="input" placeholder="Building A - Lobby"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Type</label>
          <select id="c-type" class="input"><option value="browser">Browser / Kiosk webcam</option><option value="usb">USB Camera</option><option value="ip">IP Camera</option><option value="rtsp">RTSP Stream</option><option value="onvif">ONVIF</option></select>
        </div>
        <div><label class="text-xs text-gray-400 mb-1 block">Linked Door</label>
          <select id="c-door" class="input">
            <option value="">— Unlinked —</option>
            ${data.doors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div><label class="text-xs text-gray-400 mb-1 block">Stream URL (optional)</label><input id="c-stream" class="input" placeholder="rtsp://192.168.1.x:554/stream1"></div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-ghost flex-1">Cancel</button>
      <button onclick="submitAddCamera()" class="btn-primary flex-1">Add Camera</button>
    </div>
  </div>`)
}

async function submitAddCamera() {
  const name = document.getElementById('c-name').value.trim()
  const location = document.getElementById('c-loc').value.trim()
  if (!name || !location) { toast('Name and location required', 'error'); return }
  try {
    await axios.post(`${API}/cameras`, {
      name, location, camera_type: document.getElementById('c-type').value,
      door_id: document.getElementById('c-door').value || null,
      stream_url: document.getElementById('c-stream').value || null
    })
    closeModal(); toast('Camera added'); loadCameras()
  } catch(e) { toast(apiErr(e), 'error') }
}
async function deleteCamera(id, name) {
  if (!confirm(`Remove camera "${name}"?`)) return
  try { await axios.delete(`${API}/cameras/${id}`); toast('Camera removed'); loadCameras() }
  catch(e) { toast(apiErr(e), 'error') }
}

// ─── APPROVALS (2FA pending verifications) ───────────────────
async function loadApprovals() {
  const el = document.getElementById('page-approvals')
  if (!el) return
  try {
    const { data } = await axios.get(`${API}/verify/pending`)
    const pending = data.pending || []
    updateApprovalsBadge(pending.length)
    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Pending Approvals</h2>
        <p class="text-gray-400 text-sm">Medium-confidence matches waiting for a human decision. Auto-refreshes every 5 seconds.</p>
      </div>
      <button onclick="loadApprovals()" class="btn-secondary"><i class="fas fa-sync-alt mr-2"></i>Refresh</button>
    </div>
    ${pending.length === 0 ? `
      <div class="card p-10 text-center text-gray-400">
        <i class="fas fa-check-circle text-4xl text-green-500/60 mb-3"></i>
        <div class="text-white font-medium">Nothing waiting</div>
        <div class="text-sm mt-1">When a face match falls between your medium and high thresholds it will appear here for approval.</div>
      </div>` : `
      <div class="grid gap-3">
        ${pending.map(p => {
          const secsLeft = Math.max(0, Math.round((new Date(p.expires_at.replace(' ','T')+'Z') - Date.now())/1000))
          return `
          <div class="card p-4 flex flex-col md:flex-row md:items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400 text-xl"><i class="fas fa-user-clock"></i></div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-white truncate">${esc(p.user_name || 'Unknown user')}</div>
              <div class="text-xs text-gray-400">${esc(p.door_name || p.door_id)} · ${fmtTime(p.created_at)}</div>
              <div class="text-xs text-gray-500 mt-1 flex items-center gap-2">Confidence ${confBar(p.confidence)}</div>
            </div>
            <div class="text-xs ${secsLeft < 30 ? 'text-red-400' : 'text-gray-400'} font-mono"><i class="fas fa-hourglass-half mr-1"></i>${secsLeft}s left</div>
            ${canOperate() ? `
            <div class="flex gap-2">
              <button onclick="respondApproval('${p.id}','approve')" class="btn-primary"><i class="fas fa-check mr-1"></i>Approve</button>
              <button onclick="respondApproval('${p.id}','deny')" class="btn-danger"><i class="fas fa-times mr-1"></i>Deny</button>
            </div>` : `<span class="text-xs text-gray-500">Viewer — cannot respond</span>`}
          </div>`
        }).join('')}
      </div>`}`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

async function respondApproval(id, action) {
  try {
    await axios.post(`${API}/verify/${id}/respond`, { action })
    toast(action === 'approve' ? 'Access approved' : 'Access denied', action === 'approve' ? 'success' : 'warning')
    loadApprovals()
  } catch(e) { toast(apiErr(e), 'error') }
}

function updateApprovalsBadge(n) {
  const b = document.getElementById('approvals-badge')
  if (!b) return
  if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.classList.remove('hidden') }
  else b.classList.add('hidden')
}

async function pollApprovalsBadge() {
  try {
    const { data } = await axios.get(`${API}/verify/pending`)
    updateApprovalsBadge((data.pending || []).length)
  } catch(e) { /* ignore — 401 handled by interceptor */ }
}

// ─── TEAM (organization accounts & invitations) ──────────────
const ORG_ROLE_HELP = {
  admin: 'Full control: settings, team, people, doors, permissions.',
  operator: 'Day-to-day operations: manage people, doors, enrollments, approvals.',
  viewer: 'Read-only: dashboards, logs and analytics.'
}
function orgRoleBadge(role) {
  const cls = role === 'admin' ? 'badge-admin' : role === 'operator' ? 'badge-manager' : 'badge-visitor'
  const icon = role === 'admin' ? 'crown' : role === 'operator' ? 'user-cog' : 'eye'
  return `<span class="badge ${cls}"><i class="fas fa-${icon}"></i> ${esc(role)}</span>`
}

async function loadTeam() {
  const el = document.getElementById('page-team')
  if (!el) return
  try {
    const [{ data }, { data: orgData }] = await Promise.all([axios.get(`${API}/team`), axios.get(`${API}/org`)])
    const members = data.members || []
    const invitations = data.invitations || []
    const org = orgData.org || {}
    el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-white">Team</h2>
        <p class="text-gray-400 text-sm">People who can sign in to <span class="text-white">${esc(org.name || 'your organization')}</span>'s console. Separate from the people you enroll for door access.</p>
      </div>
      ${isAdmin() ? `<button onclick="openInviteModal()" class="btn-primary"><i class="fas fa-user-plus mr-2"></i>Invite Team Member</button>` : ''}
    </div>

    <div class="card overflow-hidden mb-6">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-gray-400 border-b border-gray-800">
          <th class="px-4 py-3">Member</th><th class="px-4 py-3">Role</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Last Login</th><th class="px-4 py-3 text-right">Actions</th>
        </tr></thead>
        <tbody>
          ${members.map(m => {
            const me = currentAccount && m.id === currentAccount.id
            return `
            <tr class="border-b border-gray-800/60 hover:bg-gray-800/30">
              <td class="px-4 py-3">
                <div class="font-medium text-white">${esc(m.first_name)} ${esc(m.last_name)} ${me ? '<span class="text-xs text-indigo-400 ml-1">(you)</span>' : ''}</div>
                <div class="text-xs text-gray-500">${esc(m.email)}</div>
              </td>
              <td class="px-4 py-3">${orgRoleBadge(m.role)}</td>
              <td class="px-4 py-3">${m.status === 'active' ? '<span class="badge badge-granted">active</span>' : `<span class="badge badge-denied">${esc(m.status)}</span>`}</td>
              <td class="px-4 py-3 text-gray-400 text-xs">${m.last_login ? fmtTime(m.last_login) : 'Never'} <span class="text-gray-600">· ${m.login_count || 0} logins</span></td>
              <td class="px-4 py-3 text-right">
                ${isAdmin() && !me ? `
                  <button onclick="openEditMemberModal('${m.id}')" class="text-gray-400 hover:text-white mr-2" title="Edit"><i class="fas fa-pen"></i></button>` : ''}
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="card p-5">
      <h3 class="font-semibold text-white mb-1"><i class="fas fa-envelope-open-text text-indigo-400 mr-2"></i>Pending Invitations</h3>
      <p class="text-xs text-gray-500 mb-4">Invitations expire after 7 days. Share the link directly — email delivery is not configured in this deployment.</p>
      ${invitations.length === 0 ? `<div class="text-sm text-gray-500">No pending invitations.</div>` : `
      <div class="space-y-2">
        ${invitations.map(i => `
          <div class="flex items-center gap-3 p-3 bg-gray-800/30 rounded-lg">
            <div class="flex-1 min-w-0">
              <div class="text-sm text-white truncate">${esc(i.email)}</div>
              <div class="text-xs text-gray-500">${orgRoleBadge(i.role)} · expires ${fmtTime(i.expires_at)}</div>
            </div>
            ${isAdmin() ? `<button onclick="revokeInvite('${i.id}')" class="text-red-400 hover:text-red-300 text-sm" title="Revoke"><i class="fas fa-trash"></i></button>` : ''}
          </div>`).join('')}
      </div>`}
    </div>`
    window._teamMembers = members
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

function openInviteModal() {
  openModal(`
    <h3 class="text-lg font-bold text-white mb-1">Invite Team Member</h3>
    <p class="text-xs text-gray-400 mb-4">They will join <b class="text-white">${esc(currentAccount?.org?.name || 'your organization')}</b> with the role you choose.</p>
    <div class="space-y-3">
      <div><label class="text-xs text-gray-400 mb-1 block">Email</label><input id="inv-email" type="email" class="input" placeholder="colleague@company.com"></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Role</label>
        <select id="inv-role" class="input" onchange="document.getElementById('inv-role-help').textContent=ORG_ROLE_HELP[this.value]">
          <option value="operator">Operator</option><option value="viewer">Viewer</option><option value="admin">Admin</option>
        </select>
        <div id="inv-role-help" class="text-xs text-gray-500 mt-1">${ORG_ROLE_HELP.operator}</div>
      </div>
      <div id="inv-err" class="hidden text-xs text-red-400"></div>
      <div id="inv-result" class="hidden"></div>
      <div class="flex gap-2 pt-2" id="inv-actions">
        <button onclick="submitInvite()" class="btn-primary flex-1"><i class="fas fa-paper-plane mr-2"></i>Create Invitation</button>
        <button onclick="document.getElementById('modal-overlay').classList.add('hidden')" class="btn-secondary">Cancel</button>
      </div>
    </div>`)
}

async function submitInvite() {
  const email = document.getElementById('inv-email').value.trim()
  const role = document.getElementById('inv-role').value
  const err = document.getElementById('inv-err')
  if (!FA_AUTH.validEmail(email)) { err.textContent = 'Enter a valid email'; err.classList.remove('hidden'); return }
  err.classList.add('hidden')
  try {
    const { data } = await axios.post(`${API}/team/invite`, { email, role })
    const inv = data.invitation
    const url = inv.invite_url && inv.invite_url.startsWith('http') ? inv.invite_url : `${location.origin}/?invite=${inv.token}`
    const res = document.getElementById('inv-result')
    res.classList.remove('hidden')
    res.innerHTML = `
      <div class="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
        <div class="text-xs text-green-400 font-medium mb-2"><i class="fas fa-check mr-1"></i>Invitation created — send this link to ${esc(email)}</div>
        <div class="flex gap-2">
          <input id="inv-url" class="input text-xs font-mono" readonly value="${esc(url)}">
          <button onclick="copyInviteUrl()" class="btn-secondary whitespace-nowrap"><i class="fas fa-copy mr-1"></i>Copy</button>
        </div>
        <div class="text-[11px] text-gray-500 mt-2">Expires ${fmtTime(inv.expires_at)}.</div>
      </div>`
    document.getElementById('inv-actions').innerHTML = `<button onclick="document.getElementById('modal-overlay').classList.add('hidden')" class="btn-primary flex-1">Done</button>`
    loadTeam()
  } catch(e) { err.textContent = apiErr(e); err.classList.remove('hidden') }
}

function copyInviteUrl() {
  const v = document.getElementById('inv-url').value
  navigator.clipboard?.writeText(v).then(() => toast('Invite link copied')).catch(() => { document.getElementById('inv-url').select(); toast('Select and copy the link', 'warning') })
}

async function revokeInvite(id) {
  if (!confirm('Revoke this invitation?')) return
  try { await axios.delete(`${API}/team/invite/${id}`); toast('Invitation revoked'); loadTeam() }
  catch(e) { toast(apiErr(e), 'error') }
}

function openEditMemberModal(id) {
  const m = (window._teamMembers || []).find(x => x.id === id)
  if (!m) return
  openModal(`
    <h3 class="text-lg font-bold text-white mb-1">Edit Team Member</h3>
    <p class="text-xs text-gray-400 mb-4">${esc(m.first_name)} ${esc(m.last_name)} · ${esc(m.email)}</p>
    <div class="space-y-3">
      <div><label class="text-xs text-gray-400 mb-1 block">Role</label>
        <select id="tm-role" class="input">
          ${['admin','operator','viewer'].map(r => `<option value="${r}" ${m.role===r?'selected':''}>${r}</option>`).join('')}
        </select></div>
      <div><label class="text-xs text-gray-400 mb-1 block">Status</label>
        <select id="tm-status" class="input">
          <option value="active" ${m.status==='active'?'selected':''}>Active</option>
          <option value="suspended" ${m.status==='suspended'?'selected':''}>Suspended (cannot sign in)</option>
        </select></div>
      <div class="flex gap-2 pt-2">
        <button onclick="submitEditMember('${id}')" class="btn-primary flex-1">Save</button>
        <button onclick="document.getElementById('modal-overlay').classList.add('hidden')" class="btn-secondary">Cancel</button>
      </div>
    </div>`)
}

async function submitEditMember(id) {
  try {
    await axios.put(`${API}/team/${id}`, { role: document.getElementById('tm-role').value, status: document.getElementById('tm-status').value })
    document.getElementById('modal-overlay').classList.add('hidden')
    toast('Team member updated'); loadTeam()
  } catch(e) { toast(apiErr(e), 'error') }
}

// ─── SETTINGS ────────────────────────────────────────────────
const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','America/Mexico_City','America/Sao_Paulo',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Amsterdam','Europe/Stockholm','Europe/Warsaw','Europe/Istanbul','Europe/Moscow',
  'Africa/Johannesburg','Africa/Lagos','Africa/Cairo','Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Dhaka','Asia/Bangkok','Asia/Singapore','Asia/Hong_Kong','Asia/Shanghai',
  'Asia/Tokyo','Asia/Seoul','Australia/Sydney','Australia/Perth','Pacific/Auckland']

async function loadSettings() {
  const el = document.getElementById('page-settings')
  try {
    const [{ data }, { data: orgData }] = await Promise.all([axios.get(`${API}/settings`), axios.get(`${API}/org`)])
    const s = data.settings || {}
    const org = orgData.org || {}
    const counts = orgData.counts || {}
    const high = parseFloat(s.face_match_threshold_high ?? 0.45)
    const med  = parseFloat(s.face_match_threshold_medium ?? 0.60)
    const margin = parseFloat(s.face_match_margin ?? 0.05)
    const ro = !isAdmin()
    const dis = ro ? 'disabled' : ''
    const tzList = TIMEZONES.includes(s.timezone) || !s.timezone ? TIMEZONES : [s.timezone, ...TIMEZONES]
    el.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="mb-6">
        <h2 class="text-xl font-bold text-white">Settings</h2>
        <p class="text-gray-400 text-sm">Recognition thresholds, retention and organization details.</p>
        ${ro ? `<div class="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300"><i class="fas fa-lock mr-1"></i>Only organization admins can change settings. You have read-only access.</div>` : ''}
      </div>

      <div class="space-y-4">
        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4"><i class="fas fa-building text-indigo-400 mr-2"></i>Organization</h3>
          <div class="grid grid-cols-3 gap-3 mb-4 text-center">
            <div class="p-3 bg-gray-800/40 rounded-lg"><div class="text-lg font-bold text-white">${counts.users ?? '—'}</div><div class="text-[11px] text-gray-500">People</div></div>
            <div class="p-3 bg-gray-800/40 rounded-lg"><div class="text-lg font-bold text-white">${counts.doors ?? '—'}</div><div class="text-[11px] text-gray-500">Doors</div></div>
            <div class="p-3 bg-gray-800/40 rounded-lg"><div class="text-lg font-bold text-white">${counts.team ?? "—"}</div><div class="text-[11px] text-gray-500">Team</div></div>
          </div>
          <div class="space-y-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Company Name</label>
              <input id="s-company" class="input" maxlength="120" ${dis} value="${esc(s.company_name || org.name || '')}">
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Timezone</label>
              <select id="s-tz" class="input" ${dis}>
                ${tzList.map(tz => `<option value="${esc(tz)}" ${(s.timezone||'UTC')===tz?'selected':''}>${esc(tz)}</option>`).join('')}
              </select>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Notification Email <span class="text-gray-600">(security alerts)</span></label>
              <input id="s-notify" type="email" class="input" maxlength="254" ${dis} value="${esc(s.notification_email || '')}" placeholder="security@company.com">
            </div>
            <div class="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <span>Plan: <span class="text-indigo-300 uppercase">${esc(org.plan || 'trial')}</span></span>
              <span>Status: <span class="text-white">${esc(org.status || 'active')}</span></span>
              ${org.trial_ends_at ? `<span>Trial ends: <span class="text-white">${fmtTime(org.trial_ends_at)}</span></span>` : ''}
              <span>Org ID: <span class="font-mono text-gray-400">${esc(org.id || '')}</span></span>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <h3 class="font-semibold text-white mb-1"><i class="fas fa-sliders-h text-indigo-400 mr-2"></i>Recognition Thresholds</h3>
          <p class="text-xs text-gray-500 mb-4">Matching uses Euclidean distance between 128-d face descriptors. <b class="text-gray-300">Lower distance = closer match.</b> Typical same-person distance is 0.3–0.5; different people are usually &gt; 0.6.</p>
          <div class="space-y-4">
            <div>
              <div class="flex justify-between text-xs text-gray-400 mb-2">
                <span><span class="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1"></span>Auto-grant distance (high confidence)</span>
                <span id="high-val" class="font-mono text-white">${high.toFixed(2)}</span>
              </div>
              <input type="range" min="0.30" max="0.60" step="0.01" value="${high}" ${dis}
                oninput="document.getElementById('high-val').textContent=parseFloat(this.value).toFixed(2)"
                id="s-high" class="w-full accent-indigo-500">
              <div class="flex justify-between text-[10px] text-gray-600"><span>0.30 strict</span><span>0.60 lenient</span></div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-gray-400 mb-2">
                <span><span class="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 mr-1"></span>Approval-required distance (medium confidence)</span>
                <span id="med-val" class="font-mono text-white">${med.toFixed(2)}</span>
              </div>
              <input type="range" min="0.40" max="0.70" step="0.01" value="${med}" ${dis}
                oninput="document.getElementById('med-val').textContent=parseFloat(this.value).toFixed(2)"
                id="s-med" class="w-full accent-indigo-500">
              <div class="flex justify-between text-[10px] text-gray-600"><span>0.40</span><span>0.70</span></div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-gray-400 mb-2">
                <span>Minimum margin over 2nd-best candidate</span>
                <span id="margin-val" class="font-mono text-white">${margin.toFixed(2)}</span>
              </div>
              <input type="range" min="0" max="0.20" step="0.01" value="${margin}" ${dis}
                oninput="document.getElementById('margin-val').textContent=parseFloat(this.value).toFixed(2)"
                id="s-margin" class="w-full accent-indigo-500">
              <div class="text-[11px] text-gray-500 mt-1">If two enrolled people are closer than this margin, the match is downgraded to approval-required instead of auto-granted.</div>
            </div>
            <div class="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400 space-y-1">
              <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-green-500"></div> Distance ≤ <b class="text-white" id="hint-high">${high.toFixed(2)}</b> → access granted instantly</div>
              <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-yellow-500"></div> Between thresholds → sent to <b class="text-white">Approvals</b> for a human decision</div>
              <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-red-500"></div> Distance &gt; <b class="text-white" id="hint-med">${med.toFixed(2)}</b> → not recognized, denied</div>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4"><i class="fas fa-shield-alt text-indigo-400 mr-2"></i>Security</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg">
              <div>
                <div class="text-sm font-medium text-white">Require liveness challenge</div>
                <div class="text-xs text-gray-400">Reject recognitions without head-movement liveness evidence (anti-photo).</div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="s-liveness" class="sr-only peer" ${dis} ${s.liveness_enabled !== 'false' ? 'checked' : ''}>
                <div class="w-11 h-6 bg-gray-700 peer-focus:ring-2 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Approval timeout (seconds) <span class="text-gray-600">30–600</span></label>
              <input id="s-2fa-timeout" type="number" class="input" ${dis} value="${esc(s.two_fa_timeout_seconds || 120)}" min="30" max="600">
              <div class="text-[11px] text-gray-500 mt-1">How long a pending approval stays open before it is automatically denied.</div>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4"><i class="fas fa-database text-indigo-400 mr-2"></i>Data Retention</h3>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Access logs (days) <span class="text-gray-600">30–3650</span></label>
              <input id="s-ret-logs" type="number" class="input" ${dis} value="${esc(s.retention_days_logs || 365)}" min="30" max="3650"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Biometric data (days) <span class="text-gray-600">30–1095</span></label>
              <input id="s-ret-bio" type="number" class="input" ${dis} value="${esc(s.retention_days_biometric || 365)}" min="30" max="1095"></div>
          </div>
          <div class="mt-3 p-3 bg-gray-800/30 rounded-lg text-xs text-gray-400 space-y-1">
            <div><i class="fas fa-check text-green-500 mr-2"></i>Only numeric face descriptors are stored — never photos or video.</div>
            <div><i class="fas fa-check text-green-500 mr-2"></i>Any person's biometric profile can be erased instantly from <b>People → Erase face</b>.</div>
            <div><i class="fas fa-check text-green-500 mr-2"></i>All console actions are recorded in the audit trail.</div>
          </div>
        </div>

        ${ro ? '' : `<button onclick="saveSettings()" id="s-save-btn" class="btn-primary w-full py-3 text-base"><i class="fas fa-save mr-2"></i> Save Settings</button>`}
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="text-red-400 p-4">Error: ${apiErr(e)}</div>` }
}

async function saveSettings() {
  const high = parseFloat(document.getElementById('s-high').value)
  const med  = parseFloat(document.getElementById('s-med').value)
  if (high >= med) { toast('Auto-grant distance must be lower than the approval-required distance', 'error'); return }
  const btn = document.getElementById('s-save-btn')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving…' }
  try {
    const payload = {
      company_name: document.getElementById('s-company').value.trim(),
      timezone: document.getElementById('s-tz').value,
      notification_email: document.getElementById('s-notify').value.trim(),
      face_match_threshold_high: high.toFixed(2),
      face_match_threshold_medium: med.toFixed(2),
      face_match_margin: parseFloat(document.getElementById('s-margin').value).toFixed(2),
      liveness_enabled: String(document.getElementById('s-liveness').checked),
      two_fa_timeout_seconds: String(document.getElementById('s-2fa-timeout').value),
      retention_days_logs: String(document.getElementById('s-ret-logs').value),
      retention_days_biometric: String(document.getElementById('s-ret-bio').value)
    }
    await axios.put(`${API}/settings`, payload)
    toast('Settings saved')
    if (payload.company_name && currentAccount?.org) {
      currentAccount.org.name = payload.company_name
      const n = document.getElementById('biz-org-name'); if (n) n.textContent = payload.company_name
    }
    loadSettings()
  } catch(e) {
    toast(apiErr(e), 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i> Save Settings' }
  }
}

// ─── Clock ────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('live-clock')
  if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12:true, hour:'2-digit', minute:'2-digit', second:'2-digit' })
}
setInterval(updateClock, 1000)
updateClock()

// ─── Auth Wall (Business) ─────────────────────────────────────
let pendingInvite = null   // { token, email, role, org_name }

function bizShowTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('biz-form-login').style.display    = isLogin ? '' : 'none';
  document.getElementById('biz-form-register').style.display = isLogin ? 'none' : '';
  const tl = document.getElementById('biz-tab-login');
  const tr = document.getElementById('biz-tab-register');
  tl.style.background = isLogin ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent';
  tl.style.color      = isLogin ? '#fff' : 'rgba(255,255,255,0.4)';
  tr.style.background = !isLogin ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent';
  tr.style.color      = !isLogin ? '#fff' : 'rgba(255,255,255,0.4)';
}

function bizTogglePw(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

function showErr(el, msg) { if (!el) return; el.textContent = msg; el.style.display = '' }
function hideErr(el) { if (el) el.style.display = 'none' }

async function bizDoLogin() {
  const email = document.getElementById('biz-login-email')?.value.trim();
  const pw    = document.getElementById('biz-login-pw')?.value;
  const errEl = document.getElementById('biz-login-err');
  const btn   = document.getElementById('biz-login-btn');
  if (!email || !pw) return showErr(errEl, 'Email and password required');
  if (!FA_AUTH.validEmail(email)) return showErr(errEl, 'Invalid email format');
  hideErr(errEl);
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in…';
  try {
    const data = await FA_AUTH.loginBusiness(email, pw);
    bizEnterDashboard(data.account);
  } catch(e) {
    showErr(errEl, e.response?.data?.error || 'Login failed. Please check your credentials.');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
  }
}

async function bizDoRegister() {
  const first  = document.getElementById('biz-reg-first')?.value.trim();
  const last   = document.getElementById('biz-reg-last')?.value.trim();
  const email  = document.getElementById('biz-reg-email')?.value.trim();
  const phone  = document.getElementById('biz-reg-phone')?.value.trim();
  const pw     = document.getElementById('biz-reg-pw')?.value;
  const org    = document.getElementById('biz-reg-org')?.value.trim();
  const size   = document.getElementById('biz-reg-size')?.value || null;
  const industry = document.getElementById('biz-reg-industry')?.value.trim() || null;
  const errEl  = document.getElementById('biz-reg-err');
  const btn    = document.getElementById('biz-reg-btn');
  const consentTerms = document.getElementById('biz-reg-consent-terms')?.checked;
  const consentSms   = document.getElementById('biz-reg-consent-sms')?.checked;
  const joining = !!pendingInvite;
  if (!first || !last)              return showErr(errEl, 'First and last name required');
  if (!FA_AUTH.validEmail(email))   return showErr(errEl, 'Invalid email address');
  if (joining && pendingInvite.email && email.toLowerCase() !== pendingInvite.email.toLowerCase())
                                    return showErr(errEl, `This invitation was issued to ${pendingInvite.email}. Use that email address.`);
  if (phone && !FA_AUTH.validPhone(phone)) return showErr(errEl, 'Invalid phone number format');
  if (!FA_AUTH.validPassword(pw))   return showErr(errEl, 'Password must be 8+ characters with letters and numbers');
  if (!joining && (!org || org.length < 2)) return showErr(errEl, 'Organization name is required');
  if (!consentTerms) return showErr(errEl, 'You must agree to the Terms of Use and Privacy Policy to continue');
  hideErr(errEl);
  const label = document.getElementById('biz-reg-btn-label')
  btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${joining ? 'Joining…' : 'Creating organization…'}`;
  try {
    const payload = { first_name:first, last_name:last, email, phone:phone||null, password:pw,
      consent_terms:true, sms_consent:!!consentSms };
    if (joining) payload.invite_token = pendingInvite.token;
    else { payload.org_name = org; payload.org_size = size; payload.industry = industry; }
    const data = await FA_AUTH.registerBusiness(payload);
    history.replaceState(null, '', location.pathname);
    pendingInvite = null;
    bizEnterDashboard(data.account);
  } catch(e) {
    showErr(errEl, e.response?.data?.error || 'Registration failed.');
    btn.disabled = false; btn.innerHTML = `<i class="fas fa-user-plus mr-2"></i><span id="biz-reg-btn-label">${joining ? 'Join Organization' : 'Create Organization'}</span>`;
  }
}

async function applyInviteFromUrl() {
  const token = new URLSearchParams(location.search).get('invite');
  if (!token) return;
  const banner = document.getElementById('biz-invite-banner');
  bizShowTab('register');
  try {
    const { data } = await axios.get(`/api/auth/business/invite/${encodeURIComponent(token)}`);
    const inv = data.invitation;
    if (!inv.valid) {
      banner.style.display = '';
      banner.style.color = '#fca5a5'; banner.style.borderColor = 'rgba(239,68,68,.3)'; banner.style.background = 'rgba(239,68,68,.08)';
      banner.innerHTML = `<i class="fas fa-exclamation-triangle mr-1"></i>This invitation to <b>${esc(inv.org_name)}</b> has expired or was already used. Ask your admin for a new link.`;
      return;
    }
    pendingInvite = { token, email: inv.email, role: inv.role, org_name: inv.org_name };
    banner.style.display = '';
    banner.innerHTML = `<i class="fas fa-envelope-open-text mr-1"></i>You've been invited to join <b>${esc(inv.org_name)}</b> as <b>${esc(inv.role)}</b>. Create your account below to accept.`;
    const emailEl = document.getElementById('biz-reg-email'); if (emailEl) { emailEl.value = inv.email; emailEl.readOnly = true; }
    const orgBlock = document.getElementById('biz-reg-org-block'); if (orgBlock) orgBlock.style.display = 'none';
    const label = document.getElementById('biz-reg-btn-label'); if (label) label.textContent = 'Join Organization';
  } catch(e) {
    banner.style.display = '';
    banner.style.color = '#fca5a5'; banner.style.borderColor = 'rgba(239,68,68,.3)'; banner.style.background = 'rgba(239,68,68,.08)';
    banner.innerHTML = `<i class="fas fa-exclamation-triangle mr-1"></i>${esc(apiErr(e, 'Invitation not found'))}`;
  }
}

function setEngineStatus(state, label) {
  const dot = document.getElementById('engine-dot'), lbl = document.getElementById('engine-label');
  if (!dot || !lbl) return;
  dot.className = 'w-1.5 h-1.5 rounded-full ' + (state === 'ready' ? 'bg-green-500' : state === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse');
  lbl.textContent = label;
}

async function warmFaceEngine() {
  if (typeof FaceAccessCameraEngine === 'undefined') { setEngineStatus('error', 'Face engine unavailable'); return }
  if (FaceAccessCameraEngine.isReady && FaceAccessCameraEngine.isReady()) { setEngineStatus('ready', 'Face engine ready'); return }
  setEngineStatus('loading', 'Loading face models…');
  try {
    await FaceAccessCameraEngine.ready();
    setEngineStatus('ready', `Face engine ready · ${FaceAccessCameraEngine.ENGINE_NAME || 'face-api'}`);
  } catch(e) {
    console.error('Face engine failed to load', e);
    setEngineStatus('error', 'Face engine failed to load');
  }
}

function bizEnterDashboard(account) {
  currentAccount = account;
  const org = account.org || {};
  document.getElementById('biz-user-name').textContent  = `${account.first_name} ${account.last_name}`;
  document.getElementById('biz-user-email').textContent = `${account.email} · ${account.role}`;
  const orgEl = document.getElementById('biz-org-name'); if (orgEl) orgEl.textContent = org.name || 'Access Control';
  const plan = document.getElementById('plan-badge');
  if (plan) {
    const p = (org.plan || 'trial').toUpperCase();
    let txt = p;
    if (org.plan === 'trial' && org.trial_ends_at) {
      const days = Math.max(0, Math.ceil((new Date(org.trial_ends_at.replace(' ','T')+'Z') - Date.now()) / 86400000));
      txt = `TRIAL · ${days}d left`;
    }
    plan.textContent = txt; plan.classList.remove('hidden');
  }
  // Team page is admin/operator-relevant; hide invite features for viewers handled inside pages
  const navTeam = document.getElementById('nav-team'); if (navTeam) navTeam.style.display = '';
  document.getElementById('auth-wall').style.display = 'none';
  if (approvalsPoll) clearInterval(approvalsPoll);
  pollApprovalsBadge(); approvalsPoll = setInterval(pollApprovalsBadge, 15000);
  warmFaceEngine();
  showPage('dashboard');
}

function bizShowAuthWall() {
  if (approvalsPoll) { clearInterval(approvalsPoll); approvalsPoll = null }
  if (dashboardRefreshInterval) { clearInterval(dashboardRefreshInterval); dashboardRefreshInterval = null }
  if (liveRefreshInterval) { clearInterval(liveRefreshInterval); liveRefreshInterval = null }
  currentAccount = null;
  updateApprovalsBadge(0);
  document.getElementById('biz-user-name').textContent  = '—';
  document.getElementById('biz-user-email').textContent = '—';
  const plan = document.getElementById('plan-badge'); if (plan) plan.classList.add('hidden');
  const pw = document.getElementById('biz-login-pw'); if (pw) pw.value = '';
  // Reset the register form so a previous submission's spinner/values don't linger
  ['biz-reg-first','biz-reg-last','biz-reg-email','biz-reg-phone','biz-reg-org','biz-reg-industry','biz-reg-pw'].forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.readOnly = false } });
  ['biz-reg-consent-terms','biz-reg-consent-sms'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false });
  const regBtn = document.getElementById('biz-reg-btn');
  if (regBtn) { regBtn.disabled = false; regBtn.innerHTML = '<i class="fas fa-user-plus mr-2"></i><span id="biz-reg-btn-label">Create Organization</span>' }
  const loginBtn = document.getElementById('biz-login-btn');
  if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In' }
  const orgBlock = document.getElementById('biz-reg-org-block'); if (orgBlock) orgBlock.style.display = '';
  const banner = document.getElementById('biz-invite-banner'); if (banner) banner.style.display = 'none';
  pendingInvite = null;
  hideErr(document.getElementById('biz-reg-err')); hideErr(document.getElementById('biz-login-err'));
  bizShowTab('login');
  document.getElementById('auth-wall').style.display = 'flex';
}

async function bizLogout() {
  try {
    const t = FA_AUTH.getToken('business');
    if (t) await axios.post('/api/auth/business/logout', {}, { headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
  } finally {
    FA_AUTH.clearToken('business');
    bizShowAuthWall();
  }
}

// ─── Init ─────────────────────────────────────────────────────
(async () => {
  let account = null;
  const token = FA_AUTH.getToken('business');
  if (token) {
    try {
      const { data } = await axios.get('/api/auth/business/me', { headers: { Authorization: `Bearer ${token}` } });
      account = data.account;
    } catch(e) {
      FA_AUTH.clearToken('business');
    }
  }
  if (account && !new URLSearchParams(location.search).get('invite')) {
    bizEnterDashboard(account);
  } else {
    if (account) { FA_AUTH.clearToken('business'); account = null } // invite link: force fresh registration
    document.getElementById('auth-wall').style.display = 'flex';
    applyInviteFromUrl();
  }
})();
