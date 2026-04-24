import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_CLOUD_SIGNALING = '';
const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = CHUNK_SIZE * 64;
const SESSION_STORAGE_KEY = 'secure-p2p-session';
const MAX_ICE_GATHER_WAIT_MS = 1200;

const waitForIceGatheringComplete = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }, MAX_ICE_GATHER_WAIT_MS);

    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };

    pc.addEventListener('icegatheringstatechange', onChange);
  });

const parseOfferToken = (offerToken) => {
  const [sessionId, key] = (offerToken || '').split('.');
  if (!sessionId || !key) {
    throw new Error('Invalid offer token.');
  }
  return { sessionId, key };
};

const requestJson = async (url, options = {}, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const uniqueBases = (bases) => {
  const seen = new Set();
  return bases
    .map((base) => base?.trim())
    .filter((base) => {
      if (!base || seen.has(base)) {
        return false;
      }
      seen.add(base);
      return true;
    });
};

const waitForChannelCapacity = (channel) =>
  new Promise((resolve) => {
    if (channel.bufferedAmount <= BUFFER_LIMIT) {
      resolve();
      return;
    }

    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };

    channel.bufferedAmountLowThreshold = CHUNK_SIZE * 16;
    channel.addEventListener('bufferedamountlow', onLow);
  });

const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const getStoredSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const setStoredSession = (session) => {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage errors.
  }
};

