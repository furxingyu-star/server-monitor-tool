import json, os, sys
p = os.path.join(os.environ['APPDATA'], 'star-sentinel', 'settings.json')
d = json.load(open(p, encoding='utf-8'))
ui = d.setdefault('ui', {})
ui['theme'] = sys.argv[1]
ui['liquid'] = sys.argv[2] == '1'
ui['lowFx'] = sys.argv[3] == '1'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('look', ui['theme'], ui['liquid'], ui['lowFx'])
