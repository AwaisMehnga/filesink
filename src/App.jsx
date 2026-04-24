import ConnectionScreen from './components/ConnectionScreen';
import FileShareScreen from './components/FileShareScreen';
import { useSecureP2PLink } from './hooks/useSecureP2PLink';

function App() {
  const link = useSecureP2PLink();

  return (
    <main className="app-shell">
      <section className="card">
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
            networkMode={link.networkMode}
            error={link.error}
            formatSize={link.formatSize}
            onSelectFiles={link.selectFiles}
            onSendFiles={link.sendSelectedFiles}
          />
        ) : (
          <ConnectionScreen
            role={link.role}
            shareUrl={link.shareUrl}
            connectionStatus={link.connectionStatus}
            connectionDetail={link.connectionDetail}
            activeSignalingBase={link.activeSignalingBase}
            networkMode={link.networkMode}
            error={link.error}
            onGenerateUrl={link.createConnectionUrl}
          />
        )}
      </section>
    </main>
  );
}

export default App;
