import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { STALE_TIME_DEFAULT } from './lib/constants';
import './index.css';

// QueryClient is the central cache for all server data fetched by React Query.
// staleTime: 5 minutes — data is considered fresh for 5 min before a background refetch.
// retry: 1 — on failure, try once more before showing an error.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_DEFAULT,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
