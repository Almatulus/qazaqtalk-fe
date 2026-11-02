<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { startVoiceSession, type LiveEvent } from "../services/voice";

type VoiceSession = Awaited<ReturnType<typeof startVoiceSession>>;

const isConnecting = ref(false);
const isActive = ref(false);
const status = ref("Готов к разговору");
const caption = ref("");
const captionSpeaker = ref("");

let voiceSession: VoiceSession | null = null;

function handleVoiceEvent(event: LiveEvent) {
  switch (event.type) {
    case "session.started":
      isConnecting.value = false;
      isActive.value = true;
      status.value = "Слушаю тебя, братан";
      break;

    case "session.input_transcript.delta":
      captionSpeaker.value = "ТЫ";
      caption.value += event.delta ?? "";
      status.value = "Слушаю тебя, братан";
      break;

    case "session.output_transcript.delta":
      if (captionSpeaker.value !== "QAZAQTALK") {
        caption.value = "";
      }

      captionSpeaker.value = "QAZAQTALK";
      caption.value += event.delta ?? "";
      status.value = "Базарю, слушай";
      break;

    case "session.closed":
      isActive.value = false;
      status.value = "Разговор завершён";
      break;

    case "error":
      console.error("GPT-Live error:", event);
      status.value = "Произошла ошибка";
      break;
  }
}

async function startVoice() {
  if (isConnecting.value || isActive.value) return;

  isConnecting.value = true;
  status.value = "Подключаемся к QazaqTalk...";
  caption.value = "";
  captionSpeaker.value = "";

  try {
    voiceSession = await startVoiceSession(handleVoiceEvent);

    isConnecting.value = false;
    isActive.value = true;
    status.value = "Слушаю тебя, братан";
  } catch (error) {
    console.error("Voice connection error:", error);

    status.value =
      error instanceof Error ? error.message : "Не удалось подключиться";

    isConnecting.value = false;
    isActive.value = false;
    voiceSession = null;
  }
}

async function stopVoice() {
  if (!voiceSession) return;

  status.value = "Завершаем разговор...";

  const session = voiceSession;
  voiceSession = null;

  try {
    await session.stop();
  } catch (error) {
    console.error("Voice stop error:", error);
  } finally {
    isActive.value = false;
    isConnecting.value = false;
    status.value = "Разговор завершён";
  }
}

onUnmounted(() => {
  if (voiceSession) {
    void voiceSession.stop();
    voiceSession = null;
  }
});
</script>

<template>
  <main class="voice-page">
    <div class="voice-layout">
      <!-- Header -->
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

      <!-- Main -->
      <section class="voice-main">
        <div class="greeting">
          <span class="greeting-label">QAZAQTALK AI</span>

          <h2>
            Здарова, братан!
            <span>👊</span>
          </h2>

          <p>Готов подтянуть твой казахский? Давай побазарим!</p>
        </div>

        <!-- Animated sphere -->
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

        <!-- Status -->
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

          <p v-else>Можешь говорить — я тебя слушаю</p>
        </div>

        <!-- Last transcript -->
        <div v-if="caption" class="caption">
          <span>{{ captionSpeaker }}</span>
          <p>{{ caption }}</p>
        </div>
      </section>

      <!-- Controls -->
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

/* Orb */

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

/* Connecting */

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

/* Active conversation */

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

/* Status */

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

/* Caption */

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

/* Controls */

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
