# Latex OCR for Obsidian
![GitHub release (with filter)](https://img.shields.io/github/v/release/lucasvanmol/obsidian-latex-ocr) 
![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%27latex-ocr%27%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)
<a href="https://www.buymeacoffee.com/lucasvanmol" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="20" width="100"></a>

> ⚠️ **Inference API issues** ⚠️
> 
> The HuggingFace Inference API is not working as Hugging Face is currently **not supporting image-to-text models**. Check the [issue here](https://github.com/lucasvanmol/obsidian-latex-ocr/issues/37) for updates.
> Running locally is still supported & working.



Generate LaTeX equations from images and screenshots inside your Obsidian vault using modern multimodal vision LLMs or a local Python model.

<img src="/images/demo.gif" width="50%"/>

## Features

- **Any API Key & Provider**: Use **OpenRouter**, **Anthropic (Claude)**, **OpenAI**, or any **Custom OpenAI-compatible endpoint** (local vLLM, Ollama, LM Studio, etc.).
- **Latest Vision Models**: Choose from fast, high-accuracy presets (`google/gemini-2.5-flash`, `gpt-5.4-mini`, `claude-sonnet-5`, etc.) or input any custom model ID.
- **Paste LaTeX Directly**: Paste LaTeX equations directly into your notes using an image from your clipboard (`Paste Latex from clipboard image`).
- **Context Menu OCR**: Right-click on any image file in your file explorer and click "Generate Latex".
- **Local Fallback**: Optional local Python model (`latex-ocr-server`) for completely offline usage.

## Using Cloud Vision APIs (Recommended)

You can use your choice of API provider with high speed and precision:

### 1. OpenRouter (Recommended)
1. Sign up and grab an API key from [OpenRouter Keys](https://openrouter.ai/keys).
2. In Obsidian, go to **Settings > Latex OCR**, set Provider to **OpenRouter**, paste your key, and click **Save Key**.
3. Choose a model like `google/gemini-2.5-flash` (fast & very low cost) or `openrouter/auto`.

### 2. Anthropic
1. Get an API key from the [Anthropic Console](https://console.anthropic.com/settings/keys).
2. Set Provider to **Anthropic**, paste your key, and choose a model (e.g., `claude-sonnet-5` or `claude-haiku-4-5`).

### 3. OpenAI
1. Get an API key from the [OpenAI API Keys Dashboard](https://platform.openai.com/api-keys).
2. Set Provider to **OpenAI**, paste your key, and choose a model (e.g., `gpt-5.4-mini` or `gpt-5.4`).

### 4. Custom (OpenAI-compatible)
1. Set Provider to **Custom (OpenAI-compatible)**.
2. Enter your Base URL (e.g. `http://localhost:11434/v1` for Ollama or a third-party gateway).
3. Set your Model ID and optional API key.

## Run Locally

Alternatively, you can run the model locally. This requires installing an accompanying [python package](https://github.com/lucasvanmol/latex-ocr-server). Install it using `pip` (or, preferably `pipx`):

```
pip install latex-ocr-server
```

You can check if it is installed by running

```
python -m latex_ocr_server --version
```

### Configuration

Open Obsidian and navigate to the Community Plugins section and enable the plugin. Then head to the LatexOCR settings tab, enable "Use local model" and configure it.

![settings](images/settings.png)

You will first need to set the python path that the plugin will use to run the model in the LatexOCR settings. You can then check if it's working using the button below it. Once this is done, press "(Re)start Server".

Note that the first time you do this, the model needs to be downloaded from huggingface, and is around ~1.4 GB. You can check the status of this download in the LatexOCR settings tab by pressing "Check Status".

The status bar at the bottom will indicate the status of the server.

| Status     | Meaning            |
| ---------- | ------------------ |
| LatexOCR ✅ | server online      |
| LatexOCR ⚙️ | server loading     |
| LatexOCR 🌐 | downloading model  |
| LatexOCR ❌ | server unreachable |

If the server is online but you encounter an error getting a response from the server, ensure that the `Cache dir` filepath from the plugin settings is pointing to a valid folder and that the model has successfully been saved there. 

### GPU support

You can check if GPU support is working by running:

```
python -m latex_ocr_server info --gpu-available
```

If you want GPU support, follow the instructions at `https://pytorch.org/get-started/locally/` to install pytorch with CUDA. Note you may need to uninstall torch first. `torchvision` and `torchaudio` is not required. 


## Attribution

Massive thanks to [NormXU](https://github.com/NormXU/nougat-latex-ocr/) for training and releasing the model.
