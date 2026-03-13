// ══════════════════════════════════════════════════════
//  FaceAccess Auth Library — shared across all surfaces
//  Handles: login, register, session, guard, logout
// ══════════════════════════════════════════════════════
'use strict';

const FA_AUTH = (() => {
  const TOKEN_KEY_BIZ    = 'fa_biz_token';
  const TOKEN_KEY_HOME   = 'fa_home_token';
  const TOKEN_KEY_MOBILE = 'fa_mobile_token';
  const ACCOUNT_KEY_BIZ  = 'fa_biz_account';
  const ACCOUNT_KEY_HOME = 'fa_home_account';

  function getToken(type) {
    if (type === 'business') return localStorage.getItem(TOKEN_KEY_BIZ);
    if (type === 'mobile')   return localStorage.getItem(TOKEN_KEY_MOBILE);
    return localStorage.getItem(TOKEN_KEY_HOME);
  }
  function setToken(type, token) {
    if (type === 'business') localStorage.setItem(TOKEN_KEY_BIZ, token);
    else if (type === 'mobile') localStorage.setItem(TOKEN_KEY_MOBILE, token);
    else localStorage.setItem(TOKEN_KEY_HOME, token);
  }
  function clearToken(type) {
    localStorage.removeItem(TOKEN_KEY_BIZ);
    localStorage.removeItem(TOKEN_KEY_HOME);
    localStorage.removeItem(TOKEN_KEY_MOBILE);
    localStorage.removeItem(ACCOUNT_KEY_BIZ);
    localStorage.removeItem(ACCOUNT_KEY_HOME);
  }
  function getAccount(type) {
    try {
      const key = type === 'business' ? ACCOUNT_KEY_BIZ : ACCOUNT_KEY_HOME;
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch { return null; }
  }
  function setAccount(type, account) {
    const key = type === 'business' ? ACCOUNT_KEY_BIZ : ACCOUNT_KEY_HOME;
    localStorage.setItem(key, JSON.stringify(account));
  }

  // axios auth header helper
  function authHeaders(type) {
    const token = getToken(type);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function verifySession(type) {
    const token = getToken(type);
    if (!token) return null;
    try {
      const r = await axios.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      return r.data.account;
    } catch { return null; }
  }

  async function loginBusiness(email, password) {
    const r = await axios.post('/api/auth/business/login', { email, password });
    setToken('business', r.data.token);
    setAccount('business', r.data.account);
    return r.data;
  }
  async function registerBusiness(data) {
    const r = await axios.post('/api/auth/business/register', data);
    setToken('business', r.data.token);
    setAccount('business', r.data.account);
    return r.data;
  }

  async function loginHome(email, password) {
    const r = await axios.post('/api/auth/home/login', { email, password });
    setToken('home', r.data.token);
    setAccount('home', r.data.account);
    return r.data;
  }
  async function registerHome(data) {
    const r = await axios.post('/api/auth/home/register', data);
    setToken('home', r.data.token);
    setAccount('home', r.data.account);
    return r.data;
  }

  async function loginMobile(email, password) {
    const r = await axios.post('/api/auth/home/login', { email, password });
    setToken('mobile', r.data.token);
    setAccount('home', r.data.account);
    return r.data;
  }
  async function registerMobile(data) {
    const r = await axios.post('/api/auth/home/register', { ...data, account_type: 'mobile' });
    setToken('mobile', r.data.token);
    setAccount('home', r.data.account);
    return r.data;
  }

  async function logout(type) {
    const token = getToken(type);
    if (token) {
      await axios.post('/api/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    clearToken(type);
  }

  // Guards: redirects to login if not authenticated
  async function guardBusiness() {
    const account = await verifySession('business');
    if (!account) { window.location.href = '/?login=1'; return null; }
    return account;
  }
  async function guardHome() {
    const account = await verifySession('home');
    if (!account) { window.location.href = '/home?login=1'; return null; }
    return account;
  }
  async function guardMobile() {
    const account = await verifySession('mobile') || await verifySession('home');
    if (!account) { window.location.href = '/home/mobile?login=1'; return null; }
    return account;
  }

  // Validators
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function validPhone(p) { return /^\+?[\d\s\-\(\)]{7,20}$/.test(p.trim()); }
  function validPassword(p) { return p.length >= 8 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p); }

  return {
    getToken, setToken, clearToken, getAccount, setAccount, authHeaders,
    verifySession, loginBusiness, registerBusiness, loginHome, registerHome,
    loginMobile, registerMobile, logout,
    guardBusiness, guardHome, guardMobile,
    validEmail, validPhone, validPassword
  };
})();
