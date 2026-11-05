import json,os,sys
p=os.path.join(os.environ['APPDATA'],'star-sentinel','settings.json')
d=json.load(open(p,encoding='utf-8'))
ui=d.setdefault('ui',{})
ui['showIp']=sys.argv[1]=='1'
ui['showDomain']=sys.argv[2]=='1'
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print('showIp',ui['showIp'],'showDomain',ui['showDomain'])
