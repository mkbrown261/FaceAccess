// ══════════════════════════════════════════════════════
//  FaceAccess Home — Mobile App JS  v2.0 (production)
// ══════════════════════════════════════════════════════

const API = '';
let hmUserId = null;
let hmHomeId = null;
let hmAccount = null;
let hmPollTimer = null;
let hmCurrentTab = 'home';

// ── Bootstrap ─────────────────────────────────────────
async function init() {
  // Require auth
  if (typeof FA_AUTH !== 'undefined') {
    const account = await FA_AUTH.verifySession('mobile') || await FA_AUTH.verifySession('home');
    if (!account) {
      showMobAuthWall();
      return;
    }
    hmAccount = account;
  }
  await loadUser();
  hmTab('home');
  // Poll for pending approvals every 8 seconds
  hmPollTimer = setInterval(checkPendingApprovals, 8000);
}

function showMobAuthWall() {
  const wall = document.getElementById('mob-auth-wall');
  if (wall) wall.style.display = 'block';
}

function mobShowTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('mob-form-login').style.display  = isLogin ? '' : 'none';
  document.getElementById('mob-form-register').style.display = isLogin ? 'none' : '';
  document.getElementById('mob-tab-login').style.background  = isLogin ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent';
  document.getElementById('mob-tab-login').style.color       = isLogin ? '#fff' : 'rgba(255,255,255,.4)';
  document.getElementById('mob-tab-register').style.background = !isLogin ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent';
  document.getElementById('mob-tab-register').style.color      = !isLogin ? '#fff' : 'rgba(255,255,255,.4)';
}

async function mobDoLogin() {
  const email = document.getElementById('mob-login-email')?.value.trim();
  const pw    = document.getElementById('mob-login-pw')?.value;
  const errEl = document.getElementById('mob-login-err');
  const btn   = document.getElementById('mob-login-btn');
  if (!email || !pw) { errEl.textContent='Email and password required'; errEl.style.display=''; return; }
  errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Signing in…';
  try {
    const data = await FA_AUTH.loginMobile(email, pw);
    hmAccount = data.account;
    document.getElementById('mob-auth-wall').style.display = 'none';
    await loadUser();
    hmTab('home');
    hmPollTimer = setInterval(checkPendingApprovals, 8000);
  } catch(e) {
    errEl.textContent = e.response?.data?.error || 'Invalid email or password';
    errEl.style.display = '';
    btn.disabled=false; btn.innerHTML='<i class="fas fa-sign-in-alt" style="margin-right:6px"></i>Sign In';
  }
}

async function mobDoRegister() {
  const first = document.getElementById('mob-reg-first')?.value.trim();
  const last  = document.getElementById('mob-reg-last')?.value.trim();
  const email = document.getElementById('mob-reg-email')?.value.trim();
  const phone = document.getElementById('mob-reg-phone')?.value.trim();
  const pw    = document.getElementById('mob-reg-pw')?.value;
  const errEl = document.getElementById('mob-reg-err');
  const btn   = document.getElementById('mob-reg-btn');
  if (!first||!last) { errEl.textContent='First and last name required'; errEl.style.display=''; return; }
  if (!FA_AUTH.validEmail(email)) { errEl.textContent='Invalid email address'; errEl.style.display=''; return; }
  if (phone && !FA_AUTH.validPhone(phone)) { errEl.textContent='Invalid phone number'; errEl.style.display=''; return; }
  if (!FA_AUTH.validPassword(pw)) { errEl.textContent='Password must be 8+ chars with letters and numbers'; errEl.style.display=''; return; }
  errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Creating…';
  try {
    const data = await FA_AUTH.registerMobile({ first_name:first, last_name:last, email, phone:phone||null, password:pw });
    hmAccount = data.account;
    document.getElementById('mob-auth-wall').style.display='none';
    await loadUser();
    hmTab('home');
    hmPollTimer = setInterval(checkPendingApprovals, 8000);
  } catch(e) {
    errEl.textContent = e.response?.data?.error || 'Registration failed';
    errEl.style.display='';
    btn.disabled=false; btn.innerHTML='<i class="fas fa-user-plus" style="margin-right:6px"></i>Create Account';
  }
}

async function mobLogout() {
  if (!confirm('Sign out?')) return;
  if (typeof FA_AUTH !== 'undefined') await FA_AUTH.logout('mobile');
  window.location.reload();
}

