import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RuntimeClient } from './verify-product-runtime.mjs';
function fixture(t) {const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();const client=new RuntimeClient(child);t.after(()=>{child.emit('exit',0);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();});return{child,client};}
test('acceptance client associates concurrent replies by ID without forwarding raw errors',async t=>{
 const {child,client}=fixture(t);const one=client.request('snapshot'),two=client.request('cancel');
 child.stdout.write(JSON.stringify({id:2,result:{cancelled:true}})+'\n');child.stdout.write(JSON.stringify({id:1,result:{tasks:[]}})+'\n');
 assert.deepEqual(await one,{tasks:[]});assert.deepEqual(await two,{cancelled:true});
 const rejected=assert.rejects(client.request('test'),e=>e.message==='Runtime request failed'&&!e.message.includes('PRIVATE'));
 child.stdout.write(JSON.stringify({id:3,error:'PRIVATE_UPSTREAM'})+'\n');await rejected;
});
test('malformed or unexpected runtime replies reject pending work and disable reuse',async t=>{
 const {child,client}=fixture(t);const rejected=assert.rejects(client.request('snapshot'),/Invalid runtime response/);child.stdout.write('null\n');await rejected;await assert.rejects(client.request('snapshot'),/closed/);
});
test('runtime exit releases all pending requests',async t=>{const {child,client}=fixture(t);const a=assert.rejects(client.request('snapshot'),/exited/),b=assert.rejects(client.request('snapshot'),/exited/);child.emit('exit',1);await Promise.all([a,b]);});
