import { render } from 'preact';
import { App } from './App';
import { installSpatialNav, focusDefault } from './nav/spatial';
import { detectServer, isNative, platform } from './platform';
import { init } from './store';
import './styles.css';

document.documentElement.classList.add(isNative ? 'native' : 'web', 'p-' + platform);
installSpatialNav();
render(<App />, document.getElementById('app')!);
detectServer().finally(() => init().then(() => requestAnimationFrame(() => requestAnimationFrame(focusDefault))));
