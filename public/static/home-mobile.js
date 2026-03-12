// ══════════════════════════════════════════════════════
//  FaceAccess Home — Mobile App JS
// ══════════════════════════════════════════════════════

const API = '';
let hmUserId = null;
let hmHomeId = null;
let hmPollTimer = null;
let hmCurrentTab = 'home';

// ── Bootstrap ─────────────────────────────────────────
async function init() {
  await loadUser();
  hmTab('home');
  // Poll for pending approvals every 8 seconds
  hmPollTimer = setInterval(checkPendingApprovals, 8000);
}

async function loadUser() {
  try {
    const r = await axios.get(`${API}/api/home/users`);
    const users = r.data.users || [];
    if (users.length > 0) {
      const owner = users.find(u => u.role === 'owner') || users[0];
      hmUserId = owner.id;
      hmHomeId = owner.home_id;
      const nameEl = document.getElementById('hm-home-name');
      if (nameEl && hmHomeId) {
        try {
          const hr = await axios.get(`${API}/api/home/homes/${hmHomeId}`);
          nameEl.textContent = hr.data.home?.name || 'My Home';
        } catch {}
      }
    }
  } catch(e) {
    console.error('loadUser error', e);
  }
}

// ── Tab navigation ────────────────────────────────────
function hmTab(name) {
  hmCurrentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`htab-${name}`);
  if (btn) btn.classList.add('active');
  renderTab(name);
}

function renderTab(name) {
  const el = document.getElementById('hm-content');
  if (!el) return;
  const loaders = { home: renderHomeTab, locks: renderLocksTab, activity: renderActivityTab, profile: renderProfileTab };
  if (loaders[name]) loaders[name](el);
}

