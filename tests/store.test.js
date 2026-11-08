import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

test('SQLite persists data, migrates interrupted intents and rejects a second writer',()=>{
  const directory=mkdtempSync(join(tmpdir(),'thinkpad-test-')), path=join(directory,'test.sqlite');
  try {
    const first=new Store(path); first.begin({type:'fan',mode:'manual',percent:50});
    first.sample({at:new Date().toISOString(),cpu:{temperature:null}});
    assert.throws(()=>new Store(path),/Another app instance/); first.close();
    const reopened=new Store(path);
    assert.equal(reopened.activity()[0].status,'unknown'); assert.equal(reopened.history().length,1); reopened.close();
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test('retention removes expired samples and audit while preserving recent records',()=>{
  const store=new Store(':memory:');
  store.sample({at:'2000-01-01T00:00:00.000Z'}); store.sample({at:new Date().toISOString()});
  const id=store.begin({type:'cpu-boost'});store.db.prepare('UPDATE audit SET requested_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id);
  store.prune();assert.equal(store.db.prepare('SELECT count(*) as count FROM samples').get().count,1);assert.equal(store.activity().length,0);store.close();
});
