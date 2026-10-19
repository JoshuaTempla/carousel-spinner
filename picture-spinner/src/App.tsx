import { useEffect, useRef, useState } from 'react';
import { Upload, Shuffle, Maximize, ImagePlus, RotateCcw } from 'lucide-react';

type Entry = { id: string; name: string; url: string };
const mod = (v: number, n: number) => ((v % n) + n) % n;
function randomIndex(n: number) {
  const values = new Uint32Array(1);
  const limit = Math.floor(4294967296 / n) * n;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % n;
}

// One reusable audio graph; no downloaded sound files or audio dependencies.
class SpinnerAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<OscillatorNode>();
  private lastTick = -Infinity;
  private muted = false;
  private volume = 0.35;

  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is not running.');
  }

  configure(muted: boolean, volume: number) {
    this.muted = muted;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.01);
    }
  }

  private tone(frequency: number, offset: number, duration: number, level: number, type: OscillatorType) {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running' || this.muted || this.volume === 0) return;
    const start = ctx.currentTime + offset;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(level, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    this.voices.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect(); envelope.disconnect(); this.voices.delete(oscillator);
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.005);
  }

   tick() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || ctx.currentTime - this.lastTick < 0.055) return;
    this.lastTick = ctx.currentTime;

    // Rounded body, bright attack, and a subtle descending tail.
    this.tone(520, 0, 0.042, 0.19, 'triangle');
    this.tone(1560, 0, 0.012, 0.055, 'sine');
    this.tone(390, 0.008, 0.032, 0.09, 'sine');
  }


  winner() {
    this.stop();

    // Lower-register melody with a subtle octave layer.
    [261.63, 329.63, 392, 523.25].forEach((note, index) => {
      this.tone(note, index * 0.11, 0.42, 0.15, 'sine');
      this.tone(note * 2, index * 0.11, 0.28, 0.035, 'triangle');
    });

    // Bass foundation beneath the reveal.
    this.tone(130.81, 0, 0.65, 0.18, 'sine');
  }

  stop() {
    for (const voice of this.voices) voice.stop();
    this.lastTick = -Infinity;
  }

  dispose() {
    this.stop();
    const ctx = this.context;
    this.context = null; this.master = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(console.warn);
  }
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);
  const [winner, setWinner] = useState<Entry | null>(null);
  const [seconds, setSeconds] = useState(7);
  const [width, setWidth] = useState(900);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(35);
  const [audioError, setAudioError] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef(0);
  const busy = useRef(false);
  const urls = useRef<string[]>([]);
  const mounted = useRef(true);
  const audio = useRef<SpinnerAudio | null>(null);

  function getAudio() {
    if (!audio.current) audio.current = new SpinnerAudio();
    return audio.current;
  }

  useEffect(() => {
    mounted.current = true;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (stage.current) observer.observe(stage.current);
    return () => {
      mounted.current = false;
      observer.disconnect(); cancelAnimationFrame(frame.current);
      urls.current.forEach(URL.revokeObjectURL);
      audio.current?.dispose(); audio.current = null;
    };
  }, []);

  function changeMute() {
    const next = !muted;
    setMuted(next);
    getAudio().configure(next, volume / 100);
  }

  function changeVolume(value: number) {
    setVolume(value);
    getAudio().configure(muted, value / 100);
  }

  async function testSound() {
    if (busy.current || muted || volume === 0) return;
    try {
      const sound = getAudio();
      sound.configure(muted, volume / 100);
      await sound.unlock();
      if (!mounted.current || busy.current) return;
      setAudioError(''); sound.winner();
    } catch (cause) {
      console.warn('Sound test failed:', cause);
      if (mounted.current) setAudioError('Sound could not start. Check browser sound permissions and your output device, then try Test sound again.');
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files || busy.current) return;
    busy.current = true; setLoading(true); setError('');
    const added: Entry[] = [];
    let rejected = 0;
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 20 * 1024 * 1024) { rejected++; continue; }
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (!mounted.current) { URL.revokeObjectURL(url); continue; }
        urls.current.push(url);
        added.push({ id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), url });
      } catch { URL.revokeObjectURL(url); rejected++; }
    }
    if (mounted.current) {
      setEntries(old => [...old, ...added]); setPhase(0); setWinner(null);
      setError(rejected ? `${rejected} file(s) skipped. Use valid JPG, PNG, WebP or GIF images under 20 MB each.` : '');
      setLoading(false);
    }
    busy.current = false;
    if (input.current) input.current.value = '';
  }

  async function spin() {
    if (busy.current || entries.length < 2) return;
    busy.current = true; setRunning(true); setWinner(null);
    let sound: SpinnerAudio | null = null;
    try {
      const selected = randomIndex(entries.length);
      const start = phase;
      const minimum = Math.ceil(start) + Math.max(20, entries.length * 3);
      const target = minimum + mod(-selected - minimum, entries.length);
      if (!muted && volume > 0) {
        try {
          sound = getAudio();
          sound.configure(muted, volume / 100);
          sound.stop();
          await sound.unlock();
          if (mounted.current) setAudioError('');
        } catch (cause) {
          console.warn('Spin audio unavailable:', cause);
          sound = null;
          if (mounted.current) setAudioError('Sound unavailable. The spinner will continue silently. Try Test sound before the next spin.');
        }
      } else {
        audio.current?.stop();
      }
      if (!mounted.current) return;
      const started = performance.now();
      const duration = seconds * 1000;
      let previousCenter = Math.floor(start);
      function tick(now: number) {
        const progress = Math.min(1, (now - started) / duration);
        const next = progress === 1 ? target : start + (target - start) * (1 - Math.pow(1 - progress, 4));
        setPhase(next);
        const crossedCenter = Math.floor(next);
        if (progress < 1 && crossedCenter > previousCenter && !document.hidden) {
          // At most one tick per frame; short ticks are also rate-limited by the audio engine.
          sound?.tick();
        }
        previousCenter = crossedCenter;
        if (progress < 1) frame.current = requestAnimationFrame(tick);
        else {
          setWinner(entries[selected]); setRunning(false); busy.current = false;
          if (!document.hidden) sound?.winner();
        }
      }
      frame.current = requestAnimationFrame(tick);
    } catch (cause) {
      console.error('Unable to start spin:', cause);
      if (mounted.current) { setError('Unable to start the spin. Check the browser console for details.'); setRunning(false); }
      busy.current = false;
    }
  }

  function reset() {
    if (busy.current) return;
    audio.current?.stop();
    urls.current.forEach(URL.revokeObjectURL); urls.current = [];
    setEntries([]); setWinner(null); setPhase(0); setError('');
  }

  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setError('Fullscreen is unavailable here. Open the app in its own browser tab or use browser fullscreen.'); }
  }

  const cardWidth = Math.min(420, width * .64);
  const step = cardWidth + 28;
  const whole = Math.floor(phase);
  const fraction = phase - whole;
  return (
    <div ref={root} className="min-h-screen bg-[#0b0d16] text-white flex flex-col font-sans">
      <header className="flex items-center justify-between px-6 md:px-12 py-6 border-b border-white/10">
        <div className="flex items-center gap-3"><div className="bg-violet-500/20 p-2 rounded-xl"><Shuffle className="text-violet-300" size={23}/></div><div><div className="font-semibold tracking-tight">Picture Spin</div><div className="text-xs text-slate-400">Your photos. One lucky pick.</div></div></div>
        <button onClick={fullscreen} className="p-3 rounded-xl hover:bg-white/10" aria-label="Toggle fullscreen"><Maximize size={20}/></button>
      </header>
      <main className="flex-1 flex flex-col justify-center py-10">
        <div className="text-center px-5 mb-8"><p className="text-violet-300 uppercase tracking-[.3em] text-xs mb-3">THE SPOTLIGHT IS YOURS</p><h1 className="text-3xl md:text-5xl font-semibold tracking-tight">{running ? 'Who will it be?' : winner ? 'We have a winner!' : 'Let the pictures decide.'}</h1><p className="text-slate-400 mt-4">{entries.length ? `${entries.length} entries ready • Images move left to right` : 'Add your pictures, then spin to pick a random winner.'}</p></div>
        <div ref={stage} className="relative w-full h-[370px] md:h-[430px] overflow-hidden" style={{maskImage:'linear-gradient(to right, transparent, black 18%, black 82%, transparent)'}}>
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-violet-400/30"/>
          {entries.length ? Array.from({length:7}, (_, i) => i - 3).map(slot => {
            const entry = entries[mod(slot - whole, entries.length)];
            const distance = slot + fraction;
            return <div key={`${slot-whole}`} className="absolute top-5 left-1/2 rounded-2xl overflow-hidden border border-white/15 shadow-2xl bg-[#171a29]" style={{width:cardWidth,height:'calc(100% - 40px)',transform:`translateX(calc(-50% + ${distance*step}px)) scale(${1-Math.min(Math.abs(distance),2)*.09})`,opacity:Math.max(0,1-Math.abs(distance)*.32),zIndex:10-Math.round(Math.abs(distance))}}>
              <img src={entry.url} alt={entry.name} draggable={false} className="w-full h-full object-contain"/>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent px-5 pt-12 pb-5 text-center font-medium truncate">{entry.name}</div>
            </div>;
          }) : <div className="absolute inset-5 flex flex-col items-center justify-center border border-dashed border-white/15 rounded-2xl bg-white/[.02]"><ImagePlus size={54} className="text-violet-300 mb-5"/><p className="text-lg">Your picture lineup goes here</p><p className="text-slate-500 text-sm mt-2">JPG, PNG, WebP or GIF • Up to 20 MB per file</p></div>}
        </div>
        <div className="h-12 text-center px-4" aria-live="polite">{winner && <p className="text-xl font-semibold text-violet-200 truncate">✦ {winner.name} ✦</p>}</div>
        <div className="flex flex-wrap justify-center items-center gap-3 px-5">
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={e=>void addFiles(e.target.files)}/>
          <button disabled={running || loading} onClick={()=>input.current?.click()} className="flex gap-2 items-center px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40"><Upload size={18}/>{loading ? 'Loading photos…' : 'Add pictures'}</button>
          <button disabled={running || loading || entries.length<2} onClick={()=>void spin()} className="flex gap-2 items-center px-9 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 font-semibold shadow-lg shadow-violet-900/30 disabled:opacity-40"><Shuffle size={19}/>{running ? 'Spinning…' : winner ? 'Spin again' : 'Spin to win'}</button>
          <button disabled={running || loading || !entries.length} onClick={reset} className="p-3 rounded-xl hover:bg-white/10 disabled:opacity-30" aria-label="Clear pictures"><RotateCcw size={19}/></button>
        </div>
        <label className="flex items-center justify-center gap-3 text-sm text-slate-400 mt-6">Spin duration <select value={seconds} disabled={running} onChange={e=>setSeconds(Number(e.target.value))} className="bg-[#1c2030] rounded-lg px-3 py-2 text-white"><option value={4}>4 seconds</option><option value={7}>7 seconds</option><option value={10}>10 seconds</option></select></label>
        <div className="flex flex-wrap justify-center items-center gap-4 px-5 mt-6 text-sm">
          <button type="button" onClick={changeMute} aria-pressed={muted} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15">{muted ? 'Unmute sound' : 'Mute sound'}</button>
          <label className="flex items-center gap-3 text-slate-300">Volume<input type="range" min="0" max="100" step="1" value={volume} onChange={e=>changeVolume(Number(e.target.value))} className="w-28 accent-violet-400"/><span className="w-10 tabular-nums">{volume}%</span></label>
          <button type="button" disabled={running || loading || muted || volume === 0} onClick={()=>void testSound()} className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/10 disabled:opacity-40">Test sound</button>
        </div>
        <p className="text-center text-xs text-slate-500 mt-3 px-5">Soft center-crossing ticks + winner chime. Start with low speaker volume.</p>
        {audioError && <p role="status" className="text-amber-300 text-sm text-center px-6 mt-4">{audioError}</p>}
        {error && <p role="alert" className="text-amber-300 text-sm text-center px-6 mt-5">{error}</p>}
      </main>
      <footer className="text-center text-xs text-slate-500 px-5 py-5 border-t border-white/5">Photos stay in this browser session. Refreshing clears them. Each uploaded file is one entry; repeat winners are allowed.</footer>
    </div>
  );
}
