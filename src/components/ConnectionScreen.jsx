import { useEffect, useState } from 'react';
import { Copy, Link2, Power, Radio } from 'lucide-react';

const chipClass =
  'inline-flex min-w-0 items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-zinc-700 sm:text-xs sm:tracking-[0.18em]';

const ghostButtonClass =
  'inline-flex w-full items-center justify-center gap-2 border border-zinc-300 px-4 py-3 text-sm font-medium text-black transition hover:border-black hover:bg-brand-500 hover:text-white sm:w-auto';

const primaryButtonClass =
  'inline-flex w-full items-center justify-center gap-2 border border-brand-500 bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto';

export default function ConnectionScreen({
  role,
  shareUrl,
  connectionStatus,
  connectionDetail,
  activeSignalingBase,
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
    <div className="grid gap-5 sm:gap-6">
      <div className="grid gap-2.5 sm:gap-3">
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.24em] text-zinc-500 sm:text-[0.7rem] sm:tracking-[0.34em]">
          local-first sharing
        </p>
        <h1 className="max-w-4xl text-[2rem] leading-[0.9] font-semibold uppercase tracking-[-0.08em] text-zinc-950 sm:text-6xl">
          Send Files Across Your Network.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base sm:leading-7">
          Create a private link, open it on another device nearby, and move files directly over your local network.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className={chipClass}>
          <Radio size={14} />
          <span className="truncate">{connectionStatus}</span>
        </div>
        {role === 'peer' && (
          <button type="button" className={ghostButtonClass} onClick={onDisconnect}>
            <Power size={14} />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      <div className="grid gap-4 border border-zinc-300 p-4 sm:gap-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-3 sm:pb-4">
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-700 sm:text-[0.72rem] sm:tracking-[0.22em]">
            session
          </span>
          <Link2 size={16} className="text-black" />
        </div>

        <p className="text-sm leading-6 text-zinc-600 sm:text-base sm:leading-7">{connectionDetail}</p>

        {role === 'host' && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" className={primaryButtonClass} onClick={onGenerateUrl}>
              Create Transfer Link
            </button>
          </div>
        )}

        {shareUrl && (
          <div className="grid gap-3">
            <textarea
              className="min-h-36 w-full resize-y border border-zinc-300 bg-white p-3.5 text-sm leading-6 text-zinc-800 outline-none focus:border-black sm:min-h-32 sm:p-4"
              readOnly
              value={shareUrl}
              aria-label="Generated transfer link"
            />
            <button type="button" className={ghostButtonClass} onClick={handleCopy}>
              <Copy size={14} />
              <span>{isCopied ? 'Link Copied' : 'Copy Transfer Link'}</span>
            </button>
          </div>
        )}

        {activeSignalingBase && (
          <p className="break-all text-[0.68rem] uppercase tracking-[0.14em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">
            local session host: {activeSignalingBase}
          </p>
        )}

        {error && <p className="text-sm font-medium text-black">session issue: {error}</p>}
      </div>
    </div>
  );
}
