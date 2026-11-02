const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface LiveEvent {
  type: string;
  delta?: string;
  [key: string]: unknown;
}

export async function startVoiceSession(onEvent?: (event: LiveEvent) => void) {
  const peerConnection = new RTCPeerConnection();
  const audioElement = new Audio();

  audioElement.autoplay = true;

  let microphoneStream: MediaStream | null = null;

  try {
    // Получаем микрофон
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    // Подключаем микрофон к WebRTC
    microphoneStream.getAudioTracks().forEach((track) => {
      peerConnection.addTrack(track, microphoneStream!);
    });

    // Принимаем голос AI
    peerConnection.addEventListener("track", (event) => {
      audioElement.srcObject = new MediaStream([event.track]);

      audioElement.play().catch((error) => {
        console.error("Audio playback error:", error);
      });
    });

    // Создаём канал событий
    const dataChannel = peerConnection.createDataChannel("oai-events");

    dataChannel.addEventListener("message", ({ data }) => {
      const event = JSON.parse(data) as LiveEvent;

      console.log("Live event:", event.type);
      onEvent?.(event);
    });

    // Создаём SDP offer
    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    // Ждём завершения ICE gathering
    if (peerConnection.iceGatheringState !== "complete") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          peerConnection.removeEventListener(
            "icegatheringstatechange",
            handleIceGathering,
          );

          reject(new Error("ICE gathering timeout"));
        }, 10000);

        function handleIceGathering() {
          if (peerConnection.iceGatheringState !== "complete") return;

          clearTimeout(timeout);

          peerConnection.removeEventListener(
            "icegatheringstatechange",
            handleIceGathering,
          );

          resolve();
        }

        peerConnection.addEventListener(
          "icegatheringstatechange",
          handleIceGathering,
        );

        handleIceGathering();
      });
    }

    const sdp = peerConnection.localDescription?.sdp;

    if (!sdp) {
      throw new Error("Не удалось создать SDP offer");
    }

    // Отправляем offer на backend
    const response = await fetch(`${API_URL}/api/ai/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sdp }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Session API error:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });

      throw new Error(
        `Не удалось создать голосовую сессию: ${response.status}`,
      );
    }

    const result = await response.json();

    // Устанавливаем SDP answer
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: result.transport.sdp,
    });

    return {
      peerConnection,
      microphoneStream,
      dataChannel,
      audioElement,

      async stop() {
        if (dataChannel.readyState === "open") {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            function handleMessage({ data }: MessageEvent) {
              const event = JSON.parse(data) as LiveEvent;

              if (event.type === "session.closed") {
                clearTimeout(timeout);
                dataChannel.removeEventListener("message", handleMessage);
                resolve();
              }
            }

            dataChannel.addEventListener("message", handleMessage);

            dataChannel.send(JSON.stringify({ type: "session.close" }));
          });
        }

        microphoneStream?.getTracks().forEach((track) => track.stop());

        dataChannel.close();
        peerConnection.close();
        audioElement.srcObject = null;
      },
    };
  } catch (error) {
    microphoneStream?.getTracks().forEach((track) => track.stop());

    peerConnection.close();
    audioElement.srcObject = null;

    throw error;
  }
}
