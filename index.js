const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const bodyParser = require("body-parser");
const WebSocket = require('ws');
const PORT = process.env.PORT || 8000;
const path = require('path');

// Initialize Express
const app = express();

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jazetech', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Models
const ConnectionSession = mongoose.model('ConnectionSession', {
  sessionId: String,
  type: String, // 'qr' or 'pair'
  connectionData: {
    status: String,
    connectedAt: Date,
    disconnectedAt: Date
  },
  scans: [{
    type: String, // 'qr' or 'pair'
    ipAddress: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import your existing modules
const qrRouter = require('./qr');
const pairRouter = require('./pair');

// Track QR scans and pairing attempts
app.use((req, res, next) => {
  if (req.path === '/qr' || req.path === '/pair') {
    const sessionId = req.query.session || generateSessionId();
    const scanType = req.path === '/qr' ? 'qr' : 'pair';
    
    // Record the scan/pair attempt
    recordConnectionAttempt(sessionId, scanType, req.ip, req.headers['user-agent'])
      .catch(err => console.error('Error recording connection attempt:', err));
    
    // Add session ID to response locals for QR/pair routers to access
    res.locals.sessionId = sessionId;
  }
  next();
});

// Serve static HTML pages
app.get('/qr-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/donate', (req, res) => {
  res.sendFile(path.join(__dirname, 'donate.html'));
});

app.get('/thank-you', (req, res) => {
  res.sendFile(path.join(__dirname, 'thank-you.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// Serve the QR and Pair endpoints with tracking
app.use('/qr', qrRouter);
app.use('/pair', pairRouter);

// API Endpoints for dashboard
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const session = await ConnectionSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:sessionId/stats', async (req, res) => {
  try {
    const session = await ConnectionSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    const stats = {
      totalScans: session.scans.length,
      qrScans: session.scans.filter(s => s.type === 'qr').length,
      pairAttempts: session.scans.filter(s => s.type === 'pair').length,
      connectionStatus: session.connectionData.status || 'disconnected',
      lastActivity: session.updatedAt
    };
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cron job to clean up old sessions and update statuses
cron.schedule('*/5 * * * *', async () => {
  try {
    // Clean up sessions older than 48 hours
    await ConnectionSession.deleteMany({
      createdAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) }
    });
    
    // Update stale connections
    await ConnectionSession.updateMany(
      { 
        'connectionData.status': 'connected',
        'connectionData.updatedAt': { $lt: new Date(Date.now() - 30 * 60 * 1000) }
      },
      { 
        $set: { 
          'connectionData.status': 'disconnected',
          'connectionData.disconnectedAt': new Date()
        } 
      }
    );
  } catch (err) {
    console.error('Error in cron job:', err);
  }
});

// WebSocket setup for real-time updates
const wss = new WebSocket.Server({ noServer: true });
const clients = new Map();

function broadcastUpdate(sessionId) {
  const sessionClients = clients.get(sessionId) || [];
  sessionClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'UPDATE' }));
    }
  });
}

// Helper functions
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function recordConnectionAttempt(sessionId, type, ip, userAgent) {
  await ConnectionSession.findOneAndUpdate(
    { sessionId },
    {
      $setOnInsert: { 
        sessionId,
        type,
        createdAt: new Date(),
        'connectionData.status': 'pending'
      },
      $push: {
        scans: {
          type,
          ipAddress: ip,
          userAgent
        }
      },
      $set: {
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true }
  );
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Attach WebSocket server
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    const sessionId = request.url.split('/').pop();
    
    if (!clients.has(sessionId)) {
      clients.set(sessionId, []);
    }
    clients.get(sessionId).push(ws);
    
    ws.on('close', () => {
      clients.set(sessionId, clients.get(sessionId).filter(client => client !== ws));
    });
  });
});

module.exports = app;
