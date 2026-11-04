<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { startVoiceSession } from "../services/voice";
import { freedomSpeech } from "../services/freedomSpeech";

type VoiceSession = Awaited<ReturnType<typeof startVoiceSession>>;

const isConnecting = ref(false);
const isActive = ref(false);
const isSpeaking = ref(false);

const status = ref("Готов к разговору");
const caption = ref("");
const captionSpeaker = ref("");

let voiceSession: VoiceSession | null = null;

let responseBuffer = "";
let responseTimer: ReturnType<typeof setTimeout> | null = null;

// Если GPT перестал присылать текст на 900 мс,
// отправляем накопленный фрагмент в TTS.
const RESPONSE_PAUSE = 900;

// Количество ожидающих задач озвучивания.
let pendingSpeechCount = 0;

// Последовательная очередь озвучивания.
let speechQueue: Promise<void> = Promise.resolve();

function clearResponseTimer() {
  if (responseTimer) {
    clearTimeout(responseTimer);
    responseTimer = null;
  }
}

function updateSpeakingState() {
  isSpeaking.value = pendingSpeechCount > 0;
}

// Извлекаем из буфера законченные предложения.
function extractCompletePhrases(): string[] {
  const phrases: string[] = [];

  // Знаки, по которым разделяем текст на предложения.
  const punctuation = /[.!?。！？\n]/u;

  while (true) {
    const match = punctuation.exec(responseBuffer);

    if (!match || match.index === undefined) {
      break;
    }

    const endIndex = match.index + match[0].length;

    const phrase = responseBuffer.slice(0, endIndex).trim();

    if (phrase) {
      phrases.push(phrase);
    }

    responseBuffer = responseBuffer.slice(endIndex).trimStart();
  }

  return phrases;
}

// Добавляем текст в очередь озвучивания.
function enqueueSpeech(text: string) {
  if (!text.trim()) return;

  pendingSpeechCount++;
  updateSpeakingState();

  // Не слушаем собственную озвучку через микрофон.
  voiceSession?.pauseMicrophone();

  speechQueue = speechQueue
    .then(async () => {
      if (!isActive.value || !voiceSession) return;

      status.value = "Озвучиваю ответ...";

      console.log("FREEDOMSPEECH START:", text);

      await freedomSpeech.synthesize(text);

      console.log("FREEDOMSPEECH FINISHED:", text);
    })
    .catch((error) => {
      console.error("FreedomSpeech playback error:", error);
      status.value = "Ошибка воспроизведения";
    })
    .finally(() => {
      pendingSpeechCount = Math.max(0, pendingSpeechCount - 1);

      updateSpeakingState();

      // Возвращаем микрофон, когда вся очередь закончилась.
      if (pendingSpeechCount === 0 && voiceSession && isActive.value) {
        voiceSession.resumeMicrophone();
        status.value = "Слушаю тебя, братан";
      }
    });
}

// Отправляем оставшийся текст в TTS.
function flushResponseBuffer() {
  clearResponseTimer();

  const text = responseBuffer.trim();
  responseBuffer = "";

  if (!text || !voiceSession || !isActive.value) return;

  console.log("TTS BUFFER FLUSH:", text);

  enqueueSpeech(text);
}

