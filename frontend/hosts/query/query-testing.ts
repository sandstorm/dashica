// Test helper for the hosts' tests: a query key that the data handlers read, kept per page, without an extension.
import { queryKey } from './query';

/**
 * A stand-in for a key every chart sends (the time range's place): `?time=1h` in the URL, the page's `defaultTime`
 * (else 24h) by default, which the host leaves out of the URL, sent to the server always. The hosts' tests take it in
 * place of an extension's key.
 */
export const TEST_TIME = queryKey<string>('time', {
  parse: (url, page) => url.get('time') || page?.defaultTime || '24h',
  format: (range) => [['time', range]],
  sentToServer: true,
});
