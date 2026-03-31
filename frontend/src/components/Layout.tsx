import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/lp',            label: 'LP Analysis' },
  { to: '/plans',         label: 'Planning' },
  { to: '/doing',         label: 'Currently Doing' },
  { to: '/manufacturing', label: 'Manufacturing' },
  { to: '/history',       label: 'Market History' },
  { to: '/corp-trading',  label: 'Corp Trading' },
  { to: '/settings',      label: 'Settings' },
];

export default function Layout() {
  const {
    character, characters, isLoading,
    login, logout, addCharacter, switchCharacter,
  } = useAuth();

  // Controls whether the character list dropdown is open
  const [charMenuOpen, setCharMenuOpen] = useState(false);

  const otherCharacters = characters.filter(
    (c) => c.characterId !== character?.characterId,
  );

  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 bg-gray-800 border-r border-gray-700 flex flex-col">
        {/* App title */}
        <div className="px-4 py-5 border-b border-gray-700">
          <span className="text-sm font-semibold text-indigo-400 tracking-wide uppercase">
            GeckoState
          </span>
          <p className="text-xs text-gray-500 mt-0.5">EVE Market Planner</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'block px-3 py-2 rounded text-sm transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Character / Login section at the bottom of the sidebar */}
        <div className="px-3 py-3 border-t border-gray-700">
          {isLoading ? (
            <div className="text-xs text-gray-500">Loading...</div>
          ) : character ? (
            <div className="relative">
              {/* Active character — click to toggle character menu */}
              <button
                onClick={() => setCharMenuOpen((prev) => !prev)}
                className="w-full flex items-center gap-2 rounded p-1 hover:bg-gray-700 transition-colors"
              >
                <img
                  src={`https://images.evetech.net/characters/${character.characterId}/portrait?size=32`}
                  alt={character.characterName}
                  className="w-8 h-8 rounded"
                />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs text-gray-200 font-medium truncate">
                    {character.characterName}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {otherCharacters.length > 0
                      ? `+${otherCharacters.length} alt${otherCharacters.length > 1 ? 's' : ''}`
                      : 'Active'}
                  </p>
                </div>
                {/* Chevron */}
                <svg
                  className={`w-3 h-3 text-gray-500 transition-transform ${charMenuOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>

              {/* Dropdown: other characters + add + logout */}
              {charMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-700 rounded shadow-lg border border-gray-600 overflow-hidden">
                  {/* Other characters */}
                  {otherCharacters.map((c) => (
                    <button
                      key={c.characterId}
                      onClick={async () => {
                        await switchCharacter(c.characterId);
                        setCharMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-600 transition-colors"
                    >
                      <img
                        src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=24`}
                        alt={c.characterName}
                        className="w-6 h-6 rounded"
                      />
                      <span className="text-xs text-gray-300 truncate">{c.characterName}</span>
                    </button>
                  ))}

                  {/* Add Character */}
                  <button
                    onClick={() => {
                      setCharMenuOpen(false);
                      addCharacter();
                    }}
                    className="w-full px-2 py-1.5 text-xs text-indigo-400 hover:bg-gray-600 transition-colors text-left"
                  >
                    + Add Character
                  </button>

                  {/* Divider + Logout */}
                  <div className="border-t border-gray-600">
                    <button
                      onClick={() => {
                        setCharMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-2 py-1.5 text-xs text-red-400 hover:bg-gray-600 transition-colors text-left"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={login}
              className="w-full px-3 py-2 text-xs font-medium text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Login with EVE
            </button>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-auto bg-gray-900 p-6">
        <Outlet />
      </main>
    </div>
  );
}
