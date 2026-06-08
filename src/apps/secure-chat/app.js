// ===== Secure Chat — P2P video + chat (PeerJS + WebRTC) =====
// All functions are declared at top level so the inline on* handlers in
// content.html can reach them. Persistent state (identity + contacts) lives in
// localStorage; nothing is sent to a qurix server — only the PeerJS signaling
// server and a public STUN server are used to establish the direct connection.

// ===== STATE =====
let peer = null;
let currentCall = null;
let dataConnection = null;
let localStream = null;
let identity = null;
let contacts = [];
let pendingOffer = null;
let isInitiator = false;
let micEnabled = true;
let camEnabled = true;
let pendingIdentity = null;

const PEERJS_CONFIG = {
    // Free PeerJS cloud signaling server. For production, host your own:
    // https://github.com/peers/peerjs-server
    debug: 1
};

const WORD_LIST = [
    'ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EAGLE', 'FALCON', 'TIGER', 'LION',
    'MAPLE', 'CEDAR', 'RIVER', 'STORM', 'CLOUD', 'SUNNY', 'FROST', 'BLAZE',
    'CORAL', 'JADE', 'RUBY', 'PEARL', 'NOVA', 'LUNA', 'STAR', 'COMET',
    'BRAVE', 'SWIFT', 'BOLD', 'WISE', 'CALM', 'KEEN', 'TRUE', 'PURE'
];

// ===== INITIALIZATION =====
async function init() {
    await loadOrCreateIdentity();
    loadContacts();
    renderContacts();
    // Media is requested lazily (only when a call starts) so opening the app
    // does not immediately trigger a camera/microphone permission prompt.
    connectToPeerServer();
    checkUrlForOffer();
}

async function loadOrCreateIdentity() {
    const stored = localStorage.getItem('secureChat_identity');
    if (stored) {
        identity = JSON.parse(stored);
        document.getElementById('myId').textContent = identity.shortId;
        return;
    }

    // Generate new identity
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
    );

    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Generate short ID from public key hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyRaw);
    const hashArray = new Uint8Array(hashBuffer);
    const shortId = `${WORD_LIST[hashArray[0] % WORD_LIST.length]}-${WORD_LIST[hashArray[1] % WORD_LIST.length]}-${(hashArray[2] % 90) + 10}`;

    identity = {
        shortId,
        publicKey: publicKeyB64,
        privateKey: privateKeyJwk
    };

    localStorage.setItem('secureChat_identity', JSON.stringify(identity));
    document.getElementById('myId').textContent = identity.shortId;
}

function loadContacts() {
    const stored = localStorage.getItem('secureChat_contacts');
    contacts = stored ? JSON.parse(stored) : [];
}

function saveContacts() {
    localStorage.setItem('secureChat_contacts', JSON.stringify(contacts));
}

// ===== PEERJS CONNECTION =====
function connectToPeerServer() {
    updateServerStatus('connecting', 'Verbinde mit Server…');

    // Use shortId as PeerJS ID
    peer = new Peer(identity.shortId.replace(/-/g, '').toLowerCase(), PEERJS_CONFIG);

    peer.on('open', (id) => {
        console.log('Connected to PeerJS with ID:', id);
        updateServerStatus('online', `Online als ${identity.shortId}`);
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
            updateServerStatus('online', `Online als ${identity.shortId}`);
        } else {
            updateServerStatus('offline', 'Server nicht erreichbar – Offline-Modus');
        }
    });

    peer.on('disconnected', () => {
        updateServerStatus('offline', 'Verbindung verloren – Offline-Modus');
        setTimeout(() => peer.reconnect(), 3000);
    });

    peer.on('call', handleIncomingCall);
    peer.on('connection', handleDataConnection);
}

function updateServerStatus(status, text) {
    const dot = document.getElementById('serverStatus');
    dot.className = 'sc-dot ' + status;
    document.getElementById('serverStatusText').textContent = text;
}

// ===== MEDIA =====
async function startMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true
        });
        document.getElementById('localVideo').srcObject = localStream;
    } catch (err) {
        console.error('Media error:', err);
        // Continue without media - chat still works
    }
}

