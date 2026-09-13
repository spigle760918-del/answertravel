const crypto = require('crypto');

function requestId(req) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  return /^[a-zA-Z0-9._:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
}

function clientAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function applySecurityHeaders(req, res, config) {
  const origin = String(req.headers.origin || '');
  const originAllowed = !origin || config.allowedOrigins.includes(origin);
  res.setHeader('X-Request-Id', requestId(req));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Demo-Role, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (origin && originAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  return { origin, originAllowed };
}

function createRateLimiter({ windowMs, limit }) {
  const buckets = new Map();
  return function consume(key) {
    const current = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || current >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: current + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    bucket.count += 1;
    if (bucket.count <= limit) return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)) };
  };
}

module.exports = { applySecurityHeaders, clientAddress, createRateLimiter };
