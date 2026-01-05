const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { initializeServerState, createNewGame, validateStateInvariants } = require('./state');
const { registerSocketHandlers } = require('./socketHandlers');

const DEFAULT_PORT = 3000;
const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '1h' : 0;

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

  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log('[farkle] server listening on port', port);
    // eslint-disable-next-line no-console
    console.log(eventLogEnabled ? '[farkle] event log enabled' : '[farkle] event log disabled');
  });

  return { httpServer, io, app, serverState };
}

if (require.main === module) {
  createServer();
}

module.exports = { createServer };
