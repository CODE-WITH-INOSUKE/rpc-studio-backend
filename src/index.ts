import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import authRoutes from './routes/auth';
import userRoutes, { connectAllGateways } from './routes/users';
import presenceRoutes from './routes/presence';
import gameRoutes from './routes/games';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
app.use(express.json());

const frontendOut = path.resolve(__dirname, '../../frontend/out');
app.use(express.static(frontendOut));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/presence', presenceRoutes);
app.use('/games', gameRoutes);

const htmlPages = ['/dashboard', '/rich-presence', '/fake-game'];
for (const route of htmlPages) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(frontendOut, `${route.slice(1)}.html`));
  });
}

app.get('/_not-found', (_req, res) => {
  res.sendFile(path.join(frontendOut, '404.html'));
});

app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(frontendOut, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  getDb();
  connectAllGateways().catch((err) => console.error('Auto-connect error:', err));
});
