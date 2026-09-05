#!/usr/bin/env python3
"""
Real-face end-to-end: enrol REAL 128-d descriptors (produced by scripts/face_matrix.py from
real photos using the app's own face-api build) into a fresh organisation, then push every
other real face through POST /api/business/recognize and check the server's decisions.

Ground truth (from the face-api demo photos):
  sample1#2 == sample3#1   (same woman, blonde)
  sample1#1 == sample4#0   (same woman, dark hair)
  every other pair is a different person.

Usage:  BASE=http://localhost:3000 python3 scripts/real_face_e2e.py
Requires /tmp/face_descriptors.json (run `npm run test:faces` first).
"""
import json, os, sys, time, random, urllib.request

BASE = os.environ.get("BASE", "http://localhost:3000")
DESC_FILE = os.environ.get("DESC_FILE", "/tmp/face_descriptors.json")
SAME = {("sample1#2", "sample3#1"), ("sample1#1", "sample4#0")}
SAME |= {(b, a) for a, b in SAME}

def api(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "FaceAccess-RealFaceE2E/1.0")
    if token: req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

if not os.path.exists(DESC_FILE):
    print(f"missing {DESC_FILE} — run `python3 scripts/face_matrix.py` first"); sys.exit(2)
faces = json.load(open(DESC_FILE))["faces"]
by_id = {f["id"]: f["desc"] for f in faces}
print(f"loaded {len(faces)} real descriptors")

run = f"{int(time.time())}{random.randint(100,999)}"
st, body = api("POST", "/api/auth/business/register", body={
    "org_name": f"RealFace {run}", "first_name": "Real", "last_name": "Face", "email": f"rf-{run}@test.local",
    "password": "Str0ngPassw0rd!", "consent_terms": True, "org_size": "1-10", "industry": "other"})
assert st in (200, 201), body
tok = body["token"]
st, body = api("POST", "/api/business/doors", tok, {"name": "Lab Door", "location": "L1", "security_level": "high"})
door = body["door"]["id"]
st, body = api("POST", "/api/business/permissions", tok, {"role": "employee", "door_id": door,
    "days_allowed": "mon,tue,wed,thu,fri,sat,sun", "time_start": "00:00", "time_end": "23:59"})
assert st in (200, 201), body

# Enrol ONE face per person: everyone in sample1 + everyone in sample2 (all distinct people).
enrolled = {}
for fid in sorted(by_id):
    if fid.startswith("sample1#") or fid.startswith("sample2#"):
        st, body = api("POST", "/api/business/users", tok, {"name": fid, "email": f"{fid.replace('#','-')}-{run}@test.local", "role": "employee"})
        uid = body["user"]["id"]
        st, body = api("POST", f"/api/business/users/{uid}/face", tok, {"descriptor": by_id[fid], "quality": 0.9, "liveness_score": 0.95})
        assert st == 200, (fid, st, body)
        enrolled[fid] = uid
print(f"enrolled {len(enrolled)} people (one real descriptor each)")

# Probe with every face NOT enrolled.
false_grant = 0; missed = 0; correct_reject = 0; correct_match = 0; review = 0
for fid, desc in sorted(by_id.items()):
    if fid in enrolled: continue
    st, body = api("POST", "/api/business/recognize", tok, {"door_id": door, "descriptor": desc, "liveness_score": 0.95})
    assert st == 200, (fid, st, body)
    result = body.get("result"); matched = body.get("user", {}).get("name") if body.get("user") else None
    is_same = matched is not None and (fid, matched) in SAME
    truth_has_twin = any((fid, e) in SAME for e in enrolled)
    d = body.get('distance'); conf = body.get('confidence')
    shown = f"dist={d:.3f}" if isinstance(d, (int, float)) else (f"conf={conf:.3f}" if isinstance(conf, (int, float)) else "")
    reason = body.get('reason') or ''
    line = f"  {fid:10s} → {str(result):12s} {reason:16s} match={matched or '-':10s} {shown}"
    if result == "granted":
        if is_same: correct_match += 1; print(line, "✅ true accept")
        else: false_grant += 1; print(line, "❌ FALSE ACCEPT")
    elif result == "pending_2fa":
        review += 1; print(line, "🟡 sent to approval", "(same person)" if is_same else "(stranger)")
    else:
        if truth_has_twin and reason == 'ambiguous_match': missed += 1; print(line, "🟡 same person present but a stranger was within the margin → refused (safe)")
        elif truth_has_twin: missed += 1; print(line, "⚠️  missed a real match (false reject)")
        else: correct_reject += 1; print(line, "✅ correctly rejected")

print("\n══ Real-face results against the live /recognize endpoint")
print(f"  strangers correctly rejected : {correct_reject}")
print(f"  strangers falsely GRANTED    : {false_grant}   ← must be 0")
print(f"  same-person auto-granted     : {correct_match}")
print(f"  routed to admin approval     : {review}")
print(f"  same-person refused           : {missed}  (ambiguous/no_match — never granted to the wrong person)")
ok = false_grant == 0
print("\nREAL-FACE E2E:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
