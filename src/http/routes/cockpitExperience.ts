import { Router } from 'express';
import path from 'node:path';
import { COCKPIT_SCRIPT } from '../cockpitScript';
import { COCKPIT_STYLES } from '../cockpitStyles';
import { renderCockpitHtml } from '../cockpitView';

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; connect-src 'self' https://api.openai.com; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; media-src blob:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

const COCKPIT_MANIFEST = Object.freeze({
  id: '/cockpit/',
  name: 'LeozOps Founder Cockpit',
  short_name: 'LeozOps',
  description: 'Evidence-bound Jarvis-like operating partner for RepositoryRealms.',
  start_url: '/cockpit/',
  scope: '/cockpit/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0b1015',
  theme_color: '#111923',
  categories: ['business', 'productivity'],
  icons: [{ src: '/cockpit/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
});

const COCKPIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="LeozOps realm seal"><rect width="512" height="512" rx="96" fill="#0b1015"/><path d="M256 60 410 148v216l-154 88-154-88V148z" fill="#17212b" stroke="#c8a96b" stroke-width="20"/><path d="m178 186 78-44 78 44v108l-78 92-78-92z" fill="#2f7255" stroke="#8fc9ac" stroke-width="16"/><circle cx="256" cy="252" r="42" fill="#0b1015" stroke="#ead7ad" stroke-width="14"/></svg>`;

const COCKPIT_SERVICE_WORKER = String.raw`
'use strict';
const VERSION = 'leozops-cockpit-shell-v3';
const SHELL = ['/cockpit/', '/cockpit/assets/cockpit.css', '/cockpit/assets/cockpit.js', '/cockpit/manifest.webmanifest', '/cockpit/assets/icon.svg', '/cockpit/assets/observatory.webp', '/cockpit/assets/archmage-presence.webp', '/cockpit/assets/arcane-orb.webp'];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (cache) { return cache.addAll(SHELL); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.indexOf('leozops-cockpit-shell-') === 0 && key !== VERSION; })
      .map(function (key) { return caches.delete(key); }));
  }));
});
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || SHELL.indexOf(url.pathname) < 0) return;
  if (url.pathname === '/cockpit/') {
    event.respondWith(fetch(event.request).then(function (response) {
      var copy = response.clone();
      caches.open(VERSION).then(function (cache) { return cache.put('/cockpit/', copy); });
      return response;
    }).catch(function () { return caches.match('/cockpit/'); }));
    return;
  }
  event.respondWith(caches.match(event.request).then(function (cached) { return cached || fetch(event.request); }));
});
`;

function secure(res: { setHeader(name: string, value: string): void }): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

const COCKPIT_ASSETS = path.resolve(process.cwd(), 'assets', 'cockpit');

function cockpitAsset(name: string): string {
  return path.join(COCKPIT_ASSETS, name);
}

export function createCockpitExperienceRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    secure(res);
    res.type('html').send(renderCockpitHtml());
  });
  router.get('/assets/cockpit.css', (_req, res) => {
    secure(res);
    res.type('text/css').send(COCKPIT_STYLES);
  });
  router.get('/assets/cockpit.js', (_req, res) => {
    secure(res);
    res.type('application/javascript').send(COCKPIT_SCRIPT);
  });
  router.get('/manifest.webmanifest', (_req, res) => {
    secure(res);
    res.type('application/manifest+json').send(JSON.stringify(COCKPIT_MANIFEST));
  });
  router.get('/assets/icon.svg', (_req, res) => {
    secure(res);
    res.type('image/svg+xml').send(COCKPIT_ICON);
  });
  router.get('/assets/observatory.webp', (_req, res) => {
    secure(res);
    res.type('image/webp').sendFile(cockpitAsset('observatory.webp'));
  });
  router.get('/assets/archmage-presence.webp', (_req, res) => {
    secure(res);
    res.type('image/webp').sendFile(cockpitAsset('archmage-presence.webp'));
  });
  router.get('/assets/arcane-orb.webp', (_req, res) => {
    secure(res);
    res.type('image/webp').sendFile(cockpitAsset('arcane-orb.webp'));
  });
  router.get('/sw.js', (_req, res) => {
    secure(res);
    res.setHeader('Service-Worker-Allowed', '/cockpit/');
    res.type('application/javascript').send(COCKPIT_SERVICE_WORKER);
  });
  return router;
}
