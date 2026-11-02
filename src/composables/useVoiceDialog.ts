import { ref, onBeforeUnmount } from 'vue'

export type ServerEvent =
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'bot_text'; text: string; done?: boolean; practice?: string; translation?: string }
  | { type: 'bot_audio'; url: string }
  | {
      type: 'feedback'
      feedback: { score: number; expected: string; heard: string; issues: { letter: string; note: string }[]; tip: string }
    }
  | { type: 'error'; message: string }

// Забирает звук с микрофона, понижает частоту до 16 кГц, переводит в PCM16
// и отдаёт кусками по ~100 мс.
const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.sum = 0; this.n = 0; this.out = []; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.pos++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.sum = 0; this.n = 0;
        this.out.push(v * 32767);
      }
    }
    if (this.out.length >= 1600) { this.port.postMessage(Int16Array.from(this.out)); this.out = []; }
    return true;
  }
}
registerProcessor('pcm', Pcm);
`

export function useVoiceDialog(opts: { url: string; onEvent: (e: ServerEvent) => void }) {
  const state = ref<'idle' | 'connecting' | 'listening'>('idle')
  let ws: WebSocket | null = null
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let player: HTMLAudioElement | null = null

  function stopBot() {
    player?.pause()
    player = null
  }

  function handle(e: ServerEvent) {
    // Пользователь заговорил поверх бота: перебиваем озвучку.
    if (e.type === 'transcript') stopBot()
    if (e.type === 'bot_audio') {
      stopBot()
      player = new Audio(e.url)
      player.play().catch(() => {})
    }
    opts.onEvent(e)
  }

  function releaseMic() {
    stream?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => {})
    stream = null
    ctx = null
  }

  async function start(expected = '') {
    if (state.value !== 'idle') return
    state.value = 'connecting'
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      state.value = 'idle'
      return opts.onEvent({ type: 'error', message: 'Нет доступа к микрофону. Разрешите его в настройках браузера и нажмите кнопку ещё раз.' })
    }
    try {
      ctx = new AudioContext()
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })))

      const socket = new WebSocket(opts.url)
      ws = socket
      socket.binaryType = 'arraybuffer'
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('ws'))
      })
      socket.onmessage = (m) => typeof m.data === 'string' && handle(JSON.parse(m.data))
      socket.onclose = () => {
        releaseMic()
        state.value = 'idle'
      }
      socket.send(JSON.stringify({ type: 'start', expected, format: 'pcm_s16le', sampleRate: 16000 }))

      const node = new AudioWorkletNode(ctx, 'pcm')
      node.port.onmessage = (e) => socket.readyState === WebSocket.OPEN && socket.send(e.data.buffer)
      const mute = ctx.createGain()
      mute.gain.value = 0
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination)
      state.value = 'listening'
    } catch {
      releaseMic()
      ws?.close()
      state.value = 'idle'
      opts.onEvent({ type: 'error', message: 'Не удалось подключиться к серверу. Проверьте соединение и попробуйте ещё раз.' })
    }
  }

  function stop() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }))
      const s = ws
      setTimeout(() => s.close(), 8000) // даём серверу досказать последний ответ
    }
    releaseMic()
    stopBot()
    state.value = 'idle'
  }

  onBeforeUnmount(() => {
    ws?.close()
    stop()
  })

  return { state, start, stop }
}
