const state = {
  vapi: null,
  activePublicKey: '',
  listening: false,
  allTranscript: '',
  summaryRequested: false,
  summaryText: '',
  renderedFacts: new Set(),
  eventsAttached: false,
  audioObserver: null
};

const HUNGARIAN_SYSTEM_PROMPT = `A felhasználó magyarul beszél.
Mindig magyarul dolgozd fel a beszédet, és magyarul írj válaszokat.
Ne válaszolj hangosan: csak szöveges összegzést és adatkinyerést adj.`;

let VapiConstructor = null;

async function loadVapiConstructor() {
  if (VapiConstructor) {
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
  forceHu: document.getElementById('forceHu'),
  muteAudio: document.getElementById('muteAudio'),
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

function muteAssistantAudioOutput() {
  if (!ui.muteAudio?.checked) {
    return;
  }

  const mediaElements = document.querySelectorAll('audio, video');
  mediaElements.forEach((el) => {
    el.muted = true;
    el.volume = 0;
  });
}

function startAudioMuteObserver() {
  if (!ui.muteAudio?.checked || state.audioObserver) {
    return;
  }

  state.audioObserver = new MutationObserver(() => muteAssistantAudioOutput());
  state.audioObserver.observe(document.body, { childList: true, subtree: true });
  muteAssistantAudioOutput();
}

function stopAudioMuteObserver() {
  if (state.audioObserver) {
    state.audioObserver.disconnect();
    state.audioObserver = null;
  }
}

function handleTranscriptText(text) {
  if (!text || typeof text !== 'string') {
    return;
  }

  state.allTranscript += `${text}\n`;
  renderTranscript();
  harvestFacts(text);

  if (!state.summaryRequested && containsRendben(text)) {
    requestSummaryFromVapi();
  }
}

function extractTranscriptText(payload) {
  if (!payload) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  return (
    payload.transcript ||
    payload.text ||
    payload.content ||
    payload?.result?.transcript ||
    ''
  );
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
  } catch (error) {
    console.error(error);
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
    startAudioMuteObserver();
    setStatus('Hívás/felvétel elindult, beszélhetsz magyarul.');
  });

  state.vapi.on('call-end', () => {
    state.listening = false;
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    stopAudioMuteObserver();
    setStatus('Hívás lezárva.');
  });

  state.vapi.on('transcript', (payload) => {
    handleTranscriptText(extractTranscriptText(payload));
  });

  state.vapi.on('message', (message) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'transcript' || message.type === 'transcript-partial') {
      handleTranscriptText(extractTranscriptText(message));
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
    state.listening = false;
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    stopAudioMuteObserver();
    setStatus(`Vapi hiba: ${error?.message || 'ismeretlen hiba'}`);
  });
}

function createAssistantOverrides(forceHu) {
  if (!forceHu) {
    return undefined;
  }

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

async function startCallWithFallback(assistantId, forceHu) {
  const overrides = createAssistantOverrides(forceHu);

  if (overrides) {
    try {
      await state.vapi.start({ assistantId, assistantOverrides: overrides });
      return;
    } catch (firstError) {
      console.warn('Vapi start with overrides failed, retrying dashboard settings...', firstError);
    }
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
  const forceHu = Boolean(ui.forceHu?.checked);

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

  try {
    const Vapi = await loadVapiConstructor();

    if (!state.vapi || state.activePublicKey !== key) {
      state.vapi = new Vapi(key);
      state.activePublicKey = key;
      state.eventsAttached = false;
      attachVapiEventsOnce();
    }
  } catch (error) {
    console.error(error);
    ui.startBtn.disabled = false;
    setStatus(`A Vapi SDK nem töltődött be: ${error?.message || 'CDN hiba'}`);
    return;
  }

  resetUiForNewSession();
  startAudioMuteObserver();
  setStatus(forceHu ? 'Kapcsolódás Vapi-hoz (kényszerített magyar módban)...' : 'Kapcsolódás Vapi-hoz (dashboard beállításokkal)...');

  try {
    await startCallWithFallback(assistantId, forceHu);
    state.listening = true;
    ui.stopBtn.disabled = false;
    setStatus('Kapcsolódva. Beszélj magyarul; a kimenet szöveges leirat + összegzés.');
  } catch (error) {
    console.error(error);
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;
    stopAudioMuteObserver();
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
  stopAudioMuteObserver();
}

ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);