// Acquire camera/mic on demand; returns the stream (or null if denied).
async function ensureMedia() {
    if (localStream) return localStream;
    await startMedia();
    return localStream;
}

function toggleMic() {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    document.getElementById('toggleMicBtn').className = micEnabled ? '' : 'muted';
    document.getElementById('toggleMicBtn').textContent = micEnabled ? '🎤' : '🔇';
}

function toggleCam() {
    if (!localStream) return;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    document.getElementById('toggleCamBtn').className = camEnabled ? '' : 'muted';
    document.getElementById('toggleCamBtn').textContent = camEnabled ? '📹' : '📷';
}

// ===== QUICK CALL (PeerJS) =====
async function quickCall() {
    const targetId = document.getElementById('callIdInput').value.trim().toUpperCase();
    if (!targetId || !validateId(targetId)) {
        alert('Bitte gültige ID eingeben (z. B. EAGLE-RIVER-77)');
        return;
    }

    if (!peer || peer.disconnected) {
        alert('Nicht mit Server verbunden. Nutze den Offline-Modus.');
        return;
    }

    await ensureMedia();

    isInitiator = true;
    const peerId = targetId.replace(/-/g, '').toLowerCase();

    document.getElementById('quickCallBtn').disabled = true;
    document.getElementById('quickCallBtn').textContent = 'Rufe an…';

    // Establish data connection first
    dataConnection = peer.connect(peerId, { reliable: true });

    dataConnection.on('open', () => {
        console.log('Data connection established');

        // Send our identity
        dataConnection.send({
            type: 'identity',
            shortId: identity.shortId,
            publicKey: identity.publicKey
        });

        // Start call
        if (localStream) {
            currentCall = peer.call(peerId, localStream);
            setupCallHandlers(currentCall);
        }

        showVideoSection(targetId);
    });

    dataConnection.on('data', handleDataMessage);

    dataConnection.on('error', (err) => {
        console.error('Connection error:', err);
        alert('Verbindung fehlgeschlagen. Ist der Partner online?');
        resetCallUI();
    });

    // Timeout
    setTimeout(() => {
        if (!dataConnection || !dataConnection.open) {
            alert('Partner nicht erreichbar. Versuche Offline-Modus.');
            resetCallUI();
        }
    }, 10000);
}

function handleIncomingCall(call) {
    console.log('Incoming call from:', call.peer);
    currentCall = call;

    // Show modal after we have identity from data connection
    // The data connection should arrive first or simultaneously
}

function handleDataConnection(conn) {
    console.log('Incoming data connection from:', conn.peer);
    dataConnection = conn;

    conn.on('open', () => {
        console.log('Data connection open');
    });

    conn.on('data', (data) => {
        handleDataMessage(data);

        if (data.type === 'identity' && currentCall) {
            showIncomingCall(data.shortId, data.publicKey);
        } else if (data.type === 'identity') {
            // Data came before call, store it
            pendingIdentity = data;
        }
    });
}

function showIncomingCall(callerId, publicKey) {
    document.getElementById('callerName').textContent = getContactName(callerId) || 'Unbekannt';
    document.getElementById('callerId').textContent = callerId;

    // Check if known contact
    const contact = contacts.find(c => c.shortId === callerId);
    const warningEl = document.getElementById('callerWarning');

    if (!contact) {
        warningEl.innerHTML = '<div class="sc-alert warning">⚠️ Neuer Kontakt – Verifiziere die ID!</div>';
    } else if (contact.publicKey !== publicKey) {
        warningEl.innerHTML = '<div class="sc-alert danger">🚨 WARNUNG: Schlüssel hat sich geändert!</div>';
    } else {
        warningEl.innerHTML = '<div class="sc-alert info">✓ Verifizierter Kontakt</div>';
    }

    pendingIdentity = { shortId: callerId, publicKey };
    document.getElementById('incomingCallModal').classList.add('active');
}

