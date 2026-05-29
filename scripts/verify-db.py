import sqlite3, os
db = os.path.join(os.environ['APPDATA'], 'dev-console', 'dev-console.db')
c = sqlite3.connect(db)
tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' order by name")]
print('tables:', tables)
print('user_version:', c.execute('pragma user_version').fetchone()[0])
