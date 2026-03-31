import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LPAnalysis from './pages/LPAnalysis';
import Plans from './pages/Plans';
import Doing from './pages/Doing';
import Manufacturing from './pages/Manufacturing';
import Settings from './pages/Settings';
import MarketHistory from './pages/MarketHistory';
import CorpTrading from './pages/CorpTrading';

export default function App() {
  return (
    <Routes>
      {/* Layout wraps all pages with the sidebar + header */}
      <Route path="/" element={<Layout />}>
        {/* Default: redirect to LP Analysis */}
        <Route index element={<Navigate to="/lp" replace />} />

        {/* LP Analysis — corp picker at /lp, offer table at /lp/:corporationId */}
        <Route path="lp" element={<LPAnalysis />} />
        <Route path="lp/:corporationId" element={<LPAnalysis />} />

        {/* Planning and active tracking */}
        <Route path="plans" element={<Plans />} />
        <Route path="doing" element={<Doing />} />

        {/* Manufacturing profit calculator */}
        <Route path="manufacturing" element={<Manufacturing />} />

        {/* Corporation trading — orders, transactions, fees, journal */}
        <Route path="corp-trading" element={<CorpTrading />} />

        {/* Settings — broker fee, taxes, LP rates, LP balances */}
        <Route path="settings" element={<Settings />} />

        {/* Future pages */}
        <Route path="history" element={<MarketHistory />} />
      </Route>
    </Routes>
  );
}
