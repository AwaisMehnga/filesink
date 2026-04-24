import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_CLOUD_SIGNALING = '';
const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = CHUNK_SIZE * 64;
const SESSION_STORAGE_KEY = 'secure-p2p-session';
const MAX_ICE_GATHER_WAIT_MS = 1200;
const STATUS_POLL_INTERVAL_MS = 1500;

const waitForIceGatheringComplete = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    let onChange = null;
    const timeout = setTimeout(() => {
      if (onChange) {
        pc.removeEventListener('icegatheringstatechange', onChange);
      }
      resolve();
    }, MAX_ICE_GATHER_WAIT_MS);

    onChange = () => {
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

const isLocalhostHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';
const isPrivateIpv4Hostname = (hostname) => {
  if (!hostname) {
    return false;
  }

  if (hostname.startsWith('10.')) {
    return true;
  }

  if (hostname.startsWith('192.168.')) {
    return true;
  }

  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) {
    return false;
  }

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
};

const getNetworkModeFromBase = (base) => {
  try {
    const { hostname } = new URL(base);
    return isLocalhostHost(hostname) || isPrivateIpv4Hostname(hostname) ? 'lan' : 'internet';
  } catch {
    return 'internet';
  }
};

const buildSigHint = (signalingBase, localIP = '') => {
  try {
    const { hostname, port, protocol } = new URL(signalingBase);
    if (isLocalhostHost(hostname)) {
      if (!localIP) {
        return '';
      }

      return `${protocol}//${localIP}${port ? `:${port}` : ''}`;
    }

    if (isPrivateIpv4Hostname(hostname)) {
      return signalingBase;
    }

    return '';
  } catch {
    return '';
  }
};

const extractCandidateType = (candidate = '') => {
  const match = String(candidate).match(/\btyp\s+([a-z]+)/i);
  return match?.[1]?.toLowerCase() || '';
};

