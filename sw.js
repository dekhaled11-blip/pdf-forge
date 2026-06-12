/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              PDF Forge — Service Worker v1.2                    ║
 * ║   يتيح: التشغيل offline، التثبيت كتطبيق، التخزين المؤقت       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const CACHE_NAME    = 'pdfforge-v3';   // ← رُقِّم لإجبار مسح الكاش القديم
const OFFLINE_URL   = '/';

// ── الملفات الأساسية التي تُحمَّل في أول تثبيت (App Shell) ──────────
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32.png',
  '/favicon-16.png',
  '/favicon-180.png',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-192-maskable.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  // مكتبة pdf-lib
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  // Font Awesome — CSS + خطوط الأيقونات (السبب الجذري للأيقونات المختفية)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2',
];

// ── روابط CDN الخارجية التي نريد تخزينها مؤقتاً ─────────────────────
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ════════════════════════════════════════════════════════════════════
//  INSTALL — تثبيت App Shell في الكاش
// ════════════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  console.log('[SW] تثبيت PDF Forge Service Worker v1.2...');

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('[SW] جارٍ تخزين الملفات الأساسية...');

      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] تعذّر تخزين:', url, err.message);
          })
        )
      );

      const ok     = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[SW] تم تخزين ${ok} ملف — فشل ${failed}`);
    })
  );

  self.skipWaiting();
});

// ════════════════════════════════════════════════════════════════════
//  ACTIVATE — تنظيف الكاش القديم عند التحديث
// ════════════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  console.log('[SW] تفعيل PDF Forge Service Worker v1.2...');

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(oldKey => {
            console.log('[SW] حذف كاش قديم:', oldKey);
            return caches.delete(oldKey);
          })
      )
    )
  );

  self.clients.claim();
});

// ════════════════════════════════════════════════════════════════════
//  FETCH — listener واحد فقط يعالج كل الطلبات
// ════════════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── share-target: استقبال الصور من تطبيقات أخرى ─────────────────
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const image    = formData.get('image');
        const client   = await self.clients.openWindow('/');
        if (client && image) {
          await new Promise(r => setTimeout(r, 1500));
          client.postMessage({ type: 'SHARE_TARGET_IMAGE', file: image });
        }
        return Response.redirect('/', 303);
      })()
    );
    return;
  }

  // ── تجاهل طلبات غير GET ──────────────────────────────────────────
  if (event.request.method !== 'GET') return;

  // ── تجاهل بروتوكولات غير http/https ─────────────────────────────
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // ── تجاهل chrome-extension ───────────────────────────────────────
  if (url.origin.startsWith('chrome')) return;

  // ── الأيقونات والصور المحلية: NetworkFirst لضمان التحديث دائماً ──
  if (url.origin === self.location.origin &&
      url.pathname.match(/\.(png|ico|svg|webp)$/)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── خطوط Font Awesome: CacheFirst (لا تتغير أبداً) ───────────────
  if (url.pathname.match(/\.woff2?$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── CDN: CacheFirst (المكتبات لا تتغير) ──────────────────────────
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── الملفات المحلية: StaleWhileRevalidate ────────────────────────
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // ── بقية الطلبات: NetworkFirst ───────────────────────────────────
  event.respondWith(networkFirst(event.request));
});

// ════════════════════════════════════════════════════════════════════
//  استراتيجيات الكاش
// ════════════════════════════════════════════════════════════════════

/** CacheFirst: ردّ من الكاش، إذا لم يوجد حمّل من الشبكة واحفظ */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/** StaleWhileRevalidate: ردّ من الكاش فوراً + حدّث في الخلفية */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await networkFetch) || offlineFallback();
}

/** NetworkFirst: جرّب الشبكة أولاً، fallback إلى الكاش */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

/** صفحة Offline احتياطية */
function offlineFallback() {
  return caches.match(OFFLINE_URL).then(cached =>
    cached ||
    new Response(
      `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>PDF Forge — غير متصل</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Cairo',sans-serif;background:#0f172a;color:#e2e8f0;
         display:flex;align-items:center;justify-content:center;min-height:100vh;
         flex-direction:column;gap:20px;padding:24px;text-align:center}
    .icon{font-size:64px;margin-bottom:8px}
    h1{font-size:24px;font-weight:900;color:#fff}
    p{font-size:15px;color:#94a3b8;max-width:360px;line-height:1.7}
    button{background:#2563eb;color:#fff;border:none;padding:14px 32px;
           border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;
           font-family:inherit;transition:background .2s}
    button:hover{background:#1d4ed8}
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>لا بأس — PDF Forge يعمل بشكل كامل بدون إنترنت بمجرد تحميل الصفحة مرة واحدة.<br>يرجى الاتصال والمحاولة مجدداً.</p>
  <button onclick="location.reload()">🔄 إعادة المحاولة</button>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  );
}

// ════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS (جاهز للتفعيل مستقبلاً)
// ════════════════════════════════════════════════════════════════════
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'PDF Forge', {
      body:    data.body    || 'لديك إشعار جديد',
      icon:    '/icon-192.png',
      badge:   '/favicon-32.png',
      vibrate: [100, 50, 100],
      data:    { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || '/')
  );
});

console.log('[SW] PDF Forge Service Worker v1.2 محمَّل ✅');
