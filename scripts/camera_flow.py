#!/usr/bin/env python3
"""
Drive the REAL Face ID camera UI (enrolment modal + Face ID Test Console) in headless
Chromium with a virtual webcam that behaves like a cooperative user: navigator.mediaDevices
.getUserMedia is replaced by a canvas.captureStream() showing a real face, and the test
reads the engine's on-screen instruction ("turn LEFT", "look UP", ...) and switches the
displayed head pose accordingly — exactly what a person in front of the camera does.

Usage:
  BASE=https://faceaccess.pages.dev POSES=/tmp/cam/poses.json python3 scripts/camera_flow.py
POSES is a JSON {center,left,right,up,down} -> data:image/jpeg;base64 URLs (see scripts/make_poses.py).

Reports every UI state change the user would see, the engine result, the server
response for enrol and for recognise, and any JS errors / camera errors.
"""
import os, sys, time, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
POSES = os.environ.get('POSES', '/tmp/cam/poses.json')
IMPOSTER = os.environ.get('IMPOSTER', os.path.join(os.path.dirname(POSES), 'poses_imposter.json'))  # second person → must NOT be granted
if not os.path.exists(POSES):
    import subprocess
    subprocess.check_call([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make_poses.py'),
                           '--out', os.path.dirname(POSES) or '.'])
