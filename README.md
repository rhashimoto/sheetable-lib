# @sheetable/proxify
This package wraps both MessagePort endpoints of a MessageChannel to proxy function and method calls.

proxify is like [comlink](https://github.com/GoogleChromeLabs/comlink) but simplified
to provide only function and method calls. This can be a useful limitation when the
calling code is not trusted (e.g. from an iframe).

## Example usage:
```javascript
import { proxify } from '@sheetable/proxify';

const receiver = {
  foo(message) {
    console.log(message);
    return 42;
  }
}

const { port1, port2 } = new MessageChannel();

// Either port1 or port2 (or both) could be transferred to a
// different context via postMessage() or with proxify itself.

// Associate one port with the function or object to proxy.
proxify(port1, receiver);

// Create the proxy with the other port.
const proxy = proxify(port2);

// Calls on the proxy return a Promise for the result.
proxy.foo('Hello, world!').then(function(result) {
  // result is 42
});
```
