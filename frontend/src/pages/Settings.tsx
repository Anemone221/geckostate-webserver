import { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings, type Settings } from '../api/settings';
import { useLpRates, useLpBalances, useUpdateLpRate, useUpdateLpBalance, type LpRate, type LpBalance } from '../api/lp';
import { FEEDBACK_TIMEOUT_MS } from '../lib/constants';

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-1">{title}</h2>
      <p className="text-gray-400 text-xs mb-4">{description}</p>
      {children}
    </div>
  );
}

// ─── Global settings form ─────────────────────────────────────────────────────

function GlobalSettingsForm() {
  const { data, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState<Settings>({
    brokerFeePct:       0.02,
    salesTaxPct:        0.01,
    weeklyVolumePct:    0.05,
    logisticsCostPerM3: 0,
  });
  const [saved, setSaved] = useState(false);

  // Sync form when server data loads
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function handleChange(field: keyof Settings, raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v)) {
      setForm((prev) => ({ ...prev, [field]: v }));
    }
  }

  async function handleSave() {
    await updateSettings.mutateAsync(form);
    setSaved(true);
    setTimeout(() => { setSaved(false); }, FEEDBACK_TIMEOUT_MS);
  }

  if (isLoading) {
    return <div className="animate-pulse h-40 rounded bg-gray-800" />;
  }

  return (
    <div className="bg-gray-800 rounded border border-gray-700 p-4 max-w-lg">
      <div className="grid grid-cols-2 gap-4 mb-4">
        {(
          [
            { key: 'brokerFeePct',       label: 'Broker Fee %',      help: 'e.g. 0.02 for 2%'    },
            { key: 'salesTaxPct',        label: 'Sales Tax %',       help: 'e.g. 0.01 for 1%'    },
            { key: 'weeklyVolumePct',    label: 'Weekly Volume Cap', help: 'Fraction of 7-day avg volume you can sell weekly (e.g. 0.05 = 5%)' },
            { key: 'logisticsCostPerM3', label: 'Logistics ISK/m³',  help: 'Freight cost per m³ for shipping items to market' },
          ] as const
        ).map(({ key, label, help }) => (
          <div key={key}>
            <label className="block text-xs text-gray-400 mb-1">{label}</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={form[key]}
              onChange={(e) => { handleChange(key, e.target.value); }}
              className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-0.5">{help}</p>
          </div>
        ))}
      </div>

      <button
        onClick={() => { void handleSave(); }}
        disabled={updateSettings.isPending}
        className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors disabled:opacity-50"
      >
        {updateSettings.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}

// ─── LP rate row ──────────────────────────────────────────────────────────────

function RateRow({ rate }: { rate: LpRate }) {
  const [val, setVal] = useState(String(rate.iskPerLp ?? ''));
  const [saved, setSaved] = useState(false);
  const updateRate = useUpdateLpRate();

  async function save() {
    const n = val.trim() === '' ? null : parseFloat(val);
    await updateRate.mutateAsync({
      corporationId: rate.corporationId,
      iskPerLp:      n != null && !isNaN(n) ? n : null,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); }, FEEDBACK_TIMEOUT_MS);
  }

  return (
    <tr className="border-b border-gray-700">
      <td className="px-4 py-2 text-sm text-gray-200">{rate.corporationName}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          value={val}
          onChange={(e) => { setVal(e.target.value); setSaved(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { void save(); } }}
          placeholder="ISK/LP"
          className="w-36 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <button
          onClick={() => { void save(); }}
          disabled={updateRate.isPending}
          className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors disabled:opacity-50"
        >
          {updateRate.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

// ─── LP balance row ───────────────────────────────────────────────────────────

function BalRow({ balance }: { balance: LpBalance }) {
  const [val, setVal] = useState(String(balance.currentLp ?? ''));
  const [saved, setSaved] = useState(false);
  const updateBal = useUpdateLpBalance();

  async function save() {
    const n = val.trim() === '' ? null : parseFloat(val);
    await updateBal.mutateAsync({
      corporationId: balance.corporationId,
      currentLp:     n != null && !isNaN(n) ? n : null,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); }, FEEDBACK_TIMEOUT_MS);
  }

  return (
    <tr className="border-b border-gray-700">
      <td className="px-4 py-2 text-sm text-gray-200">{balance.corporationName}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          value={val}
          onChange={(e) => { setVal(e.target.value); setSaved(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { void save(); } }}
          placeholder="LP balance"
          className="w-36 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <button
          onClick={() => { void save(); }}
          disabled={updateBal.isPending}
          className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors disabled:opacity-50"
        >
          {updateBal.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

// ─── Rates table ──────────────────────────────────────────────────────────────

function LpRatesTable() {
  const { data: rates, isLoading } = useLpRates();

  if (isLoading) {
    return <div className="animate-pulse h-24 rounded bg-gray-800" />;
  }

  if (!rates || rates.length === 0) {
    return (
      <p className="text-gray-500 text-sm">
        No LP rates set yet. Visit LP Analysis and use the <strong className="text-gray-300">+ Set LP purchase price</strong> button on any corp.
      </p>
    );
  }

  return (
    <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden max-w-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left px-4 py-2 text-gray-400 font-medium">Corporation</th>
            <th className="text-left px-4 py-2 text-gray-400 font-medium">ISK/LP (what you pay)</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <RateRow key={rate.corporationId} rate={rate} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Balances table ───────────────────────────────────────────────────────────

function LpBalancesTable() {
  const { data: balances, isLoading } = useLpBalances();

  if (isLoading) {
    return <div className="animate-pulse h-24 rounded bg-gray-800" />;
  }

  if (!balances || balances.length === 0) {
    return (
      <p className="text-gray-500 text-sm">
        No LP balances set yet. Visit LP Analysis and use the <strong className="text-gray-300">+ Set LP balance</strong> button on any corp.
      </p>
    );
  }

  return (
    <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden max-w-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left px-4 py-2 text-gray-400 font-medium">Corporation</th>
            <th className="text-left px-4 py-2 text-gray-400 font-medium">My LP Balance</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {balances.map((bal) => (
            <BalRow key={bal.corporationId} balance={bal} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-gray-400 text-sm mb-8">
        Configure global calculation parameters and per-corp LP data.
      </p>

      <Section
        title="Calculation Settings"
        description="These values apply to all LP and manufacturing profit calculations."
      >
        <GlobalSettingsForm />
      </Section>

      <Section
        title="LP Purchase Rates"
        description="The ISK/LP price you pay when buying LP from third-party sellers in the player market."
      >
        <LpRatesTable />
      </Section>

      <Section
        title="My LP Balances"
        description="Your current LP balance per corporation. Used to show how many redemptions are available."
      >
        <LpBalancesTable />
      </Section>
    </div>
  );
}
