// The one host API core needs. Browsers, workers and Node all provide it.
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
};
