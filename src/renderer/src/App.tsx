import ConsoleApp from './features/monitor/ConsoleApp'
import PadApp from './PadApp'

function App(): React.JSX.Element {
  return window.location.pathname.startsWith('/c') ? <PadApp /> : <ConsoleApp />
}

export default App
