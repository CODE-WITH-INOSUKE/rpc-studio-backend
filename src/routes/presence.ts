import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';

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

router.get('/', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  const rp = db.prepare('SELECT * FROM rich_presences WHERE user_id = ? ORDER BY is_active DESC, id DESC').all(user.userId);
  const sp = db.prepare('SELECT * FROM spotify_presences WHERE user_id = ? ORDER BY is_active DESC, id DESC').all(user.userId);
  const cs = db.prepare('SELECT * FROM custom_statuses WHERE user_id = ? ORDER BY is_active DESC, id DESC').all(user.userId);
  res.json({ richPresences: rp, spotifyPresences: sp, customStatuses: cs });
});

router.post('/rich-presence', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const {
    name, type, state, details, large_image, large_text, small_image, small_text,
    party_current, party_max, start_timestamp, end_timestamp,
    button1_name, button1_url, button2_name, button2_url,
    platform, application_id, url,
  } = req.body;
  const db = getDb();
  db.prepare('UPDATE rich_presences SET is_active = 0 WHERE user_id = ?').run(user.userId);
  const result = db.prepare(`
    INSERT INTO rich_presences (user_id, name, type, state, details, large_image, large_text, small_image, small_text,
      party_current, party_max, start_timestamp, end_timestamp, button1_name, button1_url, button2_name, button2_url,
      platform, application_id, url, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    user.userId, name || '', type || 'PLAYING', state || null, details || null,
    large_image || null, large_text || null, small_image || null, small_text || null,
    party_current || null, party_max || null, start_timestamp || null, end_timestamp || null,
    button1_name || null, button1_url || null, button2_name || null, button2_url || null,
    platform || 'desktop', application_id || null, url || null,
  );
  res.json({ id: result.lastInsertRowid });
});

router.put('/rich-presence/:id', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const {
    name, type, state, details, large_image, large_text, small_image, small_text,
    party_current, party_max, start_timestamp, end_timestamp,
    button1_name, button1_url, button2_name, button2_url,
    platform, application_id, url, is_active,
  } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE rich_presences SET name = ?, type = ?, state = ?, details = ?,
      large_image = ?, large_text = ?, small_image = ?, small_text = ?,
      party_current = ?, party_max = ?, start_timestamp = ?, end_timestamp = ?,
      button1_name = ?, button1_url = ?, button2_name = ?, button2_url = ?,
      platform = ?, application_id = ?, url = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    name || '', type || 'PLAYING', state || null, details || null,
    large_image || null, large_text || null, small_image || null, small_text || null,
    party_current || null, party_max || null, start_timestamp || null, end_timestamp || null,
    button1_name || null, button1_url || null, button2_name || null, button2_url || null,
    platform || 'desktop', application_id || null, url || null,
    is_active !== undefined ? (is_active ? 1 : 0) : 1,
    req.params.id, user.userId,
  );
  res.json({ ok: true });
});

router.delete('/rich-presence/:id', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getDb();
  db.prepare('DELETE FROM rich_presences WHERE id = ? AND user_id = ?').run(req.params.id, user.userId);
  res.json({ ok: true });
});

router.post('/spotify', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { song_id, album_id, artist_ids, song_name, album_name, artists, large_image, small_image, start_timestamp, end_timestamp } = req.body;
  const db = getDb();
  db.prepare('UPDATE spotify_presences SET is_active = 0 WHERE user_id = ?').run(user.userId);
  const result = db.prepare(`
    INSERT INTO spotify_presences (user_id, song_id, album_id, artist_ids, song_name, album_name, artists,
      large_image, small_image, start_timestamp, end_timestamp, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    user.userId, song_id || null, album_id || null, JSON.stringify(artist_ids || []),
    song_name || null, album_name || null, artists || null,
    large_image || null, small_image || null, start_timestamp || null, end_timestamp || null,
  );
  res.json({ id: result.lastInsertRowid });
});

router.post('/custom-status', (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { emoji, state } = req.body;
  const db = getDb();
  db.prepare('UPDATE custom_statuses SET is_active = 0 WHERE user_id = ?').run(user.userId);
  const result = db.prepare(`
    INSERT INTO custom_statuses (user_id, emoji, state, is_active)
    VALUES (?, ?, ?, 1)
  `).run(user.userId, emoji || null, state || null);
  res.json({ id: result.lastInsertRowid });
});

export default router;
