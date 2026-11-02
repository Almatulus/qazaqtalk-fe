<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { NButton } from "naive-ui";
import { createSpeechConnection } from "../services/freedomSpeech";

type ConversationStatus = "idle" | "listening" | "speaking";

const status = ref<ConversationStatus>("idle");
const seconds = ref(0);
const formattedTime = ref("00:00");
const recognizedText = ref("");
const errorMessage = ref("");
const isTestingWebSocket = ref(false);

let ws: WebSocket | null = null;
let testWs: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let gainNode: GainNode | null = null;

let timer: ReturnType<typeof setInterval> | null = null;
let finalTranscript = "";

function updateTime() {
  const minutes = Math.floor(seconds.value / 60);
  const remainingSeconds = seconds.value % 60;

  formattedTime.value = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function startTimer() {
  if (timer) clearInterval(timer);

  seconds.value = 0;
  updateTime();

  timer = setInterval(() => {
    seconds.value++;
    updateTime();
  }, 1000);
}

// Проверяет только WebSocket-подключение: микрофон и аудио не запускаются.
function testWebSocket() {
  if (testWs && testWs.readyState < WebSocket.CLOSING) {
    console.warn("WS TEST: проверка уже выполняется");
    return;
  }

  errorMessage.value = "";
  isTestingWebSocket.value = true;
  console.log("WS TEST: начинаем подключение");

  try {
    const socket = createSpeechConnection((message) => {
      console.log("WS TEST RESPONSE:", message);

      if (message.type === "ready") {
        console.log("WS TEST: сервер готов принимать аудио");
        // В этом тесте аудио не отправляем — сразу закрываем соединение.
        socket.close();
      }

      if (message.type === "error") {
        console.error("WS TEST ERROR:", message);
        errorMessage.value = `WebSocket: ${message.message}`;
        socket.close();
      }
    });

    testWs = socket;

    socket.onopen = () => {
      console.log("WS TEST: WebSocket connection opened");
    };

    socket.onerror = (event) => {
      console.error("WS TEST: WebSocket connection error", event);
    };

    socket.onclose = (event) => {
      console.log("WS TEST: connection closed", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      isTestingWebSocket.value = false;
      if (testWs === socket) testWs = null;
    };
  } catch (error) {
    console.error("WS TEST: не удалось создать соединение", error);
    errorMessage.value =
      error instanceof Error ? error.message : "Ошибка WebSocket-подключения";
    isTestingWebSocket.value = false;
  }
}

async function startMicrophone(socket: WebSocket) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Просим браузер создать аудиоконтекст с частотой 16 kHz.
    audioContext = new AudioContext({ sampleRate: 16000 });

    console.log("AudioContext sampleRate:", audioContext.sampleRate);
    console.log(
      "MediaStream track settings:",
      mediaStream.getAudioTracks()[0].getSettings(),
    );

    await audioContext.resume();

    // Проверяем, действительно ли браузер использовал 16 kHz.
    if (audioContext.sampleRate !== 16000) {
      throw new Error(
        `Ожидалось 16000 Hz, получено ${audioContext.sampleRate} Hz`,
      );
    }

    audioSource = audioContext.createMediaStreamSource(mediaStream);

    // 2048 сэмплов при 16 kHz — примерно 128 мс аудио.
    processor = audioContext.createScriptProcessor(2048, 1, 1);

    // Не воспроизводим микрофон обратно в динамики.
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);

      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }

      console.log({
        samples: pcm.length,
        bytes: pcm.byteLength,
        sampleRate: audioContext?.sampleRate,
        durationMs: (pcm.length / 16000) * 1000,
      });

      socket.send(pcm.buffer);
    };

    audioSource.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);

    status.value = "listening";
    startTimer();
  } catch (error) {
    console.error("Ошибка запуска микрофона:", error);

    errorMessage.value =
      error instanceof Error ? error.message : "Не удалось запустить микрофон";

    endConversation();
  }
}

function startConversation() {
  errorMessage.value = "";
  recognizedText.value = "";
  finalTranscript = "";

  status.value = "listening";

  try {
    ws = createSpeechConnection((message) => {
      if (message.type === "ready") {
        console.log("FreedomSpeech готов к приёму аудио");

        if (ws && status.value === "listening") {
          void startMicrophone(ws);
        }
      }

      if (message.type === "partial") {
        recognizedText.value =
          finalTranscript + (finalTranscript ? " " : "") + message.text;
      }

      if (message.type === "final") {
        finalTranscript += (finalTranscript ? " " : "") + message.text;

        recognizedText.value = finalTranscript;

        console.log("Распознано:", message.text);
        console.log("Язык:", message.language);
      }

      if (message.type === "error") {
        console.error("Ошибка FreedomSpeech:", message);
        errorMessage.value = message.message;
        status.value = "idle";
        stopAudioCapture();

        if (timer) {
          clearInterval(timer);
          timer = null;
        }

        const failedSocket = ws;
        ws = null;
        failedSocket?.close();
        seconds.value = 0;
        updateTime();
      }
    });

    ws.onclose = () => {
      if (status.value !== "idle") {
        errorMessage.value = "Соединение с FreedomSpeech закрыто";
        endConversation();
      }
    };
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Ошибка подключения";

    endConversation();
  }
}

