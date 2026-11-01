// Tests for diagnostics.ts: the chart's Diagnostics read from its answer's header, decoded.
import { describe, expect, it } from 'vitest';
import { diagnosticsOf } from './diagnostics';

const answer = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('diagnosticsOf', () => {
  it('reads the ignored pills and why a chart did not run, empty without the header', () => {
    expect(diagnosticsOf(answer({ 'X-Dashica-Diagnostics': '{"ignored":["host","status"]}' }))).toEqual({ ignored: ['host', 'status'] });
    expect(diagnosticsOf(answer({ 'X-Dashica-Diagnostics': '{"skipped":"pick a host"}' }))).toEqual({ skipped: 'pick a host' });
    expect(diagnosticsOf(answer({}))).toEqual({});
  });

  it('decodes the percent-encoded JSON, so any text survives the header', () => {
    const encoded = '%7B%22ignored%22:%5B%22customer%20%E2%89%A0%20acme%22%2C%22user%20=%20J%C3%B6rg%22%5D%7D';
    expect(diagnosticsOf(answer({ 'X-Dashica-Diagnostics': encoded }))).toEqual({ ignored: ['customer ≠ acme', 'user = Jörg'] });
  });
});
