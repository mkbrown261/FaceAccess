#!/usr/bin/env bash
# FaceAccess Business — end-to-end API test.
# Usage: BASE=http://localhost:3000 bash scripts/e2e.sh
set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0
RUN=$(date +%s)$RANDOM
J() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
req() { # method path token body -> prints "STATUS\nBODY"
  local m=$1 p=$2 t=$3 b=${4:-}
  local args=(-s -X "$m" "$BASE$p" -H 'Content-Type: application/json' -w $'\n%{http_code}')
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$b" ] && args+=(-d "$b")
  local out; out=$(curl "${args[@]}")
  STATUS=${out##*$'\n'}; BODY=${out%$'\n'*}
}
check() { # desc expected_status
  if [ "$STATUS" = "$2" ]; then PASS=$((PASS+1)); echo "  ✅ $1 [$STATUS]"
  else FAIL=$((FAIL+1)); echo "  ❌ $1 — expected $2 got $STATUS: ${BODY:0:200}"; fi
}
assert() { # desc condition
  if eval "$2"; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1"; fi
}
# deterministic pseudo-random 128-d unit vector from a seed, optional noise
vec() { python3 - "$1" "${2:-0}" <<'EOF'
import sys,random,math,json
r=random.Random(sys.argv[1]); n=float(sys.argv[2])
v=[r.gauss(0,1) for _ in range(128)]
r2=random.Random(sys.argv[1]+'noise'+str(n))
v=[x+r2.gauss(0,n) for x in v]
m=math.sqrt(sum(x*x for x in v)); print(json.dumps([round(x/m,6) for x in v]))
EOF
}

echo "══ 1. Unauthenticated access is rejected"
req GET /api/business/users ""; check "GET /users without token → 401" 401
req GET /api/business/org ""; check "GET /org without token → 401" 401
req POST /api/business/recognize "" '{"door_id":"x","descriptor":[]}'; check "POST /recognize without token → 401" 401
req GET /api/business/users "deadbeef"; check "bad token → 401" 401

echo "══ 2. Register organization A"
req POST /api/auth/business/register "" "{\"first_name\":\"Ada\",\"last_name\":\"Admin\",\"email\":\"ada-$RUN@orga.test\",\"password\":\"Passw0rd123\",\"org_name\":\"Org A $RUN\",\"org_size\":\"11-50\",\"industry\":\"Logistics\",\"consent_terms\":true}"
check "register org A admin → 201" 201
TA=$(echo "$BODY" | J "['token']"); A_ORG=$(echo "$BODY" | J "['account']['org']['id']")
assert "response includes org object" "[ -n \"$A_ORG\" ]"
assert "first account is admin" "[ \"$(echo "$BODY" | J "['account']['role']")\" = admin ]"
req POST /api/auth/business/register "" "{\"first_name\":\"X\",\"last_name\":\"Y\",\"email\":\"bad@x.test\",\"password\":\"Passw0rd123\",\"org_name\":\"Z\",\"consent_terms\":false}"
check "register without consent → 400" 400
req POST /api/auth/business/register "" "{\"first_name\":\"X\",\"last_name\":\"Y\",\"email\":\"bad2@x.test\",\"password\":\"Passw0rd123\",\"consent_terms\":true}"
check "register without org_name or invite → 400" 400
req GET /api/auth/business/me "$TA"; check "GET /me with token" 200
assert "/me returns org" "[ \"$(echo "$BODY" | J "['account']['org']['id']")\" = \"$A_ORG\" ]"
req GET /api/business/org "$TA"; check "GET /org" 200
assert "org has zero users/doors initially" "[ \"$(echo "$BODY" | J "['counts']['users']")\" = 0 ] && [ \"$(echo "$BODY" | J "['counts']['doors']")\" = 0 ]"
req GET /api/business/settings "$TA"; check "GET /settings (defaults seeded per org)" 200
assert "default high threshold 0.45" "[ \"$(echo "$BODY" | J "['settings']['face_match_threshold_high']")\" = 0.45 ]"

echo "══ 3. Doors & people"
req POST /api/business/doors "$TA" '{"name":"Main Entrance","location":"Lobby","security_level":"standard"}'; check "create door" 201
DOOR=$(echo "$BODY" | J "['door']['id']")
req POST /api/business/doors "$TA" '{"name":"Server Room","location":"B2","security_level":"critical"}'; check "create critical door" 201
DOOR2=$(echo "$BODY" | J "['door']['id']")
req POST /api/business/users "$TA" "{\"name\":\"Bob Builder\",\"email\":\"bob-$RUN@orga.test\",\"role\":\"employee\",\"department\":\"Ops\",\"employee_id\":\"E-100\"}"; check "create user Bob" 201
BOB=$(echo "$BODY" | J "['user']['id']")
req POST /api/business/users "$TA" "{\"name\":\"Carol Contractor\",\"email\":\"carol-$RUN@orga.test\",\"role\":\"contractor\"}"; check "create contractor Carol" 201
CAROL=$(echo "$BODY" | J "['user']['id']")
req POST /api/business/users "$TA" '{"name":"","email":"nope"}'; check "invalid user → 400" 400
req GET /api/business/users "$TA"; check "list users" 200
assert "2 users listed, none enrolled" "[ \"$(echo "$BODY" | J "['users'].__len__()")\" = 2 ] && [ \"$(echo "$BODY" | J "['users'][0]['face_registered']")\" = 0 ]"

echo "══ 4. Face enrollment (128-d descriptors)"
BOBV=$(vec bob 0); CAROLV=$(vec carol 0)
req POST "/api/business/users/$BOB/face" "$TA" "{\"descriptors\":[$BOBV,$(vec bob 0.05),$(vec bob 0.04)],\"quality\":0.9,\"liveness_score\":0.95}"; check "enroll Bob (3 samples)" 200
assert "sample_count = 3" "[ \"$(echo "$BODY" | J "['sample_count']")\" = 3 ]"
req POST "/api/business/users/$CAROL/face" "$TA" "{\"descriptor\":$CAROLV,\"quality\":0.85}"; check "enroll Carol (1 sample)" 200
req POST "/api/business/users/$CAROL/face" "$TA" "{\"descriptor\":$BOBV}"; check "enrolling Bob's face on Carol → 409 DUPLICATE_FACE" 409
req POST "/api/business/users/$CAROL/face" "$TA" '{"descriptor":[1,2,3]}'; check "wrong dimensionality → 400" 400
req GET /api/business/users "$TA"; assert "Bob shows face_registered=1" "[ \"$(echo "$BODY" | python3 -c "import json,sys; print([u['face_registered'] for u in json.load(sys.stdin)['users'] if u['id']=='$BOB'][0])")\" = 1 ]"

echo "══ 5. Recognition"
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$(vec bob 0.03),\"liveness_score\":0.9}"; check "recognize Bob before any permission exists" 200
echo "     → result=$(echo "$BODY" | J "['result']") reason=$(echo "$BODY" | J "['reason']")"
assert "deny-by-default: matched but no_permission" "[ \"$(echo "$BODY" | J "['result']")\" = denied ] && [ \"$(echo "$BODY" | J "['reason']")\" = no_permission ]"
req POST /api/business/permissions "$TA" "{\"role\":\"employee\",\"door_id\":\"$DOOR\",\"time_start\":\"00:00\",\"time_end\":\"23:59\",\"days_allowed\":\"mon,tue,wed,thu,fri,sat,sun\"}"; check "grant employee → Main Entrance" 201
req POST /api/business/permissions "$TA" "{\"role\":\"contractor\",\"door_id\":\"$DOOR\",\"time_start\":\"00:00\",\"time_end\":\"23:59\",\"days_allowed\":\"mon,tue,wed,thu,fri,sat,sun\"}"; check "grant contractor → Main Entrance" 201
req GET /api/business/permissions "$TA"; check "list permissions" 200
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$(vec bob 0.03),\"liveness_score\":0.9}"; check "recognize Bob at Main Entrance" 200
RES=$(echo "$BODY" | J "['result']"); echo "     → result=$RES reason=$(echo "$BODY" | J "['reason']") distance=$(echo "$BODY" | J "['distance']")"
assert "Bob granted" "[ \"$RES\" = granted ]"
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$(vec stranger 0),\"liveness_score\":0.9}"; check "unknown face" 200
echo "     → result=$(echo "$BODY" | J "['result']") reason=$(echo "$BODY" | J "['reason']")"
assert "stranger denied" "[ \"$(echo "$BODY" | J "['result']")\" = denied ]"
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$(vec bob 0.03),\"liveness_score\":0.1}"; check "Bob with failed liveness" 200
echo "     → result=$(echo "$BODY" | J "['result']") reason=$(echo "$BODY" | J "['reason']")"
assert "low liveness denied" "[ \"$(echo "$BODY" | J "['result']")\" = denied ]"
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR2\",\"descriptor\":$(vec carol 0.03),\"liveness_score\":0.9}"; check "contractor Carol at critical door" 200
echo "     → result=$(echo "$BODY" | J "['result']") reason=$(echo "$BODY" | J "['reason']")"
assert "Carol denied at critical door (no permission)" "[ \"$(echo "$BODY" | J "['result']")\" = denied ]"
# Tighten thresholds so a noisier probe lands in the 2FA band
req PUT /api/business/settings "$TA" '{"face_match_threshold_high":"0.30","face_match_threshold_medium":"0.70"}'; check "tighten thresholds" 200
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$(vec bob 0.30),\"liveness_score\":0.9}"; check "Bob with noisy probe" 200
RES2=$(echo "$BODY" | J "['result']"); VID=$(echo "$BODY" | J "['verification_id']")
echo "     → result=$RES2 distance=$(echo "$BODY" | J "['distance']") verification_id=$VID"
assert "noisy probe → pending_2fa" "[ \"$RES2\" = pending_2fa ]"
req GET /api/business/verify/pending "$TA"; check "list pending approvals" 200
assert "1 pending" "[ \"$(echo "$BODY" | J "['pending'].__len__()")\" = 1 ]"
req POST "/api/business/verify/$VID/respond" "$TA" '{"action":"approve"}'; check "approve pending" 200
req GET "/api/business/verify/$VID" "$TA"; assert "verification approved" "[ \"$(echo "$BODY" | J "['status']")\" = approved ]"
req PUT /api/business/settings "$TA" '{"face_match_threshold_high":"0.45","face_match_threshold_medium":"0.60"}'; check "restore thresholds" 200

echo "══ 6. Logs, analytics, export, audit"
req GET "/api/business/logs?limit=50" "$TA"; check "GET /logs" 200
assert "7 access log entries (6 recognitions + 1 operator approval)" "[ \"$(echo "$BODY" | J "['total']")\" = 7 ]"
req GET /api/business/analytics/summary "$TA"; check "analytics summary" 200
req GET /api/business/analytics/attendance "$TA"; check "attendance" 200
CSV=$(curl -s "$BASE/api/business/logs/export" -H "Authorization: Bearer $TA" -w $'\n%{http_code}'); STATUS=${CSV##*$'\n'}; BODY=${CSV%$'\n'*}
check "CSV export" 200; assert "CSV has header + rows" "[ $(echo "$BODY" | wc -l) -ge 6 ]"
req GET /api/business/audit "$TA"; check "audit trail (admin)" 200

echo "══ 7. Settings validation"
req PUT /api/business/settings "$TA" '{"two_fa_enabled":"true"}'; check "unknown setting key → 400" 400
req PUT /api/business/settings "$TA" '{"face_match_threshold_high":"0.99"}'; check "out-of-range threshold → 400" 400
req PUT /api/business/settings "$TA" '{"company_name":"Org A Renamed","timezone":"Europe/London","retention_days_logs":"400"}'; check "valid settings" 200

echo "══ 8. Team invitations & roles"
req POST /api/business/team/invite "$TA" "{\"email\":\"viv-$RUN@orga.test\",\"role\":\"viewer\"}"; check "invite viewer" 201
INV_TOKEN=$(echo "$BODY" | J "['invitation']['token']"); INV_ID=$(echo "$BODY" | J "['invitation']['id']")
req GET "/api/auth/business/invite/$INV_TOKEN" ""; check "public invite preview" 200
assert "preview valid + org name" "[ \"$(echo "$BODY" | J "['invitation']['valid']")\" = True ]"
req POST /api/auth/business/register "" "{\"first_name\":\"Viv\",\"last_name\":\"Viewer\",\"email\":\"viv-$RUN@orga.test\",\"password\":\"Passw0rd123\",\"consent_terms\":true,\"invite_token\":\"$INV_TOKEN\"}"
check "accept invite → 201" 201
TV=$(echo "$BODY" | J "['token']")
assert "viewer joined org A" "[ \"$(echo "$BODY" | J "['account']['org']['id']")\" = \"$A_ORG\" ] && [ \"$(echo "$BODY" | J "['account']['role']")\" = viewer ]"
req GET "/api/auth/business/invite/$INV_TOKEN" ""; assert "invite consumed (valid=False)" "[ \"$(echo "$BODY" | J "['invitation']['valid']")\" = False ]"
req GET /api/business/users "$TV"; check "viewer can read users" 200
req POST /api/business/users "$TV" '{"name":"Hacker","email":"h@x.test"}'; check "viewer cannot create users → 403" 403
req PUT /api/business/settings "$TV" '{"company_name":"pwned"}'; check "viewer cannot change settings → 403" 403
req POST /api/business/team/invite "$TV" '{"email":"z@x.test","role":"admin"}'; check "viewer cannot invite → 403" 403
req POST "/api/business/verify/$VID/respond" "$TV" '{"action":"approve"}'; check "viewer cannot respond to approvals → 403" 403
req GET /api/business/audit "$TV"; check "viewer cannot read audit → 403" 403
req POST /api/business/team/invite "$TA" "{\"email\":\"op-$RUN@orga.test\",\"role\":\"operator\"}"; INV2=$(echo "$BODY" | J "['invitation']['id']")
req DELETE "/api/business/team/invite/$INV2" "$TA"; check "revoke invitation" 200
req GET /api/business/team "$TA"; check "list team" 200
assert "2 members, 0 pending invites" "[ \"$(echo "$BODY" | J "['members'].__len__()")\" = 2 ] && [ \"$(echo "$BODY" | J "['invitations'].__len__()")\" = 0 ]"
VIV_ID=$(echo "$BODY" | python3 -c "import json,sys; print([m['id'] for m in json.load(sys.stdin)['members'] if m['role']=='viewer'][0])")
req PUT "/api/business/team/$VIV_ID" "$TA" '{"role":"operator"}'; check "promote viewer → operator" 200
req POST /api/business/users "$TV" "{\"name\":\"Dan Ops\",\"email\":\"dan-$RUN@orga.test\",\"role\":\"employee\"}"; check "operator can now create users" 201
req PUT "/api/business/team/$VIV_ID" "$TA" '{"status":"suspended"}'; check "suspend member" 200
req GET /api/business/users "$TV"; check "suspended member rejected → 401/403" "$( [ "$STATUS" = 401 ] || [ "$STATUS" = 403 ] && echo $STATUS || echo 401 )"

echo "══ 9. Tenant isolation — organization B"
req POST /api/auth/business/register "" "{\"first_name\":\"Bea\",\"last_name\":\"Boss\",\"email\":\"bea-$RUN@orgb.test\",\"password\":\"Passw0rd123\",\"org_name\":\"Org B $RUN\",\"consent_terms\":true}"
check "register org B" 201; TB=$(echo "$BODY" | J "['token']"); B_ORG=$(echo "$BODY" | J "['account']['org']['id']")
assert "distinct org ids" "[ \"$A_ORG\" != \"$B_ORG\" ]"
req GET /api/business/users "$TB"; assert "B sees 0 users" "[ \"$(echo "$BODY" | J "['users'].__len__()")\" = 0 ]"
req GET /api/business/doors "$TB"; assert "B sees 0 doors" "[ \"$(echo "$BODY" | J "['doors'].__len__()")\" = 0 ]"
req GET /api/business/logs "$TB"; assert "B sees 0 logs" "[ \"$(echo "$BODY" | J "['total']")\" = 0 ]"
req GET /api/business/team "$TB"; assert "B sees only its own member" "[ \"$(echo "$BODY" | J "['members'].__len__()")\" = 1 ]"
req GET "/api/business/users/$BOB" "$TB"; check "B cannot read A's user → 404" 404
req DELETE "/api/business/users/$BOB" "$TB"; check "B cannot delete A's user → 404" 404
req PUT "/api/business/doors/$DOOR" "$TB" '{"name":"hijack"}'; check "B cannot edit A's door → 404" 404
req POST "/api/business/users/$BOB/face" "$TB" "{\"descriptor\":$BOBV}"; check "B cannot enroll on A's user → 404" 404
req POST /api/business/recognize "$TB" "{\"door_id\":\"$DOOR\",\"descriptor\":$BOBV,\"liveness_score\":0.9}"; check "B recognize against A's door → 404" 404
req POST /api/business/doors "$TB" '{"name":"B Front","location":"Lobby"}'; BDOOR=$(echo "$BODY" | J "['door']['id']")
req POST /api/business/recognize "$TB" "{\"door_id\":\"$BDOOR\",\"descriptor\":$(vec bob 0.02),\"liveness_score\":0.9}"; check "Bob's face at B's door" 200
assert "A's enrolled face is unknown in B" "[ \"$(echo "$BODY" | J "['result']")\" = denied ]"
req GET "/api/business/verify/$VID" "$TB"; check "B cannot read A's verification → 404" 404
req GET /api/business/settings "$TB"; assert "B has its own defaults (company_name != A)" "[ \"$(echo "$BODY" | J "['settings']['company_name']")\" != 'Org A Renamed' ]"
req GET /api/business/doors "$TA"; assert "A still sees exactly 2 doors" "[ \"$(echo "$BODY" | J "['doors'].__len__()")\" = 2 ]"

echo "══ 10. Right to erasure & logout"
req DELETE "/api/business/users/$CAROL/face" "$TA"; check "erase Carol's biometric" 200
req POST /api/business/recognize "$TA" "{\"door_id\":\"$DOOR\",\"descriptor\":$CAROLV,\"liveness_score\":0.9}"; assert "Carol no longer recognized" "[ \"$(echo "$BODY" | J "['result']")\" = denied ]"
req POST /api/auth/business/logout "$TA" '{}'; check "logout" 200
req GET /api/business/users "$TA"; check "token invalid after logout → 401" 401

echo
echo "════════════════════════════════════════"
echo " PASSED: $PASS   FAILED: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" = 0 ]
