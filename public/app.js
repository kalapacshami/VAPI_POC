const state = {
  vapi: null,
  listening: false,
  allTranscript: '',
  summaryRequested: false,
  summaryText: '',
  renderedFacts: new Set(),
  eventsAttached: false
};

const HUNGARIAN_SYSTEM_PROMPT = `A felhasználó magyarul beszél.
Mindig magyarul dolgozd fel a beszédet, és magyarul írj válaszokat.
Ne válaszolj hangosan: csak szöveges összegzést és adatkinyerést adj.`;


let VapiConstructor = null;

async function loadVapiConstructor() {
  if (VapiConstructor) {
    return VapiConstructor;
  }

  if (typeof window !== 'undefined' && typeof window.Vapi !== 'undefined') {
    VapiConstructor = window.Vapi;
    return VapiConstructor;
  }

  const moduleUrls = [
    'https://esm.sh/@vapi-ai/web',
    'https://cdn.jsdelivr.net/npm/@vapi-ai/web/+esm'
  ];

  for (const moduleUrl of moduleUrls) {
    try {
      const mod = await import(moduleUrl);
      VapiConstructor = mod.default || mod.Vapi || mod;
      if (typeof VapiConstructor === 'function') {
        return VapiConstructor;
      }
    } catch (error) {
      console.warn(`Vapi import sikertelen: ${moduleUrl}`, error);
    }
  }

  throw new Error('A Vapi SDK nem tölthető be a CDN-ről.');
}

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
    'Kérlek kizárólag magyarul, rövid pontokban foglald össze az eddig elhangzott adatokat, neveket, számokat, feladatokat és döntéseket. Ne adj hangos választ.';

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

function attachVapiEventsOnce() {
  if (!state.vapi || state.eventsAttached) {
    return;
  }

  state.eventsAttached = true;

  state.vapi.on('call-start', () => {
    muteAssistantAudioOutput();
    setStatus('Hívás/felvétel elindult (hangkimenet némítva), beszélhetsz magyarul.');
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
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    setStatus(`Vapi hiba: ${error?.message || 'ismeretlen hiba'}`);
  });
}

function createAssistantOverrides() {
  return {
    transcriber: {
      language: 'hu'
    },
    model: {
      messages: [
        {
          role: 'system',
          content: HUNGARIAN_SYSTEM_PROMPT
        }
      ]
    }
  };
}

function muteAssistantAudioOutput() {
  const mediaElements = document.querySelectorAll('audio, video');
  mediaElements.forEach((el) => {
    el.muted = true;
    el.volume = 0;
  });
}

function resetUiForNewSession() {
  state.allTranscript = '';
  state.summaryRequested = false;
  state.summaryText = '';
  state.renderedFacts.clear();
  ui.facts.innerHTML = '';
  ui.summary.textContent = 'Még nincs összegzés.';
  renderTranscript();
}

async function ensureMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.error(error);
    setStatus('A mikrofon nincs engedélyezve. Engedélyezd a böngészőben, majd próbáld újra.');
    return false;
  }
}

async function startCallWithFallback(assistantId) {
  const overrides = createAssistantOverrides();

  try {
    await state.vapi.start({
      assistantId,
      assistantOverrides: overrides
    });
    return;
  } catch (firstError) {
    console.warn('Vapi start with overrides failed, retrying minimal start...', firstError);
  }

  await state.vapi.start(assistantId);
}

async function start() {
  if (state.listening) {
    setStatus('A felvétel már fut.');
    return;
  }

  const key = ui.publicKey.value.trim();
  const assistantId = ui.assistantId.value.trim();

  if (!key || !assistantId) {
    setStatus('Hiányzó Public Key vagy Assistant ID.');
    return;
  }

  ui.startBtn.disabled = true;
  setStatus('Mikrofon ellenőrzése...');

  const hasMic = await ensureMicrophonePermission();
  if (!hasMic) {
    ui.startBtn.disabled = false;
    return;
  }

  muteAssistantAudioOutput();

  try {
    const Vapi = await loadVapiConstructor();

    if (!state.vapi) {
      state.vapi = new Vapi(key);
      attachVapiEventsOnce();
    }
  } catch (error) {
    console.error(error);
    ui.startBtn.disabled = false;
    setStatus(`A Vapi SDK nem töltődött be: ${error?.message || 'CDN hiba'}`);
    return;
  }

  resetUiForNewSession();
  setStatus('Kapcsolódás Vapi-hoz...');

  try {
    await startCallWithFallback(assistantId);
    state.listening = true;
    ui.stopBtn.disabled = false;
    setStatus('Kapcsolódva. Beszélj magyarul — a rendszer magyar leiratot és szöveges összegzést készít.');
  } catch (error) {
    console.error(error);
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    setStatus(`Nem sikerült elindítani a Vapi hívást: ${error?.message || 'ismeretlen hiba'}`);
  }
}

function stop() {
  if (!state.vapi || !state.listening) {
    return;
  }

  state.vapi.stop();
  state.listening = false;
  ui.startBtn.disabled = false;
  ui.stopBtn.disabled = true;
}

ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);
