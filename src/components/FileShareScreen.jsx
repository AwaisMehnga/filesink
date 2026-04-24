import { Download, Files, Power, Send, Trash2 } from 'lucide-react';

const ghostButtonClass =
  'inline-flex w-full items-center justify-center gap-2 border border-zinc-300 px-4 py-3 text-sm font-medium text-black transition hover:border-black hover:bg-brand-500 hover:text-white sm:w-auto';

const primaryButtonClass =
  'inline-flex w-full items-center justify-center gap-2 border border-brand-500 bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';

const panelClass = 'min-w-0 grid gap-4 overflow-hidden border border-zinc-300 p-4 sm:p-6';

export default function FileShareScreen({
  selectedFiles,
  isSending,
  sendProgress,
  currentSendName,
  receiveProgress,
  currentReceiveName,
  receivedFiles,
  connectionStatus,
  error,
  formatSize,
  onSelectFiles,
  onSendFiles,
  onDisconnect,
  onClearAllFiles,
}) {
  return (
    <div className="grid gap-5 sm:gap-6">
      <div className="grid gap-2.5 sm:gap-3">
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.24em] text-zinc-500 sm:text-[0.7rem] sm:tracking-[0.34em]">
          local transfer
        </p>
        <h1 className="text-[2rem] leading-[0.9] font-semibold uppercase tracking-[-0.08em] text-zinc-950 sm:text-6xl">
          LAN link is live.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base sm:leading-7">
          Queue files, send them across your local network, and download them from the same workspace.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="inline-flex min-w-0 items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-zinc-700 sm:text-xs sm:tracking-[0.18em]">
          <span className="truncate">{connectionStatus}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
            <p className="break-words text-sm leading-6 text-zinc-700">
              sending: <span className="font-medium text-zinc-950">{currentSendName}</span> / {sendProgress}%
            </p>
          )}
          {currentReceiveName && (
            <p className="break-words text-sm leading-6 text-zinc-700">
              receiving: <span className="font-medium text-zinc-950">{currentReceiveName}</span> / {receiveProgress}%
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={panelClass}>
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-3 sm:pb-4">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-700 sm:text-[0.72rem] sm:tracking-[0.22em]">
              queued files
            </span>
            <Files size={16} className="text-black" />
          </div>

          {selectedFiles.length > 0 ? (
            <div className="scrollbar-hidden min-w-0 grid max-h-80 gap-3 overflow-y-auto pr-1">
              {selectedFiles.map((file) => (
                <div
                  className="grid min-w-0 gap-2 border border-zinc-200 bg-white px-3 py-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-4"
                  key={`${file.name}-${file.size}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Files size={15} className="shrink-0 text-black" />
                    <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
                  </div>
                  <span className="shrink-0 text-xs uppercase tracking-[0.12em] text-zinc-500 sm:text-right">
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
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-3 sm:pb-4">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-700 sm:text-[0.72rem] sm:tracking-[0.22em]">
              received files
            </span>
            <Download size={16} className="text-black" />
          </div>

          {receivedFiles.length > 0 ? (
            <div className="scrollbar-hidden min-w-0 grid max-h-80 gap-3 overflow-y-auto pr-1">
              {receivedFiles.map((file) => (
                <a
                  className="grid min-w-0 gap-2 border border-zinc-200 bg-white px-3 py-3 transition hover:border-black sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-4"
                  key={file.id}
                  href={file.url}
                  download={file.name}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Files size={15} className="shrink-0 text-black" />
                    <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-zinc-500 sm:justify-end">
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
