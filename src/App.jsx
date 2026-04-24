import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileText,
  Link2,
  Share2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = CHUNK_SIZE * 32;

const waitForIceGatheringComplete = (peerConnection) =>
  new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const handleStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        peerConnection.removeEventListener('icegatheringstatechange', handleStateChange);
        resolve();
      }
    };

    peerConnection.addEventListener('icegatheringstatechange', handleStateChange);
  });

const waitForChannelCapacity = (channel) =>
  new Promise((resolve) => {
    if (channel.bufferedAmount <= BUFFER_LIMIT) {
      resolve();
      return;
    }

    const handleBufferedAmountLow = () => {
      if (channel.bufferedAmount <= BUFFER_LIMIT) {
        channel.removeEventListener('bufferedamountlow', handleBufferedAmountLow);
        resolve();
      }
    };

    channel.bufferedAmountLowThreshold = CHUNK_SIZE * 8;
    channel.addEventListener('bufferedamountlow', handleBufferedAmountLow);
  });

const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** exponent;
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const createTransferId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function App() {
  const [activeTab, setActiveTab] = useState('connect');
  const [connectionState, setConnectionState] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('Generate a shareable link to connect with another device.');
  const [error, setError] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [transferProgress, setTransferProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [currentTransferName, setCurrentTransferName] = useState('');
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);

  // Server and connection states
  const [serverUrl, setServerUrl] = useState('');
  const [currentOfferId, setCurrentOfferId] = useState('');
  const [isPollingAnswer, setIsPollingAnswer] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [isLAN, setIsLAN] = useState(false);

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const incomingTransferRef = useRef(null);
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const cleanupPeer = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onclose = null;
      channelRef.current.onmessage = null;
      channelRef.current.close();
      channelRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.ondatachannel = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.ontrack = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    incomingTransferRef.current = null;
  }, []);

  useEffect(() => () => cleanupPeer(), [cleanupPeer]);

  // Initialize server and handle URL parameters
  useEffect(() => {
    const initServer = async () => {
      // Set up server URL - prefer production
      const url = import.meta.env.VITE_SERVER_URL || 
                  (typeof window !== 'undefined' && window.location.origin.includes('pages.dev')
                    ? window.location.origin.replace(/\.pages\.dev/, '-worker.pages.dev')
                    : window.location.origin);
      
      setServerUrl(url);

      // Check for offer parameter in URL
      const params = new URLSearchParams(window.location.search);
      const offerId = params.get('offer');
      
      if (offerId) {
        setCurrentOfferId(offerId);
        setConnectionState('connecting');
        setStatusMessage('Loading shared connection...');
        
        try {
          const response = await fetch(`${url}/api/offer/${offerId}`);
          if (response.ok) {
            const data = await response.json();
            setStatusMessage('Creating answer...');
            await joinOfferLink(offerId, data.offer);
          } else {
            setError('Connection expired or invalid. Generate a new link.');
            setConnectionState('idle');
          }
        } catch (err) {
          setError(`Could not load connection: ${err.message}`);
          setConnectionState('idle');
        }
      }
    };

    initServer();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const setupDataChannel = useCallback((channel) => {
    channel.onopen = () => {
      setConnectionState('connected');
      setStatusMessage('Connected! Ready to transfer files.');
      setActiveTab('transfer');
    };

    channel.onclose = () => {
      setConnectionState('idle');
      setStatusMessage('Connection closed.');
    };

    channel.onmessage = async (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);

          if (message.type === 'file-start') {
            incomingTransferRef.current = {
              transferId: message.transferId,
              name: message.name,
              size: message.size,
              mime: message.mime,
              chunks: [],
              receivedBytes: 0,
            };
            setCurrentTransferName(message.name);
            setTransferProgress(0);
          } else if (message.type === 'file-end') {
            const transfer = incomingTransferRef.current;
            if (transfer && transfer.transferId === message.transferId) {
              const blob = new Blob(transfer.chunks, { type: transfer.mime });
              const url = URL.createObjectURL(blob);
              setReceivedFiles((prev) => [...prev, { name: transfer.name, url, size: transfer.size }]);
              setTransferProgress(0);
              setCurrentTransferName('');
              incomingTransferRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
        return;
      }

      const transfer = incomingTransferRef.current;
      if (!transfer) return;

      transfer.chunks.push(new Uint8Array(data));
      transfer.receivedBytes += data.byteLength;
      setTransferProgress(Math.min(100, Math.floor((transfer.receivedBytes / transfer.size) * 100)));
    };

    channelRef.current = channel;
  }, []);

  const setupPeerConnection = useCallback(() => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        setError('Connection failed. Check your network.');
        setConnectionState('idle');
        cleanupPeer();
      }
    };

    peer.onicecandidate = () => {};
    peer.ontrack = () => {};
    peerRef.current = peer;
    return peer;
  }, [cleanupPeer]);

  const updateConnectionState = useCallback((nextState, message) => {
    setConnectionState(nextState);
    if (message) setStatusMessage(message);
    if (nextState === 'connected') setActiveTab('transfer');
  }, []);

  const createOfferLink = useCallback(async () => {
    try {
      setError(null);
      setStatusMessage('Creating link...');
      setConnectionState('connecting');
      setShareLink('');
      setIsLAN(false);

      const peer = setupPeerConnection();
      const channel = peer.createDataChannel('file-transfer', { ordered: true });
      setupDataChannel(channel);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGatheringComplete(peer);

      const response = await fetch(`${serverUrl}/api/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: peer.localDescription }),
      });

      if (!response.ok) throw new Error('Failed to create link');
      
      const { offerId, link } = await response.json();
      setCurrentOfferId(offerId);
      setShareLink(link);
      setStatusMessage('Link created! Share it with another device.');
      updateConnectionState('awaiting-peer');
      
      pollForAnswer(offerId);
    } catch (err) {
      setError(`Failed to create link: ${err.message}`);
      updateConnectionState('idle');
    }
  }, [serverUrl, setupPeerConnection, setupDataChannel, updateConnectionState]);

  const joinOfferLink = useCallback(async (offerId, offerDescription) => {
    try {
      setError(null);
      setConnectionState('connecting');

      const peer = setupPeerConnection();
      await peer.setRemoteDescription(offerDescription);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGatheringComplete(peer);

      const response = await fetch(`${serverUrl}/api/answer/${offerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: peer.localDescription }),
      });

      if (!response.ok) throw new Error('Failed to send answer');
      setStatusMessage('Connected!');
      updateConnectionState('connected');
    } catch (err) {
      setError(`Could not join: ${err.message}`);
      updateConnectionState('idle');
    }
  }, [serverUrl, setupPeerConnection, updateConnectionState]);

  const pollForAnswer = (offerId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setIsPollingAnswer(true);

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${serverUrl}/api/answer/${offerId}`);

        if (response.ok) {
          const data = await response.json();
          clearInterval(pollInterval);
          setIsPollingAnswer(false);

          if (!peerRef.current) throw new Error('Peer connection lost');
          await peerRef.current.setRemoteDescription(data.answer);
          setStatusMessage('Connected!');
          updateConnectionState('connected');
        }
      } catch (err) {
        console.log('Waiting for peer...');
      }
    }, 1000);

    pollIntervalRef.current = pollInterval;
  };

  const resetSession = useCallback(() => {
    cleanupPeer();
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    
    setConnectionState('idle');
    setStatusMessage('Generate a shareable link to connect with another device.');
    setError(null);
    setSelectedFiles([]);
    setTransferProgress(0);
    setIsTransferring(false);
    setCurrentTransferName('');
    setCurrentOfferId('');
    setIsPollingAnswer(false);
    setShareLink('');
  }, [cleanupPeer]);

  const handleFileSelect = useCallback((files) => {
    setSelectedFiles(Array.from(files));
  }, []);

  const sendSelectedFiles = useCallback(async () => {
    const channel = channelRef.current;

    if (!channel || channel.readyState !== 'open' || selectedFiles.length === 0) {
      return;
    }

    try {
      setError(null);
      setIsTransferring(true);
      setTransferProgress(0);

      const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0) || 1;
      let sentBytes = 0;

      for (const file of selectedFiles) {
        const transferId = createTransferId();
        setCurrentTransferName(file.name);
        channel.send(
          JSON.stringify({
            type: 'file-start',
            transferId,
            name: file.name,
            size: file.size,
            mime: file.type,
          })
        );

        const buffer = await file.arrayBuffer();
        let offset = 0;

        while (offset < buffer.byteLength) {
          await waitForChannelCapacity(channel);
          const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
          channel.send(chunk);
          offset += chunk.byteLength;
          sentBytes += chunk.byteLength;
          setTransferProgress(Math.min(100, Math.floor((sentBytes / totalBytes) * 100)));
        }

        channel.send(JSON.stringify({ type: 'file-end', transferId }));
      }

      setStatusMessage(`Sent ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}.`);
      setSelectedFiles([]);
    } catch (err) {
      setError(`Transfer failed: ${err.message}`);
    } finally {
      setIsTransferring(false);
    }
  }, [selectedFiles]);

  const downloadFile = (file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.click();
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className="min-h-screen bg-slate-950 text-white overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at top left, rgba(45,212,191,0.18), transparent 28%), radial-gradient(circle at top right, rgba(251,191,36,0.12), transparent 30%), linear-gradient(180deg, #050b13 0%, #091423 45%, #04070d 100%)',
      }}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 shadow-[0_12px_48px_rgba(20,184,166,0.25)]">
              <Share2 size={22} className="text-cyan-300" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-[0.18em] text-white uppercase">PeerWire</h1>
              <p className="text-xs text-slate-400">Direct P2P file transfer</p>
            </div>
          </div>

          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
            connectionState === 'connected' ? 'bg-emerald-400/20 text-emerald-300' :
            connectionState === 'awaiting-peer' ? 'bg-cyan-400/20 text-cyan-300' :
            'bg-slate-700/50 text-slate-300'
          }`}>
            {connectionState === 'connected' && <Wifi size={14} />}
            {connectionState !== 'idle' && <div className="h-2 w-2 rounded-full bg-current animate-pulse" />}
            {connectionState.replace('-', ' ').toUpperCase()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-10">
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-100">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mb-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => setActiveTab('connect')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === 'connect'
                ? 'bg-cyan-300 text-slate-950'
                : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
            }`}
          >
            <Link2 size={16} className="mr-2 inline" />
            Connect
          </button>
          <button
            onClick={() => setActiveTab('transfer')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === 'transfer'
                ? 'bg-cyan-300 text-slate-950'
                : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
            }`}
          >
            <Upload size={16} className="mr-2 inline" />
            Transfer
          </button>
          <button
            onClick={resetSession}
            className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Reset
          </button>
        </div>

        {activeTab === 'connect' && (
          <div className="space-y-6">
            <div className="rounded-4xl border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300 text-slate-950">
                  1
                </div>
                <h3 className="text-xl font-semibold text-white">Generate Link</h3>
              </div>

              <button
                onClick={createOfferLink}
                disabled={connectionState === 'connecting'}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-4 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-300"
              >
                <Link2 size={18} />
                Create Shareable Link
              </button>

              {shareLink && (
                <div className="mt-6 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                      Share this link
                    </label>
                    {isPollingAnswer && <span className="text-xs text-cyan-300 animate-pulse">Waiting...</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareLink}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(shareLink)}
                      className="rounded-lg bg-cyan-400/20 px-3 py-2 font-semibold text-cyan-300 transition hover:bg-cyan-400/30"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <p className="font-semibold text-white mb-2">How it works:</p>
                <ul className="space-y-2 text-xs">
                  <li>✓ Same WiFi: Direct fast LAN connection</li>
                  <li>✓ Different networks: Secure internet connection</li>
                  <li>✓ No server storage: True P2P</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'transfer' && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Send Files */}
            <div className="rounded-4xl border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl md:p-8">
              <h3 className="text-xl font-semibold text-white mb-6">Send Files</h3>

              <div
                onDragEnter={() => setDragActive(true)}
                onDragLeave={() => setDragActive(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  handleFileSelect(e.dataTransfer.files);
                }}
                className={`relative rounded-3xl border-2 border-dashed transition ${
                  dragActive ? 'border-cyan-300 bg-cyan-500/10' : 'border-white/20 bg-white/5'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files ?? [])}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
                  <Upload size={40} className="mb-3 text-cyan-300/50" />
                  <p className="text-sm font-semibold text-white">Drag files here or click to select</p>
                  <p className="text-xs text-slate-400 mt-2">Multiple files supported</p>
                </div>
              </div>

              {selectedFiles.length > 0 && (
                <div className="mt-6 space-y-3">
                  {selectedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <FileText size={18} className="text-cyan-300 shrink-0" />
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-semibold text-white truncate">{file.name}</p>
                          <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={sendSelectedFiles}
                    disabled={connectionState !== 'connected' || isTransferring}
                    className="w-full rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-300"
                  >
                    {isTransferring ? `Sending... ${transferProgress}%` : 'Send Files'}
                  </button>
                </div>
              )}
            </div>

            {/* Receive Files */}
            <div className="rounded-4xl border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl md:p-8">
              <h3 className="text-xl font-semibold text-white mb-6">Received Files</h3>

              {receivedFiles.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 text-center">
                  <Download size={40} className="mb-3 text-slate-400/50" />
                  <p className="text-sm text-slate-400">Files will appear here when received</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {receivedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <FileText size={18} className="text-emerald-300 shrink-0" />
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-semibold text-white truncate">{file.name}</p>
                          <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => downloadFile(file)}
                        className="rounded-lg bg-emerald-400/20 p-2 text-emerald-300 transition hover:bg-emerald-400/30"
                      >
                        <Download size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
          <p>Your data stays between you. No files pass through any server.</p>
        </div>
      </main>
    </div>
  );
}

export default App;
