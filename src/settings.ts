import { Status } from "models/model";
import LatexOCR, { ApiProvider, LatexOCRSettings } from "main";
import { LocalModel } from "models/local_model";
import ApiModel from "models/online_model";
import { PluginSettingTab, App, Setting, Notice, TextComponent, TextAreaComponent } from "obsidian";
import safeStorage from "safeStorage";
import { picker } from "utils";
import { normalize } from "path";

const obfuscateApiKey = (apiKey = ''): string => {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '****';
    return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
};

export default class LatexOCRSettingsTab extends PluginSettingTab {
    plugin: LatexOCR;

    constructor(app: App, plugin: LatexOCR) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        ///// GENERAL SETTINGS /////

        new Setting(containerEl)
            .setName('Formatting')
            .setDesc('How the LaTeX should be formatted: formula only, $inline$ or $$block$$.')
            .addDropdown(dd => dd
                .addOption('', "Formula only")
                .addOption('$', "Inline")
                .addOption('$$', "Block")
                .setValue(this.plugin.settings.delimiters)
                .onChange(async (value) => {
                    this.plugin.settings.delimiters = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Show status bar")
            .setDesc("✅ online / ⚙️ loading / 🌐 downloading / 🔧 needs configuration / ❌ unreachable")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showStatusBar)
                .onChange(async (value) => {
                    if (value) {
                        this.plugin.statusBar.show();
                    } else {
                        this.plugin.statusBar.hide();
                    }
                    this.plugin.settings.showStatusBar = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Use local model")
            .setDesc("Run local Python server instead of cloud vision APIs (OpenRouter, Anthropic, OpenAI).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useLocalModel)
                .onChange(async (value) => {
                    if (this.plugin.model) {
                        this.plugin.model.unload();
                    }

                    if (value) {
                        this.plugin.model = new LocalModel(this.plugin.settings);
                    } else {
                        this.plugin.model = new ApiModel(this.plugin.settings);
                    }
                    this.plugin.model.load();

                    this.plugin.settings.useLocalModel = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const checkStatus = () => {
            new Notice("⏳ Checking status...");
            this.plugin.model.status().then((status) => {
                switch (status.status) {
                    case Status.Ready:
                        new Notice(`✅ ${status.msg || "Connected and ready!"}`);
                        break;
                    case Status.Downloading:
                        new Notice(`🌐 ${status.msg}`);
                        break;
                    case Status.Loading:
                        new Notice(`⚙️ ${status.msg}`);
                        break;
                    case Status.Misconfigured:
                        new Notice(`🔧 ${status.msg}`);
                        break;
                    case Status.Unreachable:
                    default:
                        new Notice(`❌ ${status.msg}`);
                        break;
                }
            }).catch(err => {
                new Notice(`❌ Error: ${err?.message || err}`);
            });
        };

        new Setting(containerEl)
            .setName("Debug logging")
            .setDesc("To enable verbose logging, open the developer console (Ctrl+Shift+I / Cmd+Option+I) and set the log level to include 'Verbose' messages.");

        if (this.plugin.settings.useLocalModel) {
            ///// LOCAL MODEL SETTINGS /////
            containerEl.createEl("h5", { text: "Local Python Model Configuration" });

            const pythonPath = new Setting(containerEl)
                .setName('Python path')
                .setDesc("Path to Python installation. You need to have the `latex_ocr_server` package installed.")
                .addExtraButton(cb => cb
                    .setIcon("folder")
                    .setTooltip("Browse")
                    .onClick(async () => {
                        const file = await picker("Open Python path", ["openFile"]) as string;
                        (pythonPath.components[1] as TextComponent).setValue(file);
                        this.plugin.settings.pythonPath = normalize(file);
                        await this.plugin.saveSettings();
                    }))
                .addText(text => text
                    .setPlaceholder('path/to/python.exe')
                    .setValue(this.plugin.settings.pythonPath)
                    .onChange(async (value) => {
                        this.plugin.settings.pythonPath = normalize(value);
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Server control')
                .setDesc("LatexOCR runs a python script in the background that can process OCR requests.")
                .addButton(button => button
                    .setButtonText("Check status")
                    .setCta()
                    .onClick(() => checkStatus())
                )
                .addButton(button => button
                    .setButtonText("(Re)start server")
                    .onClick(async () => {
                        new Notice("⚙️ Starting server...", 5000);
                        if (this.plugin.model) {
                            this.plugin.model.unload();
                            this.plugin.model.load();
                            this.plugin.model.start();
                        }
                    }))
                .addButton(button => button
                    .setButtonText("Stop server")
                    .onClick(async () => {
                        if (this.plugin.model) {
                            this.plugin.model.unload();
                            new Notice("⚙️ Server stopped", 2000);
                        } else {
                            new Notice("❌ No server found to stop", 5000);
                        }
                    }));

            new Setting(containerEl)
                .setName('Port')
                .setDesc('Port to run the LatexOCR server on.')
                .addText(text => text
                    .setValue(this.plugin.settings.port)
                    .onChange(async (value) => {
                        this.plugin.settings.port = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName("Start server on launch")
                .setDesc("Start the background server automatically when Obsidian starts.")
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.startServerOnLoad)
                    .onChange(async (value) => {
                        this.plugin.settings.startServerOnLoad = value;
                        await this.plugin.saveSettings();
                    }));

            const cacheDir = new Setting(containerEl)
                .setName("Cache dir")
                .setDesc("Directory where the local model weights are cached.")
                .addExtraButton(cb => cb
                    .setIcon("folder")
                    .setTooltip("Browse")
                    .onClick(async () => {
                        const folder = await picker("Open cache directory", ["openDirectory"]) as string;
                        (cacheDir.components[1] as TextComponent).setValue(folder);
                        this.plugin.settings.cacheDirPath = normalize(folder);
                        await this.plugin.saveSettings();
                    }))
                .addText(text => text
                    .setValue(this.plugin.settings.cacheDirPath)
                    .onChange(async (value) => {
                        const path = normalize(value);
                        if (path !== "") {
                            this.plugin.settings.cacheDirPath = path;
                            await this.plugin.saveSettings();
                        }
                    }));
        } else {
            ///// ONLINE API MODEL SETTINGS /////
            containerEl.createEl("h5", { text: "Online Vision API Configuration" });

            const providerSetting = new Setting(containerEl)
                .setName("API Provider")
                .setDesc("Choose your vision LLM / OCR provider (OpenRouter, Anthropic, OpenAI, or Custom).")
                .addDropdown(dd => dd
                    .addOption("openrouter", "OpenRouter (Recommended)")
                    .addOption("anthropic", "Anthropic (Claude)")
                    .addOption("openai", "OpenAI")
                    .addOption("custom", "Custom (OpenAI-compatible)")
                    .addOption("huggingface", "Hugging Face (Legacy)")
                    .setValue(this.plugin.settings.apiProvider || "openrouter")
                    .onChange(async (value) => {
                        this.plugin.settings.apiProvider = value as ApiProvider;
                        await this.plugin.saveSettings();
                        this.display();
                    })
                );

            const activeProvider = this.plugin.settings.apiProvider || "openrouter";

            const saveApiKey = async (rawVal: string, keyProp: keyof LatexOCRSettings, obfProp: keyof LatexOCRSettings) => {
                let storedKey: string | ArrayBuffer = rawVal;
                if (safeStorage.isEncryptionAvailable()) {
                    storedKey = safeStorage.encryptString(rawVal);
                }
                (this.plugin.settings as any)[keyProp] = storedKey;
                (this.plugin.settings as any)[obfProp] = obfuscateApiKey(rawVal);
                await this.plugin.saveSettings();
                new Notice("🔧 API key saved successfully");
                this.display();
            };

            if (activeProvider === "openrouter") {
                new Setting(containerEl)
                    .setName("Current API Key")
                    .setDesc("Currently configured OpenRouter API key.")
                    .addText(text => text
                        .setPlaceholder(this.plugin.settings.openrouterObfuscatedKey || "No key set")
                        .setDisabled(true));

                const desc = new DocumentFragment();
                desc.textContent = "OpenRouter API key. Get one from the ";
                desc.createEl("a", { text: "OpenRouter Keys Dashboard", href: "https://openrouter.ai/keys" });
                desc.createSpan({ text: "." });

                let inputVal = "";
                new Setting(containerEl)
                    .setName("Set OpenRouter API Key")
                    .setDesc(desc)
                    .addText(text => {
                        text.inputEl.setAttr("type", "password");
                        text.setPlaceholder("sk-or-v1-...");
                        text.onChange(v => { inputVal = v; });
                    })
                    .addButton(btn => btn
                        .setButtonText("Save Key")
                        .setCta()
                        .onClick(async () => {
                            if (inputVal.trim()) {
                                await saveApiKey(inputVal.trim(), "openrouterApiKey", "openrouterObfuscatedKey");
                            }
                        }));

                const modelSetting = new Setting(containerEl)
                    .setName("Model ID")
                    .setDesc("Type any OpenRouter model ID or choose from presets.")
                    .addText(text => {
                        text.setValue(this.plugin.settings.openrouterModel || "google/gemini-2.5-flash");
                        text.onChange(async val => {
                            this.plugin.settings.openrouterModel = val.trim();
                            await this.plugin.saveSettings();
                        });
                    })
                    .addDropdown(dd => dd
                        .addOption("", "Choose preset...")
                        .addOption("google/gemini-2.5-flash", "google/gemini-2.5-flash (Fast & Affordable)")
                        .addOption("openai/gpt-5.4-mini", "openai/gpt-5.4-mini (Efficient)")
                        .addOption("anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5 (Frontier)")
                        .addOption("openrouter/auto", "openrouter/auto (Automatic Routing)")
                        .onChange(async val => {
                            if (val) {
                                this.plugin.settings.openrouterModel = val;
                                (modelSetting.components[0] as TextComponent).setValue(val);
                                await this.plugin.saveSettings();
                            }
                        })
                    );

            } else if (activeProvider === "anthropic") {
                new Setting(containerEl)
                    .setName("Current API Key")
                    .setDesc("Currently configured Anthropic API key.")
                    .addText(text => text
                        .setPlaceholder(this.plugin.settings.anthropicObfuscatedKey || "No key set")
                        .setDisabled(true));

                const desc = new DocumentFragment();
                desc.textContent = "Anthropic API key. Get one from the ";
                desc.createEl("a", { text: "Anthropic Console", href: "https://console.anthropic.com/settings/keys" });
                desc.createSpan({ text: "." });

                let inputVal = "";
                new Setting(containerEl)
                    .setName("Set Anthropic API Key")
                    .setDesc(desc)
                    .addText(text => {
                        text.inputEl.setAttr("type", "password");
                        text.setPlaceholder("sk-ant-...");
                        text.onChange(v => { inputVal = v; });
                    })
                    .addButton(btn => btn
                        .setButtonText("Save Key")
                        .setCta()
                        .onClick(async () => {
                            if (inputVal.trim()) {
                                await saveApiKey(inputVal.trim(), "anthropicApiKey", "anthropicObfuscatedKey");
                            }
                        }));

                const modelSetting = new Setting(containerEl)
                    .setName("Model ID")
                    .setDesc("Type any Anthropic Claude model ID or choose from presets.")
                    .addText(text => {
                        text.setValue(this.plugin.settings.anthropicModel || "claude-sonnet-5");
                        text.onChange(async val => {
                            this.plugin.settings.anthropicModel = val.trim();
                            await this.plugin.saveSettings();
                        });
                    })
                    .addDropdown(dd => dd
                        .addOption("", "Choose preset...")
                        .addOption("claude-sonnet-5", "claude-sonnet-5 (Latest Frontier)")
                        .addOption("claude-haiku-4-5", "claude-haiku-4-5 (Fast & Lightweight)")
                        .addOption("claude-opus-5", "claude-opus-5 (Maximum Reasoning)")
                        .onChange(async val => {
                            if (val) {
                                this.plugin.settings.anthropicModel = val;
                                (modelSetting.components[0] as TextComponent).setValue(val);
                                await this.plugin.saveSettings();
                            }
                        })
                    );

            } else if (activeProvider === "openai") {
                new Setting(containerEl)
                    .setName("Current API Key")
                    .setDesc("Currently configured OpenAI API key.")
                    .addText(text => text
                        .setPlaceholder(this.plugin.settings.openaiObfuscatedKey || "No key set")
                        .setDisabled(true));

                const desc = new DocumentFragment();
                desc.textContent = "OpenAI API key. Get one from the ";
                desc.createEl("a", { text: "OpenAI API Keys Dashboard", href: "https://platform.openai.com/api-keys" });
                desc.createSpan({ text: "." });

                let inputVal = "";
                new Setting(containerEl)
                    .setName("Set OpenAI API Key")
                    .setDesc(desc)
                    .addText(text => {
                        text.inputEl.setAttr("type", "password");
                        text.setPlaceholder("sk-...");
                        text.onChange(v => { inputVal = v; });
                    })
                    .addButton(btn => btn
                        .setButtonText("Save Key")
                        .setCta()
                        .onClick(async () => {
                            if (inputVal.trim()) {
                                await saveApiKey(inputVal.trim(), "openaiApiKey", "openaiObfuscatedKey");
                            }
                        }));

                const modelSetting = new Setting(containerEl)
                    .setName("Model ID")
                    .setDesc("Type any OpenAI model ID or choose from presets.")
                    .addText(text => {
                        text.setValue(this.plugin.settings.openaiModel || "gpt-5.4-mini");
                        text.onChange(async val => {
                            this.plugin.settings.openaiModel = val.trim();
                            await this.plugin.saveSettings();
                        });
                    })
                    .addDropdown(dd => dd
                        .addOption("", "Choose preset...")
                        .addOption("gpt-5.4-mini", "gpt-5.4-mini (Latest Fast & Economical)")
                        .addOption("gpt-5.4", "gpt-5.4 (Latest General Workhorse)")
                        .addOption("gpt-4o", "gpt-4o (Vision Multimodal)")
                        .addOption("gpt-4o-mini", "gpt-4o-mini (Lightweight)")
                        .onChange(async val => {
                            if (val) {
                                this.plugin.settings.openaiModel = val;
                                (modelSetting.components[0] as TextComponent).setValue(val);
                                await this.plugin.saveSettings();
                            }
                        })
                    );

            } else if (activeProvider === "custom") {
                new Setting(containerEl)
                    .setName("Base URL")
                    .setDesc("Base endpoint URL for any OpenAI-compatible server (e.g. http://localhost:11434/v1 or https://api.together.xyz/v1).")
                    .addText(text => text
                        .setPlaceholder("https://api.openai.com/v1")
                        .setValue(this.plugin.settings.customEndpoint || "https://api.openai.com/v1")
                        .onChange(async val => {
                            this.plugin.settings.customEndpoint = val.trim();
                            await this.plugin.saveSettings();
                        }));

                new Setting(containerEl)
                    .setName("Current API Key")
                    .setDesc("Currently configured custom API key (optional for local servers).")
                    .addText(text => text
                        .setPlaceholder(this.plugin.settings.customObfuscatedKey || "No key set")
                        .setDisabled(true));

                let inputVal = "";
                new Setting(containerEl)
                    .setName("Set Custom API Key")
                    .setDesc("API key for your custom endpoint (leave empty if not required).")
                    .addText(text => {
                        text.inputEl.setAttr("type", "password");
                        text.setPlaceholder("API key (optional)...");
                        text.onChange(v => { inputVal = v; });
                    })
                    .addButton(btn => btn
                        .setButtonText("Save Key")
                        .setCta()
                        .onClick(async () => {
                            await saveApiKey(inputVal.trim(), "customApiKey", "customObfuscatedKey");
                        }));

                new Setting(containerEl)
                    .setName("Model ID")
                    .setDesc("Model name configured on your OpenAI-compatible endpoint.")
                    .addText(text => text
                        .setPlaceholder("e.g. gpt-5.4-mini or llama3.2-vision")
                        .setValue(this.plugin.settings.customModel || "")
                        .onChange(async val => {
                            this.plugin.settings.customModel = val.trim();
                            await this.plugin.saveSettings();
                        }));

            } else if (activeProvider === "huggingface") {
                new Setting(containerEl)
                    .setName("Current API Key")
                    .setDesc("Currently configured Hugging Face API key.")
                    .addText(text => text
                        .setPlaceholder(this.plugin.settings.obfuscatedKey || "No key set")
                        .setDisabled(true));

                const apiKeyDesc = new DocumentFragment();
                apiKeyDesc.textContent = "Hugging face API key. See the ";
                apiKeyDesc.createEl("a", { text: "Hugging Face tokens page", href: "https://huggingface.co/settings/tokens" });
                apiKeyDesc.createSpan({ text: " to generate it." });

                let inputVal = "";
                new Setting(containerEl)
                    .setName("Set Hugging Face API Key")
                    .setDesc(apiKeyDesc)
                    .addText(text => {
                        text.inputEl.setAttr("type", "password");
                        text.setPlaceholder("hf_...");
                        text.onChange(v => { inputVal = v; });
                    })
                    .addButton(btn => btn
                        .setButtonText("Save Key")
                        .setCta()
                        .onClick(async () => {
                            if (inputVal.trim()) {
                                await saveApiKey(inputVal.trim(), "hfApiKey", "obfuscatedKey");
                            }
                        }));
            }

            // Connection check button for online APIs
            new Setting(containerEl)
                .setName("Test API Connection")
                .setDesc("Verify that your API key and endpoint are working properly.")
                .addButton(btn => btn
                    .setButtonText("Check status")
                    .setCta()
                    .onClick(() => checkStatus()));

            // Optional OCR instruction prompt customization
            new Setting(containerEl)
                .setName("Custom OCR Prompt")
                .setDesc("Customize the instructions sent to the vision model (leave empty to use default prompt).")
                .addTextArea(area => area
                    .setPlaceholder("Default prompt: You are an expert OCR tool specialized in mathematical and scientific formulas...")
                    .setValue(this.plugin.settings.customPrompt || "")
                    .onChange(async val => {
                        this.plugin.settings.customPrompt = val;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}
