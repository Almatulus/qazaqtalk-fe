type SpeechResultEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function startSpeechRecognition(
  onTranscript: (text: string) => void,
  onError: (message: string) => void,
  onEnd: () => void,
): SpeechRecognitionLike {
  const speechWindow = window as SpeechWindow;

  const SpeechRecognition =
    speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    throw new Error(
      "Твой браузер не поддерживает распознавание речи. Попробуй Chrome или Edge.",
    );
  }

  const recognition = new SpeechRecognition();

  let finalTranscript = "";

  //   recognition.lang = "ru-RU";
  recognition.lang = "kk-KZ";
  recognition.interimResults = false;
  recognition.continuous = true;

  recognition.onresult = (event) => {
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];

      if (result.isFinal) {
        finalTranscript += result[0].transcript + " ";
      }
    }

    console.log("Распознанный текст:", finalTranscript);
  };

  recognition.onerror = (event) => {
    console.error("Ошибка распознавания:", event.error);
    onError(event.error);
  };

  recognition.onend = () => {
    console.log("Распознавание завершено");

    const transcript = finalTranscript.trim();

    if (transcript) {
      console.log("Отправляем итоговый текст:", transcript);
      onTranscript(transcript);
    }

    onEnd();
  };

  recognition.start();

  return recognition;
}
