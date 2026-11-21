# SSS GUIS: Smart Widgets Shared Worker Base

## Purpose

This package gives you the base code for a browser `SharedWorker` (running in `SharedWorkerGlobalScope`, without `window` or `document`) for use with [`@sss/sss-guis-smart-widgets-base`](https://github.com/bradley499/sss-guis-smart-widgets-base).

This package does not include a network transport. You must complete this package in an external project before you use it.

---

## Complete the Package Externally

### 1. Implement the Abstract Transport

Create a class that extends `transport` in your external project. The package also exports the `eventName`, `eventType`, and `eventContents` types. You must implement all five abstract methods:

- `publish(name, type, contents, time?)`: Send an event message to the remote server.
- `follow(name, type)`: Follows events topics on the remote server.
- `unfollow(name, type)`: Unfollows event topics on the remote server.
- `receive(listener)`: Register a callback `(name, type, contents, time?) => void` and call it when a message arrives from the remote server.
- `connected()`: Return `true` when the connection to the remote server is open. Return `false` when the connection is closed.

### 2. Start the SharedWorker

Create an entry file. Create an instance of your `transport` class and pass it to `sharedWorker`:

```ts
import { sharedWorker, transport } from "@sss/sss-guis-smart-widgets-shared-worker-base";

class myTransport extends transport { ... }

new sharedWorker(new myTransport());
```

---

## Compile for a SharedWorker

You must compile the completed SharedWorker into one standalone **classic script** bundle, with no unbundled package imports or top-level `import`/`export` statements remaining.