async function acceptCall() {
    closeModal('incomingCallModal');

    // Save/update contact
    if (pendingIdentity) {
        addOrUpdateContact(pendingIdentity.shortId, pendingIdentity.publicKey);
    }

    await ensureMedia();

    // Answer call
    if (currentCall && localStream) {
        currentCall.answer(localStream);
        setupCallHandlers(currentCall);
    }

    // Send our identity
    if (dataConnection && dataConnection.open) {
        dataConnection.send({
            type: 'identity',
            shortId: identity.shortId,
            publicKey: identity.publicKey
        });
    }

    showVideoSection(pendingIdentity?.shortId || 'Partner');
}

function rejectCall() {
    closeModal('incomingCallModal');
    if (currentCall) currentCall.close();
    if (dataConnection) dataConnection.close();
    currentCall = null;
    dataConnection = null;
}

function setupCallHandlers(call) {
    call.on('stream', (remoteStream) => {
        console.log('Received remote stream');
        document.getElementById('remoteVideo').srcObject = remoteStream;
        document.getElementById('remoteNoVideo').classList.add('hidden');
    });

    call.on('close', () => {
        console.log('Call ended');
        addSystemMessage('Anruf beendet');
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
    });
}

// ===== OFFLINE MODE =====
async function createOfflineOffer() {
    document.getElementById('offlineOfferModal').classList.add('active');
    document.getElementById('offlineOfferStatus').classList.remove('hidden');
    document.getElementById('offlineOfferReady').classList.add('hidden');

    isInitiator = true;

    await ensureMedia();

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    const dc = pc.createDataChannel('chat');
    setupOfflineDataChannel(dc);

    pendingOffer = { pc, dc };

    pc.onicecandidate = (e) => {
        if (!e.candidate) {
            // ICE gathering complete
            const offerData = {
                type: 'offer',
                sdp: pc.localDescription,
                identity: {
                    shortId: identity.shortId,
                    publicKey: identity.publicKey
                }
            };

            const encoded = btoa(JSON.stringify(offerData));
            document.getElementById('offlineOfferText').value = encoded;
            document.getElementById('offlineOfferStatus').classList.add('hidden');
            document.getElementById('offlineOfferReady').classList.remove('hidden');
        }
    };

    pc.ontrack = (e) => {
        document.getElementById('remoteVideo').srcObject = e.streams[0];
        document.getElementById('remoteNoVideo').classList.add('hidden');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
}

function setupOfflineDataChannel(dc) {
    dc.onopen = () => {
        console.log('Offline data channel open');
        dataConnection = { send: (data) => dc.send(JSON.stringify(data)), open: true };
    };

    dc.onmessage = (e) => {
        try {
            handleDataMessage(JSON.parse(e.data));
        } catch {
            handleDataMessage({ type: 'chat', text: e.data });
        }
    };
}

function copyOfflineOffer() {
    const text = document.getElementById('offlineOfferText').value;
    navigator.clipboard.writeText(text);
    alert('Kopiert!');
}

async function shareOfflineOffer() {
    const text = document.getElementById('offlineOfferText').value;
    if (navigator.share) {
        await navigator.share({
            title: 'Secure Chat Einladung',
            text: `Tritt meinem sicheren Videochat bei:\n\n${text}`
        });
    } else {
        copyOfflineOffer();
    }
}

function showPasteOffer() {
    document.getElementById('pasteOfferText').value = '';
    document.getElementById('pasteOfferModal').classList.add('active');
}

async function processPastedData() {
    const text = document.getElementById('pasteOfferText').value.trim();
    try {
        const data = JSON.parse(atob(text));

        if (data.type === 'offer') {
            await handleOfflineOffer(data);
        } else if (data.type === 'answer') {
            await handleOfflineAnswer(data);
        }

        closeModal('pasteOfferModal');
    } catch (err) {
        alert('Ungültiger Code: ' + err.message);
    }
}

async function handleOfflineOffer(data) {
    isInitiator = false;

    // Verify/save contact
    addOrUpdateContact(data.identity.shortId, data.identity.publicKey);

    await ensureMedia();

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ondatachannel = (e) => {
        setupOfflineDataChannel(e.channel);
    };

    pc.ontrack = (e) => {
        document.getElementById('remoteVideo').srcObject = e.streams[0];
        document.getElementById('remoteNoVideo').classList.add('hidden');
    };

    pc.onicecandidate = (e) => {
        if (!e.candidate) {
            const answerData = {
                type: 'answer',
                sdp: pc.localDescription,
                identity: {
                    shortId: identity.shortId,
                    publicKey: identity.publicKey
                }
            };

            const encoded = btoa(JSON.stringify(answerData));

            // Show answer to copy
            document.getElementById('offlineOfferText').value = encoded;
            document.getElementById('offlineOfferStatus').classList.add('hidden');
            document.getElementById('offlineOfferReady').classList.remove('hidden');
            document.getElementById('offlineOfferReady').querySelector('.sc-alert').innerHTML =
                '📤 Sende diese Antwort zurück an deinen Partner!';
            document.getElementById('offlineOfferModal').classList.add('active');
        }
    };

    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    pendingOffer = { pc };
    showVideoSection(data.identity.shortId);
}

async function handleOfflineAnswer(data) {
    if (!pendingOffer || !pendingOffer.pc) {
        alert('Kein ausstehender Anruf gefunden');
        return;
    }

    addOrUpdateContact(data.identity.shortId, data.identity.publicKey);
    await pendingOffer.pc.setRemoteDescription(data.sdp);

    closeModal('offlineOfferModal');
    showVideoSection(data.identity.shortId);
}

function showPasteAnswer() {
    document.getElementById('pasteAnswerText').value = '';
    document.getElementById('pasteAnswerModal').classList.add('active');
}

async function processAnswer() {
    const text = document.getElementById('pasteAnswerText').value.trim();
    try {
        const data = JSON.parse(atob(text));
        if (data.type === 'answer') {
            await handleOfflineAnswer(data);
        }
        closeModal('pasteAnswerModal');
    } catch (err) {
        alert('Ungültiger Code: ' + err.message);
    }
}

// ===== DATA MESSAGES =====
function handleDataMessage(data) {
    console.log('Received data:', data);

    switch (data.type) {
        case 'identity':
            addOrUpdateContact(data.shortId, data.publicKey);
            document.getElementById('remoteLabel').textContent =
                getContactName(data.shortId) || data.shortId;
            break;
        case 'chat':
            addMessage(data.text, 'received');
            break;
    }
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;

    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'chat', text });
        addMessage(text, 'sent');
        input.value = '';
    } else if (pendingOffer && pendingOffer.dc && pendingOffer.dc.readyState === 'open') {
        pendingOffer.dc.send(JSON.stringify({ type: 'chat', text }));
        addMessage(text, 'sent');
        input.value = '';
    }
}

