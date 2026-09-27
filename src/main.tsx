import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import './styles.css';
import { App } from './App';
import { useHashPathLocation } from './ui/hashLocation';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash-based routing (`/#/d/...`) rather than the browser History API: a single static HTML
        file has no server to fall back a request for `/d/abc123` to `index.html`, so a real path
        segment would 404 on refresh or on a shared link — the fragment after `#` is never sent to
        a server at all, so there's nothing for a static host (or a plain `file://` open) to get
        wrong. Every existing `navigate('/d/...')` / `<Link href="/d/...">` call elsewhere in the
        app is unchanged — wouter's hook is exactly the seam meant to absorb this. Our own hook
        rather than wouter's, which mishandles a `?query` inside the fragment (see hashLocation.ts). */}
    <Router hook={useHashPathLocation}>
      <App />
    </Router>
  </StrictMode>,
);