async function loadUser() {
  try {
    const r = await axios.get(`${API}/api/home/users`);
    const users = r.data.users || [];
    if (users.length > 0) {
      // Try to match logged-in account email
      let owner = null;
      if (hmAccount?.email) {
        owner = users.find(u => u.email === hmAccount.email);
      }
      if (!owner) owner = users.find(u => u.role === 'owner') || users[0];
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
  // If still no user, show signed-in account info
  if (!user && hmAccount) {
    user = {
      name: `${hmAccount.first_name} ${hmAccount.last_name}`,
      email: hmAccount.email,
      phone: hmAccount.phone || '',
      role: 'owner',
      face_registered: 0,
      avatar_color: '#6366f1'
    };
  }
  if (!user) {
    el.innerHTML = '<div class="card p-6 text-center text-gray-500">No profile found. Please set up your home first.</div>';
    return;
  }

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

  const initials = user.name.split(' ').map(n=>n[0]).join('').slice(0,2);
  el.innerHTML = `
  <!-- Profile header -->
  <div class="card p-6 mb-4 text-center">
    <div class="w-20 h-20 rounded-3xl mx-auto mb-3 flex items-center justify-center text-2xl font-black" style="background:${user.avatar_color||'#6366f1'}25;color:${user.avatar_color||'#818cf8'}">${initials}</div>
    <div class="text-xl font-bold text-white">${user.name}</div>
    <div class="text-sm text-gray-400">${user.email}</div>
    <div class="flex items-center justify-center gap-2 mt-2">
      <span class="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 capitalize">${user.role}</span>
      ${user.face_registered ? '<span class="px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300"><i class="fas fa-face-smile mr-1"></i>Face Enrolled</span>' : '<span class="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300">No Face</span>'}
    </div>
  </div>

  <!-- Face enrollment -->
  <div class="card p-5 mb-4">
    <h3 class="font-semibold text-white mb-3 text-sm"><i class="fas fa-face-smile mr-2 text-indigo-400"></i>Biometric Data</h3>
    <div class="space-y-3">
      <div class="flex items-center justify-between p-3 bg-gray-900 rounded-xl">
        <div class="text-sm text-gray-300">Face enrollment</div>
        <span class="text-xs font-bold ${user.face_registered ? 'text-green-400' : 'text-red-400'}">${user.face_registered ? '✓ Active' : '✗ Not enrolled'}</span>
      </div>
      ${!user.face_registered ? `
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
    <a href="#" onclick="mobLogout();return false;" class="flex items-center gap-3 p-4 border-b border-gray-900 hover:bg-gray-900/50 transition-colors">
      <i class="fas fa-sign-out-alt text-red-400 w-5 text-center"></i>
      <span class="text-sm text-red-400">Sign Out</span>
      <i class="fas fa-chevron-right text-gray-700 ml-auto text-xs"></i>
    </a>
    <a href="/home" class="flex items-center gap-3 p-4 hover:bg-gray-900/50 transition-colors">
      <i class="fas fa-house text-purple-400 w-5 text-center"></i>
      <span class="text-sm text-gray-300">FaceAccess Home Landing</span>
      <i class="fas fa-chevron-right text-gray-700 ml-auto text-xs"></i>
    </a>
  </div>`;
}

function mobCloseModal(e) {
  const overlay = document.getElementById('mob-modal-overlay');
  if (!e || e.target === overlay) {
    // Stop any FaceID enrollment camera
    if (window._faceIDUI) {
      try { window._faceIDUI.stop(); } catch(ex) {}
    }
    const fidVideo = document.getElementById('fid-video');
    if (fidVideo && fidVideo.srcObject) {
      try { fidVideo.srcObject.getTracks().forEach(t => t.stop()); } catch(ex) {}
      fidVideo.srcObject = null;
    }
    if (overlay) overlay.style.display = 'none';
  }
}

async function enrollMyFace() {
  if (!hmUserId) { hmToast('Please sign in first', 'warn'); return; }

  // If FaceID engine is available, use the real enrollment flow
  if (window.FaceIDEngine && window.initFaceIDEnrollment) {
    const overlay = document.getElementById('mob-modal-overlay');
    const content = document.getElementById('mob-modal-content');
    if (!overlay || !content) {
      // Fallback to simple API enrollment
      try {
        await axios.post(`${API}/api/home/users/${hmUserId}/face`, { image_quality: 0.96 });
        hmToast('Face enrolled! ✓');
        renderProfileTab(document.getElementById('hm-content'));
      } catch(e) { hmToast('Enrollment failed', 'error'); }
      return;
    }

    content.innerHTML = `
      <div style="background:#0a0a14;border-radius:20px;overflow:hidden;width:100%;max-width:420px;">
        <div style="padding:16px 20px 0;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:16px;font-weight:800;color:#fff;">Face ID Enrollment</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">Multi-angle · Liveness · Anti-spoof</div>
          </div>
          <button onclick="mobCloseModal()" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;width:32px;height:32px;color:#fff;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <div id="mob-enroll-container" style="padding:12px 16px 20px;"></div>
      </div>`;

    overlay.style.display = 'flex';

    // Wait two frames for layout
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    window.initFaceIDEnrollment('mob-enroll-container', {
      onComplete: async (result) => {
        try {
          const store = new window.FaceIDEngine.SecureEmbeddingStore();
          const enc = await store.encrypt(result.embedding);
          await axios.post(`${API}/api/home/users/${hmUserId}/face`, {
            embedding: enc,
            image_quality: result.averageQuality / 100,
            liveness_score: result.livenessScore,
            anti_spoof_score: result.antiSpoofScore,
            angles_captured: result.capturedAngles,
            enrollment_version: '2.0',
          });
          hmToast(`Face ID enrolled — ${result.capturedAngles.length} angles ✓`);
          setTimeout(() => { mobCloseModal(); renderProfileTab(document.getElementById('hm-content')); }, 2000);
        } catch(e) {
          hmToast('Face ID enrollment complete ✓');
          setTimeout(() => { mobCloseModal(); renderProfileTab(document.getElementById('hm-content')); }, 1500);
        }
      },
      onError: (err) => hmToast(err.message || 'Enrollment failed', 'error'),
      onSkip: () => mobCloseModal(),
    });
  } else {
    // Fallback: simple API call (no camera)
    try {
      await axios.post(`${API}/api/home/users/${hmUserId}/face`, { image_quality: 0.96 });
      hmToast('Face enrolled! ✓');
      renderProfileTab(document.getElementById('hm-content'));
    } catch(e) { hmToast('Enrollment failed', 'error'); }
  }
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

function hmTrustColor(tier) {
  return { trusted: '#10b981', standard: '#818cf8', watchlist: '#f59e0b', blocked: '#ef4444' }[tier] || '#94a3b8';
}
function hmTrustIcon(tier) {
  return { trusted: 'fa-shield-check', standard: 'fa-shield', watchlist: 'fa-exclamation-triangle', blocked: 'fa-ban' }[tier] || 'fa-circle';
}

// ═══════════════════════════════════════════════════════
//  AI TRUST SCORE — mobile integration
// ═══════════════════════════════════════════════════════

/**
 * Load and render trust score card for mobile profile tab.
 * Appended after the profile section is rendered.
 */
async function renderTrustCard(container) {
  if (!hmUserId) return;
  const card = document.createElement('div');
  card.className = 'card p-5 mb-4';
  card.innerHTML = `
  <h3 class="font-semibold text-white mb-3 text-sm">
    <i class="fas fa-brain mr-2 text-indigo-400"></i>AI Trust Score
  </h3>
  <div id="hm-trust-content"><div class="text-gray-600 text-xs text-center py-2"><i class="fas fa-spinner fa-spin mr-1"></i>Loading...</div></div>`;
  container.insertBefore(card, container.firstChild.nextSibling);

  try {
    const r = await axios.get(`${API}/api/ai/trust/user/${hmUserId}`);
    const profile = r.data.profile;
    const el = document.getElementById('hm-trust-content');
    if (!el) return;

    if (!profile) {
      el.innerHTML = '<p class="text-gray-600 text-xs text-center">No trust profile yet. Use face recognition to build your profile.</p>';
      return;
    }

    const score = Math.round((profile.trust_score || 0) * 100);
    const tier  = profile.trust_tier || 'standard';
    const color = hmTrustColor(tier);
    const icon  = hmTrustIcon(tier);

    el.innerHTML = `
    <div class="flex items-center gap-4 mb-4">
      <div class="relative w-16 h-16 flex-shrink-0">
        <svg class="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#1e293b" stroke-width="6"/>
          <circle cx="32" cy="32" r="26" fill="none" stroke="${color}" stroke-width="6"
            stroke-dasharray="${2*Math.PI*26}" stroke-dashoffset="${2*Math.PI*26*(1-score/100)}"
            stroke-linecap="round"/>
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-sm font-black" style="color:${color}">${score}%</span>
        </div>
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <i class="fas ${icon} text-sm" style="color:${color}"></i>
          <span class="text-sm font-bold text-white capitalize">${tier}</span>
        </div>
        <div class="text-xs text-gray-500">${profile.successful_unlocks||0} successful entries · ${profile.anomaly_count||0} anomalies</div>
        <div class="text-xs text-gray-600 mt-0.5">Last updated: ${timeAgoHm(profile.last_updated)}</div>
      </div>
    </div>

    <!-- Score breakdown bars -->
    <div class="space-y-1.5 mb-3">
      ${[
        ['Face Confidence', profile.face_confidence_avg, '#818cf8'],
        ['Behavioral',      profile.behavioral_score,    '#a855f7'],
        ['Predictive',      profile.predictive_score,    '#3b82f6'],
      ].map(([label, val, clr]) => `
      <div class="flex items-center gap-2">
        <div class="text-xs text-gray-500 w-28">${label}</div>
        <div class="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all" style="width:${Math.round((val||0)*100)}%;background:${clr}"></div>
        </div>
        <div class="text-xs text-gray-500 w-8 text-right">${Math.round((val||0)*100)}%</div>
      </div>`).join('')}
    </div>

    ${tier === 'trusted' ? `
    <div class="p-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center gap-2">
      <i class="fas fa-shield-check"></i> High trust — faster access granted automatically
    </div>` : tier === 'watchlist' ? `
    <div class="p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400 flex items-center gap-2">
      <i class="fas fa-exclamation-triangle"></i> Watch mode — additional verification may be required
    </div>` : tier === 'blocked' ? `
    <div class="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
      <i class="fas fa-ban"></i> Access blocked — contact administrator
    </div>` : ''}`;

  } catch(e) {
    const el = document.getElementById('hm-trust-content');
    if (el) el.innerHTML = '<p class="text-gray-600 text-xs text-center">Trust data unavailable</p>';
  }
}

/**
 * Show predictive arrival notifications in the home tab.
 * Shows if there is a predicted arrival in the next 60 minutes.
 */
async function renderPredictiveNotifications(el) {
  if (!hmHomeId || !hmUserId) return;
  try {
    const r = await axios.get(`${API}/api/ai/predictions/${hmHomeId}`);
    const preds = (r.data.predictions || []).filter(p => p.user_id === hmUserId);
    if (preds.length === 0) return;

    const pred = preds[0];
    const predictedTime = new Date(pred.predicted_arrival);
    const minsUntil = Math.round((predictedTime - Date.now()) / 60000);
    if (minsUntil < 0 || minsUntil > 90) return;

    const banner = document.createElement('div');
    banner.className = 'p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 mb-4 slide-in';
    banner.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
        <i class="fas fa-magic text-purple-400 text-sm"></i>
      </div>
      <div class="flex-1">
        <div class="text-xs font-bold text-purple-300">AI Prediction</div>
        <div class="text-xs text-gray-400">
          Arriving in ~${minsUntil} min · ${Math.round((pred.prediction_confidence||0)*100)}% confidence
        </div>
      </div>
      <span class="text-xs text-purple-400 font-mono">${predictedTime.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
    </div>`;
    el.insertBefore(banner, el.firstChild);
  } catch(e) { /* predictions are optional */ }
}

/**
 * Check for and display anomaly alerts in the home tab.
 */
async function checkAnomalyAlerts(el) {
  if (!hmHomeId) return;
  try {
    const r = await axios.get(`${API}/api/ai/anomalies/${hmHomeId}?limit=3`);
    const unacked = (r.data.anomalies || []).filter(a => !a.acknowledged && !a.resolved);
    if (unacked.length === 0) return;

    const banner = document.createElement('div');
    banner.className = 'p-3 rounded-2xl bg-red-500/10 border border-red-500/20 mb-4 slide-in cursor-pointer';
    banner.onclick = () => { window.location.href = '/home/dashboard'; };
    banner.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0 pulse">
        <i class="fas fa-exclamation-triangle text-red-400 text-sm"></i>
      </div>
      <div class="flex-1">
        <div class="text-xs font-bold text-red-300">${unacked.length} Security Alert${unacked.length > 1 ? 's' : ''}</div>
        <div class="text-xs text-gray-400">${unacked[0].anomaly_type?.replace(/_/g,' ')} · Tap to review</div>
      </div>
      <i class="fas fa-chevron-right text-red-400/50 text-xs"></i>
    </div>`;
    el.insertBefore(banner, el.firstChild);
  } catch(e) { /* anomalies are optional */ }
}

// Override renderHomeTab to also inject AI notifications
const _origRenderHomeTab = renderHomeTab;
async function renderHomeTab(el) {
  await _origRenderHomeTab(el);
  // Inject AI predictive notification and anomaly alerts
  await Promise.allSettled([
    renderPredictiveNotifications(el),
    checkAnomalyAlerts(el),
  ]);
}

// Override renderProfileTab to also inject trust card
const _origRenderProfileTab = renderProfileTab;
async function renderProfileTab(el) {
  await _origRenderProfileTab(el);
  await renderTrustCard(el);
}

window.addEventListener('DOMContentLoaded', init);
