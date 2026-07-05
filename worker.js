// GrowthDiver — 통합 Worker 스크립트
// /api/* 경로만 이 코드가 처리하고, 나머지 경로(html/css 등)는 정적 자산으로 자동 서빙됩니다.

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
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
