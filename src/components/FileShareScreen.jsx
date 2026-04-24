import { Download, Files, Power, Send, Trash2 } from 'lucide-react';

const ghostButtonClass =
  'inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-3 text-sm font-medium text-black transition hover:border-black hover:bg-brand-500 hover:text-white';

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 border border-brand-500 bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50';

const panelClass = 'min-w-0 grid gap-4 overflow-hidden border border-zinc-300 p-5 sm:p-6';

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
  onDisconnect,
  onClearAllFiles,
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.34em] text-zinc-500">
          transfer grid
        </p>
        <h1 className="text-4xl font-semibold uppercase tracking-[-0.06em] text-zinc-950 sm:text-6xl">
          File lane is live.
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
          Queue files, send them across, and download them from the same centered workspace.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="inline-flex items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700">
          <span>{connectionStatus}</span>
        </div>
        <div className="inline-flex items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700">
          <span>{networkMode.toUpperCase()}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className={ghostButtonClass} htmlFor="file-input">
          <Files size={14} />
          <span>Choose Files</span>
        </label>

        <button
          type="button"
          className={primaryButtonClass}
          disabled={!selectedFiles.length || isSending}
          onClick={onSendFiles}
        >
          <Send size={14} />
          <span>{isSending ? 'Sending...' : 'Send Files'}</span>
        </button>

        <button type="button" className={ghostButtonClass} onClick={onDisconnect}>
          <Power size={14} />
          <span>Disconnect</span>
        </button>

        <button type="button" className={ghostButtonClass} onClick={onClearAllFiles}>
          <Trash2 size={14} />
          <span>Clear All Files</span>
        </button>
      </div>

      <input
        id="file-input"
        className="hidden"
        type="file"
        multiple
        onChange={(event) => onSelectFiles(event.target.files)}
      />

      {(isSending || currentReceiveName) && (
        <div className="grid gap-2 border border-zinc-300 bg-white p-4">
          {isSending && (
            <p className="text-sm text-zinc-700">
              sending: <span className="font-medium text-zinc-950">{currentSendName}</span> / {sendProgress}%
            </p>
          )}
          {currentReceiveName && (
            <p className="text-sm text-zinc-700">
              receiving: <span className="font-medium text-zinc-950">{currentReceiveName}</span> / {receiveProgress}%
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={panelClass}>
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-4">
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-zinc-700">
              queued files
            </span>
            <Files size={16} className="text-black" />
          </div>

          {selectedFiles.length > 0 ? (
            <div className="scrollbar-hidden min-w-0 grid max-h-80 gap-3 overflow-y-auto pr-1">
              {selectedFiles.map((file) => (
                <div
                  className="flex min-w-0 items-center justify-between gap-3 border border-zinc-200 bg-white px-4 py-3"
                  key={`${file.name}-${file.size}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Files size={15} className="shrink-0 text-black" />
                    <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
                  </div>
                  <span className="shrink-0 text-xs uppercase tracking-[0.12em] text-zinc-500">
                    {formatSize(file.size)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">no files queued</p>
          )}
        </section>

        <section className={panelClass}>
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-4">
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-zinc-700">
              received files
            </span>
            <Download size={16} className="text-black" />
          </div>

          {receivedFiles.length > 0 ? (
            <div className="scrollbar-hidden min-w-0 grid max-h-80 gap-3 overflow-y-auto pr-1">
              {receivedFiles.map((file) => (
                <a
                  className="flex min-w-0 items-center justify-between gap-3 border border-zinc-200 bg-white px-4 py-3 transition hover:border-black"
                  key={file.id}
                  href={file.url}
                  download={file.name}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Files size={15} className="shrink-0 text-black" />
                    <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-zinc-500">
                    <span className="text-xs uppercase tracking-[0.12em]">{formatSize(file.size)}</span>
                    <Download size={15} className="text-black" />
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">nothing received yet</p>
          )}
        </section>
      </div>

      {error && <p className="text-sm font-medium text-black">error: {error}</p>}
    </div>
  );
}
