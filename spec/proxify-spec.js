import { proxify, unproxify, transfer } from '../dist/proxify.js';

// jasmine.DEFAULT_TIMEOUT_INTERVAL = 30 * 1000;

describe('proxify', function() {
  let port1, port2;
  beforeEach(function() {
    ({port1, port2} = new MessageChannel());
  });

  afterEach(function() {
    unproxify(port1);
    unproxify(port2);
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
    const clientPortClosed = new Promise(resolve => {
      const close = port2.close;
      spyOn(port2, 'close').and.callFake(() => {
        resolve();
        return close.call(port2);
      });
    });

    const target = function() { return 42; }
    proxify(port1, target);

    const proxy = proxify(port2);

    // Close the port on the target side. Notification will reach the
    // proxy side in a subsequent task.
    unproxify(port1);

    // Call the proxy before the notification arrives.
    const resultA = proxy();
    expect(port2.close).not.toHaveBeenCalled();

    // Wait for the close to propagate.
    await clientPortClosed;
    expect(port2.close).toHaveBeenCalled();

    // Call the proxy after the notification arrives.
    const resultB = proxy();

    await expectAsync(resultA).toBeRejectedWithError(/closed/);
    await expectAsync(resultB).toBeRejectedWithError(/closed/);
  });

  it('should close target port after client unproxify', async function() {
    const targetPortClosed = new Promise(resolve => {
      const close = port1.close;
      spyOn(port1, 'close').and.callFake(() => {
        resolve();
        return close.call(port1);
      });
    });

    const target = function() { return 42; }
    proxify(port1, target);

    const proxy = proxify(port2);

    expect(port1.close).not.toHaveBeenCalled();

    unproxify(proxy);
    await expectAsync(targetPortClosed).toBeResolved();
    expect(port1.close).toHaveBeenCalled();
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
    const targetPortClosed = new Promise(resolve => {
      const close = port1.close;
      spyOn(port1, 'close').and.callFake(() => {
        resolve();
        return close.call(port1);
      });
    });

    const clientPortClosed = new Promise(resolve => {
      const close = port2.close;
      spyOn(port2, 'close').and.callFake(() => {
        resolve();
        return close.call(port2);
      });
    });

    // No reference is kept to the returned Proxy so it eventually
    // should be garbage collected and trigger port closure.
    proxify(port1, {});
    proxify(port2);

    // Try to encourage garbage collection to happen.
    let count = 0;
    for (let i = 0; i < 64; ++i) {
      const ab = new ArrayBuffer(2 ** 20);
      count += ab.size;
    }

    await expectAsync(targetPortClosed).toBeResolved();
    await expectAsync(clientPortClosed).toBeResolved();
  });

  it('should pass Error properties', async function() {
    function target() {
      class MyError extends Error {
        constructor(message) {
          super(message);
          this.extra = 'bar';
        }
      }
      throw new MyError('foo');
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy();
    await expectAsync(result).toBeRejectedWithError('foo');

    const error = await result.catch(e => e);
    expect(error.extra).toBe('bar');
  });

  it('should throw if return value is not structured cloneable', async function() {
    function target() {
      return { foo() {} };
    }
    proxify(port1, target);
    const proxy = proxify(port2);

    const result = proxy();
    await expectAsync(result).toBeRejectedWithError();
  });
});