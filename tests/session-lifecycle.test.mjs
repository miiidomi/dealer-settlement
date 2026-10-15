import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile:false, server:{middlewareMode:true,hmr:false} });
after(() => vite.close());
const { createSessionLifecycle } = await vite.ssrLoadModule('/app/session-lifecycle.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = (id='one', role='dealer', dealerId=1) => Response.json({userId:id,role,dealerId});
function fixture() {
  const win = new EventTarget();
  const doc = new EventTarget();
  Object.assign(doc,{visibilityState:'visible',documentElement:{dataset:{}}});
  const storage = {'dealerSettlement:listReturnTo':'/?dealerId=1',unrelated:'keep'};
  Object.defineProperty(storage,'removeItem',{value(key){delete this[key];}});
  const events=[],states=[],navigation=[];
  Object.assign(win,{document:doc,sessionStorage:storage,localStorage:{setItem(key,value){events.push([key,JSON.parse(value)]);}},
    location:{replace(url){navigation.push(url);},reload(){navigation.push('reload');}},fetch:async()=>session()});
  const controller = createSessionLifecycle(win,state=>states.push(state));
  return {win,doc,storage,events,states,navigation,controller};
}
function event(type, properties={}) { return Object.assign(new Event(type),properties); }
test('logout immediately hides the old page, clears app filters and leaves unrelated storage alone',async()=>{
  const f=fixture();await tick();assert.equal(f.states.at(-1),'active');
  f.controller.logout();
  assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
  assert.equal(f.states.at(-1),'signed-out');
  assert.equal(f.storage['dealerSettlement:listReturnTo'],undefined);
  assert.equal(f.storage.unrelated,'keep');
  assert.equal(f.events.at(-1)[1].type,'logout');
  assert.deepEqual(f.navigation,['/cdn-cgi/access/logout']);
  f.controller.dispose();
});
test('an in-flight session response cannot restore old data after logout',async()=>{
  const f=fixture();await tick();let resolve;
  f.win.fetch=()=>new Promise(r=>{resolve=r;});
  void f.controller.retry();await tick();f.controller.logout();resolve(session());await tick();
  assert.equal(f.states.at(-1),'signed-out');assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
  f.controller.dispose();
});
test('logout in another tab removes this tab data without starting a new session',async()=>{
  const f=fixture();await tick();
  f.win.dispatchEvent(event('storage',{key:'dealerSettlement:sessionEvent',newValue:JSON.stringify({type:'logout'})}));
  assert.equal(f.states.at(-1),'signed-out');assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
  f.win.dispatchEvent(event('focus'));await tick();assert.equal(f.states.at(-1),'signed-out');assert.deepEqual(f.navigation,[]);
  f.controller.dispose();
});
test('changed account or permissions reload from the root before showing any previous data',async()=>{
  for(const next of [()=>session('two'),()=>session('one','viewer',null),()=>session('one','dealer',2)]) {
    const f=fixture();await tick();f.win.fetch=async()=>next();await f.controller.retry();
    assert.deepEqual(f.navigation,['/']);assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
    assert.equal(f.storage['dealerSettlement:listReturnTo'],undefined);f.controller.dispose();
  }
});
test('BFCache restores a hidden page and forces a fresh load',async()=>{
  const f=fixture();await tick();f.win.dispatchEvent(event('pagehide'));
  assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
  f.win.dispatchEvent(event('pageshow',{persisted:true}));assert.deepEqual(f.navigation,['reload']);
  assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');f.controller.dispose();
});
test('tab return validates without browser cache; invalid, expired and failed responses never expose old data',async()=>{
  for(const response of [Response.json({}, {status:401}),Response.json({}, {status:403}),Response.json({}, {status:500}),new Response('<html>Login</html>')]) {
    const f=fixture();await tick();f.doc.visibilityState='hidden';f.doc.dispatchEvent(event('visibilitychange'));
    assert.equal(f.doc.documentElement.dataset.sessionHidden,undefined);
    f.win.fetch=async(url,options)=>{assert.equal(url,'/api/session');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');return response;};
    f.doc.visibilityState='visible';f.doc.dispatchEvent(event('visibilitychange'));await tick();
    assert.ok(['signed-out','unavailable'].includes(f.states.at(-1)));assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
    f.controller.dispose();
  }
});
test('same session revalidation preserves the page; disabled storage does not prevent logout',async()=>{
  const f=fixture();await tick();await f.controller.retry();
  assert.equal(f.states.at(-1),'active');assert.equal(f.doc.documentElement.dataset.sessionHidden,undefined);
  f.win.localStorage.setItem=()=>{throw new Error('Storage disabled');};
  assert.doesNotThrow(()=>f.controller.logout());assert.deepEqual(f.navigation,['/cdn-cgi/access/logout']);f.controller.dispose();
});
test('returning to the tab keeps the page visible and shares overlapping focus and visibility checks',async()=>{
  const f=fixture();await tick();const initialStates=[...f.states],initialEvents=f.events.length;
  let resolve,calls=0,aborted=false;
  f.win.fetch=(_url,options)=>{calls++;options.signal.addEventListener('abort',()=>{aborted=true;});return new Promise(r=>{resolve=r;});};
  f.doc.visibilityState='hidden';f.doc.dispatchEvent(event('visibilitychange'));
  f.doc.visibilityState='visible';f.doc.dispatchEvent(event('visibilitychange'));
  f.win.dispatchEvent(event('focus'));f.win.dispatchEvent(event('pageshow',{persisted:false}));await tick();
  assert.equal(calls,1);assert.equal(aborted,false);
  assert.equal(f.doc.documentElement.dataset.sessionHidden,undefined);assert.deepEqual(f.states,initialStates);
  resolve(session());await tick();
  f.win.dispatchEvent(event('focus'));await tick();assert.equal(calls,1);
  assert.equal(f.events.length,initialEvents);assert.deepEqual(f.navigation,[]);
  f.controller.dispose();
});
test('a failed background check hides data and an explicit retry bypasses throttling',async()=>{
  const f=fixture();await tick();
  f.win.fetch=async()=>{throw new Error('network');};await f.controller.retry();
  assert.equal(f.states.at(-1),'unavailable');assert.equal(f.doc.documentElement.dataset.sessionHidden,'true');
  f.win.fetch=async()=>session();await f.controller.retry();
  assert.equal(f.states.at(-1),'active');assert.equal(f.doc.documentElement.dataset.sessionHidden,undefined);
  f.controller.dispose();
});