// Обрабатываем события OpenAI Realtime.
function handleVoiceEvent(event: any) {
  switch (event.type) {
    case "session.started": {
      isConnecting.value = false;
      isActive.value = true;
      status.value = "Слушаю тебя, братан";
      break;
    }

    case "session.input_transcript.delta": {
      captionSpeaker.value = "user";
      caption.value += event.delta ?? "";
      break;
    }

    case "session.output_transcript.delta": {
      const delta = event.delta ?? "";

      captionSpeaker.value = "assistant";
      caption.value += delta;

      // Добавляем новую часть текста в буфер.
      responseBuffer += delta;

      // Проверяем, появилось ли законченное предложение.
      const phrases = extractCompletePhrases();

      // Каждое готовое предложение сразу отправляем в TTS.
      for (const phrase of phrases) {
        console.log("TTS PHRASE READY:", phrase);
        enqueueSpeech(phrase);
      }

      // Если остался незаконченный фрагмент,
      // ждём небольшую паузу и отправляем его.
      clearResponseTimer();

      if (responseBuffer.trim()) {
        responseTimer = setTimeout(() => {
          flushResponseBuffer();
        }, RESPONSE_PAUSE);
      }

      // Не перезаписываем статус, если TTS уже говорит.
      if (pendingSpeechCount === 0) {
        status.value = "Готовлю ответ...";
      }

      break;
    }

    // Если OpenAI сообщил, что текст ответа закончен,
    // отправляем остаток буфера без дополнительного ожидания.
    case "session.output_transcript.done": {
      flushResponseBuffer();
      break;
    }

    case "session.closed": {
      clearResponseTimer();
      responseBuffer = "";

      isActive.value = false;
      isConnecting.value = false;
      isSpeaking.value = false;
      pendingSpeechCount = 0;

      freedomSpeech.disconnect();

      status.value = "Разговор завершён";
      break;
    }

    case "error": {
      console.error("Voice session error:", event);
      status.value = "Ошибка голосовой сессии";
      break;
    }
  }
}

async function startVoice() {
  if (isConnecting.value || isActive.value) return;

  isConnecting.value = true;
  status.value = "Подключаюсь...";

  try {
    console.log("1. Подключаем FreedomSpeech...");

    await freedomSpeech.connect();

    console.log("2. FreedomSpeech подключён");

    console.log("3. Запускаем OpenAI Voice Session...");

    voiceSession = await startVoiceSession(handleVoiceEvent);

    console.log("4. OpenAI Voice Session запущена");

    voiceSession.audioElement.muted = true;
    voiceSession.audioElement.volume = 0;

    isConnecting.value = false;
    isActive.value = true;
    status.value = "Слушаю тебя, братан";
  } catch (error) {
    console.error("Ошибка запуска:", error);

    console.error(
      "Тип ошибки:",
      error instanceof Error ? error.name : typeof error,
    );

    console.error("Сообщение:", error instanceof Error ? error.message : error);

    freedomSpeech.disconnect();

    voiceSession = null;

    isConnecting.value = false;
    isActive.value = false;

    status.value = "Не удалось подключиться";
  }
}

async function stopVoice() {
  if (!voiceSession) return;

  clearResponseTimer();
  responseBuffer = "";

  status.value = "Завершаю разговор...";

  const session = voiceSession;
  voiceSession = null;

  isActive.value = false;
  isSpeaking.value = false;
  pendingSpeechCount = 0;

  try {
    await session.stop();
  } catch (error) {
    console.error("Ошибка остановки голосовой сессии:", error);
  } finally {
    freedomSpeech.disconnect();

    isConnecting.value = false;
    status.value = "Разговор завершён";
  }
}

onUnmounted(() => {
  clearResponseTimer();
  responseBuffer = "";

  isActive.value = false;
  isSpeaking.value = false;
  pendingSpeechCount = 0;

  freedomSpeech.disconnect();

  if (voiceSession) {
    void voiceSession.stop();
    voiceSession = null;
  }
});
</script>

