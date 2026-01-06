const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');

const { initializeServerState, createNewGame, validateStateInvariants } = require('./state');
const { registerSocketHandlers } = require('./socketHandlers');

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
  const io = new Server(httpServer, {
    transports: ['websocket']
  });

  registerSocketHandlers(io, serverState);

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

  app.use(
    '/join',
    express.static(phoneClientPath, {
      index: 'index.html',
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

  return { httpServer, io, app, serverState };
}

if (require.main === module) {
  createServer();
}

module.exports = { createServer };
