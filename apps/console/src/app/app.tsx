import { Link, Route, Routes } from 'react-router-dom';

import { CatalogView } from '../views/Catalog';
import { TraceView } from '../views/Trace';

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="flex items-center gap-6 font-mono text-sm">
          <Link to="/" className="font-bold">
            Prose Console
          </Link>
          <Link to="/" className="text-gray-700 hover:underline">
            trace
          </Link>
          <Link to="/catalog" className="text-gray-700 hover:underline">
            catalog
          </Link>
          <Link to="/live" className="text-gray-700 hover:underline">
            live
          </Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<TraceView />} />
        <Route path="/catalog" element={<CatalogView />} />
        <Route
          path="/live"
          element={
            <Placeholder
              title="Live tail"
              body="Built in slice 8 — WS-backed feed of in-flight events."
            />
          }
        />
      </Routes>
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 font-mono text-sm">
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mt-2 text-gray-600">{body}</p>
    </div>
  );
}

export default App;
