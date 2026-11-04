const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const SAMPLE_RATE = 24000;

interface TTSMessage {
  type: "audio_chunk" | "audio_end" | "error";
  requestId?: string;
  audio?: string;
  chunkIndex?: number;
  sampleRate?: number;
  totalChunks?: number;
  message?: string;
  code?: string;
}

class FreedomSpeechClient {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;

  // Время, с которого должен начаться следующий аудиочанк.
  private nextStartTime = 0;

  // Не допускаем одновременного воспроизведения разных фраз.
  private synthesisQueue: Promise<void> = Promise.resolve();
  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log("Frontend TTS WebSocket already connected");
      return;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      throw new Error("TTS WebSocket уже подключается");
    }

    const wsUrl = API_URL.replace(/^http/, "ws").replace(/\/$/, "");
    const socket = new WebSocket(`${wsUrl}/api/ai/tts-stream`);

    this.socket = socket;

    console.log("Connecting to:", `${wsUrl}/api/ai/tts-stream`);

    this.audioContext = new AudioContext({
      sampleRate: SAMPLE_RATE,
    });

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      const fail = (error: Error) => {
        if (settled) return;

        settled = true;
        cleanup();
        reject(error);
      };

      const handleOpen = async () => {
        console.log("Frontend TTS WebSocket connected");

        try {
          await this.audioContext?.resume();

          if (socket.readyState !== WebSocket.OPEN) {
            throw new Error("TTS WebSocket закрылся во время подключения");
          }

          settled = true;
          cleanup();
          resolve();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Не удалось запустить AudioContext"),
          );
        }
      };

      const handleError = (event: Event) => {
        console.error("Frontend TTS WebSocket error:", event);

        fail(new Error("Не удалось подключиться к TTS WebSocket"));
      };

      const handleClose = (event: CloseEvent) => {
        console.error("Frontend socket closed:", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });

        if (!settled) {
          fail(
            new Error(`TTS WebSocket закрыт: ${event.code} ${event.reason}`),
          );
        }
      };

      const timeout = setTimeout(() => {
        socket.close();

        fail(new Error("TTS WebSocket: превышено время ожидания подключения"));
      }, 10000);

      // Сначала устанавливаем обработчики, затем ждём события.
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  synthesize(text: string): Promise<void> {
    // Выполняем синтез фраз последовательно.
    const task = this.synthesisQueue.then(() => this.synthesizeInternal(text));

    // Ошибка одной фразы не должна блокировать следующие.
    this.synthesisQueue = task.catch(() => {});

    return task;
  }

  private async synthesizeInternal(text: string): Promise<void> {
    const socket = this.socket;
    const audioContext = this.audioContext;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("TTS WebSocket не подключён");
    }

    if (!audioContext || audioContext.state === "closed") {
      throw new Error("AudioContext недоступен");
    }

    await audioContext.resume();

    const requestId = crypto.randomUUID();

    let pendingByte: number | null = null;
    let lastSourceEnded: Promise<void> | null = null;

    this.nextStartTime = Math.max(this.nextStartTime, audioContext.currentTime);

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("close", handleClose);
      };

      const fail = (error: Error) => {
        if (settled) return;

        settled = true;
        cleanup();
        reject(error);
      };

      const handleClose = () => {
        fail(new Error("TTS WebSocket закрыт"));
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data) as TTSMessage;

          console.log("TTS MESSAGE RECEIVED:", {
            type: message.type,
            requestId: message.requestId,
            expectedRequestId: requestId,
            chunkIndex: message.chunkIndex,
            sampleRate: message.sampleRate,
            audioLength: message.audio?.length,
          });

          // Временно разрешаем сообщения без requestId.
          if (message.requestId && message.requestId !== requestId) {
            console.warn("TTS: чужой requestId", message.requestId);
            return;
          }

          if (message.type === "error") {
            fail(new Error(message.message || "Ошибка синтеза речи"));
            return;
          }

          if (message.type === "audio_chunk" && message.audio) {
            const binary = atob(message.audio);
            const bytes = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }

            // Если предыдущий чанк закончился половиной PCM-сэмпла,
            // объединяем её с первым байтом нового чанка.
            let pcmBytes = bytes;

            if (pendingByte !== null) {
              const combined = new Uint8Array(bytes.length + 1);
              combined[0] = pendingByte;
              combined.set(bytes, 1);

              pcmBytes = combined;
              pendingByte = null;
            }

            // Один PCM-сэмпл занимает два байта.
            if (pcmBytes.length % 2 !== 0) {
              pendingByte = pcmBytes[pcmBytes.length - 1];
              pcmBytes = pcmBytes.subarray(0, pcmBytes.length - 1);
            }

            if (pcmBytes.length === 0) return;

            const sampleCount = pcmBytes.length / 2;

            const audioBuffer = audioContext.createBuffer(
              1,
              sampleCount,
              SAMPLE_RATE,
            );

            const channelData = audioBuffer.getChannelData(0);

            const dataView = new DataView(
              pcmBytes.buffer,
              pcmBytes.byteOffset,
              pcmBytes.byteLength,
            );

            for (let i = 0; i < sampleCount; i++) {
              const sample = dataView.getInt16(i * 2, true);
              channelData[i] = sample / 32768;
            }

            const source = audioContext.createBufferSource();

            console.log("AUDIO CHUNK:", {
              bytes: pcmBytes.length,
              samples: sampleCount,
              duration: sampleCount / SAMPLE_RATE,
              audioContextState: audioContext.state,
            });

            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            lastSourceEnded = new Promise<void>((resolveEnded) => {
              source.addEventListener("ended", () => resolveEnded(), {
                once: true,
              });
            });

            // Запускаем чанк сразу после предыдущего.
            this.nextStartTime = Math.max(
              this.nextStartTime,
              audioContext.currentTime,
            );

            console.log("PLAYING AUDIO:", {
              currentTime: audioContext.currentTime,
              startTime: this.nextStartTime,
            });

            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;
          }

          if (message.type === "audio_end") {
            if (pendingByte !== null) {
              fail(new Error("Получен неполный PCM-сэмпл"));
              return;
            }

            // Ждём окончания воспроизведения последнего чанка.
            const finish = async () => {
              if (lastSourceEnded) {
                await lastSourceEnded;
              }

              if (settled) return;

              settled = true;
              cleanup();
              resolve();
            };

            void finish();
          }
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Ошибка обработки аудиочанка"),
          );
        }
      };

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", handleClose);

      socket.send(
        JSON.stringify({
          type: "synthesize",
          text,
          requestId,
        }),
      );
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }

    this.audioContext = null;
    this.nextStartTime = 0;
  }
}

export const freedomSpeech = new FreedomSpeechClient();