const clearStoredSession = () => {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

function App() {
  const [connectionStatus, setConnectionStatus] = useState('Idle');
  const [connectionDetail, setConnectionDetail] = useState('Create a secure connection URL.');
  const [shareUrl, setShareUrl] = useState('');
  const [role, setRole] = useState('host');
  const [error, setError] = useState('');
  const [activeSignalingBase, setActiveSignalingBase] = useState('');
  const [networkMode, setNetworkMode] = useState('internet');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [currentSendName, setCurrentSendName] = useState('');
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [currentReceiveName, setCurrentReceiveName] = useState('');
  const [receivedFiles, setReceivedFiles] = useState([]);

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const answerPollRef = useRef(null);
  const sessionStatusPollRef = useRef(null);
  const peerSessionPollRef = useRef(null);
  const hostReconnectTimeoutRef = useRef(null);
  const hostReconnectInFlightRef = useRef(false);
  const peerReconnectInFlightRef = useRef(false);
  const joinFromOfferTokenRef = useRef(null);
  const resumeHostSessionRef = useRef(null);
  const sessionRef = useRef({ sessionId: '', key: '' });
  const autoJoinRef = useRef('');
  const incomingFileRef = useRef(null);

  const envSignaling = useMemo(() => import.meta.env.VITE_SIGNALING_URL || '', []);

  const cleanupPolling = useCallback(() => {
    if (answerPollRef.current) {
      clearInterval(answerPollRef.current);
      answerPollRef.current = null;
    }

    if (sessionStatusPollRef.current) {
      clearInterval(sessionStatusPollRef.current);
      sessionStatusPollRef.current = null;
    }

    if (hostReconnectTimeoutRef.current) {
      clearTimeout(hostReconnectTimeoutRef.current);
      hostReconnectTimeoutRef.current = null;
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    cleanupPolling();
    incomingFileRef.current = null;

    if (peerSessionPollRef.current) {
      clearInterval(peerSessionPollRef.current);
      peerSessionPollRef.current = null;
    }

    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onclose = null;
      channelRef.current.close();
      channelRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.ondatachannel = null;
      peerRef.current.close();
      peerRef.current = null;
    }
  }, [cleanupPolling]);

  const sendSelectedFiles = useCallback(async () => {
    if (!channelRef.current || channelRef.current.readyState !== 'open') {
      setError('Channel is not open. Reconnect and try again.');
      return;
    }

    if (!selectedFiles.length) {
      return;
    }

    setError('');
    setIsSending(true);

    try {
      for (const file of selectedFiles) {
        const transferId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        const total = file.size;
        let sent = 0;

        setCurrentSendName(file.name);
        setSendProgress(0);

        channelRef.current.send(
          JSON.stringify({
            type: 'file-meta',
            transferId,
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
          }),
        );

        while (sent < total) {
          const chunk = file.slice(sent, sent + CHUNK_SIZE);
          const bytes = await chunk.arrayBuffer();
          channelRef.current.send(bytes);

          sent += bytes.byteLength;
          setSendProgress(Math.floor((sent / total) * 100));

          if (channelRef.current.bufferedAmount > BUFFER_LIMIT) {
            await waitForChannelCapacity(channelRef.current);
          }
        }

        channelRef.current.send(JSON.stringify({ type: 'file-end', transferId }));
      }

      setSelectedFiles([]);
      setCurrentSendName('');
      setSendProgress(0);
    } catch (err) {
      setError(err.message || 'File send failed.');
    } finally {
      setIsSending(false);
    }
  }, [selectedFiles]);

  const buildIceServers = useCallback(() => {
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
      servers.push({
        urls: import.meta.env.VITE_TURN_URL,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL,
      });
    }

    return servers;
  }, []);

  const setupPeer = useCallback((peerRole) => {
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 2,
    });

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        cleanupPolling();
        setConnectionStatus('Connected');
        setConnectionDetail('Direct secure WebRTC tunnel established.');
      } else if (state === 'connecting') {
        setConnectionStatus('Connecting');
        setConnectionDetail('Negotiating secure peer channel...');
      } else if (state === 'failed') {
        setConnectionStatus('Failed');
        setConnectionDetail('Connection failed. Check network or TURN setup.');
      } else if (state === 'disconnected' || state === 'closed') {
        setConnectionStatus('Closed');
        setConnectionDetail('Peer disconnected.');

        if (
          peerRole === 'host'
          && !hostReconnectTimeoutRef.current
          && getStoredSession()?.role === 'host'
        ) {
          hostReconnectTimeoutRef.current = setTimeout(() => {
            hostReconnectTimeoutRef.current = null;

            if (hostReconnectInFlightRef.current) {
              return;
            }

            const storedSession = getStoredSession();
            if (!storedSession?.offerToken || storedSession.role !== 'host') {
              return;
            }

            hostReconnectInFlightRef.current = true;
            setConnectionStatus('Reconnecting');
            setConnectionDetail('Peer disconnected. Publishing a fresh secure offer...');

            const reconnect = resumeHostSessionRef.current?.(storedSession);
            if (!reconnect) {
              hostReconnectInFlightRef.current = false;
              return;
            }

            reconnect
              .catch((err) => {
                clearStoredSession();
                setError(err.message || 'Could not restore host session.');
              })
              .finally(() => {
                hostReconnectInFlightRef.current = false;
              });
          }, 1200);
        }
      }
    };

    peerRef.current = pc;
    return pc;
  }, [buildIceServers, cleanupPolling]);

  const startStatusPolling = useCallback((base, sessionId, key) => {
    const pollStatus = async () => {
      try {
        const data = await requestJson(`${base}/api/session/${sessionId}/status?key=${encodeURIComponent(key)}`, {}, 4000);
        if (data.status === 'joined') {
          setConnectionStatus('Peer Joined');
          setConnectionDetail('Peer opened your URL and is creating answer.');
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    pollStatus();
    sessionStatusPollRef.current = setInterval(pollStatus, 500);
  }, []);

  const startPeerSessionPolling = useCallback((offerToken, sigHint, signalingBase) => {
    const { sessionId, key } = parseOfferToken(offerToken);

    const pollSession = async () => {
      try {
        const data = await requestJson(
          `${signalingBase}/api/session/${sessionId}/status?key=${encodeURIComponent(key)}`,
          {},
          4000,
        );

        if (data.status !== 'waiting' || peerReconnectInFlightRef.current) {
          return;
        }

        const currentState = peerRef.current?.connectionState;
        if (currentState === 'connecting') {
          return;
        }

        peerReconnectInFlightRef.current = true;
        const reconnect = joinFromOfferTokenRef.current?.(offerToken, sigHint || signalingBase);
        if (!reconnect) {
          peerReconnectInFlightRef.current = false;
          return;
        }

        reconnect.finally(() => {
          peerReconnectInFlightRef.current = false;
        });
      } catch {
        // Ignore transient polling errors.
      }
    };

    pollSession();
    peerSessionPollRef.current = setInterval(pollSession, 500);
  }, []);

  const beginHostAnswerPolling = useCallback((base, sessionId, key) => {
    const pollAnswer = async () => {
      if (!peerRef.current) {
        return;
      }

      try {
        const response = await fetch(`${base}/api/session/${sessionId}/answer?key=${encodeURIComponent(key)}`);
        if (response.status === 202) {
          return;
        }

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Unable to fetch answer');
        }

          if (data.answer && peerRef.current.signalingState !== 'closed') {
          clearInterval(answerPollRef.current);
          answerPollRef.current = null;
          await peerRef.current.setRemoteDescription(data.answer);
            setConnectionStatus('Peer Connected');
            setConnectionDetail('Peer answer accepted. Finalizing encrypted data channel.');
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    pollAnswer();
    answerPollRef.current = setInterval(pollAnswer, 400);
  }, []);

  const setSecureChannelHandlers = useCallback(() => {
    if (!channelRef.current) {
      return;
    }

    channelRef.current.binaryType = 'arraybuffer';

    channelRef.current.onopen = () => {
      cleanupPolling();
      setConnectionStatus('Connected');
      setConnectionDetail('Secure data channel open (DTLS encrypted).');

      try {
        channelRef.current.send(JSON.stringify({ type: 'peer-ready', at: Date.now() }));
      } catch {
        // Ignore transient send errors.
      }
    };

    channelRef.current.onclose = () => {
      setConnectionStatus('Closed');
      setConnectionDetail('Secure channel closed.');
    };

    channelRef.current.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);

          if (message?.type === 'peer-ready') {
            cleanupPolling();
            setConnectionStatus('Connected');
            setConnectionDetail('Peer is connected and ready.');
            return;
          }

          if (message?.type === 'file-meta') {
            incomingFileRef.current = {
              transferId: message.transferId,
              name: message.name,
              size: message.size,
              mime: message.mime || 'application/octet-stream',
              chunks: [],
              received: 0,
            };
            setCurrentReceiveName(message.name);
            setReceiveProgress(0);
            return;
          }

          if (message?.type === 'file-end' && incomingFileRef.current?.transferId === message.transferId) {
            const transfer = incomingFileRef.current;
            const blob = new Blob(transfer.chunks, { type: transfer.mime });
            const url = URL.createObjectURL(blob);

            setReceivedFiles((prev) => [
              ...prev,
              {
                id: transfer.transferId,
                name: transfer.name,
                size: transfer.size,
                url,
              },
            ]);

            incomingFileRef.current = null;
            setCurrentReceiveName('');
            setReceiveProgress(0);
          }
        } catch {
          // Ignore non-control messages.
        }

        return;
      }

      if (!incomingFileRef.current) {
        return;
      }

      let bytes = event.data;
      if (event.data instanceof Blob) {
        bytes = await event.data.arrayBuffer();
      }

      if (!(bytes instanceof ArrayBuffer)) {
        return;
      }

      incomingFileRef.current.chunks.push(bytes);
      incomingFileRef.current.received += bytes.byteLength;
      setReceiveProgress(Math.floor((incomingFileRef.current.received / incomingFileRef.current.size) * 100));
    };
  }, [cleanupPolling]);

  const getHostSignalingCandidates = useCallback(() => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return uniqueBases([
      'http://localhost:3000',
      envSignaling,
      isLocalhost ? '' : DEFAULT_CLOUD_SIGNALING,
    ]);
  }, [envSignaling]);

  const getJoinSignalingCandidates = useCallback((sigHint) => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return uniqueBases([
      sigHint,
      envSignaling,
      'http://localhost:3000',
      isLocalhost ? '' : DEFAULT_CLOUD_SIGNALING,
    ]);
  }, [envSignaling]);

  const buildShareUrl = useCallback((offerToken, signalingBase, localIP = '') => {
    const params = new URLSearchParams({ offer: offerToken });
    if (signalingBase === 'http://localhost:3000' && localIP) {
      params.set('sig', `http://${localIP}:3000`);
    }
    return `${window.location.origin}/?${params.toString()}`;
  }, []);

  const resumeHostSession = useCallback(async (stored) => {
    const { offerToken, signalingBase: storedBase, networkMode: storedMode } = stored || {};
    if (!offerToken || !storedBase) {
      throw new Error('No stored host session found.');
    }

    const { sessionId, key } = parseOfferToken(offerToken);
    const candidates = uniqueBases([storedBase]);

    cleanupConnection();
    setRole('host');
    setError('');
    setConnectionStatus('Reconnecting');
    setConnectionDetail('Restoring host session after reload...');

    const pc = setupPeer('host');
    const channel = pc.createDataChannel('secure-link', { ordered: true });
    channelRef.current = channel;
    setSecureChannelHandlers();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    let selectedBase = '';
    let updateResult = null;

    for (const base of candidates) {
      try {
        const data = await requestJson(
          `${base}/api/session/${sessionId}/offer?key=${encodeURIComponent(key)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ offer: pc.localDescription }),
          },
          5000,
        );
        selectedBase = base;
        updateResult = data;
        break;
      } catch {
        // Try next signaling endpoint.
      }
    }

    if (!selectedBase || !updateResult) {
      clearStoredSession();
      throw new Error('Stored session expired or signaling server changed. Generate a new URL.');
    }

    sessionRef.current = { sessionId, key };
    setActiveSignalingBase(selectedBase);

    const mode = storedMode || (selectedBase === 'http://localhost:3000' ? 'lan' : 'internet');
    setNetworkMode(mode);

    const shareUrl = buildShareUrl(offerToken, selectedBase, updateResult.localIP || '');
    setShareUrl(shareUrl);

    setStoredSession({
      offerToken,
      role: 'host',
      signalingBase: selectedBase,
      networkMode: mode,
      sigHint: selectedBase === 'http://localhost:3000' && updateResult.localIP ? `http://${updateResult.localIP}:3000` : '',
    });

    setConnectionStatus('Awaiting Peer');
    setConnectionDetail('Session restored. Waiting for peer to reconnect.');

    startStatusPolling(selectedBase, sessionId, key);
    beginHostAnswerPolling(selectedBase, sessionId, key);
  }, [
    beginHostAnswerPolling,
    buildShareUrl,
    cleanupConnection,
    setSecureChannelHandlers,
    setupPeer,
    startStatusPolling,
  ]);

  const createConnectionUrl = useCallback(async () => {
    try {
      setError('');
      setRole('host');
      setShareUrl('');
      cleanupConnection();
      setConnectionStatus('Creating Offer');
      setConnectionDetail('Preparing secure WebRTC offer...');

      const pc = setupPeer('host');
      const channel = pc.createDataChannel('secure-link', { ordered: true });
      channelRef.current = channel;
      setSecureChannelHandlers();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const candidates = getHostSignalingCandidates();
      let createdSession = null;
      let selectedBase = '';

      for (const base of candidates) {
        try {
          const data = await requestJson(
            `${base}/api/session`,
            {
              method: 'POST',
              body: JSON.stringify({ offer: pc.localDescription }),
            },
            5000,
          );

          createdSession = data;
          selectedBase = base;
          break;
        } catch {
          // Try the next signaling endpoint.
        }
      }

      if (!createdSession || !selectedBase) {
        throw new Error('Unable to reach signaling server');
      }

      const { sessionId, key } = parseOfferToken(createdSession.offerToken);
      sessionRef.current = { sessionId, key };
      setActiveSignalingBase(selectedBase);

      const params = new URLSearchParams({
        offer: createdSession.offerToken,
      });

      if (selectedBase === 'http://localhost:3000' && createdSession.localIP) {
        params.set('sig', `http://${createdSession.localIP}:3000`);
        setNetworkMode('lan');
      } else {
        setNetworkMode('internet');
      }

      const url = `${window.location.origin}/?${params.toString()}`;
      setShareUrl(url);

      const persistedSigHint = selectedBase === 'http://localhost:3000' && createdSession.localIP ? `http://${createdSession.localIP}:3000` : '';
      setStoredSession({
        offerToken: createdSession.offerToken,
        role: 'host',
        signalingBase: selectedBase,
        networkMode: selectedBase === 'http://localhost:3000' ? 'lan' : 'internet',
        sigHint: persistedSigHint,
      });

      setConnectionStatus('Awaiting Peer');
      setConnectionDetail('Share URL with one peer. Session expires automatically.');

      startStatusPolling(selectedBase, sessionId, key);
      beginHostAnswerPolling(selectedBase, sessionId, key);
    } catch (err) {
      setError(err.message || 'Failed to generate URL');
      setConnectionStatus('Idle');
      setConnectionDetail('Try generating a new URL.');
    }
  }, [
    beginHostAnswerPolling,
    cleanupConnection,
    getHostSignalingCandidates,
    setSecureChannelHandlers,
    setupPeer,
    startStatusPolling,
  ]);

  const joinFromOfferToken = useCallback(
    async (offerToken, sigHint) => {
      try {
        setError('');
        setRole('peer');
        cleanupConnection();
        setConnectionStatus('Joining');
        setConnectionDetail('Loading secure offer from signaling service...');

        const { sessionId, key } = parseOfferToken(offerToken);
        sessionRef.current = { sessionId, key };

        const candidates = getJoinSignalingCandidates(sigHint);
        let sessionData = null;
        let selectedBase = '';

        let lastError = null;

        for (const base of candidates) {
          try {
            const data = await requestJson(`${base}/api/session/${sessionId}?key=${encodeURIComponent(key)}`, {}, 5000);
            sessionData = data;
            selectedBase = base;
            break;
          } catch (err) {
            lastError = err;
            // If the endpoint confirms the session exists but is already used/blocked,
            // stop fallback to avoid leaking into unrelated endpoints.
            if (err?.status && err.status !== 404) {
              break;
            }
          }
        }

        if (!sessionData || !selectedBase) {
          clearStoredSession();
          throw lastError || new Error('Offer was not found, expired, or already used');
        }

        setActiveSignalingBase(selectedBase);
        setNetworkMode(selectedBase.startsWith('http://192.') || selectedBase.startsWith('http://10.') ? 'lan' : 'internet');

        setStoredSession({
          offerToken,
          role: 'peer',
          signalingBase: selectedBase,
          networkMode: selectedBase.startsWith('http://192.') || selectedBase.startsWith('http://10.') ? 'lan' : 'internet',
          sigHint,
        });

        const pc = setupPeer('peer');
        pc.ondatachannel = (event) => {
          channelRef.current = event.channel;
          setSecureChannelHandlers();
        };

        await pc.setRemoteDescription(sessionData.offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(pc);

        await requestJson(
          `${selectedBase}/api/session/${sessionId}/answer?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            body: JSON.stringify({ answer: pc.localDescription }),
          },
          5000,
        );

        setConnectionStatus('Answer Sent');
        setConnectionDetail('Waiting for host to finalize secure connection.');
        startPeerSessionPolling(offerToken, sigHint, selectedBase);
      } catch (err) {
        if (err?.status === 403 || err?.status === 404) {
          clearStoredSession();
        }
        setError(err.message || 'Failed to join connection');
        setConnectionStatus('Idle');
        setConnectionDetail('Open a valid URL and try again.');
      }
    },
    [cleanupConnection, getJoinSignalingCandidates, setSecureChannelHandlers, setupPeer, startPeerSessionPolling],
  );

  useEffect(() => {
    resumeHostSessionRef.current = resumeHostSession;
    joinFromOfferTokenRef.current = joinFromOfferToken;
  }, [joinFromOfferToken, resumeHostSession]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const offer = params.get('offer');
    const sig = params.get('sig');

    if (offer) {
      if (autoJoinRef.current === offer) {
        return () => {
          cleanupConnection();
        };
      }

      autoJoinRef.current = offer;
      queueMicrotask(() => {
        joinFromOfferToken(offer, sig || '');
      });
      return () => {
        cleanupConnection();
      };
    }

    const stored = getStoredSession();
    if (stored?.offerToken && stored?.role === 'host') {
      queueMicrotask(() => {
        resumeHostSession(stored).catch((err) => {
            clearStoredSession();
          setError(err.message || 'Could not restore host session.');
        });
      });
    }

    if (stored?.offerToken && stored?.role === 'peer') {
      queueMicrotask(() => {
        joinFromOfferToken(stored.offerToken, stored.sigHint || stored.signalingBase || '').catch(() => {
          // Error is handled inside joinFromOfferToken.
        });
      });
    }

    return () => {
      cleanupConnection();
    };
  }, [cleanupConnection, joinFromOfferToken, resumeHostSession]);

  const showTransferScreen = connectionStatus === 'Connected';

  return (
    <main className="app-shell">
      <section className="card">
        {!showTransferScreen ? (
          <>
            <h1>Secure P2P Link</h1>

            {role === 'host' && (
              <button type="button" className="primary-btn" onClick={createConnectionUrl}>
                Generate URL
              </button>
            )}

            {shareUrl && (
              <textarea
                className="share-url"
                readOnly
                value={shareUrl}
                aria-label="Generated secure URL"
              />
            )}

            <p>Status: {connectionStatus}</p>
            <p>{connectionDetail}</p>

            {activeSignalingBase && <p>Signaling: {activeSignalingBase}</p>}
            <p>Mode: {networkMode.toUpperCase()}</p>

            {error && <p className="error">Error: {error}</p>}
          </>
        ) : (
          <>
            <h1>File Transfer</h1>
            <p>Connection is secure and ready.</p>

            <label className="file-picker" htmlFor="file-input">
              Choose files
            </label>
            <input
              id="file-input"
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                setSelectedFiles(files);
              }}
            />

            {selectedFiles.length > 0 && (
              <div className="list-block">
                {selectedFiles.map((file) => (
                  <p key={`${file.name}-${file.size}`}>{file.name} ({formatSize(file.size)})</p>
                ))}
              </div>
            )}

            <button type="button" className="primary-btn" disabled={!selectedFiles.length || isSending} onClick={sendSelectedFiles}>
              {isSending ? 'Sending...' : 'Send files'}
            </button>

            {isSending && <p>Sending {currentSendName} - {sendProgress}%</p>}
            {currentReceiveName && <p>Receiving {currentReceiveName} - {receiveProgress}%</p>}

            <h2>Received files</h2>
            {receivedFiles.length > 0 ? (
              <div className="list-block">
                {receivedFiles.map((file) => (
                  <a key={file.id} href={file.url} download={file.name}>
                    {file.name} ({formatSize(file.size)})
                  </a>
                ))}
              </div>
            ) : (
              <p>No files received yet.</p>
            )}

            <p>Status: {connectionStatus}</p>
            <p>Mode: {networkMode.toUpperCase()}</p>
            {error && <p className="error">Error: {error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

export default App;
