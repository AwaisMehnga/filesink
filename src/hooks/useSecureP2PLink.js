import { useCallback, useEffect, useRef, useState } from 'react';

const SIGNALING_BASE = 'http://localhost:3000';
const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = CHUNK_SIZE * 64;
const MAX_ICE_GATHER_WAIT_MS = 1200;

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
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
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

export function useSecureP2PLink() {
  const [connectionStatus, setConnectionStatus] = useState('Idle');
  const [connectionDetail, setConnectionDetail] = useState('Generate a LAN link and open it from another device on the same network.');
  const [shareUrl, setShareUrl] = useState('');
  const [role, setRole] = useState('host');
  const [error, setError] = useState('');
  const [activeSignalingBase, setActiveSignalingBase] = useState('');
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
  const autoJoinRef = useRef('');
  const incomingFileRef = useRef(null);

  const cleanupPolling = useCallback(() => {
    if (answerPollRef.current) {
      clearInterval(answerPollRef.current);
      answerPollRef.current = null;
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    cleanupPolling();
    incomingFileRef.current = null;

    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onclose = null;
      channelRef.current.onmessage = null;
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

  const setSecureChannelHandlers = useCallback(() => {
    if (!channelRef.current) {
      return;
    }

    channelRef.current.binaryType = 'arraybuffer';

    channelRef.current.onopen = () => {
      cleanupPolling();
      setConnectionStatus('Connected');
      setConnectionDetail('Secure data channel open.');
    };

    channelRef.current.onclose = () => {
      setConnectionStatus('Closed');
      setConnectionDetail('Channel closed.');
    };

    channelRef.current.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);

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

  const setupPeer = useCallback((peerRole) => {
    const pc = new RTCPeerConnection();

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        cleanupPolling();
        setConnectionStatus('Connected');
        setConnectionDetail('Direct LAN connection established.');
      } else if (state === 'connecting') {
        setConnectionStatus('Connecting');
        setConnectionDetail('Connecting to peer on the same network...');
      } else if (state === 'failed') {
        cleanupPolling();
        setConnectionStatus('Failed');
        setConnectionDetail('Connection failed. Make sure both devices are on the same network.');
      } else if (state === 'disconnected' || state === 'closed') {
        setConnectionStatus('Closed');
        setConnectionDetail('Peer disconnected.');
      }
    };

    if (peerRole === 'peer') {
      pc.ondatachannel = (event) => {
        channelRef.current = event.channel;
        setSecureChannelHandlers();
      };
    }

    peerRef.current = pc;
    return pc;
  }, [cleanupPolling, setSecureChannelHandlers]);

  const buildShareUrl = useCallback((offerToken, localIP) => {
    const params = new URLSearchParams({ offer: offerToken });
    if (localIP) {
      params.set('sig', `http://${localIP}:3000`);
    }
    return `${window.location.origin}/?${params.toString()}`;
  }, []);

  const beginHostAnswerPolling = useCallback((sessionId, key) => {
    const pollAnswer = async () => {
      if (!peerRef.current) {
        return;
      }

      try {
        const response = await fetch(`${SIGNALING_BASE}/api/session/${sessionId}/answer?key=${encodeURIComponent(key)}`);
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
          setConnectionStatus('Peer Joined');
          setConnectionDetail('Peer connected. Finishing secure channel setup.');
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    pollAnswer();
    answerPollRef.current = setInterval(pollAnswer, 500);
  }, []);

  const createConnectionUrl = useCallback(async () => {
    try {
      setError('');
      setRole('host');
      setShareUrl('');
      cleanupConnection();
      setConnectionStatus('Creating Offer');
      setConnectionDetail('Preparing local network connection...');

      const pc = setupPeer('host');
      const channel = pc.createDataChannel('secure-link', { ordered: true });
      channelRef.current = channel;
      setSecureChannelHandlers();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const createdSession = await requestJson(
        `${SIGNALING_BASE}/api/session`,
        {
          method: 'POST',
          body: JSON.stringify({ offer: pc.localDescription }),
        },
        5000,
      );

      const { sessionId, key } = parseOfferToken(createdSession.offerToken);
      setActiveSignalingBase(SIGNALING_BASE);
      setShareUrl(buildShareUrl(createdSession.offerToken, createdSession.localIP || ''));
      setConnectionStatus('Awaiting Peer');
      setConnectionDetail('Share this link with a device on the same network.');

      beginHostAnswerPolling(sessionId, key);
    } catch (err) {
      setError(err.message || 'Failed to generate URL');
      setConnectionStatus('Idle');
      setConnectionDetail('Start the local signaling server and try again.');
    }
  }, [beginHostAnswerPolling, buildShareUrl, cleanupConnection, setSecureChannelHandlers, setupPeer]);

  const joinFromOfferToken = useCallback(
    async (offerToken, sigHint) => {
      try {
        setError('');
        setRole('peer');
        cleanupConnection();
        setConnectionStatus('Joining');
        setConnectionDetail('Loading offer from local signaling server...');

        const { sessionId, key } = parseOfferToken(offerToken);
        const signalingBase = sigHint || SIGNALING_BASE;
        const sessionData = await requestJson(
          `${signalingBase}/api/session/${sessionId}?key=${encodeURIComponent(key)}`,
          {},
          5000,
        );

        setActiveSignalingBase(signalingBase);

        const pc = setupPeer('peer');
        await pc.setRemoteDescription(sessionData.offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(pc);

        await requestJson(
          `${signalingBase}/api/session/${sessionId}/answer?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            body: JSON.stringify({ answer: pc.localDescription }),
          },
          5000,
        );

        setConnectionStatus('Answer Sent');
        setConnectionDetail('Waiting for the host to finish the LAN connection.');
      } catch (err) {
        setError(err.message || 'Failed to join connection');
        setConnectionStatus('Idle');
        setConnectionDetail('Open a valid LAN link and try again.');
      }
    },
    [cleanupConnection, setupPeer],
  );

  const sendSelectedFiles = useCallback(async () => {
    if (!channelRef.current || channelRef.current.readyState !== 'open') {
      setError('Channel is not open.');
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
    clearAllFiles();
    setShareUrl('');
    setRole('host');
    setError('');
    setActiveSignalingBase('');
    setIsSending(false);
    setConnectionStatus('Idle');
    setConnectionDetail('Generate a LAN link and open it from another device on the same network.');
    autoJoinRef.current = '';

    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, '', cleanUrl);
  }, [cleanupConnection, clearAllFiles]);

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
    }

    return () => {
      cleanupConnection();
      revokeReceivedFileUrls();
      autoJoinRef.current = '';
    };
  }, [cleanupConnection, joinFromOfferToken, revokeReceivedFileUrls]);

  return {
    connectionStatus,
    connectionDetail,
    shareUrl,
    role,
    error,
    activeSignalingBase,
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
