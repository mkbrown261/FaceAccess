#!/usr/bin/env python3
"""Browser smoke test for the FaceAccess business console.
Registers an org through the real UI, visits every page, checks for JS errors,
verifies the face-api models load, and exercises the invite link flow.
Usage: BASE=http://localhost:3000 python3 scripts/ui_smoke.py
"""
import os, sys, time, json, random
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
RUN = f"{int(time.time())}{random.randint(100,999)}"
errors, fails = [], []

def ok(desc, cond):
    print(('  ✅ ' if cond else '  ❌ ') + desc)
    if not cond: fails.append(desc)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console.error: {m.text}') if m.type == 'error' else None)

    print('══ Load auth wall')
    page.goto(BASE, wait_until='networkidle')
    ok('auth wall visible', page.is_visible('#auth-wall'))
    ok('no QA credentials on page', 'qa-' not in page.content().lower() and 'test1234' not in page.content().lower())

    print('══ Register organization via UI')
    page.click('#biz-tab-register')
    page.fill('#biz-reg-first', 'Ursula'); page.fill('#biz-reg-last', 'UI')
    page.fill('#biz-reg-email', f'ursula-{RUN}@uiorg.test')
    page.fill('#biz-reg-org', f'UI Org {RUN}')
    page.select_option('#biz-reg-size', '11-50'); page.fill('#biz-reg-industry', 'Testing')
    page.fill('#biz-reg-pw', 'Passw0rd123')
    page.check('#biz-reg-consent-terms')
    page.click('#biz-reg-btn')
    page.wait_for_selector('#auth-wall', state='hidden', timeout=15000)
    ok('auth wall dismissed after registration', not page.is_visible('#auth-wall'))
    ok('org name in sidebar', f'UI Org {RUN}' in page.inner_text('#biz-org-name'))
    ok('plan badge shows trial', 'TRIAL' in page.inner_text('#plan-badge'))
    ok('user role shown', 'admin' in page.inner_text('#biz-user-email'))
    page.wait_for_selector('#page-dashboard:not(.hidden)')
    try: page.wait_for_function("document.getElementById('page-dashboard').innerText.includes('Add your doors')", timeout=15000)
    except Exception: pass
    ok('dashboard shows onboarding (empty org)', 'Add your doors' in page.inner_text('#page-dashboard'))

    print('══ Face engine loads real models in browser')
    try:
        page.wait_for_function("document.getElementById('engine-label').textContent.includes('ready')", timeout=90000)
        ok('engine status = ready', True)
        info = page.evaluate("""() => ({
            ready: FaceAccessCameraEngine.isReady(),
            engine: FaceAccessCameraEngine.ENGINE_NAME,
            version: FaceAccessCameraEngine.VERSION,
            hasFaceApi: typeof faceapi !== 'undefined',
            recLoaded: typeof faceapi !== 'undefined' && faceapi.nets.faceRecognitionNet.isLoaded,
            detLoaded: typeof faceapi !== 'undefined' && faceapi.nets.tinyFaceDetector.isLoaded,
            lmLoaded: typeof faceapi !== 'undefined' && faceapi.nets.faceLandmark68Net.isLoaded,
        })""")
        print('     ', json.dumps(info))
        ok('faceRecognitionNet + tinyFaceDetector + landmark68 loaded', info['recLoaded'] and info['detLoaded'] and info['lmLoaded'])
    except Exception as e:
        ok(f'engine ready ({e})', False)

    print('══ Visit every page')
    for pg, needle in [('users', 'User Management'), ('doors', 'Door'), ('permissions', 'Permission'), ('approvals', 'Pending Approvals'),
                       ('logs', 'Log'), ('analytics', 'Analytics'), ('attendance', 'Attendance'), ('cameras', 'Camera'),
                       ('team', 'Team'), ('settings', 'Recognition Thresholds'), ('recognize', 'Face'), ('live', 'Live')]:
        page.click(f'#nav-{pg}')
        page.wait_for_selector(f'#page-{pg}:not(.hidden)')
        try: page.wait_for_function(f"document.getElementById('page-{pg}').innerText.trim().length > 20", timeout=8000)
        except Exception: pass
        txt = page.inner_text(f'#page-{pg}')
        if needle.lower() not in txt.lower(): print('      >>', txt[:200].replace('\n',' | '))
        ok(f'page {pg} renders ("{needle}")', needle.lower() in txt.lower() and 'Error:' not in txt)

    print('══ Settings shows distance thresholds & Team invite flow')
    page.click('#nav-settings'); page.wait_for_selector('#s-high')
    ok('threshold slider is a distance (0.45)', page.input_value('#s-high') in ('0.45', '0.450'))
    ok('no legacy 2FA/lockout fields', page.query_selector('#s-2fa') is None and page.query_selector('#s-lockout') is None)
    page.click('#nav-team'); page.wait_for_selector('#page-team:not(.hidden)'); time.sleep(0.5)
    ok('team lists the admin as (you)', '(you)' in page.inner_text('#page-team'))
    page.click('#page-team button:has-text("Invite Team Member")'); page.wait_for_selector('#inv-email')
    page.fill('#inv-email', f'op-{RUN}@uiorg.test'); page.select_option('#inv-role', 'operator')
    page.click('#inv-actions button:has-text("Create Invitation")'); page.wait_for_selector('#inv-url')
    invite_url = page.input_value('#inv-url')
    ok('invite URL generated', '?invite=' in invite_url)
    page.click('#inv-actions button')

    print('══ Add a door + person via UI')
    page.click('#nav-doors'); page.wait_for_selector('#page-doors:not(.hidden)'); time.sleep(0.5)
    page.click('#page-doors button:has-text("Add Door")')
    page.wait_for_selector('#modal-overlay:not(.hidden)')
    page.fill('#modal-content input[id*="name"]', 'Front Door')
    loc = page.query_selector('#modal-content input[id*="loc"]')
    if loc: loc.fill('Lobby')
    page.click('#modal-content button:has-text("Add Door"), #modal-content button:has-text("Save"), #modal-content button:has-text("Create")')
    time.sleep(1)
    ok('door appears in list', 'Front Door' in page.inner_text('#page-doors'))

    print('══ Accept invite in a fresh session')
    ctx2 = b.new_context(viewport={'width': 1400, 'height': 1600}); p2 = ctx2.new_page()
    p2.on('pageerror', lambda e: errors.append(f'pageerror(invite): {e}'))
    p2.goto(invite_url.replace('http://localhost:3000', BASE), wait_until='networkidle')
    p2.wait_for_selector('#biz-invite-banner', state='visible', timeout=10000)
    ok('invite banner shown', 'invited to join' in p2.inner_text('#biz-invite-banner'))
    ok('org block hidden for invitee', not p2.is_visible('#biz-reg-org-block'))
    ok('email prefilled + button says Join', p2.input_value('#biz-reg-email') == f'op-{RUN}@uiorg.test' and 'Join' in p2.inner_text('#biz-reg-btn'))
    p2.fill('#biz-reg-first', 'Oscar'); p2.fill('#biz-reg-last', 'Operator'); p2.fill('#biz-reg-pw', 'Passw0rd123')
    p2.check('#biz-reg-consent-terms'); p2.evaluate('void setTimeout(() => bizDoRegister(), 0)')
    p2.wait_for_selector('#auth-wall', state='hidden', timeout=15000)
    ok('invitee lands in same org', f'UI Org {RUN}' in p2.inner_text('#biz-org-name') and 'operator' in p2.inner_text('#biz-user-email'))
    p2.click('#nav-settings'); p2.wait_for_selector('#page-settings #s-high', timeout=10000)
    st = p2.inner_text('#page-settings'); print('      >>', st[:250].replace('\n',' | ')); ok('operator sees read-only settings', 'read-only' in st.lower() and p2.query_selector('#s-save-btn') is None)
    p2.click('#nav-doors'); p2.wait_for_selector('#page-doors:not(.hidden)')
    p2.wait_for_function("document.getElementById('page-doors').innerText.includes('Front Door')", timeout=60000)
    ok('operator sees the door the admin created', 'Front Door' in p2.inner_text('#page-doors'))

    print('══ Logout')
    page.click('text=Sign Out') if page.query_selector('text=Sign Out') else page.evaluate('void setTimeout(() => bizLogout(), 0)')
    page.wait_for_selector('#auth-wall', state='visible')
    ok('auth wall back after logout', page.is_visible('#auth-wall'))
    ok('token cleared', page.evaluate("localStorage.getItem('fa_biz_token')") is None)

    page.screenshot(path='/tmp/ui_after.png')
    b.close()

real_errors = [e for e in errors if 'tailwindcss' not in e and 'favicon' not in e]
print('\n══ JS errors:', len(real_errors))
for e in real_errors[:10]: print('   ', e[:300])
print(f'\nUI SMOKE: {"PASS" if not fails and not real_errors else "FAIL"}  ({len(fails)} failed checks)')
sys.exit(0 if not fails and not real_errors else 1)
