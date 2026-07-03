import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';

const router = Router();

const CLIENT_ID = process.env.CLIENT_ID!;
const CLIENT_SECRET = process.env.CLIENT_SECRET!;
const REDIRECT_URI = process.env.REDIRECT_URI!;
const JWT_SECRET = process.env.JWT_SECRET!;
const SCOPE = process.env.SCOPE || 'identify';

const stateMap = new Map<string, { codeVerifier: string; redirect?: string }>();

export async function refreshDiscordToken(userId: string): Promise<string | null> {
  const db = getDb();
  const user = db.prepare('SELECT refresh_token FROM users WHERE id = ?').get(userId) as any;
  if (!user?.refresh_token) return null;
  try {
    const resp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: user.refresh_token,
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const expiresAt = Date.now() + data.expires_in * 1000;
    db.prepare(`
      UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ?
    `).run(data.access_token, data.refresh_token || user.refresh_token, expiresAt, userId);
    return data.access_token;
  } catch {
    return null;
  }
}

router.get('/login', (_req: Request, res: Response) => {
  const url = new URL('https://discord.com/oauth2/authorize');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
  const state = crypto.randomUUID();
  stateMap.set(state, { codeVerifier });
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  res.json({ url: url.toString() });
});

router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (typeof state !== 'string' || !stateMap.has(state)) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=invalid_state`);
    }
    const { codeVerifier } = stateMap.get(state)!;
    stateMap.delete(state);
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=${error}`);
    }
    if (typeof code !== 'string') {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=missing_code`);
    }
    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      return res.redirect(`${process.env.FRONTEND_URL}/?error=token_exchange_failed`);
    }
    const tokenData: any = await tokenResp.json();
    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });
    if (!userResp.ok) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=user_fetch_failed`);
    }
    const userData: any = await userResp.json();
    const expiresAt = Date.now() + tokenData.expires_in * 1000;
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, username, global_name, avatar, access_token, refresh_token, token_type, token_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        global_name = excluded.global_name,
        avatar = excluded.avatar,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_type = excluded.token_type,
        token_expires_at = excluded.token_expires_at,
        updated_at = datetime('now')
    `).run(
      userData.id, userData.username, userData.global_name, userData.avatar,
      tokenData.access_token, tokenData.refresh_token, tokenData.token_type, expiresAt,
    );
    const appToken = jwt.sign(
      { userId: userData.id, username: userData.username },
      JWT_SECRET,
      { expiresIn: '7d' },
    );
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?token=${appToken}`);
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/?error=internal_error`);
  }
});

router.get('/me', (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
    const db = getDb();
    const user = db.prepare('SELECT id, username, global_name, avatar, bio, status, status_message, connected FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