<template>
  <main class="voice-page">
    <div class="voice-layout">
      <header class="voice-header">
        <div class="brand">
          <div class="brand-icon">Q</div>

          <div class="brand-info">
            <h1>QazaqTalk</h1>
            <span>Твой казахский кореш</span>
          </div>
        </div>

        <div class="online-status">
          <span class="status-dot"></span>
          AI ONLINE
        </div>
      </header>

      <section class="voice-main">
        <div class="greeting">
          <span class="greeting-label">QAZAQTALK AI</span>

          <h2>
            Здарова, братан!
            <span>👊</span>
          </h2>

          <p>Готов подтянуть твой казахский? Давай побазарим!</p>
        </div>

        <div
          class="orb-container"
          :class="{
            connecting: isConnecting,
            active: isActive,
          }"
        >
          <div class="orb-ring ring-one"></div>
          <div class="orb-ring ring-two"></div>
          <div class="orb-ring ring-three"></div>

          <div class="orb">
            <div class="orb-inner">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 2v20" />
                <path d="M8 5v14" />
                <path d="M16 5v14" />
                <path d="M4 9v6" />
                <path d="M20 9v6" />
              </svg>
            </div>
          </div>
        </div>

        <div class="voice-info">
          <div class="voice-indicator">
            <span
              class="indicator-dot"
              :class="{
                active: isActive,
                connecting: isConnecting,
              }"
            ></span>

            {{ status }}
          </div>

          <p v-if="!isActive && !isConnecting">
            {{
              status === "Разговор завершён"
                ? "Отдохнул? Можем продолжить!"
                : "Нажми на микрофон и начинай говорить"
            }}
          </p>

          <p v-else-if="isConnecting">Устанавливаем соединение...</p>

          <p v-else-if="isSpeaking">Подожди, пока я закончу говорить</p>

          <p v-else>Можешь говорить — я тебя слушаю</p>
        </div>

        <div v-if="caption" class="caption">
          <span>{{ captionSpeaker }}</span>
          <p>{{ caption }}</p>
        </div>
      </section>

      <footer class="voice-footer">
        <button
          v-if="!isActive && !isConnecting"
          class="mic-button"
          type="button"
          @click="startVoice"
          aria-label="Начать разговор"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
            <path d="M12 19v3M8 22h8" />
          </svg>
        </button>

        <button
          v-else-if="isConnecting"
          class="mic-button connecting-button"
          type="button"
          disabled
        >
          <span class="loader"></span>
        </button>

        <button
          v-else
          class="mic-button stop-button"
          type="button"
          @click="stopVoice"
          aria-label="Завершить разговор"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>

        <span class="control-hint">
          {{
            isConnecting
              ? "Подключаемся..."
              : isActive
                ? "Завершить разговор"
                : "Начать разговор"
          }}
        </span>

        <p class="footer-description">
          Общайся свободно. Я помогу тебе освоить казахский.
        </p>
      </footer>
    </div>
  </main>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.voice-page {
  min-height: 100vh;
  background: #171622;
  color: #f5f3ff;
  display: flex;
  justify-content: center;
  padding: 0 24px;
  font-family: Inter, Arial, sans-serif;
}

.voice-layout {
  width: 100%;
  max-width: 900px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.voice-header {
  height: 82px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #302d3e;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #a855f7, #7e22ce);
  font-size: 22px;
  font-weight: 800;
}

.brand-info h1 {
  font-size: 17px;
  margin: 0 0 4px;
}

.brand-info span {
  font-size: 12px;
  color: #9995ad;
}

.online-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.7px;
  color: #a5a0b8;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #4ade80;
  border-radius: 50%;
  box-shadow: 0 0 10px #4ade8070;
}

.voice-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  text-align: center;
}

.greeting-label {
  color: #b78bea;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2px;
}

.greeting h2 {
  font-size: clamp(26px, 5vw, 36px);
  margin: 15px 0 10px;
}

.greeting p {
  color: #9995ad;
  font-size: 14px;
  margin: 0;
}

.orb-container {
  position: relative;
  width: 250px;
  height: 250px;
  display: grid;
  place-items: center;
  margin: 45px 0 35px;
}

.orb {
  width: 155px;
  height: 155px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 30% 25%, #d8a9ff, transparent 35%),
    radial-gradient(circle at 70% 75%, #6b21a8, transparent 45%),
    linear-gradient(135deg, #a855f7, #6b21a8 65%, #3b1763);
  box-shadow:
    0 0 35px #9333ea80,
    0 0 90px #9333ea35,
    inset -10px -12px 30px #30104e80;
  animation: orb-idle 4s ease-in-out infinite;
  z-index: 2;
}

.orb-inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #fff;
}

.orb-inner svg {
  width: 54px;
  height: 54px;
}

.orb-ring {
  position: absolute;
  border: 1px solid #a855f750;
  border-radius: 50%;
}

.ring-one {
  width: 185px;
  height: 185px;
}

.ring-two {
  width: 220px;
  height: 220px;
  border-color: #a855f730;
}

.ring-three {
  width: 250px;
  height: 250px;
  border-color: #a855f720;
}

@keyframes orb-idle {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.06);
  }
}

