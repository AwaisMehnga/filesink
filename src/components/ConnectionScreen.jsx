import { useEffect, useState } from 'react';
import { Copy, Link2, Power, Radio } from 'lucide-react';

const chipClass =
  'inline-flex items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-700';

const ghostButtonClass =
  'inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-3 text-sm font-medium text-black transition hover:border-black hover:bg-brand-500 hover:text-white';

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 border border-brand-500 bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600';

export default function ConnectionScreen({
  role,
  shareUrl,
  connectionStatus,
  connectionDetail,
  activeSignalingBase,
  networkMode,
  error,
  onGenerateUrl,
  onDisconnect,
}) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
    } catch {
      // Ignore clipboard failures in minimal UI mode.
    }
  };

  useEffect(() => {
    if (!isCopied) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setIsCopied(false);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [isCopied]);

  useEffect(() => {
    setIsCopied(false);
  }, [shareUrl]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.34em] text-zinc-500">
          secure transfer
        </p>
        <h1 className="text-4xl font-semibold uppercase tracking-[-0.06em] text-zinc-950 sm:text-6xl">
          Minimal. Direct. Encrypted.
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
          Generate one link, share it once, and keep the flow clean in a single window.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className={chipClass}>
          <Radio size={14} />
          <span>{connectionStatus}</span>
        </div>
        <div className={chipClass}>
          <span>{networkMode.toUpperCase()}</span>
        </div>
        {role === 'peer' && (
          <button type="button" className={ghostButtonClass} onClick={onDisconnect}>
            <Power size={14} />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      <div className="grid gap-5 border border-zinc-300 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-4">
          <span className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-zinc-700">
            connection
          </span>
          <Link2 size={16} className="text-black" />
        </div>

        <p className="text-sm leading-7 text-zinc-600 sm:text-base">{connectionDetail}</p>

        {role === 'host' && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primaryButtonClass} onClick={onGenerateUrl}>
              Generate URL
            </button>
          </div>
        )}

        {shareUrl && (
          <div className="grid gap-3">
            <textarea
              className="min-h-32 w-full resize-y border border-zinc-300 bg-white p-4 text-sm leading-6 text-zinc-800 outline-none focus:border-black"
              readOnly
              value={shareUrl}
              aria-label="Generated secure URL"
            />
            <button type="button" className={ghostButtonClass} onClick={handleCopy}>
              <Copy size={14} />
              <span>{isCopied ? 'Copied' : 'Copy Link'}</span>
            </button>
          </div>
        )}

        {activeSignalingBase && (
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            signaling: {activeSignalingBase}
          </p>
        )}

        {error && <p className="text-sm font-medium text-black">error: {error}</p>}
      </div>
    </div>
  );
}
