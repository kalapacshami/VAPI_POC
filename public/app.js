const state = {
  vapi: null,
  listening: false,
  allTranscript: '',
  summaryRequested: false,
  summaryText: '',
  renderedFacts: new Set()
};

const ui = {
  publicKey: document.getElementById('publicKey'),
  assistantId: document.getElementById('assistantId'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
  transcript: document.getElementById('transcript'),
  summary: document.getElementById('summary'),
  facts: document.getElementById('facts')
};

function setStatus(message) {
  ui.status.textContent = message;
}

function renderTranscript() {
  ui.transcript.textContent = state.allTranscript.trim() || '...';
}

function addFact(text) {
  const cleaned = text.trim();
  if (!cleaned || state.renderedFacts.has(cleaned)) {
    return;
  }
  state.renderedFacts.add(cleaned);
  const li = document.createElement('li');
  li.textContent = cleaned;
  ui.facts.appendChild(li);
}

function harvestFacts(chunk) {
  chunk
    .split(/[.?!\n]/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 18)
    .forEach((line) => addFact(line));
}

function containsRendben(text) {
  return /\brendben\b/i.test(text);
}

function requestSummaryFromVapi() {
  if (!state.vapi || state.summaryRequested) {
    return;
  }

  state.summaryRequested = true;
  setStatus('"Rendben" észlelve. Összegzés kérése a Vapi asszisztenstől...');

  const summaryPrompt =
    'Kérlek magyarul foglald össze röviden pontokban az eddig elhangzott adatokat, neveket, számokat, feladatokat és döntéseket.';

  try {
    state.vapi.send({
      type: 'add-message',
      message: {
        role: 'user',
        content: summaryPrompt
      }
    });
  } catch (_error) {
    ui.summary.textContent =
      'A Vapi összegzés küldése nem sikerült. Ellenőrizd a böngésző konzolt és a Vapi beállításokat.';
  }
}

function attachVapiEvents() {
  state.vapi.on('call-start', () => {
    setStatus('Hívás/felvétel elindult, beszélhetsz magyarul.');
  });

  state.vapi.on('call-end', () => {
    state.listening = false;
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    setStatus('Hívás lezárva.');
  });

  state.vapi.on('message', (message) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'transcript') {
      const text = message.transcript || message.text || '';
      if (!text) {
        return;
      }

      state.allTranscript += `${text}\n`;
      renderTranscript();
      harvestFacts(text);

      if (!state.summaryRequested && containsRendben(text)) {
        requestSummaryFromVapi();
      }
      return;
    }

    if (message.type === 'conversation-update') {
      const messages = message.conversation || [];
      const assistantMessages = messages.filter((m) => m.role === 'assistant' && typeof m.content === 'string');

      if (assistantMessages.length > 0 && state.summaryRequested) {
        state.summaryText = assistantMessages[assistantMessages.length - 1].content;
        ui.summary.textContent = state.summaryText;
        harvestFacts(state.summaryText);
        setStatus('Összegzés megérkezett.');
      }
    }
  });

  state.vapi.on('error', (error) => {
    console.error(error);
    setStatus('Vapi hiba történt. Részletek a konzolban.');
  });
}

async function start() {
  const key = ui.publicKey.value.trim();
  const assistantId = ui.assistantId.value.trim();

  if (!key || !assistantId) {
    setStatus('Hiányzó Public Key vagy Assistant ID.');
    return;
  }

  if (typeof Vapi === 'undefined') {
    setStatus('A Vapi SDK nem töltődött be.');
    return;
  }

  state.vapi = new Vapi(key);
  attachVapiEvents();

  state.allTranscript = '';
  state.summaryRequested = false;
  state.summaryText = '';
  state.renderedFacts.clear();
  ui.facts.innerHTML = '';
  ui.summary.textContent = 'Még nincs összegzés.';
  renderTranscript();

  setStatus('Mikrofon engedélyezése...');

  try {
    await state.vapi.start(assistantId);
    state.listening = true;
    ui.startBtn.disabled = true;
    ui.stopBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus('Nem sikerült elindítani a Vapi hívást.');
  }
}

function stop() {
  if (!state.vapi) {
    return;
  }

  state.vapi.stop();
  state.listening = false;
  ui.startBtn.disabled = false;
  ui.stopBtn.disabled = true;
}

ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);
