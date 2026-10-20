const express = require('express');
const cors = require('cors');
const scrape = require('./scrape');

const app = express();
app.use(cors({ exposedHeaders: ['Content-Disposition', 'X-Lead-Count'] }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/scrape', scrape);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`LeadScout API running on http://localhost:${PORT}`));