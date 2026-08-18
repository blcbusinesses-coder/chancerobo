import express from 'express';
import cors from 'cors';
import type { ChanceAgent } from '../agents/chance/ChanceAgent.js';

export function startApiServer(chance: ChanceAgent, port = 8787) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/identity', (req, res) => {
    res.json(chance.identity.toJSON());
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { text, audioPath } = req.body;
      const result = await chance.run({
        channel: 'api',
        text: text || '',
        audioPath,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory', async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const rows = await chance.db.recall(limit);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, agent: chance.def.identity.slug });
  });

  app.listen(port, () => {
    console.log(`[API] Server listening on port ${port}`);
  });
}
