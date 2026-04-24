export default function ConnectionScreen({
  role,
  shareUrl,
  connectionStatus,
  connectionDetail,
  activeSignalingBase,
  networkMode,
  error,
  onGenerateUrl,
}) {
  return (
    <>
      <h1>Secure P2P Link</h1>

      {role === 'host' && (
        <button type="button" className="primary-btn" onClick={onGenerateUrl}>
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
  );
}
