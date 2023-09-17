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
    async openPort(clientId) {
      const { port1, port2 } = new MessageChannel();
      mapIdToPort.set(clientId, port1);

      // Intercept proxify calls to configure MessagePort services
      // before the call is invoked. This handler must be installed
      // before calling proxify().
      port1.addEventListener('message', (event) => {
        ['log', 'sql'].forEach((name, index) => {
          if (event.ports[index]) {
            globalThis[name] = proxify(event.ports[index]);
          }
        });
      });
      proxify(port1, await provideExtension());
      return transfer(port2, [port2]);
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
