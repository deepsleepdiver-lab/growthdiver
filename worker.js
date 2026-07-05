// GrowthDiver — 통합 Worker 스크립트
// /api/*, /blog/*, /images/* 경로만 이 코드가 처리하고,
// 나머지 경로(html/css 등 정적 파일)는 Cloudflare가 자동으로 서빙합니다.

const encoder = new TextEncoder();

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function createSessionCookie(env) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24 * 7;
  const payload = `${expiry}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  const token = `${payload}.${sig}`;
  return `gd_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 7}`;
}

async function verifySession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/gd_session=([^;]+)/);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (expected !== sig) return false;
  if (Date.now() > Number(payload)) return false;
  return true;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 확장된 마크다운 라이트 렌더러 — 제목(##/###), 굵게, 기울임, 목록, 이미지, 링크 지원
function renderContentAdvanced(text) {
  if (!text) return '';
  const inline = (s) => escapeHtml(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  return text.split(/\n\s*\n/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^###\s/.test(trimmed)) return `<h3>${inline(trimmed.replace(/^###\s/, ''))}</h3>`;
    if (/^##\s/.test(trimmed)) return `<h2>${inline(trimmed.replace(/^##\s/, ''))}</h2>`;
    const lines = trimmed.split('\n');
    if (lines.every(l => /^-\s+/.test(l.trim()))) {
      const items = lines.map(l => `<li>${inline(l.trim().replace(/^-\s+/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${inline(trimmed).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function stripMdForDescription(text, max = 150) {
  const plain = (text || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
}

const CAT_LABEL = { geo: 'GEO 실험', ai: 'AI 자동화', marketing: '마케팅 인사이트' };
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

function postPageHtml(post) {
  const desc = escapeHtml(post.excerpt || stripMdForDescription(post.content));
  const title = escapeHtml(post.title);
  const catLabel = CAT_LABEL[post.category] || post.category || '';
  const canonical = `https://growthdiver.kr/blog/${post.id}`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || stripMdForDescription(post.content, 300),
    datePublished: post.created_at,
    dateModified: post.updated_at,
    author: { '@type': 'Person', name: '신희정' },
    publisher: { '@type': 'Organization', name: 'GrowthDiver' },
    mainEntityOfPage: canonical,
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — GrowthDiver</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title} — GrowthDiver">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<script type="application/ld+json">${jsonLd}</script>

<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#F5F7F8; --abyss:#0B1626; --ink:#0B1626; --teal:#0E7C86; --teal-deep:#0A5A62;
    --slate:#64707C; --line:#DEE4E7; --white:#FFFFFF;
    --font-display:'Pretendard Variable', Pretendard, sans-serif;
    --font-body:'Pretendard Variable', Pretendard, sans-serif;
    --font-mono:'IBM Plex Mono', monospace; }
  *{ margin:0; padding:0; box-sizing:border-box; }
  body{ font-family:var(--font-body); background:var(--bg); color:var(--ink); line-height:1.7; -webkit-font-smoothing:antialiased; }
  a{ color:var(--teal-deep); }
  .wrap{ max-width:760px; margin:0 auto; padding:0 32px; }
  .nav{ position:fixed; top:0; left:0; right:0; z-index:200; padding:22px 0;
    background:rgba(245,247,248,.9); backdrop-filter:blur(10px); box-shadow:0 1px 0 var(--line); }
  .nav__inner{ max-width:1180px; margin:0 auto; padding:0 32px; display:flex; justify-content:space-between; align-items:center; }
  .nav__logo{ font-family:var(--font-mono); font-weight:600; font-size:.95rem; color:var(--abyss); display:flex; align-items:center; gap:8px; text-decoration:none; }
  .nav__logo .dot{ width:8px; height:8px; border-radius:50%; background:var(--teal); }
  .nav__back{ font-size:.85rem; color:var(--slate); text-decoration:none; }
  .nav__back:hover{ color:var(--teal-deep); }
  .content{ padding:160px 0 100px; }
  .post__tag{ display:inline-block; font-family:var(--font-mono); font-size:.72rem; font-weight:600; color:var(--teal-deep);
    background:rgba(14,124,134,.09); padding:6px 14px; border-radius:99px; margin-bottom:20px; }
  .post__title{ font-family:var(--font-display); font-weight:800; font-size:clamp(1.8rem,4vw,2.4rem); letter-spacing:-.02em; margin-bottom:16px; }
  .post__date{ font-family:var(--font-mono); font-size:.8rem; color:var(--slate); margin-bottom:40px; }
  .post__body p{ margin-bottom:20px; font-size:1.02rem; color:#2a3a45; }
  .post__body h2{ font-family:var(--font-display); font-size:1.4rem; font-weight:700; margin:36px 0 16px; }
  .post__body h3{ font-family:var(--font-display); font-size:1.15rem; font-weight:700; margin:28px 0 12px; }
  .post__body ul{ margin:0 0 20px 22px; }
  .post__body li{ margin-bottom:8px; font-size:1.02rem; }
  .post__body img{ max-width:100%; border-radius:12px; margin:12px 0 24px; display:block; }
  .post__body strong{ color:var(--ink); }
</style>
</head>
<body>
<nav class="nav">
  <div class="nav__inner">
    <a href="/index.html" class="nav__logo"><span class="dot"></span>GROWTHDIVER</a>
    <a href="/blog.html" class="nav__back">← 목록으로</a>
  </div>
</nav>
<div class="wrap content">
  <span class="post__tag">${escapeHtml(catLabel)}</span>
  <h1 class="post__title">${title}</h1>
  <div class="post__date">${escapeHtml(post.created_at || '')}</div>
  <div class="post__body">${renderContentAdvanced(post.content)}</div>
</div>
</body>
</html>`;
}

function notFoundPageHtml() {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>글을 찾을 수 없습니다 — GrowthDiver</title>
  <meta name="robots" content="noindex"></head>
  <body style="font-family:sans-serif;text-align:center;padding:120px 20px;color:#64707C">
    <p>글을 찾을 수 없거나 아직 게시되지 않았습니다.</p>
    <p><a href="/blog.html">블로그로 돌아가기</a></p>
  </body></html>`;
}

function sitemapXml(posts, baseUrl) {
  const staticPages = [
    { loc: `${baseUrl}/`, freq: 'weekly', pri: '1.0' },
    { loc: `${baseUrl}/about.html`, freq: 'monthly', pri: '0.8' },
    { loc: `${baseUrl}/blog.html`, freq: 'weekly', pri: '0.9' },
    { loc: `${baseUrl}/portfolio.html`, freq: 'monthly', pri: '0.8' },
    { loc: `${baseUrl}/contact.html`, freq: 'monthly', pri: '0.6' },
  ];
  const postEntries = posts.map(p => `  <url>
    <loc>${baseUrl}/blog/${p.id}</loc>
    <lastmod>${(p.updated_at || p.created_at || '').slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  const staticEntries = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.pri}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${postEntries}
</urlset>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── 실시간 sitemap.xml (발행된 글 자동 포함) ──
      if (path === '/sitemap.xml' && method === 'GET') {
        let posts = [];
        try {
          const { results } = await env.DB.prepare(
            `SELECT id, updated_at, created_at FROM posts WHERE status = 'published' ORDER BY created_at DESC`
          ).all();
          posts = results;
        } catch (_) {
          posts = []; // DB 조회 실패해도 정적 페이지만 담은 유효한 sitemap은 반환
        }
        return new Response(sitemapXml(posts, 'https://growthdiver.kr'), {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        });
      }

      // ── SSR 블로그 글 페이지 (GEO/SEO용 서버 렌더링) ──
      const blogPageMatch = path.match(/^\/blog\/(\d+)$/);
      if (blogPageMatch && method === 'GET') {
        const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(blogPageMatch[1]).first();
        if (!post || post.status !== 'published') {
          return new Response(notFoundPageHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return new Response(postPageHtml(post), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      // ── 이미지 업로드 (관리자 전용) ──
      if (path === '/api/upload' && method === 'POST') {
        const authed = await verifySession(request, env);
        if (!authed) return json({ error: '인증이 필요합니다.' }, 401);

        const contentType = request.headers.get('Content-Type') || '';
        const ext = IMG_EXT[contentType];
        if (!ext) return json({ error: '지원하지 않는 이미지 형식입니다 (jpg/png/gif/webp만 가능).' }, 400);

        const buf = await request.arrayBuffer();
        if (buf.byteLength > 8 * 1024 * 1024) return json({ error: '이미지는 8MB 이하만 업로드 가능합니다.' }, 413);

        const key = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        await env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
        return json({ ok: true, url: `/images/${key}` });
      }

      // ── 이미지 서빙 ──
      const imgMatch = path.match(/^\/images\/(.+)$/);
      if (imgMatch && method === 'GET') {
        const obj = await env.IMAGES.get(imgMatch[1]);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      // ── AUTH ──
      if (path === '/api/login' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.password || body.password !== env.ADMIN_PASSWORD) {
          return json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, 401);
        }
        const cookie = await createSessionCookie(env);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie });
      }

      if (path === '/api/logout' && method === 'POST') {
        return json({ ok: true }, 200, {
          'Set-Cookie': 'gd_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        });
      }

      if (path === '/api/session' && method === 'GET') {
        const authenticated = await verifySession(request, env);
        return json({ authenticated });
      }

      // ── POSTS ──
      if (path === '/api/posts' && method === 'GET') {
        const authed = await verifySession(request, env);
        const query = authed
          ? `SELECT * FROM posts ORDER BY created_at DESC`
          : `SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC`;
        const { results } = await env.DB.prepare(query).all();
        return json({ posts: results });
      }

      if (path === '/api/posts' && method === 'POST') {
        const authed = await verifySession(request, env);
        if (!authed) return json({ error: '인증이 필요합니다.' }, 401);
        const body = await request.json().catch(() => ({}));
        const { title, category, excerpt, content, status } = body;
        if (!title || !content) return json({ error: '제목과 내용은 필수입니다.' }, 400);
        const result = await env.DB.prepare(
          `INSERT INTO posts (title, category, excerpt, content, status) VALUES (?, ?, ?, ?, ?)`
        ).bind(title, category || '', excerpt || '', content, status || 'draft').run();
        return json({ ok: true, id: result.meta.last_row_id });
      }

      const postIdMatch = path.match(/^\/api\/posts\/(\d+)$/);
      if (postIdMatch) {
        const id = postIdMatch[1];
        if (method === 'GET') {
          const post = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first();
          if (!post) return json({ error: 'not found' }, 404);
          if (post.status !== 'published') {
            const authed = await verifySession(request, env);
            if (!authed) return json({ error: 'not found' }, 404);
          }
          return json({ post });
        }
        if (method === 'PUT') {
          const authed = await verifySession(request, env);
          if (!authed) return json({ error: '인증이 필요합니다.' }, 401);
          const body = await request.json().catch(() => ({}));
          const { title, category, excerpt, content, status } = body;
          if (!title || !content) return json({ error: '제목과 내용은 필수입니다.' }, 400);
          await env.DB.prepare(
            `UPDATE posts SET title=?, category=?, excerpt=?, content=?, status=?, updated_at=datetime('now') WHERE id=?`
          ).bind(title, category || '', excerpt || '', content, status || 'draft', id).run();
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          const authed = await verifySession(request, env);
          if (!authed) return json({ error: '인증이 필요합니다.' }, 401);
          await env.DB.prepare(`DELETE FROM posts WHERE id=?`).bind(id).run();
          return json({ ok: true });
        }
      }

      // ── CONTACT ──
      if (path === '/api/contact' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { name, email, message, website } = body;
        if (website) return json({ ok: true }); // 허니팟 — 봇이면 조용히 성공 처리
        if (!name || !email || !message) {
          return json({ error: '이름, 이메일, 문의 내용을 모두 입력해주세요.' }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: '올바른 이메일 형식이 아닙니다.' }, 400);
        }
        await env.DB.prepare(
          `INSERT INTO messages (name, email, message) VALUES (?, ?, ?)`
        ).bind(String(name).slice(0, 100), String(email).slice(0, 150), String(message).slice(0, 3000)).run();
        return json({ ok: true });
      }

      // ── MESSAGES (admin only) ──
      if (path === '/api/messages' && method === 'GET') {
        const authed = await verifySession(request, env);
        if (!authed) return json({ error: '인증이 필요합니다.' }, 401);
        const { results } = await env.DB.prepare(`SELECT * FROM messages ORDER BY created_at DESC`).all();
        return json({ messages: results });
      }

      const msgIdMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (msgIdMatch) {
        const id = msgIdMatch[1];
        const authed = await verifySession(request, env);
        if (!authed) return json({ error: '인증이 필요합니다.' }, 401);
        if (method === 'PATCH') {
          await env.DB.prepare(`UPDATE messages SET is_read = 1 WHERE id = ?`).bind(id).run();
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(id).run();
          return json({ ok: true });
        }
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'Internal server error', detail: String(err) }, 500);
    }
  },
};
