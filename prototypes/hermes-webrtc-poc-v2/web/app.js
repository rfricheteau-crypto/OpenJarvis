const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusBadge = document.getElementById('statusBadge');
const stateLabel = document.getElementById('stateLabel');
const stateDetail = document.getElementById('stateDetail');
const conversation = document.getElementById('conversation');
const events = document.getElementById('events');
const orb = document.getElementById('orb');
const remoteAudio = document.getElementById('remoteAudio');

let pc = null;
let stream = null;
let dataChannel = null;
let pingTimer = null;
let sessionId = null;
let manualDisconnect = false;
let remoteStreamRef = null;

const appendEvent = (text) => {
  const line = document.createElement('div');
  line.className = 'event-line';
  line.textContent = `[${new Date().toLocaleTimeString('fr-FR')}] ${text}`;
  events.prepend(line);
};

const appendMessage = (role, text, confidence = null) => {
  const node = document.createElement('div');
  node.className = `entry ${role === 'user' ? 'entry-user' : 'entry-assistant'}`;
  const meta = document.createElement('small');
  meta.textContent = role === 'user'
    ? `Ruth${typeof confidence === 'number' ? ` · confiance ${confidence}` : ''}`
    : 'Hermès';
  const body = document.createElement('div');
  body.textContent = text;
  node.append(meta, body);
  conversation.prepend(node);
};

const setState = (state, detail = '') => {
  stateLabel.textContent = state;
  stateDetail.textContent = detail || '';
  orb.className = 'orb';
  if (state.includes('Ruth') || state.includes('RECORDING')) orb.classList.add('orb-recording');
  else if (state.includes('réfléchit') || state.includes('THINKING')) orb.classList.add('orb-thinking');
  else if (state.includes('parle') || state.includes('SPEAKING')) orb.classList.add('orb-speaking');
};

const setRemoteTrackEnabled = (enabled) => {
  remoteStreamRef?.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
};

const cutRemoteAudio = () => {
  try { remoteAudio.pause(); } catch {}
  remoteAudio.muted = true;
  setRemoteTrackEnabled(false);
  remoteAudio.srcObject = null;
};

const cleanupConnection = () => {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (dataChannel) {
    try { dataChannel.close(); } catch {}
    dataChannel = null;
  }
  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  sessionId = null;
  manualDisconnect = false;
  remoteStreamRef = null;
  setRemoteTrackEnabled(true);
  try { remoteAudio.pause(); } catch {}
  remoteAudio.srcObject = null;
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  statusBadge.textContent = 'Déconnecté';
  statusBadge.className = 'badge badge-idle';
  setState('En attente', 'Connexion coupée.');
};

const connect = async () => {
  manualDisconnect = false;
  connectBtn.disabled = true;
  conversation.innerHTML = '';
  events.innerHTML = '';
  appendEvent('Demande micro...');
  setState('Connexion', 'Création de la session WebRTC...');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    appendEvent('Micro autorisé.');

    pc = new RTCPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && remoteStream !== remoteStreamRef) {
        remoteStreamRef = remoteStream;
        remoteAudio.srcObject = remoteStream;
        void remoteAudio.play().catch((error) => {
          appendEvent(`Lecture audio distante bloquée: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    };

    pc.onconnectionstatechange = () => {
      appendEvent(`WebRTC state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        statusBadge.textContent = 'Connecté';
        statusBadge.className = 'badge badge-live';
      }
      if (['failed', 'closed'].includes(pc.connectionState)) {
        cleanupConnection();
      }
      if (pc.connectionState === 'disconnected') {
        if (manualDisconnect) {
          cleanupConnection();
        } else {
          // Unexpected drop — wait 2s before cleanup (gives ICE a chance to recover)
          const snapPc = pc;
          setTimeout(() => { if (snapPc?.connectionState === 'disconnected') cleanupConnection(); }, 2000);
        }
      }
    };

    dataChannel = pc.createDataChannel('hermes-events');
    dataChannel.onopen = () => {
      appendEvent('Data channel ouvert.');
      dataChannel.send(JSON.stringify({ type: 'client-ready' }));
      pingTimer = window.setInterval(() => {
        if (dataChannel?.readyState === 'open') dataChannel.send(`ping:${Date.now()}`);
      }, 2000);
    };
    dataChannel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'state') {
          setState(payload.state, payload.detail || '');
          appendEvent(`STATE ${payload.state}${payload.detail ? ` · ${payload.detail}` : ''}`);
        } else if (payload.type === 'message') {
          appendMessage(payload.role, payload.text, payload.confidence ?? null);
        } else if (payload.type === 'event') {
          if (payload.name === 'user_speaking' && remoteAudio.srcObject) {
            cutRemoteAudio();
          } else if (payload.name === 'barge_in_start') {
            cutRemoteAudio();
          } else if (payload.name === 'audio_play_start') {
            remoteAudio.muted = false;
            setRemoteTrackEnabled(true);
            if (!remoteAudio.srcObject && remoteStreamRef) {
              remoteAudio.srcObject = remoteStreamRef;
            }
            void remoteAudio.play().catch((error) => {
              appendEvent(`Reprise audio distante bloquée: ${error instanceof Error ? error.message : String(error)}`);
            });
          } else if (payload.name === 'command' && payload.payload?.action) {
            appendEvent(`Commande locale ignorée en mode simple: ${JSON.stringify(payload.payload)}`);
          }
          appendEvent(`${payload.name}${payload.payload ? ` ${JSON.stringify(payload.payload)}` : ''}`);
        }
      } catch {
        appendEvent(`Message brut: ${event.data}`);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch('/api/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Offer failed: ${response.status}${detail ? ` ${detail}` : ''}`);
    }
    const answer = await response.json();
    sessionId = answer.session_id ?? null;
    await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
    appendEvent(`Session prête${sessionId ? ` (${sessionId})` : ''}.`);

    disconnectBtn.disabled = false;
    setState('Connexion établie', 'Attente du signal client-ready puis du greeting Hermès.');
  } catch (error) {
    appendEvent(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
    cleanupConnection();
  }
};

connectBtn.addEventListener('click', () => { void connect(); });
disconnectBtn.addEventListener('click', () => {
  manualDisconnect = true;
  window.focus();
  cleanupConnection();
});

window.addEventListener('pagehide', () => {
  manualDisconnect = true;
  cleanupConnection();
});
