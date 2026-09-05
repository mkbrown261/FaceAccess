#!/usr/bin/env python3
"""Real-face validation of the recognition thresholds.

Loads the SAME face-api.js build + models the app serves, runs detection +
128-d descriptors on every face in scripts/faces/*.jpg inside headless Chromium,
then prints the pairwise distance matrix and evaluates the org defaults
(high=0.45 auto-grant, medium=0.55 approval).

Usage: BASE=http://localhost:3000 python3 scripts/face_matrix.py
"""
import os, sys, glob, json, itertools, math, base64
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
HIGH, MED = 0.45, 0.55
files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'faces', '*.jpg')))
if not files:
    print('no images in scripts/faces'); sys.exit(1)

JS = """
async ([images]) => {
  const fa = window.faceapi;
  await Promise.all([
    fa.nets.ssdMobilenetv1.loadFromUri('/static/models'),
    fa.nets.faceLandmark68Net.loadFromUri('/static/models'),
    fa.nets.faceRecognitionNet.loadFromUri('/static/models'),
  ]);
  const out = [];
  for (const [name, dataUrl] of images) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const dets = await fa.detectAllFaces(img, new fa.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks().withFaceDescriptors();
    dets.sort((a, b) => a.detection.box.x - b.detection.box.x);
    dets.forEach((d, idx) => out.push({ id: `${name}#${idx}`, x: Math.round(d.detection.box.x), score: +d.detection.score.toFixed(2), desc: Array.from(d.descriptor) }));
  }
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(BASE, wait_until='networkidle')
    page.add_script_tag(url='/static/vendor/face-api.js')
    page.wait_for_function('typeof faceapi !== "undefined"')
    images = []
    for f in files:
        with open(f, 'rb') as fh:
            images.append([os.path.basename(f).replace('.jpg', ''), 'data:image/jpeg;base64,' + base64.b64encode(fh.read()).decode()])
    page.set_default_timeout(240000)
    faces = page.evaluate(JS, [images])
    b.close()

print(f'Detected {len(faces)} faces across {len(files)} images')
for f in faces: print(f"  {f['id']:<12} x={f['x']:<5} score={f['score']}")

def dist(a, b): return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

ids = [f['id'] for f in faces]
D = {}
for a, b in itertools.combinations(faces, 2):
    D[(a['id'], b['id'])] = dist(a['desc'], b['desc'])

print('\nPairwise distances sorted (closest first):')
pairs = sorted(D.items(), key=lambda kv: kv[1])
for (a, b), d in pairs[:20]:
    tag = 'AUTO-GRANT' if d <= HIGH else 'APPROVAL' if d <= MED else 'reject'
    print(f'  {a:<12} {b:<12} {d:.3f}  {tag}')

print(f'\n... {len(pairs)} pairs total')
buckets = {'<=0.45 (would auto-grant)': sum(1 for _, d in pairs if d <= HIGH),
           '0.45-0.55 (would ask approval)': sum(1 for _, d in pairs if HIGH < d <= MED),
           '>0.55 (reject)': sum(1 for _, d in pairs if d > MED)}
for k, v in buckets.items(): print(f'  {k:<32} {v}')

# Cross-image pairs are the only ones that can be the same person (each image has distinct people)
same_img = [(a, b, d) for (a, b), d in D.items() if a.split('#')[0] == b.split('#')[0]]
print(f'\nSame-photo pairs (guaranteed DIFFERENT people): {len(same_img)}')
worst = min(same_img, key=lambda t: t[2]) if same_img else None
if worst:
    print(f'  closest different-people distance: {worst[2]:.3f} ({worst[0]} vs {worst[1]})')
    print(f'  → false auto-grants among guaranteed-different people: {sum(1 for t in same_img if t[2] <= HIGH)}')
    print(f'  → would-ask-approval among guaranteed-different people: {sum(1 for t in same_img if HIGH < t[2] <= MED)}')

json.dump({'faces': [{'id': f['id'], 'desc': f['desc']} for f in faces]}, open('/tmp/face_descriptors.json', 'w'))
print('\nDescriptors saved to /tmp/face_descriptors.json')
