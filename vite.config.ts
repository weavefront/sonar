import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Turbo SDK pulls in Node-oriented deps (crypto/stream/buffer). Scoped to just what those
    // need — the read path never imports anything that touches these, so this should only ever
    // land in the lazily-loaded write-path chunk. Verified by measuring the built bundle, not
    // assumed: see the bundle-size check in the M2 verification pass.
    //
    // That lazy-loaded chunk stops being a separate *network request* once viteSingleFile below
    // inlines it into index.html — its bytes are now part of the one file everyone downloads up
    // front, read-only sessions included. It doesn't stop being lazily *evaluated*: dynamic
    // `import()` calls are untouched by that plugin, so the code still doesn't run until a write
    // path is actually used. Real trade, not a regression to "fix": a single deployable file
    // instead of a CDN/host that rewrites every path back to index.html for client-side routing.
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'process'],
      globals: { Buffer: true, global: true, process: true },
    }),
    viteSingleFile(),
  ],
  // `react-dom` (the bare specifier `RowMenu.tsx` needs for `createPortal`) is otherwise
  // discovered lazily — only `react-dom/client` was reachable from main.tsx before. An
  // on-demand discovery mid-session forces Vite to re-optimize and push a full-reload
  // over its HMR socket, which raced with things badly enough during manual testing to leave
  // the page running two different pre-bundle hashes of react-dom at once (real duplicate-React
  // "Invalid hook call" errors, not just console noise). Listing it here makes it part of the
  // upfront scan instead, so it's bundled once at server start like everything else.
  //
  // `human-crypto-keys`/`bip39`/`libp2p-crypto` (the new-wallet flow, `wallet/generate.ts`) hit
  // the exact same class of failure, worse: they're only ever reached through a dynamic
  // `import()`, itself dynamically imported from `CreateWalletDialog.tsx` — deliberately, so
  // their real bignum/crypto weight never touches a session that already has a wallet. The
  // *first* click of "Create a new wallet" is exactly when Vite discovers them for the first
  // time mid-request, and that on-demand re-optimize returned a hard 500 rather than the milder
  // duplicate-module symptom `react-dom` produced. `optimizeDeps.include` is dev-server prep
  // only — it does not change what the browser downloads on initial page load, since the browser
  // still never issues the request for these modules until the dynamic `import()` actually runs.
  // It only means the pre-bundle already exists by the time that happens, instead of being built
  // live, mid-request.
  optimizeDeps: { include: ['react-dom', 'human-crypto-keys', 'bip39', 'libp2p-crypto'] },
  build: { target: 'es2022' },
});
