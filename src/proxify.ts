interface MessagePortLike {
  postMessage: (data: any, transferables?: Transferable[]) => void
  addEventListener: (type: "message", listener: (event: MessageEvent<any>) => void, options?) => void
  removeEventListener: (type: "message", listener: (event: MessageEvent<any>) => void) => void
  dispatchEvent?: (event: Event) => boolean

  start?: () => void
  close?: () => void
}

const mapObjectToTransferables = new WeakMap<any, Transferable[]>();
const mapAbortControllers = new WeakMap<any, AbortController>();

// Clean up when proxy is garbage collected.
const finalization = new FinalizationRegistry(function(abortController: AbortController) {
  abortController.abort();
});

/**
 * @param port 
 * @param target object to proxy
 * @returns Proxy when no target argument provided
 */
export function proxify(port: MessagePortLike, target?: Function|object) {
  port.start?.();
  return target ?
    buildTarget(port, target) :
    buildProxy(port);
}

/**
 * Terminate proxy from either side.
 * @param proxyOrPort 
 */
export function unproxify(proxyOrPort: MessagePortLike|any) {
  mapAbortControllers.get(proxyOrPort)?.abort();
  mapAbortControllers.delete(proxyOrPort);
}

/**
 * Associate transferable items with an argument or return value.
 * @param obj object to be passed as an argument or return value
 * @param transferables collection of transferable items within object
 * @returns obj
 */
export function transfer(obj: any, transferables: Iterable<Transferable>) {
  mapObjectToTransferables.set(
    obj,
    Array.isArray(transferables) ? transferables : [...transferables]);
  return obj;
}

function buildTarget(port: MessagePortLike, target: Function|object) {
  const abortController = new AbortController();
  port.addEventListener('message', async function({ data }: MessageEvent) {
    if (data.close) return abortController.abort();

    try {
      // Dereference the member path.
      const [obj, member] = data.path.reduce(([_, obj], property) => {
        return [obj, obj[property]];
      }, [null, target]);

      const result = await member.apply(obj, data.args);
      const transferables = mapObjectToTransferables.get(result) ?? []
      port.postMessage({ id: data.id, result }, transferables);
    } catch (e) {
      port.postMessage({ id: data.id, error: cvtErrorToCloneable(e) });
    }
  }, { signal: abortController.signal });

  abortController.signal.addEventListener('abort', function() {
    port.postMessage({ close: true });
    port.close?.();
    port.dispatchEvent?.(new Event('close'));
  });
  mapAbortControllers.set(port, abortController);
}

function buildProxy(port: MessagePortLike) {
  type PromiseCallbacks = { resolve: (value: unknown) => void, reject: (reason?: any) => void };
  const callbacks = new Map<number, PromiseCallbacks>();
  const abortController = new AbortController();
  port.addEventListener('message', function({ data }: MessageEvent) {
    if (data.close) return abortController.abort();

    // Settle the appropriate Promise.
    const callback = callbacks.get(data.id);
    if (data.hasOwnProperty('result')) {
      callback.resolve(data.result);
    } else {
      callback.reject(cvtCloneableToError(data.error));
    }
    callbacks.delete(data.id);
  }, { signal: abortController.signal });

  function createProxy(parentProxy: any, path: (string|symbol)[]) {
    return new Proxy(function(){}, {
      get(_, property, receiver) {
        // This line does nothing except prevent garbage collection of
        // the root proxy - which would trigger port closure by the
        // FinalizationRegistry - while any related proxies are in use.
        if (parentProxy === '') return;

        // Avoid confusing a proxy with a Promise, e.g. on return from
        // an async function.
        if (property === 'then') return undefined;

        return createProxy(receiver, [...path, property]);
      },

      apply(_, __, args) {
        if (abortController.signal.aborted) return Promise.reject(new Error('port closed'));

        return new Promise(function(resolve, reject) {
          const id = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER);
          callbacks.set(id, { resolve, reject });

          const transferables = new Set(args.map(arg => {
            return mapObjectToTransferables.get(arg) ?? [];
          }).flat());
          port.postMessage({ id, path, args }, [...transferables]);
        });
      }
    });
  }

  abortController.signal.addEventListener('abort', function() {
    port.postMessage({ close: true });
    port.close?.();
    port.dispatchEvent?.(new Event('close'));
    for (const callback of callbacks.values()) {
      callback.reject(new Error('port closed'));
    }
  });

  const proxy = createProxy(null, []);
  finalization.register(proxy, abortController);
  mapAbortControllers.set(proxy, abortController);
  mapAbortControllers.set(port, abortController);
  return proxy;
}

// Some browsers won't structured clone Error, so convert to POJO.
function cvtErrorToCloneable(e: any) {
  if (e instanceof Error) {
    const props = new Set([
      ...['name', 'message', 'stack'].filter(k => e[k] !== undefined),
      ...Object.getOwnPropertyNames(e)
    ]);
    return Object.fromEntries(Array.from(props, k =>  [k, e[k]])
      .filter(([_, v]) => {
        // Skip any non-cloneable properties.
        try {
          structuredClone(v);
          return true;
        } catch (e) {
          return false;
        }
      }));
  }
  return e;
}

// Reconstruct Error from POJO.
function cvtCloneableToError(e: any) {
  if (Object.hasOwn(e, 'message')) {
    const error = new Error(e.message);
    for (const [k, v] of Object.entries(e)) {
      try {
        error[k] = v;
      } catch (e) {
        // Ignore any properties that can't be set.
      }
    }
    return error;
  }
  return e;
}