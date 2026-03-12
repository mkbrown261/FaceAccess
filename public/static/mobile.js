// FaceAccess Mobile Companion App
const API = '/api'

// Demo user - in production this would come from device auth
const DEMO_USER_ID = 'usr-emp-001'
const DEMO_USER_NAME = 'Michael Park'

let currentTab = 'access'
let proximitySimulated = false
let bluetoothSimulated = false
let pendingPollingInterval = null

// ─── Tab navigation ──────────────────────────────────────────
function mobileTab(tab) {
  currentTab = tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + tab)?.classList.add('active')

  if (pendingPollingInterval) { clearInterval(pendingPollingInterval); pendingPollingInterval = null }

  if (tab === 'access') { loadPendingApprovals(); pendingPollingInterval = setInterval(loadPendingApprovals, 5000) }
  else if (tab === 'profile') renderProfile()
  else if (tab === 'history') loadHistory()
}

// ─── Toast ────────────────────────────────────────────────────
function mobileToast(msg, type = 'success') {
  const existing = document.getElementById('mobile-toast')
  if (existing) existing.remove()
  const t = document.createElement('div')
  t.id = 'mobile-toast'
  const colors = { success: 'bg-green-900 border-green-700 text-green-300', error: 'bg-red-900 border-red-700 text-red-300', info: 'bg-indigo-900 border-indigo-700 text-indigo-300' }
  t.className = `fixed bottom-20 left-4 right-4 z-50 p-4 rounded-xl border ${colors[type]||colors.info} text-sm font-medium shadow-2xl`
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.4s'; setTimeout(() => t.remove(), 400) }, 3000)
}

