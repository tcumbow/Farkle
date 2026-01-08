const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');

const { initializeServerState, createNewGame, validateStateInvariants } = require('./state');
const {
  registerSSEClient,
  handleJoinGame,
  handleReconnectPlayer,
  handleToggleDie,
  handleRollDice,
  handleBankScore,
  handleStartGame,
  handleResetGame,
  loadBustGifs
} = require('./sseHandlers');

const DEFAULT_PORT = 3000;
const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '1h' : 0;

function getServerHost() {
  // Allow manual override via environment variable
  if (process.env.SERVER_HOST) {
    return process.env.SERVER_HOST;
  }

  // Known virtual/non-physical network interface patterns to skip
  const virtualPatterns = /vmware|virtualbox|vbox|hyper-v|hyperv|vswitch|docker|vnet/i;

  // Attempt to detect LAN IP automatically
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    // Skip known virtual interfaces
    if (virtualPatterns.test(name)) {
      continue;
    }

    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  // Fallback to localhost if no LAN IP found
  return '127.0.0.1';
}

function createServer() {
  const port = Number.parseInt(process.env.PORT, 10) || DEFAULT_PORT;
  const eventLogEnabled = String(process.env.EVENT_LOG_ENABLED).toLowerCase() === 'true';

  const serverState = initializeServerState(eventLogEnabled);
  serverState.game = createNewGame();

  const app = express();
  const httpServer = http.createServer(app);

  // Load bust media files for reaction animations
  const mediaPath = path.join(__dirname, '..', 'media');
  const bustGifs = loadBustGifs(mediaPath);

  // Enable JSON body parsing for REST endpoints
  app.use(express.json());

  const tvClientPath = path.join(__dirname, '..', 'tv-client');
  const phoneClientPath = path.join(__dirname, '..', 'phone-client');

  app.get('/healthz', (req, res) => {
    try {
      validateStateInvariants(serverState);
      res.json({ status: 'ok', phase: serverState.game ? serverState.game.phase : 'idle' });
    } catch (error) {
      res.status(500).json({ status: 'invalid_state', message: error.message });
    }
  });

  app.get('/api/event-log', (req, res) => {
    if (!serverState.eventLogEnabled) {
      res.status(404).json({ error: 'EVENT_LOG_DISABLED' });
      return;
    }

    res.json({ eventLog: serverState.eventLog });
  });

  app.get('/api/server-info', (req, res) => {
    res.json({
      host: getServerHost(),
      port
    });
  });

  // ========================================================================
  // SSE Endpoint - Server → Client events
  // ========================================================================
  app.get('/api/events', (req, res) => {
    registerSSEClient(res, req, serverState);
  });

  // ========================================================================
  // REST Endpoints - Client → Server actions
  // ========================================================================
  
  // Phone client actions
  app.post('/api/join', (req, res) => {
    handleJoinGame(req, res, serverState);
  });

  app.post('/api/reconnect', (req, res) => {
    handleReconnectPlayer(req, res, serverState);
  });

  app.post('/api/toggle', (req, res) => {
    handleToggleDie(req, res, serverState);
  });

  app.post('/api/roll', (req, res) => {
    handleRollDice(req, res, serverState, bustGifs);
  });

  app.post('/api/bank', (req, res) => {
    handleBankScore(req, res, serverState);
  });

  // TV client actions
  app.post('/api/start', (req, res) => {
    handleStartGame(req, res, serverState);
  });

  app.post('/api/reset', (req, res) => {
    handleResetGame(req, res, serverState);
  });

  app.use(
    '/join',
    express.static(phoneClientPath, {
      index: 'index.html',
      maxAge: STATIC_MAX_AGE
    })
  );

  app.use(
    '/media',
    express.static(mediaPath, {
      index: false,
      maxAge: STATIC_MAX_AGE
    })
  );

  app.use(
    '/',
    express.static(tvClientPath, {
      index: 'index.html',
      maxAge: STATIC_MAX_AGE
    })
  );

  httpServer.listen(port, '0.0.0.0', () => {
    const serverHost = getServerHost();
    // eslint-disable-next-line no-console
    console.log('[farkle] server listening on 0.0.0.0:', port);
    // eslint-disable-next-line no-console
    console.log('[farkle] join URL:', `http://${serverHost}:${port}/join`);
    // eslint-disable-next-line no-console
    console.log(eventLogEnabled ? '[farkle] event log enabled' : '[farkle] event log disabled');
  });

  return { httpServer, app, serverState };
}

if (require.main === module) {
  createServer();
}

module.exports = { createServer };
