var d=new WeakMap,f=new WeakMap,M=new FinalizationRegistry(function(e){e.abort()});function g(e,r){return e.start?.(),r?h(e,r):P(e)}function v(e){f.get(e)?.abort(),f.delete(e)}function y(e,r){return d.set(e,Array.isArray(r)?r:[...r]),e}function h(e,r){let n=new AbortController;e.addEventListener("message",async function({data:t}){if(t.close)return n.abort();try{let[o,s]=t.path.reduce(([l,i],u)=>[i,i[u]],[null,r]),a=await s.apply(o,t.args),c=d.get(a)??[];e.postMessage({id:t.id,result:a},c)}catch(o){e.postMessage({id:t.id,error:k(o)})}},{signal:n.signal}),n.signal.addEventListener("abort",function(){e.postMessage({close:!0}),e.close?.(),e.dispatchEvent?.(new Event("close"))}),f.set(e,n)}function P(e){let r=new Map,n=new AbortController;e.addEventListener("message",function({data:s}){if(s.close)return n.abort();let a=r.get(s.id);s.hasOwnProperty("result")?a.resolve(s.result):a.reject(C(s.error)),r.delete(s.id)},{signal:n.signal});function t(s,a){return new Proxy(function(){},{get(c,l,i){if(s!==""&&l!=="then")return t(i,[...a,l])},apply(c,l,i){return n.signal.aborted?Promise.reject(new Error("port closed")):new Promise(function(u,m){let p=Math.trunc(Math.random()*Number.MAX_SAFE_INTEGER);r.set(p,{resolve:u,reject:m});let w=new Set(i.map(E=>d.get(E)??[]).flat());e.postMessage({id:p,path:a,args:i},[...w])})}})}n.signal.addEventListener("abort",function(){e.postMessage({close:!0}),e.close?.(),e.dispatchEvent?.(new Event("close"));for(let s of r.values())s.reject(new Error("port closed"))});let o=t(null,[]);return M.register(o,n),f.set(o,n),f.set(e,n),o}function k(e){if(e instanceof Error){let r=new Set([...["name","message","stack"].filter(n=>e[n]!==void 0),...Object.getOwnPropertyNames(e)]);return Object.fromEntries(Array.from(r,n=>[n,e[n]]).filter(([n,t])=>{try{return structuredClone(t),!0}catch{return!1}}))}return e}function C(e){if(Object.hasOwn(e,"message")){let r=new Error(e.message);for(let[n,t]of Object.entries(e))try{r[n]=t}catch{}return r}return e}var b=new Map;function L(e){let{port1:r,port2:n}=new MessageChannel;g(r,{async openPort(t,o){if(t===1){let{port1:s,port2:a}=new MessageChannel;return b.set(o,s),s.addEventListener("message",c=>{if(Array.isArray(c.data.args)){let l=c.data.args.shift();for(let[i,u]of l)globalThis[i]=g(u)}}),g(s,await e()),y(a,[a])}throw new Error(`Unsupported unboxed protocol version ${t}`)},closePort(t){let o=b.get(t);v(o),b.delete(t)}}),window.parent.postMessage(window.location.hash,"*",[n])}export{L as register};
//# sourceMappingURL=unboxed.js.map