import net from 'node:net';
import { createInterface } from 'node:readline';

// The desktop launcher creates a random, ACL-restricted pipe. No TCP endpoint exists in the elevated worker.
export class PipeBridge {
  constructor(name) {
    if (!/^ThinkPadControl-[a-f0-9]{32}$/.test(name)) throw new Error('Invalid hardware worker pipe name.');
    this.path=`\\\\.\\pipe\\${name}`;this.pending=new Map();this.sequence=0;
  }
  async connect() {
    if (this.child && !this.child.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting=(async()=>{
      const deadline=Date.now()+18000;
      while (true) {
        try {
          const socket=await new Promise((resolve,reject)=>{
            const stream=net.createConnection(this.path);
            stream.once('error',reject);stream.once('connect',()=>{stream.removeListener('error',reject);resolve(stream);});
          });
          this.child=socket;
          const fail=()=>{
            for (const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Hardware worker disconnected; fan lease released.'));}
            this.pending.clear();if(this.child===socket)this.child=null;
          };
          socket.on('error',fail);socket.on('close',fail);
          createInterface({input:socket}).on('line',line=>{
            try {
              const reply=JSON.parse(line),entry=this.pending.get(reply.id);if(!entry)return;
              clearTimeout(entry.timer);this.pending.delete(reply.id);
              if(reply.error)entry.reject(new Error(reply.error));else entry.resolve(reply.result);
            } catch {socket.destroy();}
          });
          return;
        } catch(e) {
          if(!['ENOENT','ECONNREFUSED','EBUSY'].includes(e.code)||Date.now()>deadline)throw new Error(`Cannot connect to hardware worker: ${e.message}`);
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      }
    })().finally(()=>{this.connecting=null;});
    return this.connecting;
  }
  async request(op,args={}) {
    await this.connect();const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.child?.destroy();reject(new Error('Hardware worker timed out; fan lease released.'));},op==='fan-curve'?60000:20000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.write(JSON.stringify({id,op,...args})+'\n',e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
    });
  }
  close() { this.child?.destroy(); }
}
