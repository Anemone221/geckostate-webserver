// Type declaration for unbzip2-stream.
// The package has no bundled types and no @types package on npm.
// It exports a single factory function that returns a Transform stream.
// Usage: response.data.pipe(unbzip2()).pipe(csvParser)

/// <reference types="node" />

declare module 'unbzip2-stream' {
  import { Transform } from 'stream';
  function unbzip2(): Transform;
  export = unbzip2;
}
