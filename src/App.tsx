import { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LinkDevicePrompt } from './components/LinkDevicePrompt';
import { TitleModal } from './components/TitleModal';
import { Toasts } from './components/Toasts';
import { TopNav } from './components/TopNav';
import { HomePage } from './pages/HomePage';
import { LeaguePage } from './pages/LeaguePage';
import { useRoute } from './lib/router';
import { startSync } from './lib/sync';

export function App() {
  const route = useRoute();
  useEffect(() => {
    void startSync();
  }, []);
  return (
    <div className="page">
      <TopNav route={route} />
      <main>
        <ErrorBoundary>{route.name === 'league' ? <LeaguePage slug={route.slug} tab={route.tab} /> : <HomePage />}</ErrorBoundary>
      </main>
      <footer className="footer">
        <div className="wrap">
          <p>
            Film and TV lists from the IMDb Top 250 charts. Artwork and details via Cinemeta and metahub. Games from Wikipedia's list of video games
            listed among the best, with art from Wikipedia and Steam. A personal, non-commercial project.
          </p>
        </div>
      </footer>
      <TitleModal />
      <LinkDevicePrompt />
      <Toasts />
    </div>
  );
}
