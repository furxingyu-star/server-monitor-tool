import sys
from PIL import Image
src = sys.argv[1]; out = sys.argv[2]
im = Image.open(src)
# crop top-left corner of the first settings card
im.crop((225,130,425,330)).resize((600,600), Image.LANCZOS).save(out+'-tl.png')
im.crop((1010,130,1215,335)).resize((615,615), Image.LANCZOS).save(out+'-tr.png')
im.crop((600,130,800,330)).resize((600,600), Image.LANCZOS).save(out+'-top.png')
print('ok')