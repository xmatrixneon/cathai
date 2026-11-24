import { NextResponse } from 'next/server';

// Security middleware: every /api/* route requires a valid admin JWT.
// Previously 19 of 40 routes (send-sms, call-forwarding, messages, numbers,
// queues, device CRUD...) had no authentication at all.
// Exceptions: login + register (they issue the token).
// Note: JWT_SECRET is inlined at build time (Edge runtime) — rebuild after
// rotating the secret.
const PUBLIC_API_PATHS = ['/api/login', '/api/register'];

// Minimal HS256 verification with Web Crypto (jsonwebtoken is Node-only and
// cannot run in the Edge middleware runtime).
function base64UrlToBytes(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h)));
  } catch {
    return null;
  }
  // Only HS256 is ever issued (jsonwebtoken default) — refuse anything else
  // to block alg-confusion attacks.
  if (header.alg !== 'HS256') return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
  } catch {
    return null;
  }
  if (payload.exp && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return null;
  }
  return payload;
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  const payload = await verifyJwt(token, process.env.JWT_SECRET);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
