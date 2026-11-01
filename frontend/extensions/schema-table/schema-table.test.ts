// @vitest-environment jsdom
// Tests for schema-table.ts: the statement below the title, an error marked as one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { schemaTable } from './schema-table';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(schemaTable);
});

afterEach(() => testbed.dispose());

describe('schemaTable', () => {
  it('shows the CREATE TABLE statement below its title', async () => {
    testbed.serveText('/p/shop/api/1/schema', 'CREATE TABLE default.http_logs (`timestamp` DateTime64(3))');
    const { widgetContainer } = testbed.render({ type: 'schemaTable', props: { table: 'http_logs', title: 'Logs' }, dataUrl: '/p/shop/api/1' });
    await settle();
    expect(widgetContainer.querySelector('h2')!.textContent).toBe('Logs');
    expect(widgetContainer.querySelector('pre')!.textContent).toBe('CREATE TABLE default.http_logs (`timestamp` DateTime64(3))');
  });

  it('marks the server’s error as one', async () => {
    testbed.serveText('/p/shop/api/1/schema', 'SHOW CREATE TABLE http_logs: Table default.http_logs does not exist', 500);
    const { widgetContainer } = testbed.render({ type: 'schemaTable', props: { table: 'http_logs' }, dataUrl: '/p/shop/api/1' });
    await settle();
    expect(widgetContainer.querySelector('pre')!.classList.contains('d-schema-table__statement--error')).toBe(true);
    expect(widgetContainer.querySelector('pre')!.textContent).toContain('does not exist');
  });
});
