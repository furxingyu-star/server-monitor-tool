import sys
from PIL import Image
src, dst, box = sys.argv[1], sys.argv[2], sys.argv[3]
l, t, r, b = [int(x) for x in box.split(',')]
im = Image.open(src).crop((l, t, r, b))
im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS)
im.save(dst)
print('ok', im.size)
