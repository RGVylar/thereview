/* App shell — routing between screens */

const { useState } = React;

function App() {
  const [route, setRoute] = useState('login');
  const [addUrl, setAddUrl] = useState('');
  const [toast, setToast] = useState(null);

  const onAddMeme = () => {
    if (!addUrl.trim()) return;
    setToast(`✓ Meme añadido: ${addUrl.slice(0, 40)}…`);
    setAddUrl('');
  };

  const onLogin = () => setRoute('sessions');
  const onOpenSession = (id) => {
    // Find session — if finished, go to results, otherwise live session
    const s = SESSIONS.find(x => x.id === id);
    if (s && s.status === 'finished') setRoute('results');
    else setRoute('session');
  };

  return (
    <div className="app-shell">
      <div className="bg-mesh"/>
      <div className="bg-grain"/>

      <div className="app-content">
        {route !== 'login' && (
          <Navbar
            route={route}
            onNavigate={setRoute}
            addUrl={addUrl}
            setAddUrl={setAddUrl}
            onAddMeme={onAddMeme}
          />
        )}

        {route === 'login' && (
          <div className="scroll-area"><LoginScreen onLogin={onLogin}/></div>
        )}
        {route === 'sessions' && (
          <div className="scroll-area"><SessionsScreen onOpen={onOpenSession}/></div>
        )}
        {route === 'session' && (
          <SessionScreen onBack={() => setRoute('sessions')}/>
        )}
        {route === 'results' && (
          <ResultsScreen onBack={() => setRoute('sessions')}/>
        )}
        {route === 'profile' && (
          <div className="scroll-area"><ProfileScreen/></div>
        )}
        {route === 'rewind' && (
          <div className="scroll-area"><RewindScreen/></div>
        )}

        {toast && <Toast msg={toast} onClose={() => setToast(null)}/>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

/* status pulse keyframe */
const styleEl = document.createElement('style');
styleEl.textContent = `
@keyframes statusPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 12px currentColor; }
  50% { opacity: 0.5; box-shadow: 0 0 4px currentColor; }
}
`;
document.head.appendChild(styleEl);
