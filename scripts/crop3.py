import sys
from PIL import Image
for tag,p in [("v5","shots-v5-deep/star-sentinel-dashboard.png"),("v6","shots-v6-deep/star-sentinel-dashboard.png")]:
    im=Image.open(p).convert("RGB")
    # hero card top-left corner + chart card left edge
    box=(228,138,470,300)
    crop=im.crop(box).resize(((box[2]-box[0])*3,(box[3]-box[1])*3), Image.LANCZOS)
    crop.save(f"zoom-lenscmp-{tag}.png")
print("ok")