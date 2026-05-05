/**
 * MULTIPLAYER SYSTEM - WebSocket & API Integration
 */

const WS_URL = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host;
const API_URL = window.location.origin + '/api';

let ws = null;
let currentUser = {
    username: localStorage.getItem('username'),
    token: localStorage.getItem('token'),
    elo: parseInt(localStorage.getItem('userElo') || '1000')
};

let matchState = {
    active: false,
    matchId: null,
    mySide: null,
    opponent: null,
    myHp: 2500,
    enemyHp: 2500
};

// Initialize WebSocket connection
function initWebSocket() {
    if(!currentUser.token) {
        console.error('No token found. Redirecting to login.');
        window.location.href = 'auth.html';
        return;
    }
    
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        console.log('✅ Connected to server');
        // Authenticate
        ws.send(JSON.stringify({
            type: 'auth',
            token: currentUser.token
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        toast('⚠️ Verbindungsfehler');
    };
    
    ws.onclose = () => {
        console.log('🔌 Disconnected from server');
        setTimeout(initWebSocket, 3000); // Reconnect
    };
}

function handleMessage(data) {
    switch(data.type) {
        case 'auth-success':
            console.log('✅ Authenticated:', data.username);
            updatePlayerUI();
            break;
            
        case 'auth-fail':
            console.error('❌ Auth failed:', data.error);
            localStorage.clear();
            window.location.href = 'auth.html';
            break;
            
        case 'match-waiting':
            console.log('⏳ Waiting for opponent...');
            matchState.matchId = data.matchId;
            toast('🔍 Warte auf Gegner...');
            showScreen('waiting-screen');
            break;
            
        case 'match-start':
            console.log('🎮 Match started!', data);
            matchState.active = true;
            matchState.matchId = data.matchId;
            matchState.mySide = data.yourSide;
            matchState.opponent = data.opponent;
            startMultiplayerMatch(data);
            break;
            
        case 'opponent-action':
            handleOpponentAction(data.action);
            break;
            
        case 'match-end':
            endMultiplayerMatch(data.result);
            break;
            
        case 'opponent-disconnected':
            toast('❌ Gegner hat die Verbindung unterbrochen!');
            endMultiplayerMatch('win');
            break;
            
        case 'server-status':
            updateServerStatus(data);
            break;
    }
}

function findMatch() {
    if(!ws || ws.readyState !== WebSocket.OPEN) {
        toast('❌ Verbindung nicht hergestellt');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'find-match',
        username: currentUser.username,
        elo: currentUser.elo,
        deck: player.deck
    }));
}

function sendGameAction(action) {
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'game-action',
        action: action,
        matchId: matchState.matchId
    }));
}

function sendMatchEnd(stats) {
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'match-end',
        winner: stats.winner,
        stats: stats
    }));
}

function startMultiplayerMatch(data) {
    console.log('🎮 Starting multiplayer match:', data);
    showScreen('game-screen');
    
    // Update UI with opponent info
    document.getElementById('opponent-name').textContent = data.opponent;
    document.getElementById('opponent-elo').textContent = '⭐ ' + localStorage.getItem('userElo');
    
    // Start the game (reuse existing game logic)
    startGame();
}

function handleOpponentAction(action) {
    // Handle opponent's game actions
    if(action.type === 'spawn') {
        // Spawn enemy unit based on opponent action
        const Ent = window.Ent;
        game.ents.push(new Ent(action.unit, false, action.level, game.ents.filter(e=>!e.isP).length));
    }
}

function endMultiplayerMatch(result) {
    matchState.active = false;
    const won = result === 'win';
    
    // Update ELO
    if(won) {
        currentUser.elo += 25;
        player.coins += 150;
        toast('🎉 SIEG! +25 ELO, +150 Coins');
    } else {
        currentUser.elo = Math.max(100, currentUser.elo - 15);
        player.coins += 50;
        toast('😢 NIEDERLAGE! -15 ELO, +50 Coins');
    }
    
    // Save progress
    savePlayerProgress();
    localStorage.setItem('userElo', currentUser.elo);
    
    // Return to menu after delay
    setTimeout(() => {
        showScreen('menu-screen');
        updatePlayerUI();
    }, 2000);
}

async function savePlayerProgress() {
    if(!currentUser.token) return;
    
    try {
        const response = await fetch(`${API_URL}/save-progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.token}`
            },
            body: JSON.stringify({
                coins: player.coins,
                units: player.units,
                deck: player.deck,
                elo: currentUser.elo
            })
        });
        
        if(!response.ok) {
            console.error('Error saving progress');
        }
    } catch(error) {
        console.error('Save progress error:', error);
    }
}

async function fetchPlayerProfile(username) {
    try {
        const response = await fetch(`${API_URL}/user/${username}`);
        const user = await response.json();
        return user;
    } catch(error) {
        console.error('Error fetching profile:', error);
        return null;
    }
}

async function fetchLeaderboard() {
    try {
        const response = await fetch(`${API_URL}/leaderboard`);
        const leaderboard = await response.json();
        return leaderboard;
    } catch(error) {
        console.error('Error fetching leaderboard:', error);
        return [];
    }
}

function updatePlayerUI() {
    const usernameEl = document.getElementById('username');
    const eloEl = document.getElementById('player-elo');
    const coinsEl = document.getElementById('coin-count');
    
    if(usernameEl) usernameEl.textContent = currentUser.username;
    if(eloEl) eloEl.textContent = '⭐ ' + currentUser.elo;
    if(coinsEl) coinsEl.textContent = Math.floor(player.coins);
}

function updateServerStatus(data) {
    const statusEl = document.getElementById('server-status');
    if(statusEl) {
        statusEl.innerHTML = `
            <div style="font-size: 12px; color: #aaa;">
                👥 ${data.onlinePlayers} online | ⚔️ ${data.activeMatches} matches
            </div>
        `;
    }
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if(screen) screen.classList.add('active');
}

function logout() {
    localStorage.clear();
    window.location.href = 'auth.html';
}

// Initialize on load
window.addEventListener('load', () => {
    if(!currentUser.token) {
        window.location.href = 'auth.html';
        return;
    }
    initWebSocket();
});