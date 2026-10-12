import { useEffect, useState } from 'preact/hooks';

let show: (msg: string) => void = () => {};
export function toast(msg: string) {
  show(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    show = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3200);
    };
  }, []);
  return msg ? <div class="toast" role="status">{msg}</div> : null;
}
