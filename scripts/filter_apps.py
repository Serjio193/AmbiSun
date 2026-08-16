#!/usr/bin/env python3
import sys
import json

data = json.load(sys.stdin)
apps = data.get('apps', [])

# Filter: visible, not hidden class, not system internal
visible = []
for a in apps:
    if not a.get('visible', False):
        continue
    cls = a.get('class', {})
    if cls.get('hidden', False):
        continue
    visible.append({'id': a['id'], 'title': a['title'], 'system': a.get('systemApp', False)})

visible.sort(key=lambda x: x['title'])
print(json.dumps(visible, ensure_ascii=False, indent=2))
