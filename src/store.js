import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    if (path !== ':memory:') {
      this.lockPath = path + '.lock';
      const acquire = () => { const fd = openSync(this.lockPath,'wx'); writeFileSync(fd,String(process.pid)); closeSync(fd); };
      try { acquire(); }
      catch(e) {
        if (e.code !== 'EEXIST') throw e;
        const pid = Number(readFileSync(this.lockPath,'utf8'));
        let alive = true;
        try { if (Number.isInteger(pid) && pid > 0) process.kill(pid,0); else alive = false; }
        catch(error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Another app instance owns this database. Close it before starting.');
        unlinkSync(this.lockPath); acquire();
      }
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (1,?)').run(new Date().toISOString());
    this.db.prepare("UPDATE audit SET status='unknown', detail='Process interrupted; inspect hardware state.' WHERE status='pending'").run();
  }
  sample(snapshot) {
    this.db.prepare('INSERT INTO samples(sampled_at,snapshot) VALUES (?,?)').run(snapshot.at, JSON.stringify(snapshot));
  }
  begin(command) {
    return this.db.prepare("INSERT INTO audit(requested_at,command,status) VALUES (?,?,'pending')")
      .run(new Date().toISOString(), JSON.stringify(command)).lastInsertRowid;
  }
  finish(id, status, detail) {
    this.db.prepare('UPDATE audit SET completed_at=?,status=?,detail=? WHERE id=?')
      .run(new Date().toISOString(), status, detail, id);
  }
  activity() {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 60').all()
      .map(row => ({ ...row, command: JSON.parse(row.command) }));
  }
  history(minutes = 10) {
    return this.db.prepare('SELECT snapshot FROM samples WHERE sampled_at>=? ORDER BY sampled_at DESC LIMIT 1200')
      .all(new Date(Date.now() - minutes * 60_000).toISOString()).reverse().map(r => JSON.parse(r.snapshot));
  }
  prune() {
    this.db.prepare('DELETE FROM samples WHERE sampled_at<?').run(new Date(Date.now() - 86_400_000).toISOString());
    this.db.prepare('DELETE FROM audit WHERE requested_at<?').run(new Date(Date.now() - 30 * 86_400_000).toISOString());
  }
  close() { this.db.close(); if (this.lockPath) { unlinkSync(this.lockPath); this.lockPath = null; } }
}
