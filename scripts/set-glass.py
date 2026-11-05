import json,os,sys
p=os.path.join(os.environ['APPDATA'],'star-sentinel','settings.json')
d=json.load(open(p,encoding='utf-8')); ui=d.setdefault('ui',{})
ui['glass']=sys.argv[1]
if len(sys.argv)>2: ui['theme']=sys.argv[2]
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(ui.get('theme'),ui['glass'])