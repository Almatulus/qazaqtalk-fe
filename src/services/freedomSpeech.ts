const API_KEY = import.meta.env.VITE_FREEDOM_SPEECH_API_KEY;

export type FreedomSpeechMessage =
  | { type: "ready" }
  | { type: "partial"; text: string; is_final?: boolean }
  | { type: "final"; text: string; language?: string }
  | { type: "error"; message: string };

export function createSpeechConnection(
  onMessage: (message: FreedomSpeechMessage) => void,
) {
  if (!API_KEY) {
    throw new Error("Не найден API-ключ FreedomSpeech");
  }

  const ws = new WebSocket(
    `wss://api.freedomspeech.kz/ws/asr?apiKey=${encodeURIComponent(API_KEY)}`,
  );

  ws.onmessage = (event: MessageEvent) => {
    console.log("FreedomSpeech RAW:", event.data);

    try {
      const message = JSON.parse(event.data);
      console.log("FreedomSpeech parsed:", message);
      onMessage(message);
    } catch (error) {
      console.error("Ошибка обработки сообщения:", error);
    }
  };

  ws.onerror = (error) => {
    console.error("FreedomSpeech WebSocket error:", error);
  };

  return ws;
}