function addMessage(text, type) {
    const messages = document.getElementById('messages');
    const msg = document.createElement('div');
    msg.className = 'sc-message ' + type;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
    addMessage(text, 'system');
}

// ===== CONTACTS =====
function addOrUpdateContact(shortId, publicKey, name = null) {
    const existing = contacts.findIndex(c => c.shortId === shortId);

    if (existing >= 0) {
        if (contacts[existing].publicKey !== publicKey) {
            console.warn('Public key changed for', shortId);
            // Could show warning here
        }
        contacts[existing].publicKey = publicKey;
        contacts[existing].lastSeen = Date.now();
    } else {
        contacts.push({
            shortId,
            publicKey,
            name: name || null,
            addedAt: Date.now(),
            lastSeen: Date.now()
        });
    }

    saveContacts();
    renderContacts();
}

function getContactName(shortId) {
    const contact = contacts.find(c => c.shortId === shortId);
    return contact?.name || null;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderContacts() {
    const list = document.getElementById('contactList');

    if (contacts.length === 0) {
        list.innerHTML = '<div class="sc-empty">Noch keine Kontakte</div>';
        return;
    }

    list.innerHTML = contacts.map(c => {
        const safeId = escapeHtml(c.shortId);
        const name = escapeHtml(c.name || 'Unbenannt');
        const initial = escapeHtml((c.name || c.shortId)[0]);
        return `
            <div class="sc-contact-item" onclick="callContact('${safeId}')">
                <div class="sc-avatar">${initial}</div>
                <div class="sc-cinfo">
                    <div class="sc-cname">${name}</div>
                    <div class="sc-cid">${safeId}</div>
                </div>
                <div class="sc-cstatus" id="status-${c.shortId.replace(/-/g, '')}"></div>
            </div>
        `;
    }).join('');
}

function callContact(shortId) {
    document.getElementById('callIdInput').value = shortId;
    quickCall();
}

function showAddContact() {
    document.getElementById('newContactId').value = '';
    document.getElementById('newContactName').value = '';
    document.getElementById('addContactModal').classList.add('active');
}

function addContact() {
    const id = document.getElementById('newContactId').value.trim().toUpperCase();
    const name = document.getElementById('newContactName').value.trim();

    if (!validateId(id)) {
        alert('Ungültige ID');
        return;
    }

    addOrUpdateContact(id, '', name);
    closeModal('addContactModal');
}

// ===== UI HELPERS =====
function showVideoSection(partnerId) {
    document.getElementById('mainSection').classList.add('hidden');
    document.getElementById('videoSection').classList.add('active');
    document.getElementById('remoteLabel').textContent =
        getContactName(partnerId) || partnerId;
    addSystemMessage('Verbunden mit ' + partnerId);
}

function hangup() {
    if (currentCall) currentCall.close();
    if (dataConnection) dataConnection.close();
    if (pendingOffer?.pc) pendingOffer.pc.close();

    currentCall = null;
    dataConnection = null;
    pendingOffer = null;

    document.getElementById('mainSection').classList.remove('hidden');
    document.getElementById('videoSection').classList.remove('active');
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('remoteNoVideo').classList.remove('hidden');
    document.getElementById('messages').innerHTML = '';

    resetCallUI();
}

function resetCallUI() {
    document.getElementById('quickCallBtn').disabled = false;
    document.getElementById('quickCallBtn').textContent = '📞 Anrufen';
    document.getElementById('callIdInput').value = '';
}

function switchTab(tab) {
    document.querySelectorAll('.sc-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sc-tab-content').forEach(t => t.classList.remove('active'));

    document.querySelector(`.sc-tab[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function validateId(id) {
    return /^[A-Z]+-[A-Z]+-\d{2}$/.test(id);
}

function formatIdInput(input) {
    let val = input.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    input.value = val;
}

function copyMyId() {
    navigator.clipboard.writeText(identity.shortId);
    alert('ID kopiert: ' + identity.shortId);
}

async function shareMyId() {
    if (navigator.share) {
        await navigator.share({
            title: 'Meine Secure Chat ID',
            text: `Ruf mich an auf Secure Chat: ${identity.shortId}`
        });
    } else {
        copyMyId();
    }
}

function checkUrlForOffer() {
    const hash = window.location.hash.slice(1);
    if (hash) {
        try {
            document.getElementById('pasteOfferText').value = hash;
            processPastedData();
            window.location.hash = '';
        } catch (e) {
            console.error('Invalid URL offer:', e);
        }
    }
}

// ===== qurix snapshot hooks =====
// "Export with data" carries only the CONTACTS list (short IDs, names, public
// keys) to another device — never the private signing key, which stays on this
// device in localStorage. "Export blank" yields a clean copy with no contacts.
window.qurixApp = window.qurixApp || {};
window.qurixApp.serializeState = function () {
    try { return { contacts: JSON.parse(localStorage.getItem('secureChat_contacts') || '[]') }; }
    catch (_) { return { contacts: [] }; }
};
window.qurixApp.hydrateState = function (s) {
    if (!s || !Array.isArray(s.contacts) || !s.contacts.length) return;
    loadContacts();
    const byId = new Map(contacts.map(c => [c.shortId, c]));
    s.contacts.forEach(c => { if (c && c.shortId) byId.set(c.shortId, c); });
    contacts = Array.from(byId.values());
    saveContacts();
    renderContacts();
};

// ===== START =====
init();
