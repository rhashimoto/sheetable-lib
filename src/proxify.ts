const AUTO_TRANSFERABLES = new Set([MessagePort]);
const UNREACHABLE = Symbol();
const PROXY_DETECTOR = Symbol();

interface MessagePortLike {
  postMessage: (data: any, transferables?: Transferable[]) => void
  addEventListener: (type: "message", listener: (event: MessageEvent<any>) => void) => void
  removeEventListener: (type: "message", listener: (event: MessageEvent<any>) => void) => void

  start?: () => void
  close?: () => void
}

type PromiseCallbacks = { resolve: (value: unknown) => void, reject: (reason?: any) => void };

const mapPortToPromiseCallbacks = new WeakMap<MessagePortLike, Map<string, PromiseCallbacks>>();
const mapObjectToTransferables = new WeakMap<any, Transferable[]>();
const mapProxyToPort = new WeakMap<any, MessagePortLike>();

// Close port when proxy is garbage collected.
const registry = new FinalizationRegistry(function(port: MessagePortLike) {
  closeProxifyPort(port);
});

export function proxify(port: MessagePortLike, target?: Function|object) {
  port.start?.();
  if (target) {
    async function listener({ data }) {
      if (data.close) {
        closeProxifyPort(port);
        return;
      }

      const id = data.id;
      try {
        // Dereference the member path.
        const [obj, member] = data.path.reduce(([_, obj], property) => {
          return [obj, obj[property]];
        }, [null, target]);

        let result = await member.apply(obj, data.args);

        const transferables = new Set([
          AUTO_TRANSFERABLES.has(result?.constructor) ? result : [],
          mapObjectToTransferables.get(result) ?? []
        ].flat());
        port.postMessage({ id, result }, [...transferables]);
      } catch (e) {
        // Error is not structured cloneable on all platforms.
        const error = e instanceof Error ? 
          Object.fromEntries(Object.getOwnPropertyNames(e).map(k => [k, e[k]])) :
          e;
        port.postMessage({ id, error });
      }
    }
    port.addEventListener('message', listener);
    return port;
  } else {
    // Create map to match a response with Promise callbacks.
    const callbacks = new Map();
    mapPortToPromiseCallbacks.set(port, callbacks);
    function listener({ data }) {
      if (data.close) {
        closeProxifyPort(port);
        return;
      }

      const callback = callbacks.get(data.id);
      if (data.hasOwnProperty('result')) {
        callback.resolve(data.result);
      } else {
        callback.reject(Object.assign(new Error(), data.error));
      }
      callbacks.delete(data.id);
    }
    port.addEventListener('message', listener);

    const proxy = makeProxy(port, null, []);
    registry.register(proxy, port);
    mapProxyToPort.set(proxy, port);
    return proxy;
  }
}

export function unproxify(proxyOrPort: any) {
  const port: MessagePortLike = proxyOrPort[PROXY_DETECTOR] ?
    mapProxyToPort.get(proxyOrPort) :
    proxyOrPort;
  closeProxifyPort(port);
}

export function transfer(obj: any, transferables: Transferable[]) {
  mapObjectToTransferables.set(obj, transferables);
  return obj;
}

function makeProxy(port: MessagePortLike, parentProxy: any, path: (string|symbol)[]) {
  const proxy = new Proxy(function(){}, {
    get(_, property, receiver) {
      // The only reason for this is to prevent garbage collection of
      // the root proxy while any related proxies are in use.
      if (property === UNREACHABLE) return parentProxy;

      // Avoid confusing a proxy with a Promise, e.g. on return from
      // an async function.
      if (property === 'then') return undefined;

      return makeProxy(port, receiver, [...path, property]);
    },

    apply(_, __, args) {
      const callbacks = mapPortToPromiseCallbacks.get(port);
      if (!callbacks) return Promise.reject(new Error('port closed'));
      return new Promise(function(resolve, reject) {
        const id = Math.random().toString(36).replace('0.', '');
        callbacks.set(id, { resolve, reject });

        const transferables = new Set([
          args.filter(arg => AUTO_TRANSFERABLES.has(arg?.constructor)),
          args.map(arg => mapObjectToTransferables.get(arg) ?? [])
        ].flat(Infinity));
        port.postMessage({ id, path, args }, [...transferables]);
      });
    }
  });
  return proxy;
}

function closeProxifyPort(port: MessagePortLike) {
  port.postMessage({ close: true });
  port.close?.();

  // Reject any outstanding calls.
  const callbacks = mapPortToPromiseCallbacks.get(port);
  if (callbacks) {
    for (const callback of callbacks.values()) {
      callback.reject(new Error('port closed'));
    }
    mapPortToPromiseCallbacks.delete(port);
  }
}