poses = json.load(open(POSES))
imposter = json.load(open(IMPOSTER)) if IMPOSTER and os.path.exists(IMPOSTER) else None
RUN  = str(int(time.time()))
fails = []
def ok(label, cond, extra=''):
    print(f"  {'✅' if cond else '❌'} {label}{(' — ' + extra) if extra else ''}")
    if not cond: fails.append(label)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 1200}, permissions=['camera'])
    ctx.add_init_script("""
      window.__cam = { pose: 'center', imgs: {}, fps: 15 };
      navigator.mediaDevices.getUserMedia = async function(constraints) {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d');
        const draw = () => { const im = window.__cam.imgs[window.__cam.pose] || window.__cam.imgs.center; if (im) g.drawImage(im, 0, 0, 640, 480); };
        draw(); const iv = setInterval(draw, 1000 / window.__cam.fps);
        const stream = c.captureStream(window.__cam.fps);
        const stop = stream.getVideoTracks()[0].stop.bind(stream.getVideoTracks()[0]);
        stream.getVideoTracks()[0].stop = () => { clearInterval(iv); stop(); };
        return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'virtual', label: 'Virtual Camera' }];
    """)
    page = ctx.new_page()
    js_errors, cam_errors, toasts = [], [], []
    page.on('pageerror', lambda e: js_errors.append(str(e)))
    page.on('console', lambda m: (cam_errors.append(m.text) if m.type in ('error',) else None))

    print('══ Register org')
    page.goto(BASE, wait_until='networkidle')
    page.evaluate("""async (poses) => { for (const [k, src] of Object.entries(poses)) { const im = new Image(); im.src = src; await im.decode(); window.__cam.imgs[k] = im; } }""", poses)
    def follow_instructions(instr_text):
        t = (instr_text or '').upper()
        pose = 'left' if 'LEFT' in t else 'right' if 'RIGHT' in t else 'up' if ' UP' in t else 'down' if 'DOWN' in t else 'center'
        page.evaluate("p => { window.__cam.pose = p }", pose)
        return pose
    page.evaluate("bizShowTab('register')")
    page.fill('#biz-reg-first', 'Cam'); page.fill('#biz-reg-last', 'Tester')
    page.fill('#biz-reg-email', f'cam-{RUN}@test.local'); page.fill('#biz-reg-pw', 'Str0ngPassw0rd!')
    page.fill('#biz-reg-org', f'Cam Org {RUN}')
    for sel in ['#biz-reg-consent-terms', '#biz-reg-consent-sms']:
        try: page.check(sel, timeout=1000)
        except Exception: pass
    page.evaluate('void setTimeout(() => bizDoRegister(), 0)')
    page.wait_for_selector('#biz-org-name', state='visible', timeout=30000)
    page.wait_for_function("document.getElementById('biz-org-name').textContent.includes('Cam Org')", timeout=20000)
    ok('registered + dashboard', True)
    page.wait_for_function("document.getElementById('engine-label').textContent.includes('ready')", timeout=90000)
    ok('engine ready in browser', True, 'backend=' + str(page.evaluate('FaceAccessCameraEngine.getBackend && FaceAccessCameraEngine.getBackend()')))

    print('══ Door + person via API (same session token)')
    tok = page.evaluate("localStorage.getItem('fa_biz_token')")
    door = page.evaluate("""async (t) => { const r = await fetch('/api/business/doors', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+t}, body: JSON.stringify({name:'Front Door', location:'Lobby', security_level:'high'})}); return (await r.json()).door.id }""", tok)
    page.evaluate("""async (t) => { await fetch('/api/business/permissions', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+t}, body: JSON.stringify({role:'employee', door_id:%r, days_allowed:'mon,tue,wed,thu,fri,sat,sun', time_start:'00:00', time_end:'23:59'})}) }""" % door, tok)
    uid = page.evaluate("""async (t) => { const r = await fetch('/api/business/users', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+t}, body: JSON.stringify({name:'Blonde Woman', email:'bw-%s@test.local', role:'employee'})}); return (await r.json()).user.id }""" % RUN, tok)
    ok('door + permission + person created', bool(door and uid))

    print('══ ENROL via the real camera modal')
    page.evaluate("showPage('users')")
    page.wait_for_selector('#page-users:not(.hidden)')
    page.evaluate(f"openRegisterFaceModal('{uid}', 'Blonde Woman')")
    page.wait_for_selector('#enroll-faceid-mount video', timeout=15000)
    seen = set(); t0 = time.time(); enrol_result = None
    while time.time() - t0 < 75:
        st = page.evaluate("document.getElementById('enroll-status') ? document.getElementById('enroll-status').textContent.trim() : ''")
        instr = page.evaluate("(document.querySelector('#enroll-faceid-mount ._fce_instr')||{}).textContent || ''")
        follow_instructions(instr)
        for s in (st, instr):
            if s and s not in seen: seen.add(s); print(f"     [{time.time()-t0:5.1f}s] {s}")
        if 'samples' in st and 'Quality' in st: enrol_result = st; break
        if 'failed' in st.lower() or 'interrupted' in st.lower() or 'No face' in st or 'Cannot start' in instr: enrol_result = st or instr; break
        time.sleep(0.25)
    ok('enrolment completed and saved', bool(enrol_result) and 'samples' in enrol_result, enrol_result or 'timed out')
    fr = page.evaluate("""async (t) => { const r = await fetch('/api/business/users', {headers:{Authorization:'Bearer '+t}}); const j = await r.json(); return j.users.find(u => u.name==='Blonde Woman') }""", tok)
    ok('server shows face_registered=1', fr and fr.get('face_registered') == 1, json.dumps({k: fr.get(k) for k in ('face_registered','face_sample_count','face_quality')} if fr else {}))
    try: page.evaluate('closeModal()')
    except Exception: pass

    print('══ RECOGNISE via Face ID Test Console')
    page.evaluate("showPage('recognize')")
    page.wait_for_selector('#rec-faceid-mount video', timeout=15000)
    page.select_option('#rec-door', door)
    t0 = time.time(); seen = set(); scan_done = False
    while time.time() - t0 < 75:
        es = page.evaluate("(document.getElementById('rec-engine-status')||{}).textContent || ''").strip()
        sb = page.evaluate("(document.getElementById('rec-status-box')||{}).innerText || ''").strip().replace('\n', ' | ')
        follow_instructions(page.evaluate("(document.querySelector('#rec-faceid-mount ._fce_instr')||{}).textContent || ''"))
        for s in (es, sb):
            if s and s not in seen: seen.add(s); print(f"     [{time.time()-t0:5.1f}s] {s}")
        if 'Scan Ready' in es: scan_done = True; break
        if 'Error' in es:
            panel = page.evaluate("(document.querySelector('#rec-faceid-mount ._fce_msg')||{}).innerText || ''").replace('\n',' | ')
            print('     engine panel:', panel[:200]); break
        time.sleep(0.4)
    ok('verification scan completed (liveness passed)', scan_done, es)
    if scan_done:
        page.click('#rec-identify-btn')
        page.wait_for_function("!document.getElementById('rec-identify-btn').innerText.includes('Analyzing')", timeout=20000)
        time.sleep(0.5)
        res = page.evaluate("(document.getElementById('rec-result-card')||document.getElementById('rec-result')||document.getElementById('rec-status-box')||{}).innerText || ''").replace('\n', ' | ')
        print('     result panel:', res[:300])
        logs = page.evaluate("""async (t) => { const r = await fetch('/api/business/logs?limit=1', {headers:{Authorization:'Bearer '+t}}); return (await r.json()).logs[0] }""", tok)
        print('     server log  :', json.dumps({k: logs.get(k) for k in ('result','denial_reason','user_name','confidence','match_distance','liveness_score')}))
        ok('server matched the enrolled person', logs.get('user_name') == 'Blonde Woman', f"result={logs.get('result')} dist={logs.get('match_distance')}")
        ok('access GRANTED end-to-end', logs.get('result') == 'granted', logs.get('denial_reason') or '')

    if imposter and scan_done:
        print('══ IMPOSTER: a different person walks up to the same door')
        page.evaluate("""async (poses) => { for (const [k, src] of Object.entries(poses)) { const im = new Image(); im.src = src; await im.decode(); window.__cam.imgs[k] = im; } }""", imposter)
        page.wait_for_function("document.getElementById('rec-identify-btn').disabled === true", timeout=20000)  # engine remounted after previous identify
        page.wait_for_selector('#rec-faceid-mount video', timeout=20000)
        page.select_option('#rec-door', door)
        t0 = time.time(); scan2 = False
        while time.time() - t0 < 75:
            es = page.evaluate("(document.getElementById('rec-engine-status')||{}).textContent || ''").strip()
            follow_instructions(page.evaluate("(document.querySelector('#rec-faceid-mount ._fce_instr')||{}).textContent || ''"))
            if page.evaluate("document.getElementById('rec-identify-btn').disabled === false"): scan2 = True; break
            if 'Error' in es: break
            time.sleep(0.25)
        ok('imposter scan completed', scan2, es)
        if scan2:
            page.click('#rec-identify-btn')
            page.wait_for_function("!document.getElementById('rec-identify-btn').innerText.includes('Analyzing')", timeout=20000); time.sleep(0.5)
            res = page.evaluate("(document.getElementById('rec-result-card')||document.getElementById('rec-result')||{}).innerText || ''").replace('\n', ' | ')
            print('     result panel:', res[:200])
            lg = page.evaluate("""async (t) => { const r = await fetch('/api/business/logs?limit=1', {headers:{Authorization:'Bearer '+t}}); return (await r.json()).logs[0] }""", tok)
            print('     server log  :', json.dumps({k: lg.get(k) for k in ('result','denial_reason','user_name','match_distance')}))
            ok('imposter NOT granted', lg.get('result') != 'granted', f"result={lg.get('result')} reason={lg.get('denial_reason')} dist={lg.get('match_distance')}")

    print(f'\n══ JS errors: {len(js_errors)}'); [print('   ', e[:200]) for e in js_errors]
    real_cam_errors = [e for e in cam_errors if 'favicon' not in e and '401' not in e]
    print(f'══ console errors: {len(real_cam_errors)}'); [print('   ', e[:200]) for e in real_cam_errors[:10]]
    page.screenshot(path='/tmp/camera_flow.png')
    b.close()

print('\nCAMERA FLOW:', 'PASS' if not fails and not js_errors else f'FAIL ({len(fails)} checks)')
sys.exit(0 if not fails and not js_errors else 1)
