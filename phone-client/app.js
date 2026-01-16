(() => {
  class ReactionOverlay {
    constructor(root = document.body) {
      this.root = root;
      this.active = false;
      this.hideTimer = null;

      this.overlayEl = document.createElement('div');
      this.overlayEl.className = 'reaction-overlay';
      this.overlayEl.setAttribute('aria-hidden', 'true');

      this.mediaEl = document.createElement('video');
      this.mediaEl.className = 'reaction-media';
      this.mediaEl.playsInline = true;
      this.mediaEl.autoplay = true;
      this.mediaEl.muted = true;
      this.mediaEl.controls = false;
      this.mediaEl.loop = false;
      this.overlayEl.appendChild(this.mediaEl);

      // Text-based bank overlay elements
      this.bankEl = document.createElement('div');
      this.bankEl.className = 'bank-overlay';
      this.bankEl.setAttribute('aria-hidden', 'true');
      this.bankAmountEl = document.createElement('div');
      this.bankAmountEl.className = 'bank-amount';
      this.bankPrevEl = document.createElement('div');
      this.bankPrevEl.className = 'bank-prev';
      this.bankLabelEl = document.createElement('div');
      this.bankLabelEl.className = 'bank-label';
      this.bankEl.appendChild(this.bankLabelEl);
      this.bankEl.appendChild(this.bankAmountEl);
      this.bankEl.appendChild(this.bankPrevEl);
      this.overlayEl.appendChild(this.bankEl);

      this.overlayEl.addEventListener('click', () => this.hide());

      if (this.root && this.root.appendChild) {
        this.root.appendChild(this.overlayEl);
      }

      this.handleEnded = () => this.hide();
      this.handleError = () => this.hide();
    }

    show(mediaUrl) {
      if (this.active) return;
      if (!mediaUrl) return;

      this._clearAll();
      this.active = true;
      this.currentType = 'media';
      this.overlayEl.classList.add('visible');
      this.mediaEl.classList.remove('hidden');
      this.bankEl.classList.add('hidden');
      this.mediaEl.src = mediaUrl;
      this.mediaEl.currentTime = 0;
      this.mediaEl.play().catch(() => {});

      const clearAndHide = () => {
        if (!this.active) return;
        this.hide();
      };

      this.mediaEl.addEventListener('ended', this.handleEnded, { once: true });
      this.mediaEl.addEventListener('error', this.handleError, { once: true });

      this.mediaEl.onloadedmetadata = () => {
        const duration = this.mediaEl.duration;
        const fallback = Number.isFinite(duration) && duration > 0 ? (duration + 0.5) * 1000 : 6000;
        this.hideTimer = setTimeout(clearAndHide, fallback);
      };
    }

    showBank({ bankAmount = 0, previousTotal = 0, playerName = null }) {
      this._clearAll();
      this.active = true;
      this.currentType = 'bank';
      this.overlayEl.classList.add('visible');
      this.mediaEl.classList.add('hidden');
      this.bankEl.classList.remove('hidden');

      this.bankLabelEl.textContent = playerName ? `${playerName} banked points:` : 'Banked points:';
      this.bankAmountEl.textContent = `+${bankAmount}`;
      this.bankPrevEl.textContent = `${previousTotal}`;

      // Sequence: 0.5s pause, 1s transfer animation, 0.5s final
      const animateTransfer = () => {
        const duration = 1000;
        const start = Date.now();
        const fromPrev = previousTotal;
        const toPrev = previousTotal + bankAmount;
        const fromBank = bankAmount;
        const tick = () => {
          const now = Date.now();
          const t = Math.min(1, (now - start) / duration);
          const currentPrev = Math.floor(fromPrev + (toPrev - fromPrev) * t);
          const remainingBank = Math.max(0, Math.ceil((fromBank * (1 - t)) / 10) * 10);
          this.bankPrevEl.textContent = `${currentPrev}`;
          this.bankAmountEl.textContent = `+${remainingBank}`;
          if (t < 1) {
            this.transferTimer = requestAnimationFrame(tick);
          } else {
            this.bankPrevEl.textContent = `${toPrev}`;
            this.bankAmountEl.textContent = `+0`;
          }
        };
        tick();
      };

      this.hideTimer = setTimeout(() => {
        animateTransfer();
        this.hideTimer = setTimeout(() => this.hide(), 1500);
      }, 500);
    }

    hide() {
      if (!this.active) return;
      this.active = false;
      this.currentType = null;
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      if (this.transferTimer) {
        cancelAnimationFrame(this.transferTimer);
        this.transferTimer = null;
      }
      this.mediaEl.pause();
      this.mediaEl.removeAttribute('src');
      this.mediaEl.load();
      this.overlayEl.classList.remove('visible');
      this.mediaEl.classList.remove('hidden');
      this.bankEl.classList.add('hidden');
    }

    _clearAll() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      if (this.transferTimer) {
        cancelAnimationFrame(this.transferTimer);
        this.transferTimer = null;
      }
      this.mediaEl.pause();
      this.mediaEl.removeAttribute('src');
      this.mediaEl.load();
      this.overlayEl.classList.remove('visible');
      this.mediaEl.classList.remove('hidden');
      this.bankEl.classList.add('hidden');
      this.active = false;
      this.currentType = null;
    }
  }

  /**
   * SSE (Server-Sent Events) connection manager with reconnection support.
   * Uses EventSource for server→client communication and fetch for client→server.
   */
  class GameConnection {
    constructor() {
      this.eventSource = null;
      this.handlers = {};
      this.reconnectTimer = null;
      this.reconnectDelay = 1000;
      this.maxReconnectDelay = 5000;
      this.intentionallyClosed = false;
      this.connectionAttempts = 0;
      this.lastConnectTime = null;
      this.connected = false;
    }

    connect(playerId = null) {
      this.intentionallyClosed = false;
      this._clearReconnectTimer();
      this.connectionAttempts++;
      this.lastConnectTime = Date.now();

      // Build SSE URL with optional playerId
      let url = '/api/events';
      if (playerId) {
        url += `?playerId=${encodeURIComponent(playerId)}`;
      }

      try {
        this.eventSource = new EventSource(url);
      } catch (err) {
        console.error('[SSE] EventSource construction failed:', err);
        this._scheduleReconnect();
        return;
      }

      this.eventSource.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        this._emit('open');
      };

      // Listen for specific event types
      this.eventSource.addEventListener('game_state', (event) => {
        try {
          const data = JSON.parse(event.data);
          this._emit('game_state', data);
        } catch (err) {
          console.warn('[SSE] Failed to parse game_state:', err);
        }
      });

      this.eventSource.addEventListener('reaction', (event) => {
        try {
          const data = JSON.parse(event.data);
          this._emit('reaction', data);
        } catch (err) {
          console.warn('[SSE] Failed to parse reaction:', err);
        }
      });

      this.eventSource.addEventListener('error', (event) => {
        // This is an SSE error event from server, not connection error
        try {
          const data = JSON.parse(event.data);
          this._emit('server_error', data);
        } catch (err) {
          // Might be a connection error, not a server error event
        }
      });

      this.eventSource.onerror = () => {
        this.connected = false;
        this._emit('close');
        
        if (!this.intentionallyClosed) {
          // EventSource auto-reconnects, but we'll track the state
          this._scheduleReconnect();
        }
      };
    }

    async send(action, payload = {}) {
      const url = `/api/${action}`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (!response.ok) {
          return { success: false, error: data.error, message: data.message };
        }
        
        return data;
      } catch (err) {
        console.error(`[API] ${action} error:`, err);
        return { success: false, error: 'NETWORK_ERROR', message: err.message };
      }
    }

    close() {
      this.intentionallyClosed = true;
      this.connected = false;
      this._clearReconnectTimer();
      
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    }

    isConnected() {
      return this.connected && this.eventSource && this.eventSource.readyState === EventSource.OPEN;
    }

    on(event, handler) {
      if (!this.handlers[event]) {
        this.handlers[event] = [];
      }
      this.handlers[event].push(handler);
    }

    off(event, handler) {
      if (!this.handlers[event]) return;
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }

    _emit(event, data) {
      const handlers = this.handlers[event];
      if (handlers) {
        handlers.forEach(h => h(data));
      }
    }

    _scheduleReconnect() {
      if (this.intentionallyClosed) return;
      
      this._clearReconnectTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
        // Close existing EventSource before reconnecting
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        this.connect();
      }, this.reconnectDelay);
    }

    _clearReconnectTimer() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
  }

  const storageKey = 'farkle.phone.identity';
  const nameKey = 'farkle.phone.lastName';

  const formEl = document.getElementById('join-form');
  const nameInput = document.getElementById('player-name');
  const joinButton = document.getElementById('join-button');
  const statusEl = document.getElementById('status');
  const credentialsCard = document.getElementById('credentials');
  const playerSummaryEl = document.getElementById('player-summary');
  const leaveButton = document.getElementById('leave-button');
  const toastContainer = document.getElementById('toast-container');
  const toastTemplate = document.getElementById('message-template');
  const turnCard = document.getElementById('turn-card');
  const turnTitle = document.getElementById('turn-title');
  const turnStatusLine = document.getElementById('turn-status-line');
  const turnAccumulatedEl = document.getElementById('turn-accumulated');
  const turnSelectionEl = document.getElementById('turn-selection');
  const turnHintEl = document.getElementById('turn-hint');
  const rollButton = document.getElementById('roll-button');
  const bankButton = document.getElementById('bank-button');
  const diceContainer = document.getElementById('dice-container');
  const heroSection = document.querySelector('.hero');
  const joinCard = document.getElementById('join-card');
  const reactionOverlay = new ReactionOverlay(document.body);

  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || '';

  let connection = null;
  let pendingJoin = false;
  let latestGameState = null;
  let lastDiceSignature = null;
  let reconnectAttemptedForConnection = false;
  let identityRecognized = false;
  let currentIdentity = null;
  let lifecycleHandlersBound = false;

  initialize();

  function initialize() {
    if (!gameId) {
      setStatus('error', 'Missing gameId in URL. Scan QR code again.');
      disableForm();
      lastDiceSignature = null;
      return;
    }

    nameInput.value = getStoredName();
    const storedIdentity = readIdentityFromStorage();
    currentIdentity = storedIdentity && storedIdentity.gameId === gameId ? storedIdentity : null;

    setupConnection();
    bindLifecycleHandlers();

    formEl.addEventListener('submit', handleJoinSubmit);
    leaveButton.addEventListener('click', handleLeave);
    if (diceContainer) {
      diceContainer.addEventListener('click', handleDiceClick);
    }
    if (rollButton) {
      rollButton.addEventListener('click', handleRoll);
    }
    if (bankButton) {
      bankButton.addEventListener('click', handleBank);
    }

    updateCredentials(currentIdentity);
    updateJoinVisibility(null);
    renderTurnState(null);
    updateJoinAvailability();
  }

  function setupConnection() {
    // Ensure any existing connection is fully closed first
    if (connection) {
      connection.close();
      connection = null;
    }

    reconnectAttemptedForConnection = false;
    identityRecognized = false;

    connection = new GameConnection();

    connection.on('open', () => {
      setStatus('info', 'Connected. Enter your name to join.');
      if (!reconnectAttemptedForConnection && currentIdentity) {
        reconnectAttemptedForConnection = true;
        emitReconnect(currentIdentity);
      }
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    connection.on('close', () => {
      setStatus('error', 'Disconnected. Retrying…');
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    connection.on('game_state', gameState => {
      latestGameState = gameState;
      updateJoinAvailability();
      updateJoinVisibility(gameState);
      const identity = getIdentity();
      if (identity && (!gameState || !gameState.players || !gameState.players.some(p => p.playerId === identity.playerId))) {
        // Identity is stale relative to game; clear it so user can rejoin.
        clearIdentity();
        updateCredentials(null);
        setStatus('info', 'This game no longer recognizes your device. Join again.');
        identityRecognized = false;
        updateJoinAvailability();
      } else if (identity) {
        updateCredentials(identity);
        if (!identityRecognized) {
          setStatus('success', `Connected as ${identity.name}.`);
          identityRecognized = true;
        }
      } else {
        identityRecognized = false;
      }
      renderTurnState(gameState);
    });

    connection.on('reaction', payload => {
      const identity = getIdentity();
      if (!payload || !identity || payload.playerId !== identity.playerId) return;

      if (payload.type === 'bank') {
        const bankAmount = typeof payload.bankAmount === 'number' ? payload.bankAmount : 0;
        const previousTotal = typeof payload.previousTotal === 'number' ? payload.previousTotal : 0;
        const playerName = typeof payload.playerName === 'string' ? payload.playerName : null;
        reactionOverlay.showBank({ bankAmount, previousTotal, playerName });
        return;
      }

      if (payload.mediaUrl && payload.type === 'bust') {
        // Do not override an active bank overlay
        if (reactionOverlay.currentType === 'bank' && reactionOverlay.active) return;
        reactionOverlay.show(payload.mediaUrl);
      }
    });

    connection.on('server_error', payload => {
      if (payload && payload.message) {
        setStatus('error', payload.message);
        showToast(payload.message);
      } else {
        setStatus('error', 'Server rejected the request.');
      }
      pendingJoin = false;
      updateJoinAvailability();
    });

    // Connect with playerId if we have one (for better server-side tracking)
    const playerId = currentIdentity ? currentIdentity.playerId : null;
    connection.connect(playerId);
  }

  function teardownConnection() {
    if (!connection) {
      return;
    }

    connection.close();
    connection = null;
    identityRecognized = false;  // Reset so game_state handler updates status
    updateJoinAvailability();
  }

  function bindLifecycleHandlers() {
    if (lifecycleHandlersBound) {
      return;
    }
    lifecycleHandlersBound = true;

    // On mobile, aggressively tearing down connections on visibility change can exhaust
    // the browser's connection pool. Instead, we let SSE stay open and rely
    // on its native reconnection. We only clean up on actual page unload.
    
    const handlePageHide = () => {
      // Force close on page unload to release resources
      if (connection) {
        connection.close();
        connection = null;
      }
    };

    // pagehide is more reliable than beforeunload on mobile
    window.addEventListener('pagehide', handlePageHide);
    
    // Also handle beforeunload for desktop browsers
    window.addEventListener('beforeunload', handlePageHide);

    // When page becomes visible again after being hidden, check connection health
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!connection) {
          setStatus('info', 'Reconnecting…');
          setupConnection();
        } else if (!connection.isConnected()) {
          // Connection exists but isn't connected - EventSource should auto-reconnect
          setStatus('info', 'Reconnecting…');
        }
      }
    });
  }

  async function handleJoinSubmit(event) {
    event.preventDefault();
    if (!connection || !connection.isConnected() || pendingJoin) {
      return;
    }

    const name = nameInput.value.trim();
    if (name.length === 0) {
      setStatus('error', 'Name is required.');
      return;
    }

    const gameState = latestGameState;
    if (gameState && gameState.phase !== 'lobby') {
      setStatus('error', 'Game already started. Wait for next game.');
      return;
    }

    pendingJoin = true;
    updateJoinAvailability();
    setStatus('info', 'Joining…');

    const result = await connection.send('join', {
      gameId,
      name
    });

    if (result.success && result.playerId && result.playerSecret) {
      const identity = {
        gameId,
        playerId: result.playerId,
        playerSecret: result.playerSecret,
        name
      };
      saveIdentity(identity);
      storeName(name);
      setStatus('success', 'Joined! Waiting for your turn.');
      showToast('You joined the game.');
      updateCredentials(identity);
      identityRecognized = true;
    } else {
      setStatus('error', result.message || 'Failed to join.');
      showToast(result.message || 'Failed to join.');
    }

    pendingJoin = false;
    updateJoinAvailability();
    renderTurnState(latestGameState);
  }

  function handleLeave() {
    clearIdentity();
    storeName(nameInput.value.trim());
    updateCredentials(null);
    setStatus('info', 'Identity cleared. You can join again.');
    identityRecognized = false;
    updateJoinAvailability();
    renderTurnState(latestGameState);
  }

  async function emitReconnect(identity) {
    if (!connection) {
      return;
    }

    setStatus('info', 'Reconnecting with saved identity…');

    const result = await connection.send('reconnect', {
      gameId,
      playerId: identity.playerId,
      playerSecret: identity.playerSecret
    });

    if (result.success) {
      identityRecognized = true;
      setStatus('success', `Reconnected as ${identity.name}.`);
    } else {
      // Reconnect failed - identity is stale, clear it so user can rejoin
      console.warn('[Reconnect] Failed:', result.message);
      clearIdentity();
      updateCredentials(null);
      setStatus('info', 'Previous session expired. Enter your name to join.');
      updateJoinAvailability();
    }
  }

  function updateJoinAvailability() {
    const connected = connection && connection.isConnected();
    const identity = getIdentity();
    const inLobby = !latestGameState || latestGameState.phase === 'lobby';
    const canAttemptJoin = connected && !pendingJoin && !identity && inLobby;
    joinButton.disabled = !canAttemptJoin;
    nameInput.disabled = !connected || Boolean(identity) || !inLobby;
    leaveButton.disabled = !identity;
  }


  function updateJoinVisibility(gameState) {
    const isLobby = !gameState || gameState.phase === 'lobby';
    if (heroSection) {
      toggleElement(heroSection, isLobby);
    }
    if (joinCard) {
      toggleElement(joinCard, isLobby);
    }
  }

  function renderTurnState(gameState) {
    const identity = getIdentity();
    if (!identity) {
      hideElement(turnCard);
      clearDice();
      lastDiceSignature = null;
      disableActionButtons();
      turnHintEl.textContent = 'Join the game to begin playing.';
      return;
    }

    showElement(turnCard);


    if (!gameState) {
      turnTitle.textContent = `Welcome, ${identity.name || 'Player'}`;
      turnStatusLine.textContent = 'Waiting for game to begin.';
      turnAccumulatedEl.textContent = 'Turn score: 0';
      turnSelectionEl.textContent = 'Selection: 0';
      clearDice();
      lastDiceSignature = null;
      disableActionButtons();
      turnHintEl.textContent = 'Awaiting game creation on the TV.';
      return;
    }

    const players = Array.isArray(gameState.players) ? gameState.players : [];
    const playerState = players.find(p => p.playerId === identity.playerId);

    if (!playerState) {
      turnTitle.textContent = identity.name || 'Player';
      turnStatusLine.textContent = 'You are not part of this game.';
      turnAccumulatedEl.textContent = 'Turn score: 0';
      turnSelectionEl.textContent = 'Selection: 0';
      clearDice();
      lastDiceSignature = null;
      disableActionButtons();
      turnHintEl.textContent = 'Leave the device or join again with the QR code.';
      return;
    }

    if (gameState.phase !== 'in_progress' || !gameState.turn) {
      turnTitle.textContent = `Hello, ${playerState.name}`;
      turnStatusLine.textContent = gameState.phase === 'lobby'
        ? 'Waiting for the game to start.'
        : 'Game is finished.';
      turnAccumulatedEl.textContent = 'Turn score: 0';
      turnSelectionEl.textContent = 'Selection: 0';
      clearDice();
      lastDiceSignature = null;
      disableActionButtons();
      turnHintEl.textContent = gameState.phase === 'lobby'
        ? 'Hang tight until the TV starts the game.'
        : 'Start a new game from the TV when ready.';
      return;
    }

    const turn = gameState.turn;
    const selection = turn.selection || { selectedIndices: [], isValid: false, selectionScore: 0 };
    const selectedIndices = Array.isArray(selection.selectedIndices) ? selection.selectedIndices : [];
    const isActivePlayer = turn.playerId === identity.playerId;
    const activePlayer = players.find(p => p.playerId === turn.playerId);
    const activeName = activePlayer ? activePlayer.name : 'Unknown player';

    turnAccumulatedEl.textContent = `Turn score: ${turn.accumulatedTurnScore}`;
    turnSelectionEl.textContent = `Selection: ${selection.selectionScore} ${selection.isValid ? '(valid)' : '(invalid)'}`;

    if (!isActivePlayer) {
      clearDice();
      lastDiceSignature = null;
      turnTitle.textContent = `${playerState.name}, hold tight`;
      turnStatusLine.textContent = `${activeName} is taking their turn.`;
      disableActionButtons();
      turnHintEl.textContent = 'Controls will unlock when your turn begins.';
      return;
    }

    // When awaiting the first roll, dice should appear blank and not be interactive
    const allowDiceInteraction = turn.status !== 'awaiting_first_roll';
    renderDice(turn.dice || [], selectedIndices, allowDiceInteraction);

    turnTitle.textContent = `Your turn, ${playerState.name}!`;
    turnStatusLine.textContent = `Status: ${formatTurnStatus(turn.status)}`;

    const rollEnabled = canRoll();
    const bankEnabled = canBank();

    rollButton.disabled = !rollEnabled;
    bankButton.disabled = !bankEnabled;

    // Update roll button text for "free" roll (hot dice)
    const dice = turn.dice || [];
    const selectableIndices = dice
      .map((die, index) => die.selectable ? index : null)
      .filter(index => index !== null);
    const selectedSet = new Set(selectedIndices);
    const allSelectableSelected = selectableIndices.length > 0 && 
                                   selectableIndices.every(index => selectedSet.has(index));
    
    if (turn.status === 'awaiting_first_roll') {
      rollButton.textContent = 'First Roll';
    } else if (rollEnabled && allSelectableSelected) {
      rollButton.textContent = '"Free" Roll';
    } else if (rollEnabled) {
      const diceToRoll = selectableIndices.filter(index => !selectedSet.has(index)).length;
      rollButton.textContent = `Roll ${diceToRoll} Dice`;
    } else {
      rollButton.textContent = 'Roll Dice';
    }

    // Update bank button text with total amount using best possible score
    if (bankEnabled) {
      const bestScore = turn.bestSelectableScore || 0;
      const bankTotal = turn.accumulatedTurnScore + bestScore;
      bankButton.textContent = `Bank ${bankTotal}`;
    } else {
      bankButton.textContent = 'Bank Score';
    }

    turnHintEl.textContent = determineHint(turn.status, selection, turn);

    if (!bankEnabled && !rollEnabled) {
      disableActionButtons();
    }
  }

  function handleDiceClick(event) {
    const target = event.target.closest('.die');
    if (!target) {
      return;
    }

    const index = Number.parseInt(target.dataset.index, 10);
    if (Number.isNaN(index)) {
      return;
    }

    attemptToggleDie(index);
  }

  function attemptToggleDie(index) {
    if (!connection || !connection.isConnected()) {
      return;
    }

    const identity = getIdentity();
    if (!identity || !latestGameState || latestGameState.phase !== 'in_progress') {
      return;
    }

    const turn = latestGameState.turn;
    if (!turn || turn.playerId !== identity.playerId) {
      return;
    }

    const die = Array.isArray(turn.dice) ? turn.dice[index] : null;
    if (!die || !die.selectable) {
      return;
    }

    connection.send('toggle', { 
      playerId: identity.playerId,
      playerSecret: identity.playerSecret,
      dieIndex: index 
    });
  }

  function handleRoll() {
    if (!canRoll()) {
      return;
    }

    const identity = getIdentity();
    connection.send('roll', {
      playerId: identity.playerId,
      playerSecret: identity.playerSecret
    });
  }

  function handleBank() {
    if (!canBank()) {
      return;
    }

    const identity = getIdentity();
    connection.send('bank', {
      playerId: identity.playerId,
      playerSecret: identity.playerSecret
    });
  }

  function canRoll() {
    const identity = getIdentity();
    if (!connection || !connection.isConnected() || !identity || !latestGameState) {
      return false;
    }

    if (latestGameState.phase !== 'in_progress') {
      return false;
    }

    const turn = latestGameState.turn;
    if (!turn || turn.playerId !== identity.playerId) {
      return false;
    }

    const selection = turn.selection || { isValid: false, selectedIndices: [] };
    // During the initial state the selection will be empty/invalid; allow the
    // player to Roll in that specific case (awaiting_first_roll).
    if (!selection.isValid && turn.status !== 'awaiting_first_roll') {
      return false;
    }

    if (turn.status && turn.status !== 'awaiting_roll' && turn.status !== 'awaiting_bank' && turn.status !== 'awaiting_first_roll') {
      return false;
    }

    return true;
  }

  function canBank() {
    const identity = getIdentity();
    if (!connection || !connection.isConnected() || !identity || !latestGameState) {
      return false;
    }

    if (latestGameState.phase !== 'in_progress') {
      return false;
    }

    const turn = latestGameState.turn;
    if (!turn || turn.playerId !== identity.playerId) {
      return false;
    }

    // Use bestSelectableScore (best possible score from all selectable dice) for banking logic
    // This ensures deselecting dice doesn't affect whether you can bank or the amount
    const bestScore = turn.bestSelectableScore || 0;
    const bankTotal = turn.accumulatedTurnScore + bestScore;

    if (bankTotal <= 0) {
      return false;
    }

    const players = Array.isArray(latestGameState.players) ? latestGameState.players : [];
    const playerState = players.find(p => p.playerId === identity.playerId);
    const minimumEntry = latestGameState.config && latestGameState.config.minimumEntryScore 
      ? latestGameState.config.minimumEntryScore 
      : 0;

    if (playerState && !playerState.hasEnteredGame && bankTotal < minimumEntry) {
      return false;
    }

    // Can bank if there's a positive best score from selectable dice, or accumulated score from previous rolls
    if (bestScore > 0) {
      return true;
    }

    if (turn.accumulatedTurnScore > 0) {
      return true;
    }

    // Do not allow banking before the first roll
    if (turn.status === 'awaiting_first_roll') {
      return false;
    }

    return false;
  }

  function renderDice(dice, selectedIndices, allowInteraction) {
    clearDice();

    if (!Array.isArray(dice) || dice.length === 0) {
      lastDiceSignature = null;
      return;
    }

    const selectedSet = new Set(selectedIndices);
    const signature = dice.map(d => `${d.value}:${d.selectable ? 1 : 0}`).join(',');
    const shouldAnimate = signature !== lastDiceSignature;
    lastDiceSignature = signature;

    dice.forEach((die, index) => {
      const dieEl = document.createElement('div');
      dieEl.classList.add('die');
      dieEl.dataset.index = String(index);

      if (!die.selectable) {
        dieEl.classList.add('locked');
      } else if (allowInteraction) {
        dieEl.classList.add('selectable');
      }

      if (selectedSet.has(index)) {
        dieEl.classList.add('selected');
      }

      dieEl.textContent = die.value === null || typeof die.value === 'undefined' ? '' : String(die.value);

      if (shouldAnimate) {
        requestAnimationFrame(() => {
          dieEl.classList.add('roll-animating');
        });
        dieEl.addEventListener('animationend', () => {
          dieEl.classList.remove('roll-animating');
        }, { once: true });
      }

      diceContainer.appendChild(dieEl);
    });
  }

  function determineHint(status, selection, turn) {
    const hasSelection = Array.isArray(selection.selectedIndices) && selection.selectedIndices.length > 0;
    if (!status) {
      return 'Waiting for the latest turn data.';
    }

    const hotDice = Boolean(turn && Array.isArray(turn.dice) && turn.dice.length === 6 && turn.accumulatedTurnScore > 0);

    switch (status) {
      case 'awaiting_selection':
        if (hasSelection && !selection.isValid) {
          return 'Current selection is not valid yet.';
        }
        if (hotDice) {
          return 'Hot dice! Pick a scoring set to keep going.';
        }
        return 'Select scoring dice to continue.';
      case 'awaiting_roll':
        return selection.isValid ? 'Roll remaining dice or bank your points.' : 'Adjust dice until the selection is valid.';
      case 'awaiting_first_roll':
        return 'Tap Roll to perform your first roll.';
      case 'awaiting_bank':
        return 'You may bank now or keep rolling.';
      default:
        return 'Waiting for the next update.';
    }
  }

  function formatTurnStatus(status) {
    switch (status) {
      case 'awaiting_selection':
        return 'Awaiting Selection';
      case 'awaiting_first_roll':
        return 'Awaiting First Roll';
      case 'awaiting_roll':
        return 'Awaiting Roll';
      case 'awaiting_bank':
        return 'Awaiting Bank';
      default:
        return 'Unknown';
    }
  }

  function clearDice() {
    if (diceContainer) {
      diceContainer.innerHTML = '';
    }
  }

  function disableActionButtons() {
    rollButton.disabled = true;
    bankButton.disabled = true;
  }

  function showElement(element) {
    if (element) {
      element.classList.remove('hidden');
    }
  }

  function hideElement(element) {
    if (element) {
      element.classList.add('hidden');
    }
  }

  function toggleElement(element, shouldShow) {
    if (shouldShow) {
      showElement(element);
    } else {
      hideElement(element);
    }
  }

  function setStatus(level, message) {
    statusEl.textContent = message;
    statusEl.classList.remove('status-info', 'status-success', 'status-error');
    switch (level) {
      case 'success':
        statusEl.classList.add('status-success');
        break;
      case 'error':
        statusEl.classList.add('status-error');
        break;
      default:
        statusEl.classList.add('status-info');
        break;
    }
  }

  function updateCredentials(identity) {
    if (identity) {
      playerSummaryEl.textContent = `${identity.name} (${identity.playerId.slice(0, 6)}…)`;
      credentialsCard.classList.remove('hidden');
    } else {
      playerSummaryEl.textContent = '—';
      credentialsCard.classList.add('hidden');
    }
  }

  function saveIdentity(identity) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(identity));
    } catch (error) {
      console.warn('Unable to save identity', error);
    }
    currentIdentity = identity;
  }

  function readIdentityFromStorage() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const identity = JSON.parse(raw);
      if (!identity || identity.gameId !== gameId) {
        return null;
      }
      return identity;
    } catch (error) {
      console.warn('Unable to load identity', error);
      return null;
    }
  }

  function getIdentity() {
    return currentIdentity;
  }

  function clearIdentity() {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Unable to clear identity', error);
    }
    currentIdentity = null;
    identityRecognized = false;
  }

  function storeName(name) {
    try {
      if (name) {
        localStorage.setItem(nameKey, name);
      }
    } catch (error) {
      console.warn('Unable to store name', error);
    }
  }

  function getStoredName() {
    try {
      return localStorage.getItem(nameKey) || '';
    } catch (error) {
      console.warn('Unable to read stored name', error);
      return '';
    }
  }

  function disableForm() {
    nameInput.disabled = true;
    joinButton.disabled = true;
  }

  function showToast(message) {
    const template = toastTemplate.content.firstElementChild.cloneNode(true);
    template.textContent = message;
    toastContainer.appendChild(template);
    requestAnimationFrame(() => {
      template.classList.add('show');
    });
    setTimeout(() => {
      template.classList.remove('show');
      setTimeout(() => template.remove(), 300);
    }, 3000);
  }
})();
