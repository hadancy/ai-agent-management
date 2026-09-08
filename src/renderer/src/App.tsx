import ConsoleApp from './features/monitor/ConsoleApp'
import PadApp from './PadApp'
import PlcDebugPage from './features/plc/PlcDebugPage'

function App(): React.JSX.Element {
  if (window.location.pathname === '/plc' || window.location.pathname === '/plc/')
    return <PlcDebugPage />
  return window.location.pathname.startsWith('/c') ? <PadApp /> : <ConsoleApp />
}

export default App
