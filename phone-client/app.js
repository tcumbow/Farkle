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

  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || '';

  let socket;
  let pendingJoin = false;
  let latestGameState = null;
  let reconnectAttempted = false;
  let identityRecognized = false;

  initialize();

  function initialize() {
    if (!gameId) {
      setStatus('error', 'Missing gameId in URL. Scan QR code again.');
      disableForm();
      return;
    }

    nameInput.value = getStoredName();
    const storedIdentity = loadIdentity();

    socket = io({ transports: ['websocket'] });

    socket.on('connect', () => {
      setStatus('info', 'Connected. Enter your name to join.');
      if (!reconnectAttempted && storedIdentity && storedIdentity.gameId === gameId) {
        reconnectAttempted = true;
        emitReconnect(storedIdentity);
      }
      updateJoinAvailability();
    });

    socket.on('disconnect', () => {
      setStatus('error', 'Disconnected. Retrying…');
      updateJoinAvailability();
    });

    socket.on('connect_error', error => {
      console.error('Socket connect error', error);
      setStatus('error', 'Unable to connect. Check network.');
      updateJoinAvailability();
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
    });

    socket.on('game_state', gameState => {
      latestGameState = gameState;
      renderGameInfo(gameState);
      updateJoinAvailability();
      const identity = loadIdentity();
      if (identity && (!gameState || !gameState.players || !gameState.players.some(p => p.playerId === identity.playerId))) {
        // Identity is stale relative to game; clear it so user can rejoin.
        clearIdentity();
        updateCredentials(null);
        setStatus('info', 'This game no longer recognizes your device. Join again.');
        identityRecognized = false;
      } else if (identity) {
        updateCredentials(identity);
        if (!identityRecognized) {
          setStatus('success', `Connected as ${identity.name}.`);
          identityRecognized = true;
        }
      } else {
        identityRecognized = false;
      }
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

    updateCredentials(storedIdentity && storedIdentity.gameId === gameId ? storedIdentity : null);
    renderGameInfo(null);
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
    const identity = loadIdentity();
    const inLobby = !latestGameState || latestGameState.phase === 'lobby';
    const canAttemptJoin = connected && !pendingJoin && (!identity || identity.gameId !== gameId) && inLobby;
    joinButton.disabled = !canAttemptJoin;
    nameInput.disabled = !connected || Boolean(identity && identity.gameId === gameId) || !inLobby;
    leaveButton.disabled = !(identity && identity.gameId === gameId);
  }

  function renderGameInfo(gameState) {
    if (!gameState) {
      gameInfoEl.textContent = `Game ID ${gameId}`;
      return;
    }

    const phase = gameState.phase || 'unknown';
    const playerCount = Array.isArray(gameState.players) ? gameState.players.length : 0;
    let text = `Game ID ${gameState.gameId || gameId} — ${phase.toUpperCase()} — ${playerCount} player${playerCount === 1 ? '' : 's'}`;
    if (phase !== 'lobby') {
      text += ' (joining closed)';
    }
    gameInfoEl.textContent = text;
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
  }

  function loadIdentity() {
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

  function clearIdentity() {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Unable to clear identity', error);
    }
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
