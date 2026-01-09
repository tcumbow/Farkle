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

      // Create text-based bank overlay elements
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
      // Generic media-based reaction
      if (this.active) {
        return;
      }
      if (!mediaUrl) {
        return;
      }

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
      // Bank overlay takes precedence: interrupt any ongoing media reaction
      this._clearAll();
      this.active = true;
      this.currentType = 'bank';
      this.overlayEl.classList.add('visible');
      this.mediaEl.classList.add('hidden');
      this.bankEl.classList.remove('hidden');

      // Initialize display
      this.bankLabelEl.textContent = playerName ? `${playerName} banked points:` : 'Banked points:';
      this.bankAmountEl.textContent = `+${bankAmount}`;
      this.bankPrevEl.textContent = `${previousTotal}`;

      // Sequence: show initial numbers for 0.5s, animate transfer for 1s, show final total 0.5s
      const showInitial = () => {
        this.bankAmountEl.style.opacity = '1';
        this.bankPrevEl.style.opacity = '1';
      };

      const animateTransfer = () => {
        const duration = 1000;
        const start = Date.now();
        const fromPrev = previousTotal;
        const toPrev = previousTotal + bankAmount;
        const fromBank = bankAmount;
        const tick = () => {
          const now = Date.now();
          const t = Math.min(1, (now - start) / duration);
          // prev counts up linearly
          const currentPrev = Math.floor(fromPrev + (toPrev - fromPrev) * t);
          // bank counts down in steps of 10
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

      showInitial();
      this.hideTimer = setTimeout(() => {
        animateTransfer();
        // After 1s (transfer), show final for 0.5s then clear
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
      // Reset media
      this.mediaEl.pause();
      this.mediaEl.removeAttribute('src');
      this.mediaEl.load();
      // Reset visibility
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
      this.connected = false;
    }

    connect() {
      this.intentionallyClosed = false;
      this._clearReconnectTimer();

      const url = '/api/events';

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

      this.eventSource.onerror = () => {
        this.connected = false;
        this._emit('close');
        
        if (!this.intentionallyClosed) {
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

  const connectionStatusEl = document.getElementById('connection-status');
  const startButton = document.getElementById('start-game-btn');
  const resetButton = document.getElementById('reset-game-btn');
  const gameIdEl = document.getElementById('game-id');
  const phaseEl = document.getElementById('game-phase');
  const minimumEntryEl = document.getElementById('minimum-entry');
  const playerCountEl = document.getElementById('player-count');
  const qrSection = document.getElementById('qr-section');
  const qrCanvas = document.getElementById('join-qr');
  const joinUrlEl = document.getElementById('join-url');
  const gameMetadataSection = document.getElementById('game-metadata');
  const lobbyView = document.getElementById('lobby-view');
  const lobbyList = document.getElementById('lobby-players');
  const inProgressView = document.getElementById('in-progress-view');
  const scoreboardSection = document.getElementById('scoreboard');
  const scoreboardBody = document.getElementById('scoreboard-body');
  const finishedView = document.getElementById('finished-view');
  const finalResultsList = document.getElementById('final-results');
  const emptyState = document.getElementById('empty-state');
  const activePlayerEl = document.getElementById('active-player');
  const turnStatusEl = document.getElementById('turn-status');
  const turnScoreEl = document.getElementById('turn-score');
  const selectionScoreEl = document.getElementById('selection-score');
  const diceContainer = document.getElementById('dice-container');
  const reactionOverlay = new ReactionOverlay(document.body);

  let qrInstance = null;
  let latestGameState = null;
  let lastTurnDiceSignature = null;
  let serverHost = null;
  let serverPort = null;
  let connection = null;

  // Fetch server info on page load
  fetch('/api/server-info')
    .then(res => res.json())
    .then(info => {
      serverHost = info.host;
      serverPort = info.port;
      // Re-render QR if we're in lobby
      if (latestGameState && latestGameState.phase === 'lobby') {
        updateQr(latestGameState);
      }
    })
    .catch(err => {
      console.error('Failed to fetch server info:', err);
    });

  // Initialize connection
  connection = new GameConnection();

  startButton.addEventListener('click', () => {
    if (connection.isConnected()) {
      connection.send('start', {});
    }
  });

  resetButton.addEventListener('click', () => {
    if (connection.isConnected()) {
      connection.send('reset', {});
    }
  });

  connection.on('open', () => {
    updateConnectionStatus(true);
    toggleButtons(latestGameState);
  });

  connection.on('close', () => {
    updateConnectionStatus(false);
    toggleButtons(null);
  });

  connection.on('game_state', gameState => {
    latestGameState = gameState;
    renderGameState(gameState);
  });

  connection.on('reaction', payload => {
    if (!payload) return;
    // If this is a structured bank reaction, use the bank overlay
    if (payload.type === 'bank') {
      // bank overlay has priority
      const bankAmount = typeof payload.bankAmount === 'number' ? payload.bankAmount : 0;
      const previousTotal = typeof payload.previousTotal === 'number' ? payload.previousTotal : 0;
      const playerName = typeof payload.playerName === 'string' ? payload.playerName : null;
      reactionOverlay.showBank({ bankAmount, previousTotal, playerName });
      return;
    }

    // Fallback: media-based reaction
    if (payload.mediaUrl) {
      if (payload.type === 'bust') {
        // If a bank overlay is active, do not override it
        if (reactionOverlay.currentType === 'bank' && reactionOverlay.active) return;
        reactionOverlay.show(payload.mediaUrl);
      }
    }
  });

  connection.connect();

  function updateConnectionStatus(isConnected) {
    connectionStatusEl.textContent = isConnected ? 'Connected' : 'Disconnected';
    connectionStatusEl.classList.toggle('status-connected', isConnected);
    connectionStatusEl.classList.toggle('status-disconnected', !isConnected);
  }

  function renderGameState(gameState) {
    if (!gameState) {
      renderEmptyState();
      toggleButtons(null);
      lastTurnDiceSignature = null;
      return;
    }

    renderMetadata(gameState);
    renderLobby(gameState);
    renderScoreboard(gameState);
    renderTurn(gameState);
    renderFinished(gameState);
    toggleViews(gameState);
    toggleButtons(gameState);
  }

  function renderEmptyState() {
    gameIdEl.textContent = '—';
    phaseEl.textContent = '—';
    minimumEntryEl.textContent = '—';
    playerCountEl.textContent = '0';
    hideElement(lobbyView);
    hideElement(inProgressView);
    hideElement(scoreboardSection);
    hideElement(finishedView);
    showElement(emptyState);
    hideQr();
  }

  function renderMetadata(gameState) {
    gameIdEl.textContent = gameState.gameId || '—';
    phaseEl.textContent = gameState.phase || 'unknown';
    minimumEntryEl.textContent = gameState.config ? gameState.config.minimumEntryScore : '—';
    playerCountEl.textContent = String(gameState.players ? gameState.players.length : 0);

    const showMetadata = !gameState || gameState.phase !== 'in_progress';
    toggleElement(gameMetadataSection, showMetadata);

    if (gameState.phase === 'lobby') {
      updateQr(gameState);
    } else {
      hideQr();
    }
  }

  function renderLobby(gameState) {
    lobbyList.innerHTML = '';

    (gameState.players || []).forEach((player, index) => {
      const item = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${index + 1}. ${player.name}`;

      const statusSpan = document.createElement('span');
      statusSpan.classList.add('status-pill');
      if (player.connected) {
        statusSpan.textContent = 'Online';
        statusSpan.classList.add('status-online');
      } else {
        statusSpan.textContent = 'Offline';
        statusSpan.classList.add('status-offline');
      }

      item.appendChild(nameSpan);
      item.appendChild(statusSpan);
      lobbyList.appendChild(item);
    });
  }

  function renderScoreboard(gameState) {
    scoreboardBody.innerHTML = '';

    const players = gameState.players || [];
    const hasTurnOrder = Array.isArray(gameState.turnOrder) && gameState.turnOrder.length > 0;
    const playerMap = new Map();
    players.forEach(player => {
      playerMap.set(player.playerId, player);
    });

    let orderedPlayers;

    if (hasTurnOrder) {
      orderedPlayers = gameState.turnOrder.map((id, index) => ({
        turnPosition: index + 1,
        player: playerMap.get(id)
      })).filter(entry => entry.player);
    } else {
      orderedPlayers = players.map((player, index) => ({
        turnPosition: index + 1,
        player
      }));
    }

    orderedPlayers.forEach(entry => {
      const row = document.createElement('tr');
      const isActive = gameState.phase === 'in_progress' && gameState.turn && gameState.turn.playerId === entry.player.playerId;
      if (isActive) {
        row.classList.add('active-row');
      }

      const positionCell = document.createElement('td');
      positionCell.textContent = String(entry.turnPosition);
      const nameCell = document.createElement('td');
      nameCell.textContent = entry.player.name;
      const scoreCell = document.createElement('td');
      scoreCell.textContent = String(entry.player.totalScore);

      // Progress cell: graphical bar showing fraction of victory target (10000)
      const progressCell = document.createElement('td');
      progressCell.className = 'progress-cell';
      const progressWrapper = document.createElement('div');
      progressWrapper.className = 'progress-wrapper';
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      const progressFill = document.createElement('div');
      progressFill.className = 'progress-fill';

      const VICTORY = 10000;
      const score = typeof entry.player.totalScore === 'number' ? entry.player.totalScore : Number(entry.player.totalScore) || 0;
      const pct = Math.max(0, Math.min(1, score / VICTORY));
      progressFill.style.width = `${Math.round(pct * 100)}%`;
      progressFill.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      progressFill.setAttribute('aria-valuemin', '0');
      progressFill.setAttribute('aria-valuemax', '100');

      progressBar.appendChild(progressFill);
      progressWrapper.appendChild(progressBar);

      // No percentage label — keep the bar only
      progressCell.appendChild(progressWrapper);

      row.appendChild(positionCell);
      row.appendChild(nameCell);
      row.appendChild(scoreCell);
      row.appendChild(progressCell);

      scoreboardBody.appendChild(row);
    });
  }

  function renderTurn(gameState) {
    if (gameState.phase !== 'in_progress' || !gameState.turn) {
      hideElement(inProgressView);
      clearDice();
      lastTurnDiceSignature = null;
      return;
    }

    const player = gameState.players.find(p => p.playerId === gameState.turn.playerId);
    activePlayerEl.textContent = player ? `${player.name} is rolling` : 'Active player unknown';

    const statusLabel = formatTurnStatus(gameState.turn.status);
    turnStatusEl.textContent = `Status: ${statusLabel}`;
    turnScoreEl.textContent = `Accumulated Turn Score: ${gameState.turn.accumulatedTurnScore}`;

    const selection = gameState.turn.selection || { isValid: false, selectionScore: 0, selectedIndices: [] };
    selectionScoreEl.textContent = `Current Selection: ${selection.selectionScore} ${selection.isValid ? '(valid)' : '(invalid)'}`;

    renderDice(gameState.turn.dice || [], selection.selectedIndices || []);
  }

  function renderFinished(gameState) {
    finalResultsList.innerHTML = '';

    if (gameState.phase !== 'finished') {
      return;
    }

    const sorted = [...(gameState.players || [])].sort((a, b) => b.totalScore - a.totalScore);
    sorted.forEach(player => {
      const item = document.createElement('li');
      item.textContent = `${player.name} — ${player.totalScore}`;
      finalResultsList.appendChild(item);
    });
  }

  function renderDice(dice, selectedIndices) {
    clearDice();
    const selected = new Set(selectedIndices);

     const currentSignature = Array.isArray(dice)
       ? dice.map(d => `${d.value}:${d.selectable ? 1 : 0}`).join(',')
       : null;
     const shouldAnimate = currentSignature && currentSignature !== lastTurnDiceSignature;
     lastTurnDiceSignature = currentSignature;

    dice.forEach((die, index) => {
      const dieEl = document.createElement('div');
      dieEl.classList.add('die');
      dieEl.textContent = String(die.value);

      if (die.selectable) {
        dieEl.classList.add('selectable');
      } else {
        dieEl.classList.add('locked');
      }

      if (selected.has(index)) {
        dieEl.classList.add('selected');
      }

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

  function clearDice() {
    diceContainer.innerHTML = '';
  }

  function toggleViews(gameState) {
    const hasGame = Boolean(gameState);
    const isLobby = hasGame && gameState.phase === 'lobby';
    const inProgress = hasGame && gameState.phase === 'in_progress';
    const isFinished = hasGame && gameState.phase === 'finished';

    if (hasGame) {
      hideElement(emptyState);
    }

    toggleElement(lobbyView, isLobby);
    toggleElement(inProgressView, inProgress && gameState.turn);
    toggleElement(scoreboardSection, hasGame && (gameState.players || []).length > 0);
    toggleElement(finishedView, isFinished);
  }

  function toggleButtons(gameState) {
    const connected = connection && connection.isConnected();
    const canStart = connected && gameState && gameState.phase === 'lobby' && (gameState.players || []).length > 0;
    startButton.disabled = !canStart;

    resetButton.disabled = !connected;
  }

  function updateQr(gameState) {
    if (!qrInstance) {
      qrInstance = new QRious({
        element: qrCanvas,
        size: 320,
        value: ''
      });
    }

    const joinUrl = buildJoinUrl(gameState.gameId);
    qrInstance.value = joinUrl;
    joinUrlEl.textContent = joinUrl;
    showElement(qrSection);
  }

  function hideQr() {
    if (qrInstance) {
      qrInstance.value = '';
    }
    hideElement(qrSection);
    joinUrlEl.textContent = '—';
  }

  function buildJoinUrl(gameId) {
    // Use server-provided host/port if available, otherwise fallback to window.location
    if (serverHost && serverPort) {
      return `http://${serverHost}:${serverPort}/join?gameId=${encodeURIComponent(gameId)}`;
    }
    const origin = window.location.origin;
    return `${origin}/join?gameId=${encodeURIComponent(gameId)}`;
  }

  function toggleElement(element, shouldShow) {
    if (shouldShow) {
      showElement(element);
    } else {
      hideElement(element);
    }
  }

  function showElement(element) {
    element.classList.remove('hidden');
  }

  function hideElement(element) {
    element.classList.add('hidden');
  }

  function formatTurnStatus(status) {
    switch (status) {
      case 'awaiting_selection':
        return 'Awaiting Selection';
      case 'awaiting_roll':
        return 'Ready to Roll';
      case 'awaiting_bank':
        return 'Ready to Bank';
      default:
        return 'Unknown';
    }
  }
})();
