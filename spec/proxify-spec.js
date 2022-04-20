import { proxify, transfer, wrap } from '../dist/proxify.js';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 30 * 1000;

describe('proxify', function() {
  let port1, port2;
  beforeEach(function() {
    ({port1, port2} = new MessageChannel());
  });

  afterEach(function() {
    port1.close();
    port2.close();
  });

  it('should call a function target', async function() {
    function target(a, b) {
      return a + b;
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy(1, 2);
    await expectAsync(result).toBeResolvedTo(3);
  });

  it('should call a target member function', async function() {
    const target = {
      add(a, b) {
        return a + b;
      }
    };
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy.add(1, 2);
    await expectAsync(result).toBeResolvedTo(3);
  });

  it('should pass a function argument', async function() {
    function target(f, ...args) {
      return f(...args);
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy((a, b) => a + b, 1, 2);
    await expectAsync(result).toBeResolvedTo(3);
  });

  it('should return a function result', async function() {
    function target() {
      return (a, b) => a + b;
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = await proxy();
    await expectAsync(result(1, 2)).toBeResolvedTo(3);
  });

  it('should propagate Error', async function() {
    function target() {
      throw new Error('foo');
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy();
    await expectAsync(result).toBeRejectedWithError(/foo/);
  });

  it('should throw after port is closed', async function() {
    const target = function() { return 42; }
    proxify(port1, target);

    const proxy = proxify(port2);

    // Watch for close of the port on the proxy side.
    const portClosed = new Promise(resolve => {
      const close = port2.close;
      port2.close = function() {
        close.apply(port2);
        resolve();
      };
    });

    // Close the port on the target side. Notification will reach the
    // proxy side in a subsequent task.
    port1.close();

    // Call the proxy before the notification arrives.
    const resultA = proxy();

    // Wait for the close to propagate.
    await portClosed;

    // Call the proxy after the notification arrives.
    const resultB = proxy();

    await expectAsync(resultA).toBeRejectedWithError(/closed/);
    await expectAsync(resultB).toBeRejectedWithError(/closed/);
  });

  it('should transfer argument', async function() {
    function target(arrayBuffer) {
      return arrayBuffer.byteLength;
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy(new ArrayBuffer(42));
    await expectAsync(result).toBeResolvedTo(42);
  });

  it('should transfer result', async function() {
    function target() {
      return new ArrayBuffer(42);
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = await proxy();
    await expect(result.byteLength).toBe(42);
  });

  it('should transfer complex argument', async function() {
    function target(buffers) {
      return buffers.map(buffer => buffer.byteLength);
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const buffers = [new ArrayBuffer(1), new ArrayBuffer(2), new ArrayBuffer(3)];
    const result = proxy(transfer(buffers, buffers));
    await expectAsync(result).toBeResolvedTo([1, 2, 3]);
  });

  it('should transfer complex result', async function() {
    function target() {
      const buffers = [new ArrayBuffer(1), new ArrayBuffer(2), new ArrayBuffer(3)];
      return transfer(buffers, buffers);
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = await proxy();
    await expect(result.map(buffer => buffer.byteLength)).toEqual([1, 2, 3]);
  });

  it('should auto close', async function() {
    // Watch for close of both ports.
    const target = new Promise(resolve => {
      const close = port1.close;
      port1.close = function() {
        close.apply(this);
        resolve();
      }
      proxify(port1, {});
    });
    const proxy = new Promise(resolve => {
      const close = port2.close;
      port2.close = function() {
        close.apply(this);
        resolve();
      }

      // No reference is kept to the returned Proxy so it eventually
      // should be garbage collected and trigger port closure.
      proxify(port2);
    });

    // TODO: Find a way to trigger garbage collection to avoid delay.
    await expectAsync(target).toBeResolved();
    await expectAsync(proxy).toBeResolved();
  });
});