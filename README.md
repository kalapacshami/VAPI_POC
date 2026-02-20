# Vapi Hungarian Speech-to-Text Prototype

Prototype Node.js web app that:

- starts a Vapi assistant call in browser,
- writes live Hungarian transcript,
- watches for the word **"Rendben"**,
- requests a Hungarian summary from the assistant,
- shows extracted key facts.

## Local run

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## Pre-filled Vapi config

- Assistant ID: `3aa26a46-ffa9-4f95-9fbc-8cdac3e3d9cf`
- Public Key: `1dde296e-f852-41f7-9bb6-473b13b07308`

You can overwrite them from the form.
