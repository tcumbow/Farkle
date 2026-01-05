(() => {
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

  let qrInstance = null;
  let latestGameState = null;

  const socket = io({ transports: ['websocket'] });

  startButton.addEventListener('click', () => {
    if (socket.connected) {
      socket.emit('start_game', {});
    }
  });

  resetButton.addEventListener('click', () => {
    if (socket.connected) {
      socket.emit('reset_game', {});
    }
  });

  socket.on('connect', () => {
    updateConnectionStatus(true);
    toggleButtons(latestGameState);
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
    toggleButtons(null);
  });

  socket.on('connect_error', () => {
    updateConnectionStatus(false);
  });

  socket.on('game_state', gameState => {
    latestGameState = gameState;
    renderGameState(gameState);
  });

  function updateConnectionStatus(isConnected) {
    connectionStatusEl.textContent = isConnected ? 'Connected' : 'Disconnected';
    connectionStatusEl.classList.toggle('status-connected', isConnected);
    connectionStatusEl.classList.toggle('status-disconnected', !isConnected);
  }

  function renderGameState(gameState) {
    if (!gameState) {
      renderEmptyState();
      toggleButtons(null);
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
      const statusCell = document.createElement('td');
      const statusBits = [];
      statusBits.push(entry.player.connected ? 'Connected' : 'Disconnected');
      statusBits.push(entry.player.hasEnteredGame ? 'Entered' : 'Not entered');
      statusCell.textContent = statusBits.join(' / ');

      row.appendChild(positionCell);
      row.appendChild(nameCell);
      row.appendChild(scoreCell);
      row.appendChild(statusCell);

      scoreboardBody.appendChild(row);
    });
  }

  function renderTurn(gameState) {
    if (gameState.phase !== 'in_progress' || !gameState.turn) {
      hideElement(inProgressView);
      clearDice();
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
    const connected = socket.connected;
    const canStart = connected && gameState && gameState.phase === 'lobby' && (gameState.players || []).length > 0;
    startButton.disabled = !canStart;

    resetButton.disabled = !connected;
  }

  function updateQr(gameState) {
    if (!qrInstance) {
      qrInstance = new QRious({
        element: qrCanvas,
        size: 200,
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