export function useSecureP2PLink() {
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
  const autoJoinRef = useRef('');
  const incomingFileRef = useRef(null);

  const envSignaling = useMemo(() => import.meta.env.VITE_SIGNALING_URL || '', []);
  const stunUrls = useMemo(() => {
    const configured = (import.meta.env.VITE_STUN_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    if (configured.length) {
      return configured;
    }

    return ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
  }, []);
  const turnConfig = useMemo(
    () => ({
      url: import.meta.env.VITE_TURN_URL || '',
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    }),
    [],
  );
  const hasTurnConfigured = useMemo(
    () => Boolean(turnConfig.url && turnConfig.username && turnConfig.credential),
    [turnConfig],
  );
  const hasPartialTurnConfig = useMemo(
    () => Boolean(turnConfig.url || turnConfig.username || turnConfig.credential) && !hasTurnConfigured,
    [hasTurnConfigured, turnConfig],
  );

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

    if (peerSessionPollRef.current) {
      clearInterval(peerSessionPollRef.current);
      peerSessionPollRef.current = null;
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    cleanupPolling();
    incomingFileRef.current = null;

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

  const revokeReceivedFileUrls = useCallback(() => {
    setReceivedFiles((prev) => {
      prev.forEach((file) => {
        try {
          URL.revokeObjectURL(file.url);
        } catch {
          // Ignore URL cleanup errors.
        }
      });
      return [];
    });
  }, []);

  const buildIceServers = useCallback(() => {
    const servers = stunUrls.map((url) => ({ urls: url }));

    if (hasTurnConfigured) {
      servers.push({
        urls: turnConfig.url,
        username: turnConfig.username,
        credential: turnConfig.credential,
      });
    }

    return servers;
  }, [hasTurnConfigured, stunUrls, turnConfig]);

  const diagnoseIceFailure = useCallback(async (pc) => {
    const observedTypes = new Set();

    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          if (report.candidateType) {
            observedTypes.add(report.candidateType);
          }
        }

        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.localCandidateId) {
            const local = stats.get(report.localCandidateId);
            if (local?.candidateType) {
              observedTypes.add(local.candidateType);
            }
          }

          if (report.remoteCandidateId) {
            const remote = stats.get(report.remoteCandidateId);
            if (remote?.candidateType) {
              observedTypes.add(remote.candidateType);
            }
          }
        }
      });
    } catch {
      // Ignore stats errors and fall back to generic guidance.
    }

    if (hasPartialTurnConfig) {
      return 'Connection failed. TURN is only partially configured; set VITE_TURN_URL, VITE_TURN_USERNAME, and VITE_TURN_CREDENTIAL.';
    }

    if (!hasTurnConfigured) {
      return 'Connection failed. Different networks usually need a TURN relay; only STUN is configured right now.';
    }

    if (!observedTypes.size) {
      return 'Connection failed after signaling. TURN is configured, but ICE could not find any usable network path.';
    }

    if (!observedTypes.has('relay')) {
      return `Connection failed. ICE candidates were ${Array.from(observedTypes).join(', ') || 'unavailable'}, but no relay path succeeded.`;
    }

    return 'Connection failed. A relay candidate existed, but the TURN route still did not connect.';
  }, [hasPartialTurnConfig, hasTurnConfigured]);

  const setupPeer = useCallback((peerRole) => {
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 2,
    });

    pc.onicecandidate = (event) => {
      const candidateType = extractCandidateType(event.candidate?.candidate || '');
      if (candidateType) {
        console.debug('[webrtc] local ICE candidate', { type: candidateType, role: peerRole });
      }
    };

    pc.onicecandidateerror = (event) => {
      console.warn('[webrtc] ICE candidate error', {
        role: peerRole,
        address: event.address,
        port: event.port,
        url: event.url,
        errorCode: event.errorCode,
        errorText: event.errorText,
      });
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;

      if (state === 'checking') {
        setConnectionDetail('Exchanging ICE candidates and testing network paths...');
      } else if (state === 'connected' || state === 'completed') {
        setConnectionDetail('ICE connected. Opening secure data channel...');
      } else if (state === 'failed') {
        diagnoseIceFailure(pc).then((message) => {
          if (peerRef.current === pc) {
            setConnectionStatus('Failed');
            setConnectionDetail(message);
          }
        });
      }
    };

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
        cleanupPolling();
        setConnectionStatus('Failed');
        diagnoseIceFailure(pc).then((message) => {
          if (peerRef.current === pc) {
            setConnectionDetail(message);
          }
        });
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
  }, [buildIceServers, cleanupPolling, diagnoseIceFailure]);

  const startStatusPolling = useCallback((base, sessionId, key) => {
    let inFlight = false;

    const pollStatus = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      try {
        const data = await requestJson(`${base}/api/session/${sessionId}/status?key=${encodeURIComponent(key)}`, {}, 4000);
        if (data.status === 'joined') {
          setConnectionStatus('Peer Joined');
          setConnectionDetail('Peer opened your URL and is creating answer.');
        }
        if (data.status === 'answered' || data.status === 'connected') {
          if (sessionStatusPollRef.current) {
            clearInterval(sessionStatusPollRef.current);
            sessionStatusPollRef.current = null;
          }
        }
      } catch {
        // Ignore transient polling errors.
      } finally {
        inFlight = false;
      }
    };

    pollStatus();
    sessionStatusPollRef.current = setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
  }, []);

  const startPeerSessionPolling = useCallback((offerToken, sigHint, signalingBase) => {
    const { sessionId, key } = parseOfferToken(offerToken);
    let inFlight = false;

    const pollSession = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      try {
        const data = await requestJson(
          `${signalingBase}/api/session/${sessionId}/status?key=${encodeURIComponent(key)}`,
          {},
          4000,
        );

        if (data.status === 'answered' || data.status === 'connected') {
          if (peerSessionPollRef.current) {
            clearInterval(peerSessionPollRef.current);
            peerSessionPollRef.current = null;
          }
          return;
        }

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
      } finally {
        inFlight = false;
      }
    };

    pollSession();
    peerSessionPollRef.current = setInterval(pollSession, STATUS_POLL_INTERVAL_MS);
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
    const isLocalhost = isLocalhostHost(window.location.hostname);
    const sameOrigin = window.location.origin;

    if (isLocalhost) {
      return uniqueBases([
        'http://localhost:3000',
        envSignaling,
        DEFAULT_CLOUD_SIGNALING,
      ]);
    }

    return uniqueBases([
      envSignaling,
      sameOrigin,
      DEFAULT_CLOUD_SIGNALING,
    ]);
  }, [envSignaling]);

  const getJoinSignalingCandidates = useCallback((sigHint) => {
    const isLocalhost = isLocalhostHost(window.location.hostname);
    const sameOrigin = window.location.origin;

    if (isLocalhost) {
      return uniqueBases([
        sigHint,
        'http://localhost:3000',
        envSignaling,
        DEFAULT_CLOUD_SIGNALING,
      ]);
    }

    return uniqueBases([
      envSignaling,
      sameOrigin,
      DEFAULT_CLOUD_SIGNALING,
      sigHint,
    ]);
  }, [envSignaling]);

  const buildShareUrl = useCallback((offerToken, sigHint = '') => {
    const params = new URLSearchParams({ offer: offerToken });
    if (sigHint) {
      params.set('sig', sigHint);
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

    setActiveSignalingBase(selectedBase);

    const resolvedSigHint = buildSigHint(selectedBase, updateResult.localIP || '');
    const mode = storedMode || getNetworkModeFromBase(resolvedSigHint || selectedBase);
    setNetworkMode(mode);

    setShareUrl(buildShareUrl(offerToken, resolvedSigHint));

    setStoredSession({
      offerToken,
      role: 'host',
      signalingBase: selectedBase,
      networkMode: mode,
      sigHint: resolvedSigHint,
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
        throw new Error(
          isLocalhostHost(window.location.hostname)
            ? 'Unable to reach signaling server'
            : 'Public signaling server is not configured or unreachable. Set VITE_SIGNALING_URL for live deploys.',
        );
      }

      const { sessionId, key } = parseOfferToken(createdSession.offerToken);
      setActiveSignalingBase(selectedBase);

      const persistedSigHint = buildSigHint(selectedBase, createdSession.localIP || '');
      setNetworkMode(getNetworkModeFromBase(persistedSigHint || selectedBase));

      const shareLink = buildShareUrl(createdSession.offerToken, persistedSigHint);
      setShareUrl(shareLink);

      setStoredSession({
        offerToken: createdSession.offerToken,
        role: 'host',
        signalingBase: selectedBase,
        networkMode: getNetworkModeFromBase(persistedSigHint || selectedBase),
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
    buildShareUrl,
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
            if (err?.status && err.status !== 404) {
              break;
            }
          }
        }

        if (!sessionData || !selectedBase) {
          clearStoredSession();
          throw (
            lastError
            || new Error(
              isLocalhostHost(window.location.hostname)
                ? 'Offer was not found, expired, or already used'
                : 'Offer could not be loaded from a public signaling server. Check VITE_SIGNALING_URL or the shared link.',
            )
          );
        }

        setActiveSignalingBase(selectedBase);
        setNetworkMode(getNetworkModeFromBase(selectedBase));

        setStoredSession({
          offerToken,
          role: 'peer',
          signalingBase: selectedBase,
          networkMode: getNetworkModeFromBase(selectedBase),
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

  const selectFiles = useCallback((files) => {
    setSelectedFiles(Array.from(files || []));
  }, []);

  const clearAllFiles = useCallback(() => {
    setSelectedFiles([]);
    setCurrentSendName('');
    setSendProgress(0);
    setCurrentReceiveName('');
    setReceiveProgress(0);
    incomingFileRef.current = null;
    revokeReceivedFileUrls();
  }, [revokeReceivedFileUrls]);

  const disconnect = useCallback(() => {
    cleanupConnection();
    clearStoredSession();
    clearAllFiles();
    setShareUrl('');
    setRole('host');
    setError('');
    setActiveSignalingBase('');
    setNetworkMode('internet');
    setIsSending(false);
    setConnectionStatus('Idle');
    setConnectionDetail('Create a secure connection URL.');
    autoJoinRef.current = '';

    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, '', cleanUrl);
  }, [cleanupConnection, clearAllFiles]);

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
      revokeReceivedFileUrls();
      autoJoinRef.current = '';
    };
  }, [cleanupConnection, joinFromOfferToken, resumeHostSession, revokeReceivedFileUrls]);

  return {
    connectionStatus,
    connectionDetail,
    shareUrl,
    role,
    error,
    activeSignalingBase,
    networkMode,
    selectedFiles,
    isSending,
    sendProgress,
    currentSendName,
    receiveProgress,
    currentReceiveName,
    receivedFiles,
    isConnected: connectionStatus === 'Connected',
    formatSize,
    createConnectionUrl,
    selectFiles,
    sendSelectedFiles,
    disconnect,
    clearAllFiles,
  };
}
