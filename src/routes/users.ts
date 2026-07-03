import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { GatewayClient } from '../gateway';
import { DEFAULTS } from '../constants';
import { buildPresencePayload, buildSpotifyPresence, buildCustomStatus, buildFakeGamePresence } from '../structures/presence';
import { refreshDiscordToken } from './auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;
const gateways = new Map<string, GatewayClient>();

function getUser(req: Request): { userId: string; username: string } | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
  } catch {
    return null;
  }
}

router.patch('/status', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { status, status_message, status_emoji } = req.body;
  const db = getDb();
  db.prepare(`UPDATE users SET status = ?, status_message = ?, status_emoji = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status || 'online', status_message || '', status_emoji || '', user.userId);
  const gw = gateways.get(user.userId);
  if (gw) sendPresence(user.userId, gw);
  res.json({ ok: true });
});

router.patch('/bio', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { bio } = req.body;
  const db = getDb();
  db.prepare(`UPDATE users SET bio = ?, updated_at = datetime('now') WHERE id = ?`).run(bio || '', user.userId);
  res.json({ ok: true });
});

async function connectGateway(userId: string, row: any): Promise<any> {
  let accessToken = row.access_token;
  if (row.token_expires_at && Date.now() > row.token_expires_at) {
    const refreshed = await refreshDiscordToken(userId);
    if (refreshed) accessToken = refreshed;
  }

  if (gateways.has(userId)) {
    gateways.get(userId)!.close(1000, 'reconnecting');
    gateways.delete(userId);
  }

  const token = `${row.token_type} ${accessToken}`;
  const gw = new GatewayClient();
  let readyData: any = null;

  gw.on('ready', (data: any) => {
    readyData = data;
    console.log(`[gateway] ${userId} connected as ${data.user?.username}`);
    getDb().prepare('UPDATE users SET connected = 1 WHERE id = ?').run(userId);
    applyActivePresences(userId, gw);
  });

  gw.on('close', (info: any) => {
    console.log(`[gateway] ${userId} closed: code=${info.code} reason=${info.reason}`);
    getDb().prepare('UPDATE users SET connected = 0 WHERE id = ?').run(userId);
    gateways.delete(userId);
  });

  gw.on('error', (err: Error) => {
    console.error(`[gateway] ${userId} error:`, err.message);
  });

  gw.on('debug', (msg: string) => {
    console.log(`[gateway-debug] ${userId}:`, msg);
  });

  gateways.set(userId, gw);

  try {
    await gw.connect({ token, gatewayUrl: DEFAULTS.GATEWAY_SDK_URL });
    return readyData;
  } catch (err) {
    console.error(`[gateway] ${userId} connection failed:`, err);
    gw.close();
    gateways.delete(userId);
    getDb().prepare('UPDATE users SET connected = 0 WHERE id = ?').run(userId);
    throw err;
  }
}

async function connectAllGateways(): Promise<void> {
  const db = getDb();
  const users = db.prepare('SELECT id, access_token, token_type, refresh_token, token_expires_at FROM users WHERE access_token IS NOT NULL').all() as any[];
  console.log(`[gateway] auto-connecting ${users.length} user(s)...`);
  for (const row of users) {
    await connectGateway(row.id, row).catch((err) =>
      console.error(`[gateway] auto-connect failed for ${row.id}:`, err)
    );
  }
}

router.post('/connect', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  const row = db.prepare('SELECT access_token, token_type, refresh_token, token_expires_at FROM users WHERE id = ?').get(user.userId) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });

  try {
    const readyData = await connectGateway(user.userId, row);
    res.json({ ok: true, message: 'Connected to gateway', user: readyData?.user });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gateway connection failed', details: String(err) });
    }
  }
});

router.post('/disconnect', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const gw = gateways.get(user.userId);
  if (gw) {
    gw.close(1000, 'user disconnect');
    gateways.delete(user.userId);
  }
  const db = getDb();
  db.prepare('UPDATE users SET connected = 0 WHERE id = ?').run(user.userId);
  res.json({ ok: true });
});

function buildActivities(userId: string): { activities: any[]; status: string } {
  const db = getDb();
  const userRow = db.prepare('SELECT status, status_message, status_emoji FROM users WHERE id = ?').get(userId) as any;
  const status = userRow?.status || 'online';

  const fg = db.prepare('SELECT * FROM fake_games WHERE user_id = ? AND is_running = 1').all(userId) as any[];
  if (fg.length > 0) {
    const activities = [];
    for (const game of fg) {
      activities.push(buildFakeGamePresence(game.game_name, game.game_id));
    }
    return { activities, status };
  }

  const activities: any[] = [];
  const rp = db.prepare('SELECT * FROM rich_presences WHERE user_id = ? AND is_active = 1 ORDER BY id DESC').get(userId) as any;
  if (rp) activities.push(buildPresencePayload(rp));

  const sp = db.prepare('SELECT * FROM spotify_presences WHERE user_id = ? AND is_active = 1 ORDER BY id DESC').get(userId) as any;
  if (sp) activities.push(buildSpotifyPresence(sp, userId));

  const cs = db.prepare('SELECT * FROM custom_statuses WHERE user_id = ? AND is_active = 1 ORDER BY id DESC').get(userId) as any;
  if (cs) {
    activities.push(buildCustomStatus(cs));
  } else if (userRow?.status_message) {
    activities.push(buildCustomStatus({ state: userRow.status_message, emoji: userRow.status_emoji || null }));
  }

  return { activities, status };
}

function sendPresence(userId: string, gw: GatewayClient): void {
  const { activities, status } = buildActivities(userId);
  gw.send(3, {
    activities,
    afk: false,
    since: 0,
    status,
  });
}

function sendEmptyPresence(userId: string, gw: GatewayClient): void {
  const db = getDb();
  const status = (db.prepare('SELECT status FROM users WHERE id = ?').get(userId) as any)?.status || 'online';
  gw.send(3, {
    activities: [],
    afk: false,
    since: 0,
    status,
  });
}

router.post('/presence/update', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const gw = gateways.get(user.userId);
  if (!gw) return res.json({ ok: false, error: 'Gateway not connected', queued: true });
  sendPresence(user.userId, gw);
  res.json({ ok: true });
});

function applyActivePresences(userId: string, gw: GatewayClient): void {
  sendPresence(userId, gw);
}

export { gateways, sendPresence, sendEmptyPresence, connectAllGateways };
export default router;
