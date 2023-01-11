const TRANSFERABLES = new Set([MessagePort, ArrayBuffer]);
const UNREACHABLE = Symbol();
const PROXY_MARKER = '()=>{}';

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

// Close port when proxy is garbage collected.
const registry = new FinalizationRegistry(function(port: MessagePortLike) {
  port.close?.();
});

export function proxify(port: MessagePortLike, target?: Function|object) {
  port.start?.();
  const close = port.close;
  if (target) {
    async function listener({ data }) {
      if (data.close) {
        port.close();
        return;
      }

      const id = data.id;
      try {
        // Dereference the member path.
        const [obj, member] = data.path.reduce(([_, obj], property) => {
          return [obj, obj[property]];
        }, [null, target]);

        // Instantiate argument proxies.
        const args = data.args.map(unwrap);

        let result = await member.apply(obj, args);
        if (typeof result === 'function') {
          result = wrap(result);
        }

        const transferables = new Set([
          TRANSFERABLES.has(result?.constructor) ? result : [],
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

    // When the port is closed, notify the other endpoint and remove
    // the listener so the target is no longer referenced.
    port.close = function() {
      port.postMessage({ close: true });
      close?.apply(port);
      port.removeEventListener('message', listener);
    };
  } else {
    // Create map to match a response with Promise callbacks.
    const callbacks = new Map();
    mapPortToPromiseCallbacks.set(port, callbacks);
    function listener({ data }) {
      if (data.close) {
        port.close();
        return;
      }

      const callback = callbacks.get(data.id);
      if (data.hasOwnProperty('result')) {
        const result =  unwrap(data.result);
        callback.resolve(result);
      } else {
        callback.reject(Object.assign(new Error(), data.error));
      }
      callbacks.delete(data.id);
    }
    port.addEventListener('message', listener);

    // Override the close method to notify the other endpoint.
    port.close = function() {
      port.postMessage({ close: true });
      close?.apply(port);
      port.removeEventListener('message', listener);

      // Reject any outstanding calls.
      const callbacks = mapPortToPromiseCallbacks.get(port);
      if (callbacks) {
        for (const callback of callbacks.values()) {
          callback.reject(new Error('port closed'));
        }
        mapPortToPromiseCallbacks.delete(port);
      }
    };

    const proxy = makeProxy(port, null, []);
    registry.register(proxy, port);
    return proxy;
  }
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

        // Automatically proxy function arguments.
        args = args.map(arg => typeof arg === 'function' ? wrap(arg) : arg);

        const transferables = new Set([
          args.filter(arg => TRANSFERABLES.has(arg?.constructor)),
          args.map(arg => mapObjectToTransferables.get(arg) ?? [])
        ].flat(Infinity));
        port.postMessage({ id, path, args }, [...transferables]);
      });
    }
  });
  return proxy;
}

export function transfer(obj: any, transferables: Transferable[]) {
  mapObjectToTransferables.set(obj, transferables);
  return obj;
}

export function wrap(obj: any) {
  const { port1, port2 } = new MessageChannel();
  proxify(port1, obj);
  return transfer({
    [PROXY_MARKER]: port2
  }, [port2]);
}

function unwrap(obj: any) {
  const port = obj?.[PROXY_MARKER];
  return port instanceof MessagePort ? proxify(port) : obj;
}