function stopAudioCapture() {
  processor?.disconnect();
  audioSource?.disconnect();
  gainNode?.disconnect();

  processor = null;
  audioSource = null;
  gainNode = null;

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;

  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}

function endConversation() {
  status.value = "idle";

  stopAudioCapture();

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const socketToClose = ws;

  if (socketToClose) {
    if (socketToClose.readyState === WebSocket.OPEN) {
      // Просим сервер завершить текущую фразу.
      socketToClose.send(JSON.stringify({ type: "stop" }));

      // Даём серверу время отправить финальный результат.
      setTimeout(() => {
        socketToClose.close();

        // Обнуляем ws, только если это всё ещё то же соединение.
        if (ws === socketToClose) {
          ws = null;
        }
      }, 1000);
    } else {
      socketToClose.close();
      ws = null;
    }
  }

  seconds.value = 0;
  updateTime();
}

const statusText = {
  idle: "Готов к разговору?",
  listening: "Слушаю тебя...",
  speaking: "ИИ говорит...",
};

onUnmounted(() => {
  status.value = "idle";

  stopAudioCapture();

  if (timer) clearInterval(timer);

  ws?.close();
  ws = null;
  testWs?.close();
  testWs = null;
});
</script>

<template>
  <main class="voice-page">
    <header class="voice-header">
      <div class="brand">
        <div class="brand-icon">
          <span>Q</span>
        </div>

        <span class="brand-name">QazaqTalk</span>
      </div>

      <div class="header-label">
        <span class="status-dot"></span>
        AI Language Tutor
      </div>
    </header>

    <section class="voice-content">
      <div class="lesson-label">
        <span class="lesson-indicator"></span>
        ПРАКТИКА РАЗГОВОРНОГО КАЗАХСКОГО
      </div>

      <h1>Сөйлесейік!</h1>

      <p class="description">
        Практикуй казахский язык в живом диалоге с ИИ-репетитором
      </p>

      <div class="voice-visual" :class="status">
        <div class="voice-ring ring-outer"></div>
        <div class="voice-ring ring-middle"></div>

        <div class="voice-circle">
          <svg viewBox="0 0 100 100" width="76" height="76" fill="none">
            <path
              d="M50 15C43.9 15 39 19.9 39 26V50C39 56.1 43.9 61 50 61C56.1 61 61 56.1 61 50V26C61 19.9 56.1 15 50 15Z"
              stroke="currentColor"
              stroke-width="4"
              stroke-linecap="round"
            />
            <path
              d="M28 46V50C28 62.2 37.8 72 50 72C62.2 72 72 62.2 72 50V46"
              stroke="currentColor"
              stroke-width="4"
              stroke-linecap="round"
            />
            <path
              d="M50 72V85M39 85H61"
              stroke="currentColor"
              stroke-width="4"
              stroke-linecap="round"
            />
          </svg>
        </div>
      </div>

      <h2>{{ statusText[status] }}</h2>

      <p class="status-description">
        <template v-if="status === 'idle'">
          Нажми на кнопку, чтобы начать разговор
        </template>

        <template v-else-if="status === 'listening'">
          Говори на казахском или русском языке
        </template>

        <template v-else> Послушай ответ и продолжай разговор </template>
      </p>

      <div class="conversation-timer">
        <span class="timer-dot"></span>
        {{ formattedTime }}
      </div>

      <div class="controls">
        <n-button
          v-if="status === 'idle'"
          type="primary"
          size="large"
          class="start-button"
          @click="startConversation"
        >
          <template #icon>
            <span>🎙</span>
          </template>

          Начать разговор
        </n-button>

        <n-button
          v-else
          type="error"
          size="large"
          class="end-button"
          @click="endConversation"
        >
          <template #icon>
            <span>■</span>
          </template>

          Завершить разговор
        </n-button>
      </div>

      <n-button
        v-if="status === 'idle'"
        secondary
        size="medium"
        class="test-button"
        :disabled="isTestingWebSocket"
        @click="testWebSocket"
      >
        {{ isTestingWebSocket ? "Проверяем подключение..." : "Проверить WebSocket" }}
      </n-button>

      <div class="transcription">
        <h3>Распознанная речь</h3>

        <p v-if="recognizedText">
          {{ recognizedText }}
        </p>

        <p v-else class="empty-text">Здесь появится твоя речь...</p>
      </div>

      <p v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </p>

      <div class="hint">
        <span>💡</span>
        Не бойся ошибаться — ИИ поможет тебе учиться
      </div>
    </section>

    <footer class="voice-footer">
      <span>QazaqTalk</span>
      <span>Практикуй. Говори. Развивайся.</span>
    </footer>
  </main>
