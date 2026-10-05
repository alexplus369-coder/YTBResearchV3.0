"""SQLite queue, immutable requests and resumable stage artifacts, one worker."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.db = root / 'queue.sqlite3'
        (root / 'assets').mkdir(exist_ok=True)
        (root / 'jobs').mkdir(exist_ok=True)
        with self.connect() as con:
            con.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT, path TEXT, kind TEXT, size INTEGER, created TEXT);
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT, payload TEXT, state TEXT, stage TEXT,
                    progress REAL DEFAULT 0, cancel INTEGER DEFAULT 0, error TEXT DEFAULT '', result TEXT DEFAULT '{}', attempts INTEGER DEFAULT 0, created TEXT, updated TEXT);
                CREATE INDEX IF NOT EXISTS job_fingerprint ON jobs(fingerprint);
            ''')

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.db, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def add_asset(self, path, name, kind):
        ident = path.stem
        with self.connect() as con:
            con.execute('INSERT INTO assets VALUES(?,?,?,?,?,?)', (ident, name[:200], str(path), kind, path.stat().st_size, now()))
        return self.asset(ident)

    def asset(self, ident):
        with self.connect() as con:
            row = con.execute('SELECT * FROM assets WHERE id=?', (ident,)).fetchone()
        if not row or not Path(row['path']).is_file():
            raise ValueError('Recurso no encontrado; vuelve a subirlo.')
        return dict(row)

    def assets(self):
        with self.connect() as con:
            return [dict(r) for r in con.execute('SELECT id,name,kind,size,created FROM assets ORDER BY created DESC LIMIT 100')]

    def create(self, payload, signature=''):
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        fingerprint = hashlib.sha256((signature + encoded).encode()).hexdigest()
        with self.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            row = con.execute("SELECT id FROM jobs WHERE fingerprint=? AND state IN ('queued','running','completed') ORDER BY created DESC LIMIT 1", (fingerprint,)).fetchone()
            if row:
                return self.get(row['id'])
            ident, stamp = uuid.uuid4().hex, now()
            con.execute('INSERT INTO jobs(id,fingerprint,payload,state,stage,created,updated) VALUES(?,?,?,?,?,?,?)', (ident, fingerprint, encoded, 'queued', 'queued', stamp, stamp))
        return self.get(ident)

    def get(self, ident, private=False):
        with self.connect() as con:
            row = con.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
        if not row:
            raise KeyError('Trabajo no encontrado.')
        item = dict(row)
        item['result'] = json.loads(item['result'])
        if private:
            item['payload'] = json.loads(item['payload'])
        else:
            payload = json.loads(item['payload'])
            item['kind'] = payload.get('kind', 'render')
            item['title'] = payload.get('request', {}).get('production', {}).get('packaging', {}).get('title', 'Recorte de video')
            item.pop('payload'); item.pop('fingerprint'); item.pop('cancel')
        return item

    def list(self):
        with self.connect() as con:
            ids = [r['id'] for r in con.execute('SELECT id FROM jobs ORDER BY created DESC LIMIT 50')]
        return [self.get(ident) for ident in ids]

    def claim(self):
        with self.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            row = con.execute("SELECT id FROM jobs WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            con.execute("UPDATE jobs SET state='running',attempts=attempts+1,updated=? WHERE id=?", (now(), row['id']))
        return self.get(row['id'], private=True)

    def active(self):
        with self.connect() as con:
            ids = [r['id'] for r in con.execute("SELECT id FROM jobs WHERE state IN ('queued','running')")]
        return [self.get(ident, private=True) for ident in ids]

    def update(self, ident, **changes):
        allowed = {'state', 'stage', 'progress', 'error', 'cancel', 'result'}
        if not changes or any(k not in allowed for k in changes):
            raise ValueError('Actualización de trabajo inválida.')
        if 'result' in changes:
            changes['result'] = json.dumps(changes['result'], ensure_ascii=False)
        changes['updated'] = now()
        with self.connect() as con:
            con.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in changes) + ' WHERE id=?', (*changes.values(), ident))

    def recover(self):
        with self.connect() as con:
            con.execute("UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'queued' END, stage='interrupted',updated=? WHERE state='running'", (now(),))

    def retry(self, ident):
        with self.connect() as con:
            changed = con.execute("UPDATE jobs SET state='queued',stage='queued',cancel=0,error='',updated=? WHERE id=? AND state IN ('failed','cancelled')", (now(), ident)).rowcount
        if not changed:
            raise ValueError('Solo se pueden reintentar trabajos fallidos o cancelados.')
        return self.get(ident)

    def cancel(self, ident):
        self.get(ident)
        with self.connect() as con:
            con.execute("UPDATE jobs SET cancel=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated=? WHERE id=? AND state IN ('queued','running')", (now(), ident))

    def directory(self, ident):
        path = self.root / 'jobs' / ident
        path.mkdir(exist_ok=True)
        return path