.connecting .orb {
  animation: connecting-pulse 1s ease-in-out infinite;
}

.connecting .ring-one,
.connecting .ring-two {
  animation: ring-pulse 1.5s ease-out infinite;
}

@keyframes connecting-pulse {
  50% {
    transform: scale(0.94);
    opacity: 0.7;
  }
}

@keyframes ring-pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.7;
  }

  100% {
    transform: scale(1.12);
    opacity: 0;
  }
}

.active .orb {
  animation: orb-speaking 1.5s ease-in-out infinite;
  box-shadow:
    0 0 45px #a855f7a0,
    0 0 110px #9333ea70,
    inset -10px -12px 30px #30104e80;
}

.active .ring-one {
  animation: ring-active 2s ease-in-out infinite;
}

.active .ring-two {
  animation: ring-active 2s ease-in-out infinite 0.3s;
}

.active .ring-three {
  animation: ring-active 2s ease-in-out infinite 0.6s;
}

@keyframes orb-speaking {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.09);
  }
}

@keyframes ring-active {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.25;
  }

  50% {
    transform: scale(1.06);
    opacity: 0.8;
  }
}

.voice-info {
  min-height: 65px;
}

.voice-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;
  font-size: 16px;
  font-weight: 600;
}

.indicator-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #777287;
}

.indicator-dot.active {
  background: #4ade80;
  box-shadow: 0 0 10px #4ade80;
}

.indicator-dot.connecting {
  background: #facc15;
  animation: blink 0.8s infinite;
}

@keyframes blink {
  50% {
    opacity: 0.3;
  }
}

.voice-info > p {
  color: #9995ad;
  font-size: 13px;
  margin-top: 10px;
}

.caption {
  max-width: 520px;
  width: 100%;
  margin-top: 22px;
  padding: 14px 18px;
  background: #292735;
  border: 1px solid #383447;
  border-radius: 14px;
  text-align: left;
}

.caption span {
  color: #b78bea;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.caption p {
  margin: 7px 0 0;
  color: #e5e1ef;
  font-size: 14px;
  line-height: 1.6;
}

.voice-footer {
  flex-shrink: 0;
  padding: 25px 0 30px;
  border-top: 1px solid #302d3e;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mic-button {
  width: 76px;
  height: 76px;
  border: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #a855f7, #7e22ce);
  color: white;
  cursor: pointer;
  box-shadow: 0 0 30px #9333ea50;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.mic-button:hover:not(:disabled) {
  transform: scale(1.07);
  box-shadow: 0 0 40px #9333ea90;
}

.mic-button svg {
  width: 32px;
  height: 32px;
}

.stop-button {
  background: #dc2626;
  box-shadow: 0 0 25px #dc262650;
}

.stop-button:hover {
  background: #ef4444;
}

.connecting-button {
  cursor: wait;
  opacity: 0.8;
}

.loader {
  width: 27px;
  height: 27px;
  border: 3px solid #ffffff50;
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.control-hint {
  margin-top: 14px;
  font-size: 13px;
  color: #d4cce8;
}

.footer-description {
  color: #777287;
  font-size: 11px;
  margin-top: 12px;
  text-align: center;
}

@media (max-width: 600px) {
  .voice-page {
    padding: 0 16px;
  }

  .voice-header {
    height: 70px;
  }

  .orb-container {
    margin: 35px 0 25px;
    transform: scale(0.9);
  }

  .greeting h2 {
    font-size: 27px;
  }

  .voice-footer {
    padding-bottom: 25px;
  }
}
</style>
