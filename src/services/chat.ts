const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export async function sendMessage(message: string): Promise<string> {
  const response = await fetch(`${API_URL}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error("Не удалось получить ответ от AI");
  }

  const data: { answer: string } = await response.json();

  return data.answer;
}
