import json,sqlite3,pathlib
root=pathlib.Path(__file__).resolve().parent
db=sqlite3.connect(root/'knowledge.sqlite')
db.execute('CREATE TABLE IF NOT EXISTS archive(collection TEXT,id TEXT,body TEXT,PRIMARY KEY(collection,id))')
tables=json.loads((root/'data/capture-tables.json').read_text(encoding='utf-8'))
legacy=json.loads((root/'data/workspace.json').read_text(encoding='utf-8')) or {}
learning=json.loads((root/'data/learning.json').read_text(encoding='utf-8')) or {}
for collection,rows in list(tables.items())+[(k,v) for k,v in legacy.items() if isinstance(v,list)]+[('learning_articles',learning.get('articles',[])),('learning_methods',learning.get('methods',[]))]:
 for i,row in enumerate(rows):
  db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',(collection,str(row.get('id',i)),json.dumps(row,ensure_ascii=False)))
db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',('workspace','complete',json.dumps(legacy,ensure_ascii=False)))
db.execute('INSERT OR REPLACE INTO archive VALUES(?,?,?)',('learning','complete',json.dumps(learning,ensure_ascii=False)))
db.commit()
print(root/'knowledge.sqlite')