// ── Toast ──────────────────────────────────────────────
function hmToast(msg, type = 'success') {
  const existing = document.getElementById('hm-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'hm-toast';
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warn: 'bg-yellow-500', info: 'bg-indigo-500' };
  t.className = `fixed bottom-20 left-4 right-4 ${colors[type]||'bg-green-500'} text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl z-50 slide-in text-center`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ═══════════════════════════════════════════════════════
//  HOME TAB — pending approvals + quick actions
// ═══════════════════════════════════════════════════════
async function renderHomeTab(el) {
  el.innerHTML = `<div class="text-gray-500 text-sm text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</div>`;

  try {
    const [pendingR, locksR] = await Promise.all([
      hmUserId ? axios.get(`${API}/api/home/verifications/pending/${hmUserId}`) : Promise.resolve({data:{pending:[]}}),
      hmHomeId ? axios.get(`${API}/api/home/locks?home_id=${hmHomeId}`) : Promise.resolve({data:{locks:[]}})
    ]);
    const pending = pendingR.data.pending || [];
    const locks = locksR.data.locks || [];

    el.innerHTML = '';

    // Pending approvals
    if (pending.length > 0) {
      const section = document.createElement('div');
      section.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <div class="w-2 h-2 rounded-full bg-yellow-400 pulse"></div>
        <span class="text-sm font-semibold text-yellow-300">Approval Requests (${pending.length})</span>
      </div>`;
      pending.forEach(v => {
        section.appendChild(renderApprovalCard(v));
      });
      el.appendChild(section);
    } else {
      const noPending = document.createElement('div');
      noPending.className = 'card p-5 mb-4 text-center';
      noPending.innerHTML = `
      <div class="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto mb-3">
        <i class="fas fa-shield-check text-green-400 text-2xl"></i>
      </div>
      <div class="text-sm font-semibold text-white">All Clear</div>
      <div class="text-xs text-gray-500 mt-1">No pending access requests</div>`;
      el.appendChild(noPending);
    }

    // Proximity status
    const proxCard = document.createElement('div');
    proxCard.className = 'card p-5 mb-4';
    proxCard.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-white text-sm">Proximity Status</h3>
      <button onclick="simulateProximityScan()" class="text-xs text-indigo-400"><i class="fas fa-sync mr-1"></i>Scan</button>
    </div>
    <div class="ble-ring mb-4">
      <i class="fas fa-bluetooth text-indigo-400 text-3xl"></i>
    </div>
    <div id="prox-status" class="space-y-2">
      <div class="flex items-center justify-between text-sm p-2.5 bg-gray-900 rounded-xl">
        <div class="flex items-center gap-2"><i class="fas fa-bluetooth text-blue-400 w-5 text-center"></i><span class="text-gray-300">BLE Beacon</span></div>
        <span class="text-gray-600 text-xs" id="ble-status">Tap Scan</span>
      </div>
      <div class="flex items-center justify-between text-sm p-2.5 bg-gray-900 rounded-xl">
        <div class="flex items-center gap-2"><i class="fas fa-wifi text-cyan-400 w-5 text-center"></i><span class="text-gray-300">Home WiFi</span></div>
        <span class="text-gray-600 text-xs" id="wifi-status">Tap Scan</span>
      </div>
    </div>`;
    el.appendChild(proxCard);

    // Quick lock controls
    if (locks.length > 0) {
      const lockSection = document.createElement('div');
      lockSection.innerHTML = `<h3 class="font-semibold text-white text-sm mb-3">Quick Controls</h3>`;
      locks.forEach(lock => {
        const row = document.createElement('div');
        row.className = 'lock-row mb-3 slide-in';
        row.innerHTML = `
        <div class="w-10 h-10 rounded-2xl ${lock.is_locked ? 'bg-indigo-500/15' : 'bg-green-500/15'} flex items-center justify-center flex-shrink-0">
          <i class="fas fa-lock${lock.is_locked ? '' : '-open'} text-${lock.is_locked ? 'indigo' : 'green'}-400 text-lg"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white text-sm">${lock.name}</div>
          <div class="text-xs text-gray-500">${lock.location || '—'}</div>
        </div>
        <button onclick="hmLockToggle('${lock.id}', ${lock.is_locked})" class="px-4 py-2 rounded-xl text-sm font-bold ${lock.is_locked ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'} transition-colors">
          ${lock.is_locked ? 'Unlock' : 'Lock'}
        </button>`;
        lockSection.appendChild(row);
      });
      el.appendChild(lockSection);
    }

  } catch(e) {
    el.innerHTML = `<div class="text-red-400 text-sm text-center py-4"><i class="fas fa-exclamation-circle mr-1"></i>Failed to load. ${e.message}</div>`;
  }
}

function renderApprovalCard(v) {
  const card = document.createElement('div');
  card.className = 'card p-5 mb-4 slide-in';
  card.id = `approval-${v.id}`;
  const confPct = Math.round((v.face_confidence || 0) * 100);
  const secLeft = Math.max(0, Math.ceil((new Date(v.expires_at) - Date.now()) / 1000));
  const isHighConf = confPct >= 88;
  card.innerHTML = `
  <div class="flex items-center gap-3 mb-4">
    <div class="w-12 h-12 rounded-2xl bg-yellow-500/15 flex items-center justify-center">
      <i class="fas fa-bell text-yellow-400 text-xl"></i>
    </div>
    <div class="flex-1">
      <div class="font-bold text-white">Entry Request</div>
      <div class="text-xs text-gray-400">${v.lock_full_name || v.lock_name} · ${v.home_name || 'Home'}</div>
    </div>
    <div class="text-xs text-yellow-400 font-mono" id="timer-${v.id}">${secLeft}s</div>
  </div>

  <div class="space-y-2 mb-4">
    <div class="flex items-center justify-between p-2.5 bg-gray-900 rounded-xl">
      <div class="flex items-center gap-2 text-xs">
        <i class="fas fa-face-smile ${isHighConf ? 'text-green-400' : 'text-yellow-400'}"></i>
        <span class="text-gray-300">Face match</span>
      </div>
      <span class="text-xs font-bold ${isHighConf ? 'text-green-400' : 'text-yellow-400'}">${confPct}%</span>
    </div>
    <div class="flex items-center justify-between p-2.5 bg-gray-900 rounded-xl">
      <div class="flex items-center gap-2 text-xs">
        <i class="fas fa-bluetooth text-blue-400"></i>
        <span class="text-gray-300">Phone proximity</span>
      </div>
      <span class="text-xs text-blue-400 font-bold">Verifying...</span>
    </div>
  </div>

  <!-- Confidence bar -->
  <div class="mb-4">
    <div class="h-1.5 bg-gray-900 rounded-full overflow-hidden">
      <div class="h-full rounded-full ${isHighConf ? 'bg-green-500' : 'bg-yellow-500'}" style="width:${confPct}%;transition:width .6s"></div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <button onclick="respondApproval('${v.id}','deny')" class="btn-deny py-4">
      <i class="fas fa-times text-xl"></i> Deny
    </button>
    <button onclick="respondApproval('${v.id}','approve')" class="btn-approve py-4">
      <i class="fas fa-check text-xl"></i> Approve
    </button>
  </div>
  <p class="text-xs text-gray-600 text-center mt-3">Your phone must be near the door to approve</p>`;

  // Countdown timer
  let remaining = secLeft;
  const timerEl = card.querySelector(`#timer-${v.id}`);
  const countdownInterval = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      card.innerHTML = `<div class="text-center py-4 text-gray-500"><i class="fas fa-clock mr-1"></i>Request expired</div>`;
    }
  }, 1000);

  return card;
}

