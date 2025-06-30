const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://empiretechapp:bullishbb3@empiretechapi.19vipus.mongodb.net/?retryWrites=true&w=majority&appName=empiretechapi', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// Click model
const clickSchema = new mongoose.Schema({
  ip: String,
  route: String,
  value: Number,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Click = mongoose.model('Click', clickSchema);

// Utility to get client IP address
const getIP = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0] : req.connection.remoteAddress;
};

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve static HTML pages
app.get('/qr-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

app.get('/pair', async (req, res) => {
  try {
    const ip = getIP(req);
    await Click.create({
      ip: ip,
      route: '/pair',
      value: 1,
    });
    console.log(`✅ Pair click recorded from IP: ${ip}`);
  } catch (err) {
    console.error('❌ Error saving /pair click:', err);
  }
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/qr', async (req, res) => {
  try {
    const ip = getIP(req);
    await Click.create({
      ip: ip,
      route: '/qr',
      value: 1,
    });
    console.log(`✅ QR click recorded from IP: ${ip}`);
  } catch (err) {
    console.error('❌ Error saving /qr click:', err);
  }
  res.sendFile(path.join(__dirname, 'qr.html'));
});

// Click summary endpoint with improved counting
app.get('/clicks', async (req, res) => {
  try {
    // Get counts for last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const [total, pair, qr, lastPair, lastQr] = await Promise.all([
      Click.countDocuments({ createdAt: { $gte: oneDayAgo } }),
      Click.countDocuments({ route: '/pair', createdAt: { $gte: oneDayAgo } }),
      Click.countDocuments({ route: '/qr', createdAt: { $gte: oneDayAgo } }),
      Click.findOne({ route: '/pair' }).sort({ createdAt: -1 }),
      Click.findOne({ route: '/qr' }).sort({ createdAt: -1 })
    ]);

    res.json({
      totalClicks: total,
      pairClicks: pair,
      qrClicks: qr,
      lastPairTime: lastPair ? lastPair.createdAt : null,
      lastQrTime: lastQr ? lastQr.createdAt : null
    });
  } catch (err) {
    console.error('Error fetching click stats:', err);
    res.status(500).json({ message: 'Failed to fetch click stats' });
  }
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    let startDate;
    
    switch(range) {
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default: // 24h
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    // Group data by hour/day depending on range
    const groupBy = range === '24h' ? 'hour' : 'day';
    
    const result = await Click.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $project: {
          [groupBy]: {
            [$cond: {
              if: { $eq: [range, '24h'] },
              then: { $hour: "$createdAt" },
              else: { $dayOfMonth: "$createdAt" }
            }]: 1
          },
          route: 1,
          date: {
            [$cond: {
              if: { $eq: [range, '24h'] },
              then: { $dateToString: { format: "%Y-%m-%dT%H:00:00", date: "$createdAt" } },
              else: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
            }]
          }
        }
      },
      {
        $group: {
          _id: "$date",
          time: { $first: "$date" },
          qrCount: {
            $sum: {
              $cond: [{ $eq: ["$route", "/qr"] }, 1, 0]
            }
          },
          pairCount: {
            $sum: {
              $cond: [{ $eq: ["$route", "/pair"] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { time: 1 }
      }
    ]);
    
    res.json(result);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

// Endpoint to get local IP
app.get('/api/local-ip', (req, res) => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return res.json({ ip: iface.address });
      }
    }
  }
  res.json({ ip: '127.0.0.1' });
});

// Import external modules
let server = require('./qr');
let code = require('./pair');
require('events').EventEmitter.defaultMaxListeners = 1000;

app.use('/qr', server);
app.use('/code', code);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

module.exports = app;