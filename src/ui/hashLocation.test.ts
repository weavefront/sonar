import { describe, expect, it } from 'vitest';
import { hashFromPath, hashQuery, pathFromHash } from './hashLocation';

const UUID = '6f1c2e0a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const OWNER = 'g1hzNXVbh2M6LMQSUYp7HgkgxdadYqYEfw-HAajlms0';

describe('hash routing with a query inside the fragment', () => {
  it('keeps a single-folder share link’s query out of the route path', () => {
    // Regression: the path was `/share/d/o/<uuid>?scope=folder`, so `:folderId` never matched.
    const hash = `#/share/drive/${OWNER}/${UUID}?scope=folder`;
    expect(pathFromHash(hash)).toBe(`/share/drive/${OWNER}/${UUID}`);
    expect(hashQuery(hash)).toBe('scope=folder');
  });

  it('handles fragments with no query, no leading slash, or nothing at all', () => {
    expect(pathFromHash(`#/d/${UUID}`)).toBe(`/d/${UUID}`);
    expect(hashQuery(`#/d/${UUID}`)).toBe('');
    expect(pathFromHash('#d/x')).toBe('/d/x');
    expect(pathFromHash('')).toBe('/');
    expect(pathFromHash('#')).toBe('/');
  });

  it('writes the query inside the fragment, where hashQuery reads it back', () => {
    // Regression: wouter's navigate moved `?scope=folder` into location.search, widening the share.
    const to = `/share/drive/${OWNER}/${UUID}?scope=folder`;
    const fragment = hashFromPath(to);
    expect(fragment).toBe(to);
    expect(hashQuery('#' + fragment)).toBe('scope=folder');
    expect(pathFromHash('#' + fragment)).toBe(`/share/drive/${OWNER}/${UUID}`);
  });
});