// ─── Pending Approvals ───────────────────────────────────────
async function loadPendingApprovals() {
  const content = document.getElementById('mobile-content')
  if (currentTab !== 'access') return

  try {
    const { data } = await axios.get(`${API}/mobile/pending/${DEMO_USER_ID}`)
    const pending = data.pending || []

    let html = `
    <!-- User header -->
    <div class="mobile-card p-4 flex items-center gap-3">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-lg shadow-lg">MP</div>
      <div class="flex-1">
        <div class="font-semibold text-white">${DEMO_USER_NAME}</div>
        <div class="text-xs text-gray-400">Employee · Engineering</div>
      </div>
      <div class="text-right">
        <div class="text-xs text-gray-500 mb-1">2FA Status</div>
        <div class="flex items-center gap-1 text-xs text-green-400">
          <div class="w-1.5 h-1.5 rounded-full bg-green-400"></div> Active
        </div>
      </div>
    </div>

    <!-- Proximity Widget -->
    <div class="mobile-card p-5">
      <h3 class="font-semibold text-white mb-4 text-center">
        <i class="fas fa-broadcast-tower text-indigo-400 mr-2"></i>Proximity Detection
      </h3>
      <div class="proximity-ring mb-4">
        <div class="text-center">
          <i class="fas fa-bluetooth text-indigo-400 text-2xl"></i>
          <div class="text-xs text-gray-400 mt-1" id="prox-status">${proximitySimulated ? 'Nearby' : 'Scanning...'}</div>
        </div>
      </div>
      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-gray-800/50">
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-bluetooth ${proximitySimulated ? 'text-blue-400' : 'text-gray-600'}"></i>
            <span class="text-gray-300">Bluetooth BLE</span>
          </div>
          <span class="text-xs ${proximitySimulated ? 'text-green-400' : 'text-gray-500'}">${proximitySimulated ? '✓ In range' : 'Scanning'}</span>
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-gray-800/50">
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-wifi ${bluetoothSimulated ? 'text-indigo-400' : 'text-gray-600'}"></i>
            <span class="text-gray-300">WiFi Network</span>
          </div>
          <span class="text-xs ${bluetoothSimulated ? 'text-green-400' : 'text-gray-500'}">${bluetoothSimulated ? '✓ Corp-WiFi' : 'Not matched'}</span>
        </div>
      </div>
      <button onclick="simulateProximity()" class="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold ${proximitySimulated ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}">
        ${proximitySimulated ? '<i class="fas fa-check-circle mr-2"></i>Proximity Verified' : '<i class="fas fa-search mr-2"></i>Scan for Beacons'}
      </button>
    </div>`

    if (pending.length === 0) {
      html += `
      <div class="mobile-card p-6 text-center">
        <div class="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-bell-slash text-gray-600 text-2xl"></i>
        </div>
        <h3 class="font-semibold text-white mb-1">No Pending Requests</h3>
        <p class="text-gray-400 text-sm">Access requests will appear here when a face is recognized at a secured door.</p>
        <div class="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
          <div class="w-1.5 h-1.5 rounded-full bg-indigo-500 pulse"></div>
          Auto-refreshing every 5 seconds
        </div>
      </div>

      <!-- Demo trigger -->
      <div class="mobile-card p-4">
        <h4 class="text-sm font-semibold text-gray-300 mb-3"><i class="fas fa-flask text-indigo-400 mr-2"></i>Demo: Trigger Access Request</h4>
        <p class="text-xs text-gray-500 mb-3">Simulate a face recognition event that requires your 2FA approval:</p>
        <select id="demo-door-sel" class="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-gray-300 mb-3 outline-none">
          <option value="door-server-001">🔒 Server Room (High Security)</option>
          <option value="door-exec-001">🏢 Executive Suite (High Security)</option>
          <option value="door-lab-001">🧪 Research Lab (Critical)</option>
        </select>
        <button onclick="triggerDemo()" class="w-full py-3 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-sm font-semibold hover:bg-indigo-500/30 transition-colors">
          <i class="fas fa-bolt mr-2"></i>Simulate Face Recognition
        </button>
      </div>`
    } else {
      html += `<div class="space-y-3">`
      for (const ver of pending) {
        const remaining = Math.max(0, Math.round((new Date(ver.expires_at) - new Date()) / 1000))
        const pct = Math.round((ver.confidence || 0) * 100)
        const secColor = ver.security_level === 'critical' ? 'red' : ver.security_level === 'high' ? 'yellow' : 'indigo'

        html += `
        <div class="mobile-card p-5 notification-item" id="ver-${ver.id}" style="border:2px solid rgba(${secColor==='red'?'239,68,68':secColor==='yellow'?'245,158,11':'99,102,241'},0.3)">
          <div class="flex items-center gap-2 mb-4">
            <div class="w-3 h-3 rounded-full bg-${secColor==='red'?'red':secColor==='yellow'?'yellow':'indigo'}-400 pulse"></div>
            <span class="text-sm font-bold text-white">Access Request</span>
            <span class="ml-auto text-xs text-gray-500" id="timer-${ver.id}">${remaining}s</span>
          </div>

          <div class="bg-gray-800/50 rounded-xl p-4 mb-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <i class="fas fa-door-open text-indigo-400"></i>
              </div>
              <div>
                <div class="font-semibold text-white">${ver.door_name}</div>
                <div class="text-xs text-gray-400">${ver.door_location || 'Access Point'}</div>
              </div>
              <div class="ml-auto"><span class="text-xs px-2 py-1 rounded-full bg-${secColor==='red'?'red':secColor==='yellow'?'yellow':'indigo'}-500/20 text-${secColor==='red'?'red':secColor==='yellow'?'yellow':'indigo'}-400">${ver.security_level || 'standard'}</span></div>
            </div>
            <div class="text-xs text-gray-400 mb-2">Face match confidence: <span class="font-bold text-white">${pct}%</span></div>
            <div class="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-full rounded-full" style="width:${pct}%;background:${pct>=85?'#10b981':pct>=65?'#f59e0b':'#ef4444'}"></div>
            </div>
            <div class="mt-3 text-xs text-gray-500">
              <i class="fas fa-clock mr-1"></i>${new Date(ver.created_at).toLocaleTimeString()}
              ${!proximitySimulated ? '<div class="mt-1 text-yellow-500"><i class="fas fa-exclamation-triangle mr-1"></i>Proximity not verified — verify location above</div>' : '<div class="mt-1 text-green-400"><i class="fas fa-check mr-1"></i>Proximity verified</div>'}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button onclick="respondToVerification('${ver.id}','deny')" class="btn-deny">
              <i class="fas fa-times"></i> Deny
            </button>
            <button onclick="respondToVerification('${ver.id}','approve')" class="btn-approve" ${!proximitySimulated?'style="opacity:0.6"':''}>
              <i class="fas fa-check"></i> Approve
            </button>
          </div>
        </div>`

        // Start countdown timer
        startCountdown(ver.id, remaining)
      }
      html += `</div>`
    }

    content.innerHTML = html
  } catch(e) {
    content.innerHTML = `<div class="mobile-card p-4 text-red-400 text-sm"><i class="fas fa-exclamation-circle mr-2"></i>Error: ${e.message}</div>`
  }
}

