import { proxify, unproxify, transfer } from './proxify.js';

/** @type {Map<string,MessagePort>} */ const mapIdToPort = new Map();

/**
 * @param {() => any} provideExtension
 */
export function register(provideExtension) {
  const { port1, port2 } = new MessageChannel();
  proxify(port1, {
    /**
     * @param {string} clientId 
     * @returns {Promise<MessagePort>}
     */
    async openPort(version, clientId) {
      if (version === 1) {
        const { port1, port2 } = new MessageChannel();
        mapIdToPort.set(clientId, port1);

        // Intercept proxify calls to configure MessagePort services
        // before the call is invoked. This handler must be installed
        // before calling proxify().
        port1.addEventListener('message', (event) => {
          if (Array.isArray(event.data.args)) {
            const services = event.data.args.shift();
            for (const [name, port] of services) {
              globalThis[name] = proxify(port);
            }
          }
        });
        proxify(port1, await provideExtension());
        return transfer(port2, [port2]);
      }
      throw new Error(`Unsupported unboxed protocol version ${version}`);
    },

    /**
     * @param {string} clientId 
     * @returns {void}
     */
    closePort(clientId) {
      const port = mapIdToPort.get(clientId);
      unproxify(port);
      mapIdToPort.delete(clientId);
    }
  });
  window.parent.postMessage(window.location.hash, '*', [port2]);
}
