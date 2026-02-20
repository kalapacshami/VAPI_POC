# Vapi Hungarian Speech-to-Text Prototype

This repo now includes a **Visual Studio/.NET solution** so you can debug it as a C# web app.

## What it does

- Starts a Vapi assistant call from the browser.
- Writes live Hungarian transcript.
- Detects the word **"Rendben"**.
- Asks the Vapi assistant to summarize what was said in Hungarian.
- Extracts and lists key facts from the transcript + summary.

## Open in Visual Studio

1. Open `VapiPrototype.sln`.
2. Set `VapiPrototype.Web` as startup project.
3. Run with **F5** (or `Ctrl+F5`).

Default URL from launch settings: `http://localhost:5074`.

## Run from CLI

```bash
dotnet run --project src/VapiPrototype.Web/VapiPrototype.Web.csproj
```

## Vapi configuration pre-filled in UI

- Assistant ID: `3aa26a46-ffa9-4f95-9fbc-8cdac3e3d9cf`
- Public Key: `1dde296e-f852-41f7-9bb6-473b13b07308`