function startCountdown(verId, seconds) {
  let remaining = seconds
  const interval = setInterval(() => {
    remaining--
    const el = document.getElementById(`timer-${verId}`)
    if (!el) { clearInterval(interval); return }
    if (remaining <= 0) {
      el.textContent = 'Expired'
      el.className = 'text-xs text-red-400 font-bold'
      clearInterval(interval)
      setTimeout(loadPendingApprovals, 1000)
    } else {
      el.textContent = remaining + 's'
      if (remaining <= 15) el.className = 'text-xs text-red-400 font-bold'
      else if (remaining <= 30) el.className = 'text-xs text-yellow-400'
    }
  }, 1000)
}

async function respondToVerification(verId, action) {
  if (action === 'approve' && !proximitySimulated) {
    mobileToast('⚠️ Please verify proximity first to prevent remote approvals', 'error')
    return
  }

  const btn = document.querySelector(`#ver-${verId} .btn-${action === 'approve' ? 'approve' : 'deny'}`)
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>' }

  try {
    const { data } = await axios.post(`${API}/verify/${verId}/respond`, {
      action,
      proximity_verified: proximitySimulated,
      device_id: 'mobile-demo-device-001'
    })

    const card = document.getElementById(`ver-${verId}`)
    if (card) {
      card.style.borderColor = action === 'approve' ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'
      card.innerHTML = `
      <div class="text-center py-6">
        <div class="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style="background:${action==='approve'?'rgba(16,185,129,0.2)':'rgba(239,68,68,0.2)'}">
          <i class="fas ${action==='approve'?'fa-check':'fa-times'} text-3xl" style="color:${action==='approve'?'#10b981':'#ef4444'}"></i>
        </div>
        <div class="font-bold text-white text-lg">${action === 'approve' ? 'Access Granted' : 'Access Denied'}</div>
        <div class="text-sm text-gray-400 mt-1">${data.message}</div>
      </div>`
    }

    mobileToast(action === 'approve' ? '✅ Door unlocked!' : '🔒 Access denied', action === 'approve' ? 'success' : 'error')
    setTimeout(loadPendingApprovals, 2000)
  } catch(e) {
    mobileToast(e.response?.data?.error || e.message, 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = action === 'approve' ? '<i class="fas fa-check"></i> Approve' : '<i class="fas fa-times"></i> Deny' }
  }
}

function simulateProximity() {
  if (proximitySimulated) { proximitySimulated = false; bluetoothSimulated = false }
  else {
    // Simulate Bluetooth + WiFi detection
    setTimeout(() => { bluetoothSimulated = true; proximitySimulated = true; mobileToast('📡 Proximity verified — you are near the door', 'success'); loadPendingApprovals() }, 1200)
    mobileToast('🔍 Scanning for nearby beacons...', 'info')
    return
  }
  loadPendingApprovals()
}

async function triggerDemo() {
  const doorSel = document.getElementById('demo-door-sel')
  const door_id = doorSel ? doorSel.value : 'door-server-001'
  try {
    const { data } = await axios.post(`${API}/recognize`, { door_id, liveness_score: 0.96 })
    if (data.result === 'pending_2fa') {
      mobileToast('🔔 New access request! Check above.', 'info')
      loadPendingApprovals()
    } else {
      mobileToast(`Result: ${data.result} (${Math.round((data.confidence||0)*100)}% match)`, data.result === 'granted' ? 'success' : 'error')
    }
  } catch(e) { mobileToast(e.message, 'error') }
}

