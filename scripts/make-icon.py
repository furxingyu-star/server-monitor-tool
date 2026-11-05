import math, os, random
from PIL import Image, ImageDraw, ImageFilter

random.seed(11)
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# rounded-square background with vertical gradient
bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(bg)
for y in range(S):
    t = y / S
    r = int(8 + 8 * t); g = int(16 + 14 * t); b = int(30 + 26 * t)
    d.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=250, fill=255)
img.paste(bg, (0, 0), mask)

# ambient glows
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([-260, -300, 700, 660], fill=(40, 150, 255, 90))
gd.ellipse([420, 300, 1240, 1120], fill=(130, 80, 255, 85))
gd.ellipse([250, -250, 780, 280], fill=(70, 240, 200, 45))
glow = glow.filter(ImageFilter.GaussianBlur(150))
img = Image.alpha_composite(img, Image.composite(glow, Image.new('RGBA', (S, S), (0,0,0,0)), mask))

# orb
cx, cy, R = S // 2, S // 2, 340
orb = Image.new('RGBA', (S, S), (0, 0, 0, 0))
od = ImageDraw.Draw(orb)
# conic-like colored wedges under blur
for i in range(96):
    a0 = i * 360 / 96
    a1 = a0 + 360 / 96 + 0.6
    hue = i / 96
    if hue < 0.34:
        col = (int(110 + 40 * hue), 220, 255)
    elif hue < 0.67:
        col = (int(140 + 20 * hue), int(120 + 40 * hue), 255)
    else:
        col = (int(90 + 30 * hue), 245, int(195 + 40 * hue))
    od.pieslice([cx - R, cy - R, cx + R, cy + R], a0 - 90, a1 - 90, fill=col + (255,))
orb = orb.filter(ImageFilter.GaussianBlur(18))

# dark inner sphere over the ring
inner = Image.new('RGBA', (S, S), (0, 0, 0, 0))
idr = ImageDraw.Draw(inner)
for rr in range(R, 0, -2):
    t = rr / R
    r = int(6 + 30 * (1 - t) ** 2)
    g = int(14 + 70 * (1 - t) ** 2)
    b = int(28 + 120 * (1 - t) ** 2)
    idr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(r, g, b, 255))
orb = Image.alpha_composite(orb, inner)
mask_o = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask_o).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
orb.putalpha(mask_o)
img = Image.alpha_composite(img, orb)

# vivid glass rim
ring = Image.new('RGBA', (S, S), (0, 0, 0, 0))
rg = ImageDraw.Draw(ring)
for i in range(120):
    a0 = i * 3.0
    hue = i / 120
    if hue < 0.34:
        col = (int(120 + 30 * hue), 230, 255)
    elif hue < 0.67:
        col = (int(150 + 20 * hue), int(130 + 30 * hue), 255)
    else:
        col = (int(95 + 30 * hue), 250, int(200 + 40 * hue))
    rg.arc([cx - R + 3, cy - R + 3, cx + R - 3, cy + R - 3], a0, a0 + 3.4, fill=col + (240,), width=22)
ring = ring.filter(ImageFilter.GaussianBlur(9))
img = Image.alpha_composite(img, ring)

# specular highlight
spec = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(spec)
sd.ellipse([cx - 190, cy - 250, cx + 40, cy - 40], fill=(255, 255, 255, 235))
sd.ellipse([cx - 80, cy + 90, cx + 150, cy + 230], fill=(120, 220, 255, 55))
spec = spec.filter(ImageFilter.GaussianBlur(55))
img = Image.alpha_composite(img, spec)

# bright rim
rim = Image.new('RGBA', (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(rim)
rd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(200, 245, 255, 150), width=7)
rim = rim.filter(ImageFilter.GaussianBlur(4))
img = Image.alpha_composite(img, rim)

# tiny glass sheen arc
arc = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ad = ImageDraw.Draw(arc)
ad.arc([cx - R + 40, cy - R + 40, cx + R - 40, cy + R - 40], 195, 275, fill=(255, 255, 255, 190), width=12)
arc = arc.filter(ImageFilter.GaussianBlur(8))
img = Image.alpha_composite(img, arc)

os.makedirs('assets', exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save('assets/icon.png')
img.resize((256, 256), Image.LANCZOS).save('assets/icon-256.png')
sizes = [16, 24, 32, 48, 64, 128, 256]
img.save('assets/icon.ico', sizes=[(s, s) for s in sizes])
print('icon written', os.path.getsize('assets/icon.png'), os.path.getsize('assets/icon.ico'))