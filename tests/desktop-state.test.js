import test from 'node:test';
import assert from 'node:assert/strict';
import {hardwareAccessState} from '../public/desktop.js';

test('desktop hardware action follows confirmed native connection rather than old telemetry',()=>{
  assert.deepEqual(hardwareAccessState('live'),{disabled:false,label:'Enable hardware access'});
  assert.deepEqual(hardwareAccessState('live',{busy:true,hardwareEnabled:false}),{disabled:true,label:'Working…'});
  assert.deepEqual(hardwareAccessState('live',{busy:false,hardwareEnabled:true}),{disabled:true,label:'Hardware worker connected'});
  assert.deepEqual(hardwareAccessState('live',{busy:false,hardwareEnabled:false,administrator:true}),{disabled:false,label:'Enable hardware access'},'Old elevated telemetry cannot keep the retry action disabled after disconnect');
  assert.deepEqual(hardwareAccessState('demo',{busy:false,hardwareEnabled:false}),{disabled:true,label:'Enable hardware access'});
  assert.deepEqual(hardwareAccessState('live',{busy:true,hardwareEnabled:true}),{disabled:true,label:'Working…'},'Setup must remain busy even if an older elevated connection exists');
});
