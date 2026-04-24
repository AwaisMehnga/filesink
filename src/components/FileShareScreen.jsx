export default function FileShareScreen({
  selectedFiles,
  isSending,
  sendProgress,
  currentSendName,
  receiveProgress,
  currentReceiveName,
  receivedFiles,
  connectionStatus,
  networkMode,
  error,
  formatSize,
  onSelectFiles,
  onSendFiles,
}) {
  return (
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
        onChange={(event) => onSelectFiles(event.target.files)}
      />

      {selectedFiles.length > 0 && (
        <div className="list-block">
          {selectedFiles.map((file) => (
            <p key={`${file.name}-${file.size}`}>{file.name} ({formatSize(file.size)})</p>
          ))}
        </div>
      )}

      <button type="button" className="primary-btn" disabled={!selectedFiles.length || isSending} onClick={onSendFiles}>
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
  );
}
