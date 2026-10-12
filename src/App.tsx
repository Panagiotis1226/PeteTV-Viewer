import { App as CapApp } from '@capacitor/app';
import { useEffect } from 'preact/hooks';
import { toast, ToastHost } from './components/Toast';
import { goBack, setBackHandler } from './nav/spatial';
import { isNative } from './platform';
import { WebPlayer } from './player/WebPlayer';
import { pop, type Route, useRouter } from './router';
import { AddPlaylist } from './screens/AddPlaylist';
import { Home } from './screens/Home';
import { Manage, ManageItems } from './screens/Manage';
import { MovieDetail } from './screens/MovieDetail';
import { PhoneSetup } from './screens/PhoneSetup';
import { Section } from './screens/Section';
import { SeriesDetail } from './screens/SeriesDetail';
import { Settings } from './screens/Settings';
import { useStore } from './store';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <Home />;
    case 'section': return <Section kind={route.kind} />;
    case 'movie': return <MovieDetail id={route.id} />;
    case 'series': return <SeriesDetail id={route.id} />;
    case 'settings': return <Settings />;
    case 'addPlaylist': return <AddPlaylist editId={route.editId} />;
    case 'manage': return <Manage kind={route.kind} />;
    case 'manageItems': return <ManageItems categoryId={route.categoryId} />;
    case 'phoneSetup': return <PhoneSetup />;
    case 'player': return <WebPlayer req={route.req} />;
  }
}

export function App() {
  const s = useStore();
  const stack = useRouter();

  useEffect(() => {
    let lastBackAt = 0;
    setBackHandler(() => {
      if (pop()) return;
      if (isNative) {
        // Press back twice on the home screen to exit.
        if (Date.now() - lastBackAt < 2000) CapApp.exitApp();
        else {
          lastBackAt = Date.now();
          toast('Press back again to exit');
        }
      }
    });
    if (isNative) {
      const h = CapApp.addListener('backButton', () => goBack());
      return () => { h.then((x) => x.remove()); };
    }
  }, []);

  if (!s.ready) return <div class="boot"><div class="brand big">Pete<span>TV</span></div></div>;
  return (
    <>
      {stack.map((e, i) => {
        const top = i === stack.length - 1;
        return (
          <div key={e.key} class={'layer' + (top ? '' : ' inactive')} data-nav-scope={top ? '' : undefined} inert={!top}>
            <Screen route={e.route} />
          </div>
        );
      })}
      <ToastHost />
    </>
  );
}