</template>

<style scoped>
.voice-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: #24212e;
  background:
    radial-gradient(circle at 50% 43%, #f0eaff 0, transparent 35%), #faf9fc;
}

.voice-header {
  height: 76px;
  padding: 0 7%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #eeebf3;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: white;
  background: #8054df;
  border-radius: 11px;
  font-weight: 700;
  font-size: 20px;
}

.brand-name {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.header-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #777184;
  font-size: 13px;
}

.status-dot,
.lesson-indicator,
.timer-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #27b887;
}

.voice-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 50px 20px;
  text-align: center;
}

.lesson-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8054df;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
}

.lesson-indicator {
  background: #8054df;
}

h1 {
  margin: 22px 0 10px;
  font-size: clamp(38px, 5vw, 54px);
  font-weight: 750;
  letter-spacing: -2px;
}

.description {
  max-width: 390px;
  margin: 0;
  color: #888294;
  font-size: 15px;
  line-height: 1.6;
}

.voice-visual {
  position: relative;
  width: 240px;
  height: 240px;
  display: grid;
  place-items: center;
  margin: 40px 0 20px;
}

.voice-ring {
  position: absolute;
  border: 1px solid rgba(128, 84, 223, 0.15);
  border-radius: 50%;
}

.ring-outer {
  width: 100%;
  height: 100%;
}

.ring-middle {
  width: 82%;
  height: 82%;
}

.voice-circle {
  width: 140px;
  height: 140px;
  display: grid;
  place-items: center;
  color: white;
  background: linear-gradient(145deg, #a17aef, #7650d2);
  border-radius: 50%;
  box-shadow: 0 15px 45px rgba(128, 84, 223, 0.28);
  transition:
    transform 0.3s,
    box-shadow 0.3s;
}

.voice-visual.listening .voice-circle {
  animation: pulse 1.8s infinite;
}

.voice-visual.speaking .voice-circle {
  animation: pulse 1s infinite;
  background: linear-gradient(145deg, #54c8a0, #269e80);
}

.voice-visual.speaking .voice-ring {
  border-color: rgba(39, 184, 135, 0.25);
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 15px 45px rgba(128, 84, 223, 0.28);
  }

  50% {
    transform: scale(1.08);
    box-shadow: 0 15px 65px rgba(128, 84, 223, 0.4);
  }
}

h2 {
  margin: 8px 0;
  font-size: 21px;
  font-weight: 650;
}

.status-description {
  margin: 0;
  color: #888294;
  font-size: 14px;
}

.conversation-timer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 25px;
  color: #777184;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.timer-dot {
  width: 6px;
  height: 6px;
  background: #c5bfce;
}

.controls {
  margin-top: 30px;
}

.start-button,
.end-button {
  min-width: 220px;
  height: 50px;
  border-radius: 13px;
  font-weight: 600;
}

.start-button {
  background: #8054df;
}

.test-button {
  margin-top: 12px;
}

.start-button:hover {
  background: #7045cb;
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 30px;
  color: #9992a4;
  font-size: 12px;
}

.voice-footer {
  min-height: 65px;
  padding: 0 7%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #eeebf3;
  color: #aaa4b3;
  font-size: 12px;
}

@media (max-width: 600px) {
  .voice-header {
    padding: 0 20px;
  }

  .header-label {
    font-size: 11px;
  }

  .voice-footer {
    padding: 0 20px;
  }

  .voice-visual {
    width: 210px;
    height: 210px;
  }

  .voice-circle {
    width: 125px;
    height: 125px;
  }
}

.transcription {
  width: 100%;
  max-width: 500px;
  margin-top: 35px;
  padding: 20px;
  text-align: left;
  background: white;
  border: 1px solid #eeebf3;
  border-radius: 16px;
}

.transcription h3 {
  margin: 0 0 12px;
  font-size: 14px;
}

.transcription p {
  color: #555064;
  font-size: 14px;
  line-height: 1.6;
}

.empty-text {
  color: #aaa4b3 !important;
}

.error-message {
  color: #e05252;
  font-size: 13px;
}
</style>
