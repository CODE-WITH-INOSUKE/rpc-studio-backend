import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { gateways, sendPresence, sendEmptyPresence } from './users';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;

function getUser(req: Request): { userId: string } | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
  } catch {
    return null;
  }
}

router.get('/detectable', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch('https://discord.com/api/v9/applications/detectable');
    const games = await resp.json() as any[];
    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO detectable_games (id, name, executables, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, executables = excluded.executables, updated_at = datetime('now')
    `);
    const tx = db.transaction(() => {
      for (const game of games) {
        upsert.run(String(game.id), game.name, JSON.stringify(game.executables || []));
      }
    });
    tx();
    res.json({ count: games.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch detectable games', details: String(err) });
  }
});

router.get('/detectable/search', (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  const db = getDb();
  let games: any[];
  if (!query) {
    games = db.prepare('SELECT id, name, executables FROM detectable_games ORDER BY name LIMIT 50').all();
  } else {
    games = db.prepare('SELECT id, name, executables FROM detectable_games WHERE name LIKE ? ORDER BY name LIMIT 50')
      .all(`%${query}%`);
  }
  res.json(games.map((g: any) => ({ ...g, executables: JSON.parse(g.executables) })));
});

router.get('/my', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  const games = db.prepare('SELECT * FROM fake_games WHERE user_id = ? ORDER BY created_at DESC').all(user.userId);
  res.json(games);
});

router.post('/add', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { game_id, game_name, executable } = req.body;
  if (!game_id || !game_name) {
    return res.status(400).json({ error: 'Missing required fields: game_id and game_name are required' });
  }
  const db = getDb();
  try {
    db.prepare('INSERT INTO fake_games (user_id, game_id, game_name, executable) VALUES (?, ?, ?, ?)')
      .run(user.userId, game_id, game_name, executable || '');
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Game already added' });
    throw err;
  }
});

router.post('/:id/toggle', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  const game = db.prepare('SELECT * FROM fake_games WHERE id = ? AND user_id = ?').get(req.params.id, user.userId) as any;
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const newState = game.is_running ? 0 : 1;
  db.prepare('UPDATE fake_games SET is_running = ? WHERE id = ?').run(newState, req.params.id);

  const gw = gateways.get(user.userId);
  if (gw) sendEmptyPresence(user.userId, gw);

  if (newState) {
    db.prepare('UPDATE rich_presences SET is_active = 0 WHERE user_id = ?').run(user.userId);
    db.prepare('UPDATE spotify_presences SET is_active = 0 WHERE user_id = ?').run(user.userId);
    db.prepare('UPDATE custom_statuses SET is_active = 0 WHERE user_id = ?').run(user.userId);
  }

  if (gw) sendPresence(user.userId, gw);

  res.json({ ok: true, is_running: newState });
});

router.delete('/:id', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  db.prepare('DELETE FROM fake_games WHERE id = ? AND user_id = ?').run(req.params.id, user.userId);
  const gw = gateways.get(user.userId);
  if (gw) sendPresence(user.userId, gw);
  res.json({ ok: true });
});

export default router;
