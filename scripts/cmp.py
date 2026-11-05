import sys
from PIL import Image, ImageStat
files = [r"shots-lens2\star-sentinel-dashboard.png", r"shots-lens4b\star-sentinel-dashboard.png", r"shots-ringtest\star-sentinel-dashboard.png"]
box = (255,165,535,405)   # inside hero card
for f in files:
    im = Image.open(f).convert('RGB').crop(box)
    st = ImageStat.Stat(im)
    print(f, [round(v,1) for v in st.mean], 'std', [round(v,1) for v in st.stddev])
