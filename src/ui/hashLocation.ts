import { useHashLocation } from 'wouter/use-hash-location';

/**
 * Hash routing that allows a query string *inside* the fragment: `#/share/d/o/f?scope=folder`.
 *
 * wouter's own `useHashLocation` gets this wrong in both directions:
 *   - Reading, it returns the whole fragment as the path, so `?scope=folder` ended up inside the
 *     `:folderId` route param and a single-folder share link opened on "This folder isn't part of
 *     this shared link."
 *   - Writing, its `navigate` moves the query *out* of the fragment into `location.search`, where
 *     `hashQuery` (and so `ShareRoute`) never looks. A single-folder share silently widened to
 *     include subfolders after any in-app navigation.
 *
 * Share links already handed out carry the query inside the fragment, so that stays the format.
 */

/** The route path of a fragment, without its query: `#/a/b?x=1` → `/a/b`. */
export function pathFromHash(hash: string): string {
  return '/' + (hash.replace(/^#?\/?/, '').split('?')[0] ?? '');
}

/** The query string inside a fragment, without the `?`: `#/a/b?x=1` → `x=1`. */
export function hashQuery(hash: string): string {
  const i = hash.indexOf('?');
  return i === -1 ? '' : hash.slice(i + 1);
}

/** The fragment for a route, query kept inside it: `/a/b?x=1` → `/a/b?x=1`, `a` → `/a`. */
export function hashFromPath(to: string): string {
  return '/' + to.replace(/^#?\/?/, '');
}

export function navigate(to: string, { state = null, replace = false }: { state?: unknown; replace?: boolean } = {}) {
  const oldURL = location.href;
  const url = new URL(location.href);
  url.hash = hashFromPath(to);
  if (replace) history.replaceState(state, '', url.href);
  else history.pushState(state, '', url.href);
  // pushState doesn't fire hashchange on its own; wouter's store (reused below) listens for it.
  dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: url.href }));
}

export function useHashPathLocation(): [string, typeof navigate] {
  // Reuse wouter's subscription for re-renders, but derive the path from the fragment ourselves.
  useHashLocation();
  return [pathFromHash(location.hash), navigate];
}

useHashPathLocation.hrefs = (href: string) => '#' + href;
