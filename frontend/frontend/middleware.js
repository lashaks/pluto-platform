// Vercel Edge Middleware — subdomain routing + admin protection
export const config = {
  matcher: ['/', '/pluto-admin.html', '/pluto-admin', '/terminal.html']
};

export default function middleware(req) {
  const host = req.headers.get('host') || '';
  const url = new URL(req.url);
  const path = url.pathname;

  // ── trade.plutocapitalfunding.com ──
  // Root → redirect to terminal
  if (host.startsWith('trade.') && path === '/') {
    return Response.redirect(new URL('/terminal.html', req.url), 307);
  }

  // ── admin.plutocapitalfunding.com ──
  // Root → redirect to admin panel
  if (host.startsWith('admin.') && path === '/') {
    return Response.redirect(new URL('/pluto-admin.html', req.url), 307);
  }

  // ── Block admin page on non-admin domains ──
  if ((path === '/pluto-admin.html' || path === '/pluto-admin') && !host.startsWith('admin.')) {
    return new Response('Not Found', { status: 404 });
  }
}
