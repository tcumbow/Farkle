/**
 * Socket.IO Event Registration
 *
 * Wires all Socket.IO event listeners using the canonical names defined in
 * docs/websocket-event-schema.md. Event logic is intentionally deferred; this
 * module only connects incoming events to optional callbacks.
 */

const INCOMING_EVENTS = {
  RECONNECT_PLAYER: 'reconnect_player',
  JOIN_GAME: 'join_game',
  START_GAME: 'start_game',
  TOGGLE_DIE_SELECTION: 'toggle_die_selection',
  ROLL_DICE: 'roll_dice',
  BANK_SCORE: 'bank_score',
  ACKNOWLEDGE_RESULTS: 'acknowledge_results',
  RESET_GAME: 'reset_game'
};

const SOCKET_LIFECYCLE_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect'
};

const DEFAULT_HANDLER = (eventName) => () => {
  // Placeholder to make it obvious when a handler has not been provided yet.
  // eslint-disable-next-line no-console
  console.warn(`[socketHandlers] handler for "${eventName}" not implemented`);
};

/**
 * Register Socket.IO event listeners.
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {Object} [handlers] - Optional event handlers keyed by event name
 */
function registerSocketHandlers(io, handlers = {}) {
  if (!io || typeof io.on !== 'function') {
    throw new Error('Socket.IO server instance with an "on" method is required');
  }

  const getHandler = (eventName) => {
    const handler = handlers[eventName];
    if (typeof handler === 'function') {
      return handler;
    }
    return DEFAULT_HANDLER(eventName);
  };

  io.on(SOCKET_LIFECYCLE_EVENTS.CONNECTION, (socket) => {
    if (!socket || typeof socket.on !== 'function') {
      return;
    }

    socket.on(INCOMING_EVENTS.RECONNECT_PLAYER, (payload) => {
      getHandler(INCOMING_EVENTS.RECONNECT_PLAYER)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.JOIN_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.JOIN_GAME)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.START_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.START_GAME)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.TOGGLE_DIE_SELECTION, (payload) => {
      getHandler(INCOMING_EVENTS.TOGGLE_DIE_SELECTION)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.ROLL_DICE, (payload) => {
      getHandler(INCOMING_EVENTS.ROLL_DICE)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.BANK_SCORE, (payload) => {
      getHandler(INCOMING_EVENTS.BANK_SCORE)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.ACKNOWLEDGE_RESULTS, (payload) => {
      getHandler(INCOMING_EVENTS.ACKNOWLEDGE_RESULTS)(socket, payload);
    });

    socket.on(INCOMING_EVENTS.RESET_GAME, (payload) => {
      getHandler(INCOMING_EVENTS.RESET_GAME)(socket, payload);
    });

    socket.on(SOCKET_LIFECYCLE_EVENTS.DISCONNECT, (reason) => {
      getHandler(SOCKET_LIFECYCLE_EVENTS.DISCONNECT)(socket, reason);
    });
  });
}

module.exports = {
  registerSocketHandlers,
  INCOMING_EVENTS,
  SOCKET_LIFECYCLE_EVENTS
};