async function respondApproval(verId, action) {
  try {
    const card = document.getElementById(`approval-${verId}`);
    if (card) card.style.opacity = '0.5';
    const r = await axios.post(`${API}/api/home/verifications/${verId}/respond`, {
      action, proximity_verified: true, ble_confirmed: action === 'approve'
    });
    const msg = action === 'approve' ? '🔓 Door unlocked!' : '🚫 Access denied';
    hmToast(msg, action === 'approve' ? 'success' : 'error');
    if (card) card.remove();
    // Refresh home tab after brief delay
    setTimeout(() => hmTab('home'), 1000);
  } catch(e) {
    hmToast('Failed to respond to request', 'error');
  }
}

function simulateProximityScan() {
  const bleEl = document.getElementById('ble-status');
  const wifiEl = document.getElementById('wifi-status');
  if (!bleEl || !wifiEl) return;

  bleEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Scanning...';
  wifiEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Scanning...';
  bleEl.className = 'text-yellow-400 text-xs';
  wifiEl.className = 'text-yellow-400 text-xs';

  setTimeout(() => {
    const bleFound = Math.random() > 0.3;
    const wifiFound = Math.random() > 0.2;
    bleEl.innerHTML = bleFound ? '<i class="fas fa-check-circle mr-1"></i>Detected' : '<i class="fas fa-times-circle mr-1"></i>Not nearby';
    bleEl.className = `text-xs font-semibold ${bleFound ? 'text-green-400' : 'text-red-400'}`;
    wifiEl.innerHTML = wifiFound ? '<i class="fas fa-check-circle mr-1"></i>Connected' : '<i class="fas fa-times-circle mr-1"></i>Not connected';
    wifiEl.className = `text-xs font-semibold ${wifiFound ? 'text-green-400' : 'text-red-400'}`;
    if (bleFound || wifiFound) hmToast('Phone proximity confirmed ✓', 'success');
    else hmToast('Phone not detected near door', 'warn');
  }, 2000);
}

async function hmLockToggle(lockId, isLocked) {
  const cmd = isLocked ? 'unlock' : 'lock';
  try {
    await axios.post(`${API}/api/home/locks/${lockId}/command`, { command: cmd, user_id: hmUserId });
    hmToast(cmd === 'unlock' ? '🔓 Door unlocked' : '🔒 Door locked');
    renderHomeTab(document.getElementById('hm-content'));
  } catch(e) { hmToast('Failed to send command', 'error'); }
}

