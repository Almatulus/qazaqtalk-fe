// Тестовый сервер без распознавания: npm i ws && node mock-ws-server.mjs
// Каждые ~3 секунды речи отвечает «распознанной» фразой, ответом бота и разбором.
import { WebSocketServer } from 'ws'

const words = 'Сәлем, менің атым Айгүл.'.split(' ')
const reply = ['Жақсы! ', 'Теперь ', 'спросим ', 'собеседника, ', 'как дела.']

new WebSocketServer({ port: 8787 }).on('connection', (ws) => {
  let frames = 0
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o))

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return // здесь же приходят {type:'start'|'stop'}
    frames++
    if (frames % 10 !== 0 || frames > 30) return
    const final = frames === 30
    send({ type: 'transcript', text: words.slice(0, 1 + frames / 10).join(' '), final })
    if (!final) return
    frames = 0
    send({
      type: 'feedback',
      feedback: {
        score: 72, expected: 'Сәлем, менің атым Айгүл.', heard: 'Салем, менин атым Айгул.',
        issues: [{ letter: 'ә', note: 'Звук между «а» и «э».' }, { letter: 'ү', note: 'Как «у», но губы вытянуты вперёд.' }],
        tip: 'Начните с «ә»: произнесите «а» и округлите «э».',
      },
    })
    reply.forEach((text, i) =>
      setTimeout(() => {
        const last = i === reply.length - 1
        send({ type: 'bot_text', text, done: last, ...(last && { practice: 'Қалайсың?', translation: 'Как дела?' }) })
      }, 300 + i * 150),
    )
  })
})
