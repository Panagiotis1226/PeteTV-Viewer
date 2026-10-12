import qrcode from 'qrcode-generator';
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../components/Toast';
import { Native } from '../platform';
import { pop, resetTo } from '../router';
import { savePlaylistFromInput } from './AddPlaylist';

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return <div class="qr" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} />;
}

/**
 * "Set up from phone": the TV runs a tiny web server on the local network.
 * The user opens the shown address on their phone, types the playlist there
 * and it is sent straight to the TV. No accounts, MAC addresses or cloud.
 */
export function PhoneSetup() {
  const [pin] = useState(() => String(Math.floor(1000 + Math.random() * 9000)));
  const [addr, setAddr] = useState<string | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    let alive = true;
    Native.addListener('setupData', async ({ data }) => {
      try {
        setStatus('Received! Connecting to your provider…');
        await savePlaylistFromInput(JSON.parse(data));
        toast('Playlist added from phone');
        resetTo({ name: 'home' });
      } catch (e) {
        setErr((e as Error).message);
        setStatus('Waiting for your phone…');
      }
    }).then((h) => { if (alive) handle = h; else h.remove(); });
    Native.startSetupServer({ pin })
      .then((r) => { setAddr(r.url); setStatus('Waiting for your phone…'); })
      .catch((e) => setErr('Could not start setup server: ' + e.message));
    return () => {
      alive = false;
      handle?.remove();
      Native.stopSetupServer().catch(() => {});
    };
  }, []);

  return (
    <div class="screen phone-setup">
      <header class="topbar">
        <button data-nav data-nav-default class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>Set up from your phone</h1>
      </header>
      <div class="phone-body">
        {addr ? <Qr text={addr} /> : <div class="spinner inline" />}
        <div>
          <ol class="steps">
            <li>Connect your phone to the <b>same Wi-Fi</b> as this TV.</li>
            <li>Scan the QR code or open <b class="accent">{addr || '…'}</b></li>
            <li>Enter PIN <b class="pin">{pin}</b> and your playlist details.</li>
          </ol>
          <p class="muted">{status}</p>
          {err && <div class="banner error">{err}</div>}
        </div>
      </div>
    </div>
  );
}
