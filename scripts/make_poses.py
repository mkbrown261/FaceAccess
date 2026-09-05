#!/usr/bin/env python3
"""
Generate the head-pose fixtures used by scripts/camera_flow.py.

From one real frontal face photo we synthesise five 640x480 "webcam frames":
center, left, right, up, down. The pose change is a smooth local warp of the
face region (Gaussian-weighted pixel displacement) that moves the nose tip and
inner features relative to the face outline — exactly the geometric cue the
engine's yaw/pitch estimator uses (nose x-offset / face width, nose y vs eye
line and chin). Measured on the default subject: left dYaw +0.118, right -0.089,
up dPitch -0.060, down +0.059 (thresholds 0.09 / 0.07), so every step of the
liveness challenge is satisfied by the matching frame and not by the others.

Usage:
  python3 scripts/make_poses.py                       # -> /tmp/cam/poses.json + poses_imposter.json
  python3 scripts/make_poses.py --out /tmp/cam        # custom directory
Requires: Pillow, numpy (already needed by scripts/face_matrix.py).
"""
import argparse, base64, io, json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FACES = os.path.join(HERE, 'faces')

# (source image, crop box x,y,w,h, gaussian centre (cx,cy) in the output frame)
SUBJECTS = {
    'poses':          ('sample3.jpg', (1073, 215, 224, 298), (265, 268)),  # "Blonde Woman" in camera_flow.py
    'poses_imposter': ('sample2.jpg', (1446, 153, 195, 242), (320, 250)),  # a different person
}
# displacement (dx, dy) of the face interior per pose
OFFSETS = {'center': (0, 0), 'left': (50, 0), 'right': (-55, 0), 'up': (0, -42), 'down': (0, 45)}
SIGMA = 70.0


def load_frame(src, box):
    x, y, w, h = box
    img = Image.open(src).convert('RGB')
    # crop a generous area around the face and resize to a 4:3 webcam frame
    W = int(w * 2.6); H = int(W * 0.75)
    cx, cy = x + w // 2, y + h // 2
    left, top = max(0, cx - W // 2), max(0, cy - H // 2)
    crop = img.crop((left, top, min(img.width, left + W), min(img.height, top + H)))
    return np.asarray(crop.resize((640, 480), Image.LANCZOS)).astype(np.float32)


def warp(frame, dx, dy, centre):
    h, w, _ = frame.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    g = np.exp(-((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2) / (2 * SIGMA ** 2))
    sx = np.clip(xx - dx * g, 0, w - 1)
    sy = np.clip(yy - dy * g, 0, h - 1)
    # bilinear sample
    x0 = np.floor(sx).astype(int); y0 = np.floor(sy).astype(int)
    x1 = np.clip(x0 + 1, 0, w - 1); y1 = np.clip(y0 + 1, 0, h - 1)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    out = (frame[y0, x0] * (1 - fx) * (1 - fy) + frame[y0, x1] * fx * (1 - fy)
           + frame[y1, x0] * (1 - fx) * fy + frame[y1, x1] * fx * fy)
    return np.clip(out, 0, 255).astype(np.uint8)


def to_data_url(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format='JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='/tmp/cam')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name, (src, box, centre) in SUBJECTS.items():
        frame = load_frame(os.path.join(FACES, src), box)
        poses = {pose: to_data_url(warp(frame, dx, dy, centre)) for pose, (dx, dy) in OFFSETS.items()}
        path = os.path.join(a.out, name + '.json')
        json.dump(poses, open(path, 'w'))
        print(f'wrote {path}  ({len(poses)} poses, {sum(len(v) for v in poses.values()) // 1024} kB)')


if __name__ == '__main__':
    main()
