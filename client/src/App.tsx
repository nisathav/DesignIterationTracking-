import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError, signOut } from './api';
import { useLiveUpdates, useMe } from './hooks';
import { Loading } from './components/ui';
import { Bell, Toasts } from './components/Notifications';
import { LoginPage, SetupPage, ChangePasswordPage } from './pages/Account';
import { NewEntryPage } from './pages/NewEntry';
import { ConsiderationListPage, FlagListPage, IterationListPage } from './pages/Lists';
import { ConsiderationPage } from './pages/Consideration';
import { FlagPage } from './pages/Flag';
import { UsersPage } from './pages/AdminUsers';
import { DomainsPage } from './pages/AdminDomains';
import { HomePage } from './pages/Home';
import { BoardPage } from './pages/Board';
import { MyItemsPage, useMyItems } from './components/MyItems';

export function App() {
  const me = useMe();
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api.get<{ needsSetup: boolean; managerName: string | null }>('/api/setup'),
    enabled: me.isError,
  });
  const signedIn = !!me.data && !me.data.mustChangePassword;
  useLiveUpdates(signedIn);

  if (me.isLoading) return <Loading />;
  if (me.isError) {
    const e = me.error as ApiError;
    if (e.status !== 401) return <div className="center-card error-box">Cannot reach the server: {e.message}</div>;
    if (setup.isLoading) return <Loading />;
    if (setup.data?.needsSetup) return <SetupPage managerName={setup.data.managerName ?? ''} />;
    return <LoginPage />;
  }
  if (me.data!.mustChangePassword) return <ChangePasswordPage forced />;

  return (
    <div className="app">
      <TopBar />
      <Toasts />
      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/my-items" element={<MyItemsPage />} />
          <Route path="/new" element={<NewEntryPage />} />
          <Route path="/considerations" element={<ConsiderationListPage />} />
          <Route path="/considerations/:id" element={<ConsiderationPage />} />
          <Route path="/iterations" element={<IterationListPage />} />
          <Route path="/flags" element={<FlagListPage />} />
          <Route path="/flags/:id" element={<FlagPage />} />
          <Route path="/admin/users" element={me.data!.role === 'manager' ? <UsersPage /> : <Navigate to="/" />} />
          <Route path="/admin/domains" element={me.data!.role === 'manager' ? <DomainsPage /> : <Navigate to="/" />} />
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<div className="panel panel-body">Page not found.</div>} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar() {
  const { data: me } = useMe();
  const mine = useMyItems();
  const myCount = (mine.data?.assigned.length ?? 0) + (mine.data?.readyToClose.length ?? 0) + (mine.data?.escalated.length ?? 0);
  return (
    <header className="topbar">
      <NavLink to="/" className="brand">
        Design Iteration Tracker
      </NavLink>
      <nav className="nav">
        <NavLink to="/new" className="nav-new">
          + New entry
        </NavLink>
        <NavLink to="/" end>
          Activity
        </NavLink>
        <NavLink to="/my-items">
          My items{myCount > 0 && <span className="nav-count">{myCount}</span>}
        </NavLink>
        <NavLink to="/board">Board</NavLink>
        <NavLink to="/considerations">Considerations</NavLink>
        <NavLink to="/iterations">Iterations</NavLink>
        <NavLink to="/flags">Flags</NavLink>
        {me?.role === 'manager' && (
          <>
            <span className="nav-sep" />
            <NavLink to="/admin/users">Users</NavLink>
            <NavLink to="/admin/domains">Domains &amp; lists</NavLink>
          </>
        )}
      </nav>
      <div className="user-menu">
        <Bell />
        <span className="who">
          {me?.name}
          {me?.role === 'manager' && <span className="muted"> (manager)</span>}
        </span>
        <NavLink to="/account/password" className="btn small ghost">
          Password
        </NavLink>
        <button type="button" className="btn small ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