async function checkPendingApprovals() {
  if (hmCurrentTab !== 'home' || !hmUserId) return;
  try {
    const r = await axios.get(`${API}/api/home/verifications/pending/${hmUserId}`);
    const pending = r.data.pending || [];
    if (pending.length > 0) {
      // Check if cards are already shown
      if (!document.getElementById(`approval-${pending[0].id}`)) {
        renderHomeTab(document.getElementById('hm-content'));
      }
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════
//  LOCKS TAB
// ═══════════════════════════════════════════════════════
async function renderLocksTab(el) {
  el.innerHTML = `<div class="text-gray-500 text-center py-8"><i class="fas fa-spinner fa-spin mr-1"></i>Loading...</div>`;
  try {
    const r = await axios.get(`${API}/api/home/locks?home_id=${hmHomeId}`);
    const locks = r.data.locks || [];
    el.innerHTML = `<h3 class="font-semibold text-white mb-4">Smart Locks</h3>`;

    if (locks.length === 0) {
      el.innerHTML += `<div class="card p-8 text-center"><i class="fas fa-lock text-gray-700 text-4xl mb-3"></i><p class="text-gray-500 text-sm">No locks configured.</p></div>`;
      return;
    }

    locks.forEach(lock => {
      const card = document.createElement('div');
      card.className = `card p-5 mb-4 border-l-4 ${lock.is_locked ? 'border-l-indigo-500' : 'border-l-green-500'} slide-in`;
      card.innerHTML = `
      <div class="flex items-center gap-4 mb-5">
        <div class="w-14 h-14 rounded-2xl ${lock.is_locked ? 'bg-indigo-500/15' : 'bg-green-500/15'} flex items-center justify-center">
          <i class="fas fa-lock${lock.is_locked ? '' : '-open'} text-${lock.is_locked ? 'indigo' : 'green'}-400 text-2xl"></i>
        </div>
        <div class="flex-1">
          <div class="font-bold text-white text-lg">${lock.name}</div>
          <div class="text-xs text-gray-500">${lock.location || '—'} · ${lock.brand?.charAt(0).toUpperCase() + lock.brand?.slice(1) || 'Generic'}</div>
        </div>
        <span class="px-3 py-1.5 rounded-xl text-xs font-bold ${lock.is_locked ? 'bg-indigo-500/20 text-indigo-300' : 'bg-green-500/20 text-green-300'}">${lock.is_locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <button onclick="hmSendLockCmd('${lock.id}','unlock',this)" class="py-4 rounded-2xl font-bold text-base ${lock.is_locked ? 'bg-green-500/20 text-green-300 border border-green-500/30 active:scale-95' : 'bg-gray-800 text-gray-600 cursor-not-allowed'} transition-all" ${!lock.is_locked ? 'disabled' : ''}>
          <i class="fas fa-lock-open text-xl mb-1 block"></i> Unlock
        </button>
        <button onclick="hmSendLockCmd('${lock.id}','lock',this)" class="py-4 rounded-2xl font-bold text-base ${!lock.is_locked ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 active:scale-95' : 'bg-gray-800 text-gray-600 cursor-not-allowed'} transition-all" ${lock.is_locked ? 'disabled' : ''}>
          <i class="fas fa-lock text-xl mb-1 block"></i> Lock
        </button>
      </div>
      ${lock.battery_pct != null ? `
      <div class="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <i class="fas fa-battery-${lock.battery_pct > 60 ? 'full text-green' : lock.battery_pct > 20 ? 'half text-yellow' : 'empty text-red'}-400"></i>
        Battery: ${lock.battery_pct}%
      </div>` : ''}`;
      el.appendChild(card);
    });
  } catch(e) {
    el.innerHTML = `<div class="text-red-400 text-center py-4">Failed to load locks</div>`;
  }
}

async function hmSendLockCmd(lockId, cmd, btn) {
  if (btn) { btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xl mb-1 block"></i> ${cmd === 'unlock' ? 'Unlocking' : 'Locking'}...`; btn.disabled = true; }
  try {
    await axios.post(`${API}/api/home/locks/${lockId}/command`, { command: cmd, user_id: hmUserId });
    hmToast(cmd === 'unlock' ? '🔓 Door unlocked!' : '🔒 Door locked!');
    setTimeout(() => renderLocksTab(document.getElementById('hm-content')), 800);
  } catch(e) {
    hmToast('Command failed', 'error');
    if (btn) { btn.disabled = false; }
  }
}

// ═══════════════════════════════════════════════════════
//  ACTIVITY TAB
// ═══════════════════════════════════════════════════════
async function renderActivityTab(el) {
  el.innerHTML = `<div class="text-gray-500 text-center py-8"><i class="fas fa-spinner fa-spin mr-1"></i>Loading...</div>`;
  try {
    const r = await axios.get(`${API}/api/home/events?home_id=${hmHomeId}&limit=50`);
    const events = r.data.events || [];
    el.innerHTML = `<h3 class="font-semibold text-white mb-4">Activity History</h3>`;

    if (events.length === 0) {
      el.innerHTML += `<div class="card p-8 text-center"><i class="fas fa-history text-gray-700 text-4xl mb-3"></i><p class="text-gray-500 text-sm">No activity yet.</p></div>`;
      return;
    }

    const list = document.createElement('div');
    list.className = 'card overflow-hidden';
    events.forEach((ev, i) => {
      const row = document.createElement('div');
      row.className = `flex items-center gap-3 p-4 ${i < events.length - 1 ? 'border-b border-gray-900' : ''}`;
      const typeMap = {
        unlock: ['fa-lock-open', '#10b981'],
        denied: ['fa-times-circle', '#ef4444'],
        alert: ['fa-exclamation-triangle', '#f59e0b'],
        guest_entry: ['fa-ticket', '#8b5cf6'],
        manual: ['fa-hand-pointer', '#6366f1']
      };
      const [icon, color] = typeMap[ev.event_type] || ['fa-circle', '#94a3b8'];
      const confPct = ev.face_confidence ? `${Math.round(ev.face_confidence * 100)}%` : null;
      row.innerHTML = `
      <div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style="background:${color}22">
        <i class="fas ${icon} text-sm" style="color:${color}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-white truncate">${ev.user_name || 'Unknown'}</div>
        <div class="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
          <span>${ev.lock_name || '—'}</span>
          ${ev.ble_detected ? '<span class="text-blue-500">·BLE</span>' : ''}
          ${ev.wifi_matched ? '<span class="text-cyan-500">·WiFi</span>' : ''}
          ${confPct ? `<span>·${confPct}</span>` : ''}
        </div>
      </div>
      <div class="text-xs text-gray-600 flex-shrink-0">${timeAgoHm(ev.created_at)}</div>`;
      list.appendChild(row);
    });
    el.appendChild(list);
  } catch(e) {
    el.innerHTML = `<div class="text-red-400 text-center py-4">Failed to load activity</div>`;
  }
}

// ═══════════════════════════════════════════════════════
//  PROFILE TAB
// ═══════════════════════════════════════════════════════
async function renderProfileTab(el) {
  let user = null;
  if (hmUserId) {
    try {
      const r = await axios.get(`${API}/api/home/users?home_id=${hmHomeId}`);
      user = (r.data.users || []).find(u => u.id === hmUserId) || r.data.users?.[0];
    } catch {}
  }
  const u = user || { name: 'Jordan Kim', email: 'jordan@home.demo', phone: '+1-555-0100', role: 'owner', face_registered: 1, avatar_color: '#6366f1' };

  let devicesHTML = '<div class="text-gray-600 text-xs">Loading...</div>';
  try {
    const dr = await axios.get(`${API}/api/home/devices?user_id=${hmUserId}`);
    const devs = dr.data.devices || [];
    devicesHTML = devs.length === 0 ? '<p class="text-gray-600 text-sm">No trusted devices registered.</p>' :
      devs.map(d => `
      <div class="flex items-center gap-3 py-2 border-b border-gray-900 last:border-0">
        <i class="fab fa-${d.platform === 'android' ? 'android' : 'apple'} text-${d.trusted ? 'green' : 'gray'}-400 text-xl w-6 text-center"></i>
        <div class="flex-1">
          <div class="text-sm text-white">${d.name}</div>
          <code class="text-xs text-indigo-400 font-mono">${d.ble_uuid || '—'}</code>
        </div>
        <span class="text-xs font-semibold ${d.trusted ? 'text-green-400' : 'text-gray-600'}">${d.trusted ? '✓' : '✗'}</span>
      </div>`).join('');
  } catch {}

  const initials = u.name.split(' ').map(n=>n[0]).join('').slice(0,2);
  el.innerHTML = `
  <!-- Profile header -->
  <div class="card p-6 mb-4 text-center">
    <div class="w-20 h-20 rounded-3xl mx-auto mb-3 flex items-center justify-center text-2xl font-black" style="background:${u.avatar_color||'#6366f1'}25;color:${u.avatar_color||'#818cf8'}">${initials}</div>
    <div class="text-xl font-bold text-white">${u.name}</div>
    <div class="text-sm text-gray-400">${u.email}</div>
    <div class="flex items-center justify-center gap-2 mt-2">
      <span class="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 capitalize">${u.role}</span>
      ${u.face_registered ? '<span class="px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300"><i class="fas fa-face-smile mr-1"></i>Face Enrolled</span>' : '<span class="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300">No Face</span>'}
    </div>
  </div>

  <!-- Face enrollment -->
  <div class="card p-5 mb-4">
    <h3 class="font-semibold text-white mb-3 text-sm"><i class="fas fa-face-smile mr-2 text-indigo-400"></i>Biometric Data</h3>
    <div class="space-y-3">
      <div class="flex items-center justify-between p-3 bg-gray-900 rounded-xl">
        <div class="text-sm text-gray-300">Face enrollment</div>
        <span class="text-xs font-bold ${u.face_registered ? 'text-green-400' : 'text-red-400'}">${u.face_registered ? '✓ Active' : '✗ Not enrolled'}</span>
      </div>
      ${!u.face_registered ? `
      <button onclick="enrollMyFace()" class="w-full py-3 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold text-sm">
        <i class="fas fa-camera mr-2"></i> Enroll Face Now
      </button>` : `
      <button onclick="deleteMyFace()" class="w-full py-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 font-semibold text-sm">
        <i class="fas fa-trash mr-2"></i> Delete Biometric Data (GDPR)
      </button>`}
    </div>
  </div>

  <!-- Trusted devices -->
  <div class="card p-5 mb-4">
    <h3 class="font-semibold text-white mb-3 text-sm"><i class="fas fa-bluetooth mr-2 text-blue-400"></i>Trusted Devices</h3>
    ${devicesHTML}
    <button onclick="registerMyDevice()" class="w-full mt-3 py-2.5 rounded-xl bg-blue-500/10 text-blue-300 border border-blue-500/20 font-semibold text-sm">
      <i class="fas fa-plus mr-1"></i> Register This Device
    </button>
  </div>

  <!-- Settings -->
  <div class="card p-5 mb-4">
    <h3 class="font-semibold text-white mb-3 text-sm"><i class="fas fa-cog mr-2 text-gray-400"></i>Notification Settings</h3>
    <div class="space-y-3">
      ${[['Entry notifications','Get notified on every unlock',true],['Denied attempts','Alert when access is denied',true],['Guest arrivals','Notify when a guest enters',true],['Remote approvals','Vibrate when approval is needed',true]].map(([label,desc,on])=>`
      <div class="flex items-center justify-between">
        <div><div class="text-sm text-gray-300">${label}</div><div class="text-xs text-gray-600">${desc}</div></div>
        <button onclick="this.dataset.on=this.dataset.on==='1'?'0':'1';this.className='w-11 h-6 rounded-full relative transition-colors border-0 cursor-pointer '+(this.dataset.on==='1'?'bg-indigo-500':'bg-gray-700')" data-on="${on?'1':'0'}" class="w-11 h-6 rounded-full relative transition-colors border-0 cursor-pointer ${on?'bg-indigo-500':'bg-gray-700'}">
          <div class="w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${on?'right-1':'left-1'}"></div>
        </button>
      </div>`).join('')}
    </div>
  </div>

  <!-- Links -->
  <div class="card overflow-hidden mb-4">
    <a href="/home/dashboard" class="flex items-center gap-3 p-4 border-b border-gray-900 hover:bg-gray-900/50 transition-colors">
      <i class="fas fa-th-large text-indigo-400 w-5 text-center"></i>
      <span class="text-sm text-gray-300">Open Dashboard</span>
      <i class="fas fa-chevron-right text-gray-700 ml-auto text-xs"></i>
    </a>
    <a href="/home/onboard" class="flex items-center gap-3 p-4 border-b border-gray-900 hover:bg-gray-900/50 transition-colors">
      <i class="fas fa-plus text-green-400 w-5 text-center"></i>
      <span class="text-sm text-gray-300">Add Another Home</span>
      <i class="fas fa-chevron-right text-gray-700 ml-auto text-xs"></i>
    </a>
    <a href="/home" class="flex items-center gap-3 p-4 hover:bg-gray-900/50 transition-colors">
      <i class="fas fa-house text-purple-400 w-5 text-center"></i>
      <span class="text-sm text-gray-300">FaceAccess Home Landing</span>
      <i class="fas fa-chevron-right text-gray-700 ml-auto text-xs"></i>
    </a>
  </div>`;
}

async function enrollMyFace() {
  if (!hmUserId) return;
  try {
    await axios.post(`${API}/api/home/users/${hmUserId}/face`, { image_quality: 0.96 });
    hmToast('Face enrolled! ✓');
    renderProfileTab(document.getElementById('hm-content'));
  } catch(e) { hmToast('Enrollment failed', 'error'); }
}

async function deleteMyFace() {
  if (!confirm('Delete your biometric data? You will need to re-enroll to use face recognition.')) return;
  try {
    await axios.delete(`${API}/api/home/users/${hmUserId}/face`);
    hmToast('Biometric data deleted (GDPR compliant)');
    renderProfileTab(document.getElementById('hm-content'));
  } catch(e) { hmToast('Failed to delete data', 'error'); }
}

async function registerMyDevice() {
  if (!hmUserId || !hmHomeId) return;
  const name = `My ${navigator.platform || 'Phone'}`;
  try {
    const r = await axios.post(`${API}/api/home/devices`, { user_id: hmUserId, home_id: hmHomeId, name, platform: /android/i.test(navigator.userAgent) ? 'android' : 'ios' });
    hmToast(`Device registered — BLE: ${r.data.ble_uuid}`);
    renderProfileTab(document.getElementById('hm-content'));
  } catch(e) { hmToast('Failed to register device', 'error'); }
}

// ── Helpers ──────────────────────────────────────────
function timeAgoHm(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
  return `${Math.floor(diff/86400000)}d`;
}

window.addEventListener('DOMContentLoaded', init);
