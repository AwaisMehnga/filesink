import { Heart } from 'lucide-react';
import ConnectionScreen from './components/ConnectionScreen';
import FileShareScreen from './components/FileShareScreen';
import { useSecureP2PLink } from './hooks/useSecureP2PLink';
import  githubIcon from './assets/github.svg';

const GITHUB_REPO_URL = 'https://github.com/awaisemehnga/filesink';
const LINKEDIN_URL = 'https://www.linkedin.com/in/awaisemehnga/';

function App() {
  const link = useSecureP2PLink();

  return (
    <main className="flex min-h-screen overflow-x-hidden flex-col bg-white text-black">
      <header className="border-b border-brand-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3" aria-label="filesink logo">
            <span className="grid h-9 w-9 shrink-0 place-items-center border border-black bg-brand-500 text-xs font-bold uppercase tracking-[0.24em] text-white">
              fs
            </span>
            <div className="min-w-0">
              <p className="text-[0.58rem] font-medium uppercase tracking-[0.24em] text-zinc-500 sm:text-[0.65rem] sm:tracking-[0.3em]">
                direct transfer
              </p>
              <p className="truncate text-sm font-semibold uppercase tracking-[0.16em] sm:text-lg sm:tracking-[0.18em]">
                filesink
              </p>
            </div>
          </div>

          <a
            className="inline-flex h-11 w-11 items-center justify-center border border-zinc-300 text-black transition hover:border-black"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open GitHub repository"
          >
            <img src={githubIcon} alt="GitHub" className="h-5 w-5" />
          </a>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8">
        <div className="w-full max-w-5xl overflow-x-hidden bg-white">
          {link.isConnected ? (
            <FileShareScreen
              selectedFiles={link.selectedFiles}
              isSending={link.isSending}
              sendProgress={link.sendProgress}
              currentSendName={link.currentSendName}
              receiveProgress={link.receiveProgress}
              currentReceiveName={link.currentReceiveName}
              receivedFiles={link.receivedFiles}
              connectionStatus={link.connectionStatus}
              error={link.error}
              formatSize={link.formatSize}
              onSelectFiles={link.selectFiles}
              onSendFiles={link.sendSelectedFiles}
              onDisconnect={link.disconnect}
              onClearAllFiles={link.clearAllFiles}
            />
          ) : (
            <ConnectionScreen
              role={link.role}
              shareUrl={link.shareUrl}
              connectionStatus={link.connectionStatus}
              connectionDetail={link.connectionDetail}
              activeSignalingBase={link.activeSignalingBase}
              error={link.error}
              onGenerateUrl={link.createConnectionUrl}
              onDisconnect={link.disconnect}
            />
          )}
        </div>
      </section>

      <footer className="mt-auto border-t border-brand-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 text-center sm:px-6 sm:py-4">
          <a
            className="inline-flex flex-wrap items-center justify-center gap-2 text-center text-xs font-medium text-zinc-700 transition hover:text-black sm:text-sm"
            href={LINKEDIN_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open LinkedIn profile"
          >
            <span>made with</span>
            <Heart size={14} className="fill-red-500 text-red-500" />
            <span>by awaisemehnga</span>
          </a>
        </div>
      </footer>
    </main>
  );
}

export default App;
