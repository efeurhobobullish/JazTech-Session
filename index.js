const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require("body-parser");
const app = express();
const PORT = process.env.PORT || 8000;

// Define the base directory
__path = process.cwd();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://empiretechapp:bullishbb3@empiretechapi.19vipus.mongodb.net/?retryWrites=true&w=majority&appName=empiretechapi', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// Define the Click schema and model
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
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
};

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static HTML pages
app.get('/qr-page', (req, res) => {
    res.sendFile(__path + '/qr.html');
});

app.get('/pair', async (req, res) => {
    try {
        await Click.create({
            ip: getIP(req),
            route: '/pair',
            value: 1,
        });
    } catch (err) {
        console.error('❌ Error saving /pair click:', err);
    }
    res.sendFile(__path + '/pair.html');
});

app.get('/qr', async (req, res) => {
    try {
        await Click.create({
            ip: getIP(req),
            route: '/qr',
            value: 1,
        });
    } catch (err) {
        console.error('❌ Error saving /qr click:', err);
    }
    res.sendFile(__path + '/qr.html');
});

app.get('/donate', (req, res) => {
    res.sendFile(__path + '/donate.html');
});

app.get('/thank-you', (req, res) => {
    res.sendFile(__path + '/thank-you.html');
});

app.get('/', (req, res) => {
    res.sendFile(__path + '/main.html');
});

// 📊 Click summary endpoint
app.get('/clicks', async (req, res) => {
    try {
        const total = await Click.countDocuments();
        const pair = await Click.countDocuments({ route: '/pair' });
        const qr = await Click.countDocuments({ route: '/qr' });

        res.json({
            totalClicks: total,
            pairClicks: pair,
            qrClicks: qr,
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch click stats' });
    }
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
