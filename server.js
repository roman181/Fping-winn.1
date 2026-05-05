const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DB_FILE = 'database.json';

// Database Helper
function loadDB() {
    if(!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, matches: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// REST API ENDPOINTS

// 📝 REGISTRATION
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if(!username || !email || !password) {
        return res.status(400).json({ error: 'Alle Felder erforderlich' });
    }
    
    if(username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username muss 3-20 Zeichen lang sein' });
    }
    
    if(password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }
    
    const db = loadDB();
    
    if(db.users[username]) {
        return res.status(400).json({ error: 'Username bereits vorhanden' });
    }
    
    if(Object.values(db.users).some(u => u.email === email)) {
        return res.status(400).json({ error: 'Email bereits registriert' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = {
        username,
        email,
        passwordHash: hashedPassword,
        coins: 500,
        elo: 1000,
        wins: 0,
        losses: 0,
        level: 1,
        units: {},
        deck: [],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
    };
    
    // Initialize units
    const UNIT_KEYS = [
        'frosch_soldat', 'frosch_sniper', 'frosch_pyro', 'frosch_sanitaeter', 'frosch_schwer',
        'kroete_wache', 'pinguin_bomber', 'pinguin_don', 'pinguin_fahrer', 'pinguin_hacker',
        'pinguin_killer', 'pinguin_schlaeger', 'pinguin_schuetze',
        'schwein_doktor', 'schwein_lady', 'schwein_patin', 'schwein_revolver', 'schwein_schlaeger',
        'schwein_spion', 'schwein_vollstrecker'
    ];
    
    UNIT_KEYS.forEach(k => {
        newUser.units[k] = { level: 1, count: 0 };
    });
    
    db.users[username] = newUser;
    saveDB(db);
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
        success: true,
        token,
        user: { username, email, elo: 1000, level: 1, coins: 500 }
    });
});

// 🔐 LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if(!username || !password) {
        return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    
    const db = loadDB();
    const user = db.users[username];
    
    if(!user) {
        return res.status(400).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    
    if(!passwordMatch) {
        return res.status(400).json({ error: 'Passwort falsch' });
    }
    
    user.lastLogin = new Date().toISOString();
    saveDB(db);
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
        success: true,
        token,
        user: {
            username,
            email: user.email,
            elo: user.elo,
            level: user.level,
            coins: user.coins,
            wins: user.wins,
            losses: user.losses
        }
    });
});