// ─── Profile ─────────────────────────────────────────────────
async function renderProfile() {
  const content = document.getElementById('mobile-content')
  try {
    const { data } = await axios.get(`${API}/users/${DEMO_USER_ID}`)
    const u = data.user

    content.innerHTML = `
    <div class="mobile-card p-6 text-center">
      <div class="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-3xl mx-auto mb-4 shadow-xl">
        ${u.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
      </div>
      <h2 class="text-xl font-bold text-white">${u.name}</h2>
      <p class="text-gray-400 text-sm mt-1">${u.email}</p>
      <div class="flex justify-center gap-2 mt-3">
        <span class="text-xs px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-semibold uppercase">${u.role}</span>
        <span class="text-xs px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">${u.department||'—'}</span>
      </div>
    </div>

    <div class="mobile-card p-4 space-y-3">
      <h3 class="font-semibold text-white"><i class="fas fa-fingerprint text-indigo-400 mr-2"></i>Biometric Status</h3>
      <div class="flex items-center justify-between p-3 bg-gray-800/50 rounded-xl">
        <span class="text-sm text-gray-300">Face ID</span>
        <span class="${u.face_registered ? 'text-green-400' : 'text-red-400'} text-sm font-semibold">
          <i class="fas ${u.face_registered ? 'fa-check-circle' : 'fa-times-circle'} mr-1"></i>
          ${u.face_registered ? 'Registered' : 'Not set'}
        </span>
      </div>
      <div class="flex items-center justify-between p-3 bg-gray-800/50 rounded-xl">
        <span class="text-sm text-gray-300">Mobile 2FA</span>
        <span class="text-green-400 text-sm font-semibold"><i class="fas fa-check-circle mr-1"></i>Active</span>
      </div>
      <div class="flex items-center justify-between p-3 bg-gray-800/50 rounded-xl">
        <span class="text-sm text-gray-300">Device Trust</span>
        <span class="text-green-400 text-sm font-semibold"><i class="fas fa-shield-alt mr-1"></i>Trusted</span>
      </div>
    </div>

    <div class="mobile-card p-4 space-y-3">
      <h3 class="font-semibold text-white"><i class="fas fa-lock text-indigo-400 mr-2"></i>Privacy Controls</h3>
      <p class="text-xs text-gray-400">Your biometric data is encrypted with AES-256. You can request deletion at any time.</p>
      <button onclick="requestDataDeletion()" class="w-full py-3 rounded-xl border border-red-800 text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors">
        <i class="fas fa-trash-alt mr-2"></i>Delete My Biometric Data
      </button>
      <button class="w-full py-3 rounded-xl border border-gray-700 text-gray-400 text-sm font-semibold hover:bg-gray-800 transition-colors">
        <i class="fas fa-download mr-2"></i>Export My Data (GDPR)
      </button>
    </div>

    <div class="mobile-card p-4">
      <h3 class="font-semibold text-white mb-3"><i class="fas fa-info-circle text-indigo-400 mr-2"></i>Account Info</h3>
      <div class="space-y-2 text-sm">
        <div class="flex justify-between"><span class="text-gray-500">Phone</span><span class="text-gray-300">${u.phone||'—'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Status</span><span class="text-green-400">${u.status}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Joined</span><span class="text-gray-300">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</span></div>
      </div>
    </div>`
  } catch(e) {
    content.innerHTML = `<div class="mobile-card p-4 text-red-400 text-sm">Error: ${e.message}</div>`
  }
}

async function requestDataDeletion() {
  if (!confirm('Delete all your biometric data? This cannot be undone.')) return
  try {
    await axios.delete(`${API}/users/${DEMO_USER_ID}/face`)
    mobileToast('✅ Biometric data deleted', 'success')
    renderProfile()
  } catch(e) { mobileToast(e.message, 'error') }
}

// ─── History ─────────────────────────────────────────────────
async function loadHistory() {
  const content = document.getElementById('mobile-content')
  content.innerHTML = `<div class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl"></i></div>`
  try {
    const { data } = await axios.get(`${API}/logs?user_id=${DEMO_USER_ID}&limit=30`)
    const logs = data.logs

    let html = `
    <div class="mobile-card p-4 mb-3">
      <h3 class="font-semibold text-white"><i class="fas fa-history text-indigo-400 mr-2"></i>My Access History</h3>
      <p class="text-xs text-gray-400 mt-1">${logs.length} recent events</p>
    </div>`

    if (logs.length === 0) {
      html += `<div class="mobile-card p-6 text-center text-gray-500"><i class="fas fa-inbox text-3xl mb-3"></i><p>No access history</p></div>`
    } else {
      html += `<div class="space-y-2">`
      for (const l of logs) {
        const isGranted = l.result === 'granted'
        html += `
        <div class="mobile-card p-4" style="border-left:3px solid ${isGranted?'#10b981':'#ef4444'}">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium text-white text-sm">${l.door_name}</span>
            <span class="text-xs font-bold ${isGranted?'text-green-400':'text-red-400'}">${l.result?.toUpperCase()}</span>
          </div>
          <div class="flex items-center justify-between text-xs text-gray-500">
            <span><i class="far fa-clock mr-1"></i>${new Date(l.timestamp).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
            <span class="font-mono bg-gray-800 px-2 py-0.5 rounded">${l.method||'face'}</span>
          </div>
          ${l.denial_reason ? `<div class="text-xs text-red-400 mt-1"><i class="fas fa-exclamation-triangle mr-1"></i>${l.denial_reason}</div>` : ''}
          ${l.confidence ? `<div class="text-xs text-gray-600 mt-1">Confidence: ${Math.round(l.confidence*100)}%</div>` : ''}
        </div>`
      }
      html += `</div>`
    }

    content.innerHTML = html
  } catch(e) {
    content.innerHTML = `<div class="mobile-card p-4 text-red-400 text-sm">Error: ${e.message}</div>`
  }
}

// ─── Init ─────────────────────────────────────────────────────
mobileTab('access')
