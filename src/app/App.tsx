import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { Shell } from './components/Shell'
import { Spinner, ToastProvider } from './components/ui'
import { ApiError, useMe } from './lib/api'
import { ChatPage } from './pages/Chat'
import { EventView } from './pages/EventView'
import { Events } from './pages/Events'
import { Settings } from './pages/Settings'
import { SetupNeeded, SignIn } from './pages/SignIn'

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } })

function Gate() {
  const me = useMe()
  if (me.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />
  if (me.error) return <SetupNeeded message={me.error.message} />
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<ChatPage />} />
        <Route path="c/:id" element={<ChatPage />} />
        <Route path="events" element={<Events />} />
        <Route path="e/:id" element={<EventView />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
