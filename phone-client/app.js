(() => {
  const storageKey = 'farkle.phone.identity';
  const nameKey = 'farkle.phone.lastName';

  const formEl = document.getElementById('join-form');
  const nameInput = document.getElementById('player-name');
  const joinButton = document.getElementById('join-button');
  const statusEl = document.getElementById('status');
  const credentialsCard = document.getElementById('credentials');
  const playerSummaryEl = document.getElementById('player-summary');
  const leaveButton = document.getElementById('leave-button');
  const gameInfoEl = document.getElementById('game-info');
  const toastContainer = document.getElementById('toast-container');
  const toastTemplate = document.getElementById('message-template');
  const turnCard = document.getElementById('turn-card');
  const turnTitle = document.getElementById('turn-title');
  const turnPhaseEl = document.getElementById('turn-phase');
  const turnStatusLine = document.getElementById('turn-status-line');
  const turnAccumulatedEl = document.getElementById('turn-accumulated');
  const turnSelectionEl = document.getElementById('turn-selection');
  const turnHintEl = document.getElementById('turn-hint');
  const rollButton = document.getElementById('roll-button');
  const bankButton = document.getElementById('bank-button');
  const diceContainer = document.getElementById('dice-container');
  const heroSection = document.querySelector('.hero');
  const joinCard = document.getElementById('join-card');

  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || '';

  let socket;
  let pendingJoin = false;
  let latestGameState = null;
  let lastDiceSignature = null;
  let reconnectAttempted = false;
  let identityRecognized = false;
  let currentIdentity = null;

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

    socket = io({ transports: ['websocket'] });

    socket.on('connect', () => {
      setStatus('info', 'Connected. Enter your name to join.');
      if (!reconnectAttempted && currentIdentity) {
        reconnectAttempted = true;
        emitReconnect(currentIdentity);
      }
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    socket.on('disconnect', () => {
      setStatus('error', 'Disconnected. Retrying…');
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    socket.on('connect_error', error => {
      console.error('Socket connect error', error);
      setStatus('error', 'Unable to connect. Check network.');
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    socket.on('join_success', payload => {
      if (!payload || !payload.playerId || !payload.playerSecret) {
        console.warn('Invalid join_success payload', payload);
        return;
      }

      const identity = {
        gameId,
        playerId: payload.playerId,
        playerSecret: payload.playerSecret,
        name: nameInput.value.trim()
      };
      saveIdentity(identity);
      storeName(identity.name);
      setStatus('success', 'Joined! Waiting for your turn.');
      showToast('You joined the game.');
      updateCredentials(identity);
      identityRecognized = true;
      pendingJoin = false;
      updateJoinAvailability();
      renderTurnState(latestGameState);
    });

    socket.on('game_state', gameState => {
      latestGameState = gameState;
      renderGameInfo(gameState);
      updateJoinAvailability();
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

    socket.on('error', payload => {
      if (payload && payload.message) {
        setStatus('error', payload.message);
        showToast(payload.message);
      } else {
        setStatus('error', 'Server rejected the request.');
      }
      pendingJoin = false;
      updateJoinAvailability();
    });

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
    renderGameInfo(null);
    renderTurnState(null);
    updateJoinAvailability();
  }

  function handleJoinSubmit(event) {
    event.preventDefault();
    if (!socket || !socket.connected || pendingJoin) {
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

    socket.emit('join_game', {
      gameId,
      name
    });
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

  function emitReconnect(identity) {
    if (!socket || !socket.connected) {
      return;
    }

    setStatus('info', 'Reconnecting with saved identity…');

    socket.emit('reconnect_player', {
      gameId,
      playerId: identity.playerId,
      playerSecret: identity.playerSecret
    });
  }

  function updateJoinAvailability() {
    const connected = socket && socket.connected;
    const identity = getIdentity();
    const inLobby = !latestGameState || latestGameState.phase === 'lobby';
    const canAttemptJoin = connected && !pendingJoin && !identity && inLobby;
    joinButton.disabled = !canAttemptJoin;
    nameInput.disabled = !connected || Boolean(identity) || !inLobby;
    leaveButton.disabled = !identity;
  }

  function renderGameInfo(gameState) {
    if (!gameState) {
      gameInfoEl.textContent = `Game ID ${gameId}`;
      updateJoinVisibility(null);
      return;
    }

    const phase = gameState.phase || 'unknown';
    const playerCount = Array.isArray(gameState.players) ? gameState.players.length : 0;
    let text = `Game ID ${gameState.gameId || gameId} — ${phase.toUpperCase()} — ${playerCount} player${playerCount === 1 ? '' : 's'}`;
    if (phase !== 'lobby') {
      text += ' (joining closed)';
    }
    gameInfoEl.textContent = text;
    updateJoinVisibility(gameState);
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

    const phase = gameState && gameState.phase ? gameState.phase : null;
    turnPhaseEl.textContent = phase ? phase.toUpperCase() : '—';

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

    renderDice(turn.dice || [], selectedIndices, true);

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
    
    if (rollEnabled && allSelectableSelected) {
      rollButton.textContent = '"Free" Roll';
    } else if (rollEnabled) {
      // Count how many dice will be rolled (selectable dice that are not selected)
      const diceToRoll = selectableIndices.filter(index => !selectedSet.has(index)).length;
      rollButton.textContent = `Roll ${diceToRoll} Dice`;
    } else {
      rollButton.textContent = 'Roll Dice';
    }

    // Update bank button text with total amount
    if (bankEnabled) {
      const selectionScore = selection.isValid ? selection.selectionScore : 0;
      const bankTotal = turn.accumulatedTurnScore + selectionScore;
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
    if (!socket || !socket.connected) {
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

    socket.emit('toggle_die_selection', { dieIndex: index });
  }

  function handleRoll() {
    if (!canRoll()) {
      return;
    }

    socket.emit('roll_dice', {});
  }

  function handleBank() {
    if (!canBank()) {
      return;
    }

    socket.emit('bank_score', {});
  }

  function canRoll() {
    const identity = getIdentity();
    if (!socket || !socket.connected || !identity || !latestGameState) {
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
    if (!selection.isValid) {
      return false;
    }

    if (turn.status && turn.status !== 'awaiting_roll' && turn.status !== 'awaiting_bank') {
      return false;
    }

    return true;
  }

  function canBank() {
    const identity = getIdentity();
    if (!socket || !socket.connected || !identity || !latestGameState) {
      return false;
    }

    if (latestGameState.phase !== 'in_progress') {
      return false;
    }

    const turn = latestGameState.turn;
    if (!turn || turn.playerId !== identity.playerId) {
      return false;
    }

    const selection = turn.selection || { isValid: false, selectedIndices: [], selectionScore: 0 };
    const hasSelection = Array.isArray(selection.selectedIndices) && selection.selectedIndices.length > 0;

    // Calculate total bank amount
    const selectionScore = selection.isValid ? selection.selectionScore : 0;
    const bankTotal = turn.accumulatedTurnScore + selectionScore;

    // Can't bank zero or negative
    if (bankTotal <= 0) {
      return false;
    }

    // Check minimum entry requirement
    const players = Array.isArray(latestGameState.players) ? latestGameState.players : [];
    const playerState = players.find(p => p.playerId === identity.playerId);
    const minimumEntry = latestGameState.config && latestGameState.config.minimumEntryScore 
      ? latestGameState.config.minimumEntryScore 
      : 0;

    if (playerState && !playerState.hasEnteredGame && bankTotal < minimumEntry) {
      return false;
    }

    // Must have a valid selection or accumulated score
    if (selection.isValid) {
      return true;
    }

    if (!hasSelection && turn.accumulatedTurnScore > 0) {
      return true;
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

      dieEl.textContent = String(die.value);

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
