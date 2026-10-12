import { render } from 'preact';
import { handleAuthRedirects } from './integrations/registry';
import { captureShare } from './state/share';
import { App } from './ui/App';
import './ui/styles.css';

// An OAuth callback (`?code=`) must be consumed before the first render so the URL is cleaned and routed to #/links.
captureShare();
void handleAuthRedirects()
  .catch(() => undefined)
  .then(() => render(<App />, document.getElementById('app') as HTMLElement));
