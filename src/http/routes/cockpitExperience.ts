import { Router } from 'express';
import { COCKPIT_SCRIPT } from '../cockpitScript';
import { COCKPIT_STYLES } from '../cockpitStyles';
import { renderCockpitHtml } from '../cockpitView';

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

function secure(res: { setHeader(name: string, value: string): void }): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
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
  return router;
}
