var b=new WeakMap,c=new WeakMap,E=new FinalizationRegistry(function(e){e.abort()});function k(e,t){return e.start?.(),t?m(e,t):M(e)}function P(e){c.get(e)?.abort(),c.delete(e)}function C(e,t){return b.set(e,Array.isArray(t)?t:[...t]),e}function m(e,t){let n=new AbortController;e.addEventListener("message",async function({data:r}){if(r.close)return n.abort();try{let[o,s]=r.path.reduce(([l,i],f)=>[i,i[f]],[null,t]),a=await s.apply(o,r.args),u=b.get(a)??[];e.postMessage({id:r.id,result:a},u)}catch(o){e.postMessage({id:r.id,error:w(o)})}},{signal:n.signal}),n.signal.addEventListener("abort",function(){e.postMessage({close:!0}),e.close?.(),e.dispatchEvent?.(new Event("close"))}),c.set(e,n)}function M(e){let t=new Map,n=new AbortController;e.addEventListener("message",function({data:s}){if(s.close)return n.abort();let a=t.get(s.id);s.hasOwnProperty("result")?a.resolve(s.result):a.reject(p(s.error)),t.delete(s.id)},{signal:n.signal});function r(s,a){return new Proxy(function(){},{get(u,l,i){if(s!==""&&l!=="then")return r(i,[...a,l])},apply(u,l,i){return n.signal.aborted?Promise.reject(new Error("port closed")):new Promise(function(f,v){let g=Math.trunc(Math.random()*Number.MAX_SAFE_INTEGER);t.set(g,{resolve:f,reject:v});let d=new Set(i.map(y=>b.get(y)??[]).flat());e.postMessage({id:g,path:a,args:i},[...d])})}})}n.signal.addEventListener("abort",function(){e.postMessage({close:!0}),e.close?.(),e.dispatchEvent?.(new Event("close"));for(let s of t.values())s.reject(new Error("port closed"))});let o=r(null,[]);return E.register(o,n),c.set(o,n),c.set(e,n),o}function w(e){if(e instanceof Error){let t=new Set([...["name","message","stack"].filter(n=>e[n]!==void 0),...Object.getOwnPropertyNames(e)]);return Object.fromEntries(Array.from(t,n=>[n,e[n]]).filter(([n,r])=>{try{return structuredClone(r),!0}catch{return!1}}))}return e}function p(e){if(Object.hasOwn(e,"message")){let t=new Error(e.message);for(let[n,r]of Object.entries(e))try{t[n]=r}catch{}return t}return e}export{k as proxify,C as transfer,P as unproxify};
//# sourceMappingURL=proxify.js.map
