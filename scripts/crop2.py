import sys
from PIL import Image
im = Image.open(sys.argv[1])
im.crop((230,120,560,420)).resize((660,600), Image.LANCZOS).save('zoom-dawn-hero.png')
im.crop((240,395,830,700)).resize((885,457), Image.LANCZOS).save('zoom-dawn-chart.png')
print('ok')