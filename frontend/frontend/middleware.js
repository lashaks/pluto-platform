// Vercel Edge Middleware — subdomain routing
export const config = { matcher: '/' };

export default function middleware(req) {
  const host = req.headers.get('host') || '';
  const url = new URL(req.url);

  // trade.plutocapitalfunding.com → /terminal.html
  if (host.startsWith('trade.')) {
    return Response.redirect(new URL('/terminal.html', req.url), 307);
  }

  // admin.plutocapitalfunding.com → /pluto-admin.html
  if (host.startsWith('admin.')) {
    return Response.redirect(new URL('/pluto-admin.html', req.url), 307);
  }

  // Block admin page on main domain
  if (url.pathname === '/pluto-admin.html' && !host.startsWith('admin.')) {
    return new Response('Not Found', { status: 404 });
  }
}
