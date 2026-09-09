import Model, { Status } from "./model";
import * as fs from 'fs';
import { ApiProvider, LatexOCRSettings } from "main";
import safeStorage from "safeStorage";
import { Notice, requestUrl } from "obsidian";
import * as path from "path";
import { imageToText } from "@huggingface/inference";

const DEFAULT_PROMPT =
    "You are an expert OCR tool specialized in mathematical and scientific formulas. Convert the formula or handwritten/printed math in the image into accurate LaTeX code.\n\nStrict Rules:\n1. Return ONLY the raw LaTeX code.\n2. Do NOT wrap in markdown codeblocks (no ```latex or ```).\n3. Do NOT include any surrounding delimiters like $$ or $ (they will be added automatically).\n4. Do NOT include any explanations, greetings, comments, or conversational text.";

export function cleanLatexResponse(raw: string): string {
    if (!raw) return '';
    let text = raw.trim();

    // 1. Check for markdown code blocks (```latex ... ``` or ``` ... ```)
    const codeBlockMatch = text.match(/```(?:latex|tex|markdown)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
        text = codeBlockMatch[1].trim();
    }

    // 2. Extract math block if wrapped in display or inline delimiters
    const displayMathMatch = text.match(/\$\$([\s\S]+?)\$\$/);
    if (displayMathMatch) {
        text = displayMathMatch[1].trim();
    } else {
        const bracketMathMatch = text.match(/\\\[([\s\S]+?)\\\]/);
        if (bracketMathMatch) {
            text = bracketMathMatch[1].trim();
        } else {
            const parenMathMatch = text.match(/\\\(([\s\S]+?)\\\)/);
            if (parenMathMatch) {
                text = parenMathMatch[1].trim();
            } else if (text.startsWith('$') && text.endsWith('$') && text.length > 2 && !text.slice(1, -1).includes('$')) {
                text = text.slice(1, -1).trim();
            }
        }
    }

    // 3. Remove wrapping inline backticks
    if (text.startsWith('`') && text.endsWith('`') && text.length > 2) {
        text = text.slice(1, -1).trim();
    }

    // 4. Strip any residual outer delimiters
    if (text.startsWith('$$') && text.endsWith('$$') && text.length >= 4) {
        text = text.slice(2, -2).trim();
    }
    if (text.startsWith('\\[') && text.endsWith('\\]') && text.length >= 4) {
        text = text.slice(2, -2).trim();
    }
    if (text.startsWith('\\(') && text.endsWith('\\)') && text.length >= 4) {
        text = text.slice(2, -2).trim();
    }
    if (text.startsWith('$') && text.endsWith('$') && text.length >= 2 && !text.slice(1, -1).includes('$')) {
        text = text.slice(1, -1).trim();
    }

    return text.trim();
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    switch (ext) {
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'bmp':
            return 'image/bmp';
        default:
            return 'image/png';
    }
}

function decryptKey(key: string | ArrayBuffer | undefined): string {
    if (!key) return '';
    if (typeof key === 'string') return key;
    try {
        if (safeStorage.isEncryptionAvailable()) {
            return safeStorage.decryptString(Buffer.from(key));
        }
    } catch (err) {
        console.error('Error decrypting API key:', err);
    }
    return '';
}

export default class ApiModel implements Model {
    settings: LatexOCRSettings;
    apiKey: string = "";
    statusCheckIntervalLoading = 5000;
    statusCheckIntervalReady = 15000;

    constructor(settings: LatexOCRSettings) {
        this.reloadSettings(settings);
    }

    reloadSettings(settings: LatexOCRSettings) {
        this.settings = settings;
        const provider = settings.apiProvider || 'openrouter';

        try {
            switch (provider) {
                case 'openrouter':
                    this.apiKey = decryptKey(settings.openrouterApiKey);
                    break;
                case 'anthropic':
                    this.apiKey = decryptKey(settings.anthropicApiKey);
                    break;
                case 'openai':
                    this.apiKey = decryptKey(settings.openaiApiKey);
                    break;
                case 'custom':
                    this.apiKey = decryptKey(settings.customApiKey);
                    break;
                case 'huggingface':
                    this.apiKey = decryptKey(settings.hfApiKey);
                    break;
                default:
                    this.apiKey = '';
            }
        } catch (error) {
            new Notice(`❌ Error loading ${this.getProviderName(provider)} API key`);
            console.error('Error loading API key:', error);
            this.apiKey = "";
        }
    }

    getProviderName(provider: ApiProvider): string {
        switch (provider) {
            case 'openrouter': return 'OpenRouter';
            case 'anthropic': return 'Anthropic';
            case 'openai': return 'OpenAI';
            case 'custom': return 'Custom (OpenAI-compatible)';
            case 'huggingface': return 'Hugging Face';
            default: return 'API';
        }
    }

    load() {
        console.log(`latex_ocr: API model loaded with provider: ${this.settings.apiProvider || 'openrouter'}`);
    }

    start() { }

    unload() { }

    async imgfileToLatex(filepath: string): Promise<string> {
        const file = path.parse(filepath);
        const provider = this.settings.apiProvider || 'openrouter';
        const notice = new Notice(`⚙️ Generating Latex for ${file.base} via ${this.getProviderName(provider)}...`, 0);

        try {
            const rawLatex = await this.callProvider(filepath);
            setTimeout(() => notice.hide(), 1000);

            const cleaned = cleanLatexResponse(rawLatex);
            if (cleaned) {
                const d = this.settings.delimiters;
                return `${d}${cleaned}${d}`;
            } else {
                throw new Error("Empty or invalid LaTeX response received from API");
            }
        } catch (error: any) {
            setTimeout(() => notice.hide(), 1000);
            console.error(`latex_ocr error:`, error);
            throw error;
        }
    }

    private async callProvider(filepath: string): Promise<string> {
        const provider = this.settings.apiProvider || 'openrouter';

        if (provider === 'huggingface') {
            return this.callHuggingFace(filepath);
        }

        const data = fs.readFileSync(filepath);
        const base64Image = data.toString('base64');
        const mimeType = getMimeType(filepath);
        const prompt = (this.settings.customPrompt && this.settings.customPrompt.trim() !== '')
            ? this.settings.customPrompt
            : DEFAULT_PROMPT;

        switch (provider) {
            case 'openrouter':
                return this.callOpenRouter(base64Image, mimeType, prompt);
            case 'openai':
                return this.callOpenAI(base64Image, mimeType, prompt);
            case 'anthropic':
                return this.callAnthropic(base64Image, mimeType, prompt);
            case 'custom':
                return this.callCustom(base64Image, mimeType, prompt);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    private async callOpenRouter(base64Image: string, mimeType: string, prompt: string): Promise<string> {
        const model = this.settings.openrouterModel || 'google/gemini-2.5-flash';
        const response = await requestUrl({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://obsidian.md',
                'X-Title': 'Obsidian Latex OCR'
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1
            })
        });

        const json = response.json;
        if (json.error) {
            throw new Error(`OpenRouter Error: ${json.error.message || JSON.stringify(json.error)}`);
        }
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`Malformed OpenRouter response: ${JSON.stringify(json)}`);
        }
        return content;
    }

    private async callOpenAI(base64Image: string, mimeType: string, prompt: string): Promise<string> {
        const model = this.settings.openaiModel || 'gpt-5.4-mini';
        const response = await requestUrl({
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1
            })
        });

        const json = response.json;
        if (json.error) {
            throw new Error(`OpenAI Error: ${json.error.message || JSON.stringify(json.error)}`);
        }
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`Malformed OpenAI response: ${JSON.stringify(json)}`);
        }
        return content;
    }

    private async callAnthropic(base64Image: string, mimeType: string, prompt: string): Promise<string> {
        const model = this.settings.anthropicModel || 'claude-sonnet-5';
        const response = await requestUrl({
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                max_tokens: 2048,
                temperature: 0.1,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mimeType,
                                    data: base64Image
                                }
                            },
                            {
                                type: 'text',
                                text: prompt
                            }
                        ]
                    }
                ]
            })
        });

        const json = response.json;
        if (json.error) {
            throw new Error(`Anthropic Error: ${json.error.message || JSON.stringify(json.error)}`);
        }
        const blocks = json.content || [];
        const content = blocks
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
            .trim();

        if (!content) {
            throw new Error(`Malformed Anthropic response: ${JSON.stringify(json)}`);
        }
        return content;
    }

    private async callCustom(base64Image: string, mimeType: string, prompt: string): Promise<string> {
        const endpoint = (this.settings.customEndpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = this.settings.customModel || 'gpt-5.4-mini';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await requestUrl({
            url: `${endpoint}/chat/completions`,
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1
            })
        });

        const json = response.json;
        if (json.error) {
            throw new Error(`Custom API Error: ${json.error.message || JSON.stringify(json.error)}`);
        }
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`Malformed Custom API response: ${JSON.stringify(json)}`);
        }
        return content;
    }

    private async callHuggingFace(filepath: string): Promise<string> {
        const data = fs.readFileSync(filepath);
        const fetch_max_tokens = (input: RequestInfo | URL, init: RequestInit | undefined) => {
            const image_data = (init?.body as Buffer).toString('base64');
            const payload = { "inputs": image_data, "parameters": { "max_new_tokens": 800 } };
            return fetch(input, { ...init, body: JSON.stringify(payload) });
        };

        try {
            const response = await imageToText({
                accessToken: this.apiKey,
                model: "Norm/nougat-latex-base",
                data: data,
            }, {
                retry_on_error: false,
                fetch: fetch_max_tokens
            });
            return response.generated_text;
        } catch (error: any) {
            if (`${error}`.includes("is currently loading")) {
                new Notice(`⚙️ Hugging Face model is being provisioned...`);
            }
            const response = await imageToText({
                accessToken: this.apiKey,
                model: "Norm/nougat-latex-base",
                data: data,
            }, {
                retry_on_error: false,
                wait_for_model: true,
                fetch: fetch_max_tokens
            });
            return response.generated_text;
        }
    }

    async status(): Promise<{ status: Status, msg: string }> {
        const provider = this.settings.apiProvider || 'openrouter';

        if (provider !== 'custom' && (!this.apiKey || this.apiKey.trim() === "")) {
            return { status: Status.Misconfigured, msg: `${this.getProviderName(provider)} API key required` };
        }

        try {
            switch (provider) {
                case 'openrouter': {
                    const response = await requestUrl({
                        url: "https://openrouter.ai/api/v1/auth/key",
                        headers: { Authorization: `Bearer ${this.apiKey}` },
                        method: "GET",
                    });
                    if (response.status === 200) {
                        const label = response.json?.data?.label ? ` (${response.json.data.label})` : '';
                        return { status: Status.Ready, msg: `OpenRouter API key is active${label}` };
                    }
                    return { status: Status.Ready, msg: "OpenRouter connected" };
                }
                case 'openai': {
                    const response = await requestUrl({
                        url: "https://api.openai.com/v1/models",
                        headers: { Authorization: `Bearer ${this.apiKey}` },
                        method: "GET",
                    });
                    if (response.status === 200) {
                        return { status: Status.Ready, msg: "OpenAI API key is working" };
                    }
                    return { status: Status.Ready, msg: "OpenAI connected" };
                }
                case 'anthropic': {
                    const response = await requestUrl({
                        url: "https://api.anthropic.com/v1/models",
                        headers: {
                            'x-api-key': this.apiKey,
                            'anthropic-version': '2023-06-01',
                        },
                        method: "GET",
                    });
                    if (response.status === 200) {
                        return { status: Status.Ready, msg: "Anthropic API key is working" };
                    }
                    return { status: Status.Ready, msg: "Anthropic connected" };
                }
                case 'custom': {
                    const endpoint = (this.settings.customEndpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
                    const headers: Record<string, string> = {};
                    if (this.apiKey) {
                        headers['Authorization'] = `Bearer ${this.apiKey}`;
                    }
                    const response = await requestUrl({
                        url: `${endpoint}/models`,
                        headers,
                        method: "GET",
                    });
                    if (response.status === 200) {
                        return { status: Status.Ready, msg: "Custom endpoint is reachable" };
                    }
                    return { status: Status.Ready, msg: "Custom endpoint connected" };
                }
                case 'huggingface': {
                    const response = await requestUrl({
                        url: "https://huggingface.co/api/whoami-v2",
                        headers: { Authorization: `Bearer ${this.apiKey}` },
                        method: "GET",
                    });
                    if (response.status === 200) {
                        return { status: Status.Ready, msg: "Hugging Face API key is working" };
                    }
                    return { status: Status.Ready, msg: "Hugging Face connected" };
                }
                default:
                    return { status: Status.Misconfigured, msg: `Unknown provider: ${provider}` };
            }
        } catch (error: any) {
            const status = error?.status;
            if (status === 400 || status === 401 || status === 403) {
                return {
                    status: Status.Misconfigured,
                    msg: `Unauthorized: check your ${this.getProviderName(provider)} API key in settings`
                };
            } else {
                console.error('API status check error:', error);
                return {
                    status: Status.Unreachable,
                    msg: `Cannot reach ${this.getProviderName(provider)} (${status || error?.message || 'unknown error'})`
                };
            }
        }
    }
}