// 👤 GET USER PROFILE
app.get('/api/user/:username', (req, res) => {
    const { username } = req.params;
    const db = loadDB();
    const user = db.users[username];
    
    if(!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    res.json({
        username: user.username,
        elo: user.elo,
        level: user.level,
        coins: user.coins,
        wins: user.wins,
        losses: user.losses,
        createdAt: user.createdAt,
        units: user.units,
        deck: user.deck
    });
});

// 📊 LEADERBOARD
app.get('/api/leaderboard', (req, res) => {
    const db = loadDB();
    const leaderboard = Object.values(db.users)
        .map(u => ({
            username: u.username,
            elo: u.elo,
            wins: u.wins,
            losses: u.losses,
            level: u.level
        }))
        .sort((a, b) => b.elo - a.elo)
        .slice(0, 100);
    
    res.json(leaderboard);
});

// 🔑 VERIFY TOKEN MIDDLEWARE
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if(!token) {
        return res.status(401).json({ error: 'Token erforderlich' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if(err) {
            return res.status(403).json({ error: 'Ungültiger Token' });
        }
        req.user = user;
        next();
    });
}

// 💾 SAVE PLAYER DATA
app.post('/api/save-progress', authenticateToken, (req, res) => {
    const { coins, units, deck, elo } = req.body;
    const { username } = req.user;
    
    const db = loadDB();
    const user = db.users[username];
    
    if(!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    user.coins = coins;
    user.units = units;
    user.deck = deck;
    user.elo = elo;
    
    saveDB(db);
    res.json({ success: true });
});

// WEBSOCKET LOGIC
const players = new Map();
const matches = new Map();
let matchCounter = 0;

wss.on('connection', (ws) => {
    let currentUser = null;
    let currentMatch = null;
    
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            
            if(data.type === 'auth') {
                // Verify JWT token
                jwt.verify(data.token, JWT_SECRET, (err, decoded) => {
                    if(err) {
                        ws.send(JSON.stringify({ type: 'auth-fail', error: 'Token ungültig' }));
                        ws.close();
                        return;
                    }
                    
                    currentUser = decoded.username;
                    const db = loadDB();
                    const user = db.users[currentUser];
                    
                    players.set(ws, {
                        username: currentUser,
                        elo: user.elo,
                        deck: user.deck
                    });
                    
                    ws.send(JSON.stringify({
                        type: 'auth-success',
                        username: currentUser,
                        elo: user.elo
                    }));
                    
                    broadcastStatus();
                });
            }
            
            if(data.type === 'find-match') {
                findOrCreateMatch(ws, currentUser);
            }
            
            if(data.type === 'game-action' && currentMatch) {
                const match = matches.get(currentMatch);
                if(match) {
                    // Forward action to opponent
                    const opponent = match.players.find(p => p.ws !== ws);
                    if(opponent) {
                        opponent.ws.send(JSON.stringify({
                            type: 'opponent-action',
                            action: data.action
                        }));
                    }
                }
            }
            
            if(data.type === 'match-end') {
                endMatch(currentMatch, data.winner, data.stats);
            }
            
        } catch(e) {
            console.error('WebSocket error:', e);
        }
    });
    
    ws.on('close', () => {
        players.delete(ws);
        if(currentMatch) {
            const match = matches.get(currentMatch);
            if(match) {
                // Disconnect opponent
                match.players.forEach(p => {
                    if(p.ws !== ws) {
                        p.ws.send(JSON.stringify({ type: 'opponent-disconnected' }));
                    }
                });
                matches.delete(currentMatch);
            }
        }
        broadcastStatus();
    });
});

function findOrCreateMatch(ws, username) {
    // Simple matchmaking: find first waiting player or create new match
    for(let [matchId, match] of matches) {
        if(match.state === 'waiting' && match.players.length === 1) {
            // Add second player
            match.players.push({ ws, username });
            match.state = 'in-progress';
            
            // Notify both players
            match.players.forEach((p, idx) => {
                p.ws.send(JSON.stringify({
                    type: 'match-start',
                    matchId,
                    yourSide: idx === 0 ? 'p' : 'e',
                    opponent: match.players[idx === 0 ? 1 : 0].username
                }));
            });
            
            return;
        }
    }
    
    // Create new match
    const matchId = `match_${++matchCounter}`;
    matches.set(matchId, {
        id: matchId,
        players: [{ ws, username }],
        state: 'waiting',
        createdAt: new Date()
    });
    
    ws.send(JSON.stringify({
        type: 'match-waiting',
        matchId,
        message: 'Warte auf Gegner...'
    }));
}

function endMatch(matchId, winner, stats) {
    const match = matches.get(matchId);
    if(!match) return;
    
    const db = loadDB();
    const loser = match.players.find(p => p.username !== winner);
    const winnerUser = db.users[winner];
    const loserUser = db.users[loser.username];
    
    if(winnerUser && loserUser) {
        winnerUser.wins++;
        winnerUser.elo += 25;
        loserUser.losses++;
        loserUser.elo = Math.max(100, loserUser.elo - 15);
        winnerUser.coins += stats.coins || 100;
        
        saveDB(db);
    }
    
    // Notify both players
    match.players.forEach(p => {
        p.ws.send(JSON.stringify({
            type: 'match-end',
            result: p.username === winner ? 'win' : 'loss'
        }));
    });
    
    matches.delete(matchId);
}

function broadcastStatus() {
    const status = {
        type: 'server-status',
        onlinePlayers: players.size,
        activeMatches: matches.size
    };
    
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(status));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🎮 WebSocket on ws://localhost:${PORT}`);
});