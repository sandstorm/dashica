// See Perspective in view.ts. The entry of the bundle public/dist/perspective.js (frontendBuild.mjs), which the
// Explore view imports on first use, so dashboards load none of it; its wasm files lie beside it.
import perspective from '@perspective-dev/client';
import perspectiveViewer from '@perspective-dev/viewer';
import '@perspective-dev/viewer-datagrid';
import '@perspective-dev/viewer-charts';
import '@perspective-dev/viewer/dist/css/pro.css';
import '@perspective-dev/viewer/dist/css/pro-dark.css';
import SERVER_WASM from '@perspective-dev/server/dist/wasm/perspective-server.wasm';
import SERVER_WASM64 from '@perspective-dev/server/dist/wasm/perspective-server.memory64.wasm';
import VIEWER_WASM from '@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm';
import type { Perspective, PerspectiveClient, PerspectiveViewer } from './view';

perspective.init_server({ wasm32: () => fetch(SERVER_WASM), wasm64: () => fetch(SERVER_WASM64) });

/**
 * The viewer's wasm, compiled: it defines `<perspective-viewer>` at its end, and the client takes its own wasm from
 * that element, so a worker comes after it.
 */
let viewerReady: Promise<unknown> | undefined;
let client: Promise<PerspectiveClient> | undefined;

/** Perspective for the Explore view: one engine in a Web Worker for the page, and `<perspective-viewer>`. */
export const explorePerspective: Perspective = {
  worker() {
    // a failed start (the network) is tried again on the next call
    if (!viewerReady) {
      viewerReady = perspectiveViewer.init_client(fetch(VIEWER_WASM));
      viewerReady.catch(() => (viewerReady = undefined));
    }
    if (!client) {
      client = viewerReady.then(() => perspective.worker() as unknown as Promise<PerspectiveClient>);
      client.catch(() => (client = undefined));
    }
    return client;
  },
  createViewer(doc) {
    return doc.createElement('perspective-viewer') as unknown as PerspectiveViewer;
  },
};
