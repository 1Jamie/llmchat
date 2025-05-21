/* extension.js
*/

const { Clutter, Gio, GLib, GObject, Pango, St, Shell } = imports.gi;
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Signals = imports.signals;

// Import tool system
const { ToolLoader } = Me.imports.utils.ToolLoader;
// Import our new MemoryService
const { MemoryService } = Me.imports.services.MemoryService;

// Import session management
const { SessionManager } = Me.imports.sessionManager;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Initialize memory service for RAG
let memoryService = null;
try {
    memoryService = MemoryService.getInstance();
    // Start initialization asynchronously only if not already initialized
    if (!memoryService._initialized) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            memoryService._startInitialization().catch(e => {
                log(`Error starting memory system initialization: ${e.message}`);
            });
            return GLib.SOURCE_REMOVE;
        });
    }
} catch (e) {
    log(`Error creating memory service: ${e.message}`);
}

// Initialize tool loader
const toolLoader = new ToolLoader();
toolLoader.setMemoryService(memoryService);
toolLoader.loadTools();

// Provider Adapter class to handle different AI providers
class ProviderAdapter {
    constructor(settings) {
        this._settings = settings;
        this._initialized = false;
        this._initializationPromise = null;
        
        // Initialize the memory system asynchronously
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            this._initializeMemorySystem().catch(e => {
                log(`Error initializing memory system: ${e.message}`);
            });
            return GLib.SOURCE_REMOVE;
        });
    }
    
    async _initializeMemorySystem() {
        if (this._initializationPromise) {
            return this._initializationPromise;
        }

        this._initializationPromise = (async () => {
            try {
                // Use the existing memory service instance
                if (memoryService) {
                    await memoryService.waitForInitialization();
                    this._initialized = true;
                    log('Memory system initialized successfully');
                } else {
                    log('Memory service not available');
                    this._initialized = true; // Still mark as initialized to allow operation without memory
                }
            } catch (e) {
                log(`Error in memory system initialization: ${e.message}`);
                this._initialized = true; // Mark as initialized even if memory system fails
            }
        })();

        return this._initializationPromise;
    }

    // Common interface for all providers
    async makeRequest(text, toolCalls = null) {
        // Ensure memory system is initialized before proceeding
        if (!this._initialized) {
            try {
                await this._initializeMemorySystem();
            } catch (e) {
                log(`Failed to initialize memory system: ${e.message}`);
                // Continue without memory system if initialization fails
            }
        }

        const provider = this._settings.get_string('service-provider');
        log(`Making request to provider: ${provider}`);
        
        try {
            // Extract just the user's query from the conversation history
            const userQuery = text.split('\n').filter(line => line.startsWith('User: ')).pop()?.replace('User: ', '') || text;
            
            let relevantToolsPrompt = '';
            let relevantMemories = [];
            
            if (memoryService && memoryService._initialized) {
                try {
                    // Step 1: Get relevant tools
                    const relevantTools = await memoryService.getRelevantToolDescriptions(userQuery);
                    relevantToolsPrompt = relevantTools; // Pass the entire result object
                    toolCalls = relevantTools.tools; // Use the tools array for function calls
                    
                    // Step 2: Get relevant memories
                    relevantMemories = await memoryService.getRelevantMemories(userQuery);
                    
                    // Step 3: Add memories to the conversation context
                    if (relevantMemories.length > 0) {
                        const memoryContext = this._formatMemoryContext(relevantMemories);
                        text = `${text}\n\nRelevant context from previous conversations:\n${memoryContext}`;
                    }
                } catch (e) {
                    log(`Error retrieving relevant tools or memories: ${e.message}`);
                    // If memory service fails, we'll proceed without the relevant tools/memories
                }
            }
            
            let response;
            switch (provider) {
                case 'openai':
                    response = await this._makeOpenAIRequest(text, toolCalls, relevantToolsPrompt);
                    break;
                case 'gemini':
                    response = await this._makeGeminiRequest(text, toolCalls, relevantToolsPrompt);
                    break;
                case 'anthropic':
                    response = await this._makeAnthropicRequest(text, toolCalls, relevantToolsPrompt);
                    break;
                case 'llama':
                    response = await this._makeLlamaRequest(text, toolCalls, relevantToolsPrompt);
                    break;
                case 'ollama':
                    response = await this._makeOllamaRequest(text, toolCalls, relevantToolsPrompt);
                    break;
                default:
                    throw new Error(`Unknown provider: ${provider}`);
            }
            
            // Remove automatic memory storage
            return response;
        } catch (error) {
            log(`Error in makeRequest: ${error.message}`);
            throw error;
        }
    }

    _formatMemoryContext(memories) {
        return memories.map(memory => {
            let context = `Memory: ${memory.text}\n`;
            
            // Add relevance score if available
            if (memory.relevance) {
                context += `Relevance: ${Math.round(memory.relevance * 100)}%\n`;
            }
            
            // Add timestamp if available
            if (memory.context?.timestamp) {
                const date = new Date(memory.context.timestamp);
                context += `Time: ${date.toLocaleString()}\n`;
            }
            
            // Add importance if available
            if (memory.context?.metadata?.importance) {
                context += `Importance: ${memory.context.metadata.importance}\n`;
            }
            
            // Add tags if available
            if (memory.context?.metadata?.tags?.length > 0) {
                context += `Tags: ${memory.context.metadata.tags.join(', ')}\n`;
            }
            
            return context;
        }).join('\n');
    }

    _determineMemoryImportance(query, response) {
        const text = `${query} ${response}`.toLowerCase();
        
        // Patterns for volatile/temporary information that should not be stored
        const volatilePatterns = [
            // System state patterns
            /(?:ip address|directory|current time|current date|system load|memory usage|cpu usage|disk space|process list|running processes)/i,
            /(?:file list|directory contents|folder contents|ls output|dir output)/i,
            /(?:window layout|workspace layout|screen layout|display configuration)/i,
            /(?:current session|active session|user session|login session)/i,
            
            // Temporary state patterns
            /(?:currently|now|right now|at the moment|presently|currently running|currently active)/i,
            /(?:temporary|temporary state|temporary file|temp file|cache|cached)/i,
            /(?:dynamic|dynamic content|dynamic state|changing|variable)/i,
            
            // System command outputs
            /(?:command output|terminal output|console output|shell output)/i,
            /(?:search results|query results|filtered results|sorted results)/i,
            /(?:error log|system log|application log|debug log)/i,
            
            // File system operations
            /(?:file operation|directory operation|file system|file listing|directory listing)/i,
            /(?:file content|file contents|file data|file information)/i,
            
            // Network and connectivity
            /(?:network status|connection status|connectivity|network state)/i,
            /(?:active connection|current connection|network connection)/i,
            
            // Process and system monitoring
            /(?:process status|system status|monitoring data|performance data)/i,
            /(?:resource usage|system resources|hardware status)/i
        ];

        // Check for volatile content first
        for (const pattern of volatilePatterns) {
            if (pattern.test(text)) {
                log(`Detected volatile content: ${pattern}`);
                return 'none';
            }
        }

        // Patterns for persistent information that should be stored
        const persistentPatterns = [
            // Personal preferences and settings
            /(?:prefer|preference|like|favorite|usually|typically|always|never)/i,
            /(?:setting|configuration|option|choice|decision)/i,
            
            // Personal identity and location
            /(?:name|email|address|location|city|country|timezone)/i,
            /(?:live in|reside in|located in|based in)/i,
            
            // Important decisions and relationships
            /(?:decided to|chose to|selected|picked|opted for)/i,
            /(?:friend|colleague|partner|family|relative)/i,
            
            // Significant dates and events
            /(?:birthday|anniversary|important date|significant date)/i,
            /(?:event|occasion|celebration|milestone)/i
        ];

        // Check for persistent content
        let isPersistent = false;
        for (const pattern of persistentPatterns) {
            if (pattern.test(text)) {
                isPersistent = true;
                break;
            }
        }

        // Calculate importance score based on multiple factors
        let importanceScore = 0;
        
        // Factor 1: Personal Relevance (0-3 points)
        if (isPersistent) {
            importanceScore += 3;
        }
        
        // Factor 2: Sentiment Strength (0-2 points)
        const sentimentWords = {
            positive: ['love', 'great', 'excellent', 'wonderful', 'amazing', 'perfect'],
            negative: ['hate', 'terrible', 'awful', 'horrible', 'bad', 'poor']
        };
        
        let sentimentCount = 0;
        for (const word of [...sentimentWords.positive, ...sentimentWords.negative]) {
            if (text.includes(word)) {
                sentimentCount++;
            }
        }
        importanceScore += Math.min(sentimentCount, 2);
        
        // Factor 3: Context Importance (0-2 points)
        const importantContexts = ['important', 'critical', 'essential', 'vital', 'crucial'];
        for (const context of importantContexts) {
            if (text.includes(context)) {
                importanceScore += 2;
                break;
            }
        }
        
        // Factor 4: Temporal Relevance (0-2 points)
        const temporalWords = ['always', 'never', 'forever', 'permanent', 'persistent'];
        for (const word of temporalWords) {
            if (text.includes(word)) {
                importanceScore += 2;
                break;
            }
        }
        
        // Determine final importance based on total score
        if (importanceScore >= 6) {
            return 'high';
        } else if (importanceScore >= 3) {
            return 'normal';
        }
        
        return 'none';
    }

    _extractTags(query, response) {
        const tags = new Set();
        
        // Extract potential tags from the text
        const text = `${query} ${response}`.toLowerCase();
        
        // Common categories for tagging
        const categories = {
            'system': ['system', 'computer', 'desktop', 'settings'],
            'personal': ['name', 'preference', 'like', 'favorite'],
            'task': ['task', 'todo', 'reminder', 'schedule'],
            'technical': ['error', 'bug', 'fix', 'solution']
        };
        
        // Check each category
        Object.entries(categories).forEach(([category, keywords]) => {
            if (keywords.some(keyword => text.includes(keyword))) {
                tags.add(category);
            }
        });
        
        return Array.from(tags);
    }

    // Shared tool processing methods
    _extractToolCalls(text) {
        log('Attempting to extract tool calls from response...');
        let toolCalls = [];
        let remainingText = text;
        let matches = [];
        let i = 0;
        while (i < text.length) {
            if (text[i] === '{') {
                let stack = 1;
                let j = i + 1;
                let inString = false;
                let escape = false;
                while (j < text.length && stack > 0) {
                    if (inString) {
                        if (escape) {
                            escape = false;
                        } else if (text[j] === '\\') {
                            escape = true;
                        } else if (text[j] === '"') {
                            inString = false;
                        }
                    } else {
                        if (text[j] === '"') {
                            inString = true;
                        } else if (text[j] === '{') {
                            stack++;
                        } else if (text[j] === '}') {
                            stack--;
                        }
                    }
                    j++;
                }
                if (stack === 0) {
                    const candidate = text.slice(i, j);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (parsed.tool && parsed.arguments) {
                            matches.push({ parsed, match: candidate });
                        }
                    } catch (e) {}
                    i = j;
                } else {
                    break; // Unmatched brace
                }
            } else {
                i++;
            }
        }
        // Remove duplicates
        const seen = new Set();
        const uniqueMatches = [];
        for (const m of matches) {
            const key = m.parsed.tool + JSON.stringify(m.parsed.arguments);
            if (!seen.has(key)) {
                seen.add(key);
                uniqueMatches.push(m);
            }
        }
        // Remove each JSON from the text
        for (const { parsed, match } of uniqueMatches) {
            toolCalls.push({
                function: {
                    name: parsed.tool,
                    arguments: JSON.stringify(parsed.arguments)
                }
            });
            remainingText = remainingText.replace(match, '').trim();
        }
        return { toolCalls, remainingText };
    }

    _processToolResponse(response) {
        log(`Processing response for tool calls: ${JSON.stringify(response)}`);
        let text = '';
        let toolCalls = [];
        let memoryCommands = [];

        try {
            // Handle different response formats
            if (response.choices && response.choices[0]) {
                const message = response.choices[0].message;
                if (message) {
                    text = message.content || '';
                    
                    // Extract memory commands
                    const memoryMatches = text.match(/<memory>([\s\S]*?)<\/memory>/g);
                    if (memoryMatches) {
                        memoryMatches.forEach(match => {
                            try {
                                const memoryJson = match.match(/<memory>([\s\S]*?)<\/memory>/)[1];
                                const memoryData = JSON.parse(memoryJson);
                                memoryCommands.push(memoryData);
                            } catch (e) {
                                log(`Error parsing memory command: ${e.message}`);
                            }
                        });
                        // Remove memory commands from the text
                        text = text.replace(/<memory>[\s\S]*?<\/memory>/g, '').trim();
                    }
                    
                    // Check for function calls in OpenAI format
                    if (message.function_call) {
                        toolCalls = [{
                            function: {
                                name: message.function_call.name,
                                arguments: message.function_call.arguments
                            }
                        }];
                    }
                    // If no function calls found, try extracting from content
                    else if (text) {
                        const extracted = this._extractToolCalls(text);
                        toolCalls = extracted.toolCalls;
                        text = extracted.remainingText;
                    }
                }
            } else if (response.response) {
                // Handle Ollama-style response
                text = response.response;
                const extracted = this._extractToolCalls(text);
                toolCalls = extracted.toolCalls;
                text = extracted.remainingText;
                
                // Extract memory commands
                const memoryMatches = text.match(/<memory>([\s\S]*?)<\/memory>/g);
                if (memoryMatches) {
                    memoryMatches.forEach(match => {
                        try {
                            const memoryJson = match.match(/<memory>([\s\S]*?)<\/memory>/)[1];
                            const memoryData = JSON.parse(memoryJson);
                            memoryCommands.push(memoryData);
                        } catch (e) {
                            log(`Error parsing memory command: ${e.message}`);
                        }
                    });
                    // Remove memory commands from the text
                    text = text.replace(/<memory>[\s\S]*?<\/memory>/g, '').trim();
                }
            }

            // Process memory commands if we have them
            if (memoryCommands.length > 0 && memoryService && memoryService._initialized) {
                memoryCommands.forEach(memory => {
                    try {
                        memoryService.indexMemory({
                            text: memory.content,
                            context: {
                                type: memory.type,
                                importance: memory.importance,
                                context: memory.context,
                                tags: memory.tags,
                                timestamp: new Date().toISOString()
                            }
                        });
                    } catch (e) {
                        log(`Error storing memory: ${e.message}`);
                    }
                });
            }

            // Process thinking tags if hide-thinking is enabled
            if (this._settings.get_boolean('hide-thinking')) {
                text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
            }
        } catch (error) {
            log(`Error processing tool response: ${error.message}`);
        }

        log(`Processed response - text length: ${text.length}, tool calls: ${toolCalls.length}, memory commands: ${memoryCommands.length}`);
        return { text, toolCalls };
    }

    // Update LlamaCPP request method to use shared processing and include relevant tools
    _makeLlamaRequest(text, toolCalls, relevantToolsPrompt) {
        const serverUrl = this._settings.get_string('llama-server-url');
        if (!serverUrl) {
            throw new Error('Llama server URL is not set');
        }

        const modelName = this._settings.get_string('llama-model-name') || 'llama';
        const temperature = this._settings.get_double('llama-temperature');

        // Create the system message with tool instructions and relevant tools
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        const systemMessage = {
            role: 'system',
            content: systemPrompt
        };

        // Create the user message
        const userMessage = {
            role: 'user',
            content: text
        };

        // Create the request payload
        const payload = {
            model: modelName,
            messages: [systemMessage, userMessage],
            max_tokens: 1338,
            temperature: temperature,
            stream: false,
            functions: toolCalls || [],  // Use the filtered tools
            function_call: 'auto'
        };

        log(`Making Llama request with data: ${JSON.stringify(payload)}`);

        const message = Soup.Message.new('POST', `${serverUrl}/v1/chat/completions`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(payload)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    const errorMsg = `Llama API error: ${msg.status_code} - ${msg.reason_phrase}`;
                    log(errorMsg);
                    reject(errorMsg);
                    return;
                }

                try {
                    const response = JSON.parse(msg.response_body.data);
                    log(`Received Llama response: ${JSON.stringify(response)}`);
                    
                    // Use shared processing method
                    const processed = this._processToolResponse(response);
                    resolve(processed);
                } catch (error) {
                    log(`Error processing Llama response: ${error.message}`);
                    reject(`Error processing Llama response: ${error.message}`);
                }
            });
        });
    }

    // Provider-specific request implementations with relevant tools support
    _makeOpenAIRequest(text, toolCalls, relevantToolsPrompt) {
        const apiKey = this._settings.get_string('openai-api-key');
        if (!apiKey) {
            throw new Error('OpenAI API key is not set');
        }

        const model = this._settings.get_string('openai-model');
        const temperature = this._settings.get_double('openai-temperature');

        // Add relevant tools to the system prompt
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
        ];

        const requestData = {
            model: model,
            messages: messages,
            max_tokens: Math.round(this._settings.get_int('max-response-length') / 4),
            temperature: temperature
        };

        if (toolCalls && toolCalls.length > 0) {
            requestData.tools = toolCalls;  // Use the filtered tools
            requestData.tool_choice = "auto";
        }

        const message = Soup.Message.new('POST', 'https://api.openai.com/v1/chat/completions');
        message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    reject(`OpenAI API error: ${msg.status_code}`);
                    return;
                }
                try {
                    const response = JSON.parse(msg.response_body.data);
                    resolve({
                        text: response.choices[0].message.content || '',
                        toolCalls: response.choices[0].message.tool_calls || []
                    });
                } catch (error) {
                    reject(`Error parsing OpenAI response: ${error.message}`);
                }
            });
        });
    }

    _makeGeminiRequest(text, toolCalls, relevantToolsPrompt) {
        const apiKey = this._settings.get_string('gemini-api-key');
        if (!apiKey) {
            throw new Error('Gemini API key is not set');
        }

        // Add relevant tools to the system prompt
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        
        // Format the prompt to include tool descriptions
        const toolDescriptions = toolCalls ? toolCalls.map(tool => 
            `${tool.name}: ${tool.description}\nRequired parameters: ${Object.entries(tool.parameters)
                .filter(([_, param]) => param.required)
                .map(([name, param]) => `${name}: ${param.description}`)
                .join(', ')}`
        ).join('\n\n') : '';
        
        const fullPrompt = `${systemPrompt}\n\n${toolDescriptions}\n\nUser query: ${text}`;
        
        const requestData = {
            contents: [{
                parts: [{ text: fullPrompt }]
            }]
        };

        const message = Soup.Message.new('POST', `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    reject(`Gemini API error: ${msg.status_code}`);
                    return;
                }
                try {
                    const response = JSON.parse(msg.response_body.data);
                    resolve({
                        text: response.candidates[0].content.parts[0].text || '',
                        toolCalls: []
                    });
                } catch (error) {
                    reject(`Error parsing Gemini response: ${error.message}`);
                }
            });
        });
    }

    _makeAnthropicRequest(text, toolCalls, relevantToolsPrompt) {
        const apiKey = this._settings.get_string('anthropic-api-key');
        if (!apiKey) {
            throw new Error('Anthropic API key is not set');
        }

        const model = this._settings.get_string('anthropic-model');
        const temperature = this._settings.get_double('anthropic-temperature');
        const maxTokens = this._settings.get_int('anthropic-max-tokens');

        // Add relevant tools to the system prompt
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        
        // Format the prompt to include tool descriptions
        const toolDescriptions = toolCalls ? toolCalls.map(tool => 
            `${tool.name}: ${tool.description}\nRequired parameters: ${Object.entries(tool.parameters)
                .filter(([_, param]) => param.required)
                .map(([name, param]) => `${name}: ${param.description}`)
                .join(', ')}`
        ).join('\n\n') : '';
        
        const anthropicPrompt = `${systemPrompt}\n\n${toolDescriptions}\n\nHuman: ${text}\n\nAssistant:`;

        const requestData = {
            model: model,
            prompt: anthropicPrompt,
            max_tokens_to_sample: maxTokens,
            temperature: temperature
        };

        const message = Soup.Message.new('POST', 'https://api.anthropic.com/v1/complete');
        message.request_headers.append('X-API-Key', apiKey);
        message.request_headers.append('Content-Type', 'application/json');
        message.request_headers.append('anthropic-version', '2023-06-01');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    reject(`Anthropic API error: ${msg.status_code}`);
                    return;
                }
                try {
                    const response = JSON.parse(msg.response_body.data);
                    resolve({
                        text: response.completion || '',
                        toolCalls: []
                    });
                } catch (error) {
                    reject(`Error parsing Anthropic response: ${error.message}`);
                }
            });
        });
    }

    _makeOllamaRequest(text, toolCalls, relevantToolsPrompt) {
        const serverUrl = this._settings.get_string('ollama-server-url');
        if (!serverUrl) {
            throw new Error('Ollama server URL is not set');
        }

        const modelName = this._settings.get_string('ollama-model-name') || 'llama2';
        const temperature = this._settings.get_double('ollama-temperature');

        // For Ollama, we need to use their chat API which has better support for tools
        let requestUrl = `${serverUrl}/api/generate`;
        
        // Get the system prompt with relevant tools
        const toolSystemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        
        // Build the full prompt
        const fullPrompt = `${toolSystemPrompt}\n\nUser: ${text}`;
        
        let requestData = {
            model: modelName,
            prompt: fullPrompt,
            stream: false,
            options: {
                temperature: temperature
            }
        };

        log(`Making Ollama request with tool support. Model: ${modelName}, temp: ${temperature}`);
        
        log(`Sending request to Ollama: ${requestUrl}`);
        const message = Soup.Message.new('POST', requestUrl);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    const errorMsg = `Ollama API error: ${msg.status_code}`;
                    log(errorMsg);
                    reject(errorMsg);
                    return;
                }
                try {
                    log('Received response from Ollama, parsing...');
                    const response = JSON.parse(msg.response_body.data);
                    
                    // Use shared processing method
                    const processed = this._processToolResponse(response);
                    resolve(processed);
                } catch (error) {
                    const errorMsg = `Error parsing Ollama response: ${error.message}`;
                    log(errorMsg);
                    reject(errorMsg);
                }
            });
        });
    }

    _getToolSystemPrompt(relevantToolsPrompt = '') {
        // Always use the RAG system's prompt
        if (relevantToolsPrompt) {
            // First try to use the descriptions array, then fall back to tools array
            const tools = relevantToolsPrompt.descriptions || relevantToolsPrompt.tools || [];
            if (tools.length > 0) {
                // Format the tool descriptions for the prompt
                const toolDescriptions = tools.map(tool => {
                    let prompt = `Tool: ${tool.name}
Description: ${tool.description}
Parameters:`;
                    if (tool.parameters) {
                        Object.entries(tool.parameters).forEach(([name, param]) => {
                            prompt += `\n  - ${name}: ${param.description}`;
                            if (param.enum) {
                                prompt += `\n    Allowed values: ${param.enum.join(', ')}`;
                            }
                        });
                    }
                    return prompt;
                }).join('\n\n');

                return `You are a helpful assistant with access to the following tools:

${toolDescriptions}

TOOL USAGE RULES:
1. For tool calls, respond with ONLY a JSON object: {"tool": "tool_name", "arguments": {"param1": "value1"}}
2. No text before/after JSON, no XML tags, no explanations
3. If no tool needed, respond conversationally

MEMORY MANAGEMENT:
When storing memories, you MUST include the memory command in your response. Format your response like this:

1. First, respond to the user's main request
2. Then, include the memory command as a separate JSON object
3. Both the response and memory command should be in the same message

Example format:
I'll check the weather for you in Memphis. Let me search that for you.

{"tool": "web_search", "arguments": {"query": "weather forecast Memphis TN"}}

{"tool": "add_memory", "arguments": {
    "text": "User lives in Memphis, TN",
    "context": {
        "type": "personal",
        "importance": "high",
        "tags": ["location", "personal"]
    }
}}

IMPORTANT MEMORY GUIDELINES:
1. ALWAYS complete the user's main request first
2. ALWAYS include the memory command in your response when storing information
3. Store memories as a side effect while performing the main task
4. Do not let memory storage prevent you from completing the primary task

DO NOT store:
- Temporary or volatile information (current time, file listings, search results)
- System state (open windows, running processes, network status)
- Command outputs or tool results
- Individual user queries unless they are very important
- Folder contents or file listings
- Web search results or web content
- Dynamic/changing information

DO store:
- Personal preferences and settings
- Important decisions and choices
- Personal information (name, location, timezone) - ALWAYS save when mentioned
- Significant dates and events
- Important relationships and connections
- Hard-to-remember technical details
- User-specific configurations

EXAMPLE OF PROPER RESPONSE WITH MEMORY:
I'll check the weather for you in Memphis. Let me search that for you.

{"tool": "web_search", "arguments": {"query": "weather forecast Memphis TN"}}

{"tool": "add_memory", "arguments": {
    "text": "User lives in Memphis, TN",
    "context": {
        "type": "personal",
        "importance": "high",
        "tags": ["location", "personal"]
    }
}}`;
            }
        }
        
        // If no relevant tools found, return a minimal prompt
        return 'You are a helpful assistant. No specific tools are available for this query. Please respond conversationally.';
    }
}

class LLMChatBox {
    constructor(settings) {
        this._settings = settings;
        this._messages = [];
        this._maxResponseLength = settings.get_int('max-response-length');
        this._maxInitialHeight = 800;
        this._initialHeight = 600;
        this._sessionId = GLib.uuid_string_random();
        this._lastSearchResults = null;
        this._lastSearchQuery = null;
        this._lastSearchUrls = new Map();
        
        // Add tool call tracking for loop protection
        this._toolCallCount = 0;
        this._maxToolCalls = 10;
        this._recentToolCalls = [];
        this._maxRecentToolCalls = 5;
        
        // Create main container
        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-box',
            y_expand: true
        });

        // Chat history scroll view
        this._scrollView = new St.ScrollView({
            style_class: 'llm-chat-scrollview',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true
        });

        // Container for chat messages
        this._messageContainer = new St.BoxLayout({
            vertical: true,
            y_expand: true
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._scrollView.add_actor(this._messageContainer);
        this.actor.add_child(this._scrollView);

        // Connect to settings changes for thinking visibility
        this._settingsChangedId = this._settings.connect('changed::hide-thinking', () => {
            log('Thinking visibility setting changed');
            this._updateThinkingVisibility();
        });

        // --- Input Area Improvements ---
        // Use a vertical layout for input area to accommodate a larger text entry
        const inputBox = new St.BoxLayout({
            style_class: 'llm-chat-input-box',
            vertical: true, // Changed to vertical
            y_align: Clutter.ActorAlign.END, //align to the bottom
        });


        // Text entry (make it multi-line)
        this._entryText = new St.Entry({
            style_class: 'llm-chat-entry',
            can_focus: true,
            hint_text: 'Type your message...',
           // x_expand: true,  Removed to allow for wrapping within the box
            y_expand: false, // Don't expand vertically, let the height be determined by content.
        });

        this._entryText.clutter_text.line_wrap = true;
        this._entryText.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._entryText.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._entryText.clutter_text.single_line_mode = false;
        this._entryText.clutter_text.activatable = false;

        // Store signal handler IDs
        this._entryText.clutter_text._keyPressHandlerId = this._entryText.clutter_text.connect('key-press-event', (actor, event) => {
            let keyval = event.get_key_symbol();
            let state = event.get_state();
            log(`Key press detected: keyval = ${keyval}, state = ${state}`);

            // Submit on Enter (without Ctrl)
            if (keyval === Clutter.KEY_Return && !(state & Clutter.ModifierType.CONTROL_MASK)) {
                this._onEntryActivated();
                return true;
            }
            // Submit on Ctrl+Enter
            if (keyval === Clutter.KEY_Return && (state & Clutter.ModifierType.CONTROL_MASK)) {
                this._onEntryActivated();
                return true;
            }
            return false;
        });

        this._entryText.clutter_text._activateHandlerId = this._entryText.clutter_text.connect('activate', this._onEntryActivated.bind(this));

        // --- Key Press Handling for Multi-Line Input ---
        this._entryText.clutter_text._multiLineHandlerId = this._entryText.clutter_text.connect('key-press-event', (actor, event) => {
            let keyval = event.get_key_symbol();
            let state = event.get_state();
            log(`Key press detected: keyval = ${keyval}, state = ${state}`);

            // Allow new lines on Shift+Enter
            if(keyval === Clutter.KEY_Return && (state & Clutter.ModifierType.SHIFT_MASK)) {
                actor.insert_text("\n", actor.get_cursor_position());
                return true;
            }
            if (keyval === Clutter.KEY_Return) {
                return true;
            }
            return false;
        });

        inputBox.add_child(this._entryText);

        // Container for buttons (horizontal)
        const buttonBox = new St.BoxLayout({
            style_class: 'llm-chat-button-box', // Add a class for potential styling
            vertical: false,
             x_align: Clutter.ActorAlign.END // Align buttons to right
        });

        // Send button
        const sendButton = new St.Button({
            style_class: 'llm-chat-button',
            label: 'Send'
        });
        sendButton.connect('clicked', this._onSendButtonClicked.bind(this));
        buttonBox.add_child(sendButton);

        // Settings button
        const settingsIcon = new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 16
        });

        const settingsButton = new St.Button({
            style_class: 'llm-chat-settings-button',
            child: settingsIcon
        });
        settingsButton.connect('clicked', this._onSettingsButtonClicked.bind(this));
        buttonBox.add_child(settingsButton);

        // Add tool calling state
        this._toolCallingEnabled = false;
        
        // Replace hardcoded tools with the ones loaded from the ToolLoader
        this._availableTools = toolLoader.getToolsAsSchemaArray();

        // Add tool calling toggle button
        this._toolCallingToggleButton = new St.Button({
            style_class: 'llm-chat-tool-button',
            label: 'Tools: OFF'
        });
        this._toolCallingToggleButton._clickHandlerId = this._toolCallingToggleButton.connect('clicked', this._onToolCallingToggleClicked.bind(this));
        buttonBox.add_child(this._toolCallingToggleButton);

        inputBox.add_child(buttonBox);  // Add button container to vertical input box

        this.actor.add_child(inputBox); // Add the entire input box (entry + buttons) to main actor.
        this._adjustWindowHeight(); // Adjust height on creation.

        // Initialize the provider adapter
        this._providerAdapter = new ProviderAdapter(settings);

        // Initialize tool system
        this.toolLoader = new ToolLoader();
        this.toolLoader.loadTools();
        this.tools = this.toolLoader.getTools();
        
        // Always enable tool calling by default, since we're now relying on it for all functionality
        this._toolCallingEnabled = true;
        this._toolCallingToggleButton.label = 'Tools: ON';
        this._toolCallingToggleButton.add_style_class_name('llm-chat-tool-button-selected');

        // Initialize session manager
        this._sessionManager = new SessionManager();
        this._sessionId = GLib.uuid_string_random();
        this._sessionTitle = null;

        // Add session history button
        const historyIcon = new St.Icon({
            icon_name: 'document-open-recent-symbolic',
            icon_size: 16
        });

        const historyButton = new St.Button({
            style_class: 'llm-chat-settings-button',
            child: historyIcon
        });
        historyButton.connect('clicked', this._onHistoryButtonClicked.bind(this));
        buttonBox.add_child(historyButton);

        // Add new chat button
        const newChatIcon = new St.Icon({
            icon_name: 'document-new-symbolic',
            icon_size: 16
        });

        const newChatButton = new St.Button({
            style_class: 'llm-chat-settings-button',
            child: newChatIcon
        });
        newChatButton.connect('clicked', this._onNewChatButtonClicked.bind(this));
        buttonBox.add_child(newChatButton);
        
        // Initialize view state
        this._currentView = 'chat'; // possible values: 'chat', 'history'
    }

    _onEntryActivated() {
        const text = this._entryText.get_text();
        if (text.trim() !== '') {
            this._sendMessage(text);
            this._entryText.set_text('');
        }
    }

    _onSendButtonClicked() {
        const text = this._entryText.get_text();
        if (text.trim() !== '') {
            this._sendMessage(text);
            this._entryText.set_text('');
        }
    }

    _onSettingsButtonClicked() {
        ExtensionUtils.openPrefs();
    }

    _onToolCallingToggleClicked() {
        this._toolCallingEnabled = !this._toolCallingEnabled;
        this._toolCallingToggleButton.label = this._toolCallingEnabled ? 'Tools: ON' : 'Tools: OFF';
        
        if (this._toolCallingEnabled) {
            this._toolCallingToggleButton.add_style_class_name('llm-chat-tool-button-selected');
        } else {
            this._toolCallingToggleButton.remove_style_class_name('llm-chat-tool-button-selected');
        }
    }

    _executeToolCall(toolCall) {
        try {
            log(`Executing tool call: name=${toolCall.name}, arguments=${JSON.stringify(toolCall.arguments)}`);
            
            const tool = this.toolLoader.getTool(toolCall.name);
            if (!tool) {
                const errorMsg = `Tool ${toolCall.name} not found`;
                log(errorMsg);
                return { error: errorMsg };
            }
            
            log(`Found tool: ${tool.name}, category=${tool.category}`);
            
            // Ensure arguments is an object
            let args = toolCall.arguments;
            if (typeof args === 'string') {
                try {
                    args = JSON.parse(args);
                    log(`Parsed arguments string into object: ${JSON.stringify(args)}`);
                } catch (e) {
                    log(`Could not parse arguments string, using as-is: ${e.message}`);
                }
            }

            // Type correction for fetch_web_content: ensure urls is an array
            if (toolCall.name === 'fetch_web_content' && args.urls) {
                if (typeof args.urls === 'string') {
                    try {
                        args.urls = JSON.parse(args.urls);
                    } catch (e) {
                        args.urls = [args.urls];
                    }
                }
            }
            
            log(`Executing tool with arguments: ${JSON.stringify(args)}`);
            const result = tool.execute(args);
            
            if (result instanceof Promise) {
                log('Tool returned a Promise, waiting for result...');
                return result.then(r => {
                    log(`Promise resolved with result: ${JSON.stringify(r)}`);
                    return r;
                }).catch(e => {
                    const errorMsg = `Error in Promise execution: ${e.message}`;
                    log(errorMsg);
                    return { error: errorMsg };
                });
            }
            
            log(`Tool execution complete, result: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            const errorMsg = `Error executing tool: ${error.message}`;
            log(errorMsg);
            return { error: errorMsg };
        }
    }

    _sendMessage() {
        const message = this._entryText.get_text().trim();
        if (!message) return;

        // Clear input
        this._entryText.set_text('');

        // Reset tool call tracking between user messages
        // This allows fresh tool calls for each new user query
        this._toolCallCount = 0;
        this._recentToolCalls = [];

        // Add user message
        this._addMessage(message, 'user');

        // Save session after each message
        this._saveCurrentSession();

        // Add thinking message if not hidden
        if (!this._settings.get_boolean('hide-thinking')) {
            this._addMessage('Thinking...', 'assistant', true);
        }

        // Get conversation history
        const history = this._getConversationHistory();

        // Construct the full prompt with conversation history
        const fullPrompt = history + message;
        
        // Log the tool calling state and available tools
        log(`Tool calling is now always enabled. Available tools: ${this.toolLoader.getTools().length}`);

        // Make the API request using the provider adapter - always enable tool calls
        this._providerAdapter.makeRequest(fullPrompt, true)
            .then(response => {
                log(`Received response from API: text length=${response.text ? response.text.length : 0}, tool calls=${response.toolCalls ? response.toolCalls.length : 0}`);
                
                // Check for tool calls
                if (response.toolCalls && response.toolCalls.length > 0) {
                    log(`Processing ${response.toolCalls.length} tool calls`);
                    
                    // Remove thinking message before showing tool call processing
                    if (!this._settings.get_boolean('hide-thinking')) {
                        const children = this._messageContainer.get_children();
                        const lastChild = children[children.length - 1];
                        if (lastChild && lastChild._isThinking) {
                            this._messageContainer.remove_child(lastChild);
                        }
                    }
                    
                    this._handleToolCalls(response.toolCalls, response.text);
                } else {
                    // Remove thinking message if it exists
                    if (!this._settings.get_boolean('hide-thinking')) {
                        const children = this._messageContainer.get_children();
                        const lastChild = children[children.length - 1];
                        if (lastChild && lastChild._isThinking) {
                            this._messageContainer.remove_child(lastChild);
                        }
                    }
                    
                    this._addMessage(response.text, 'ai');
                }
            })
            .catch(error => {
                // Remove thinking message if it exists
                if (!this._settings.get_boolean('hide-thinking')) {
                    const children = this._messageContainer.get_children();
                    const lastChild = children[children.length - 1];
                    if (lastChild && lastChild._isThinking) {
                        this._messageContainer.remove_child(lastChild);
                    }
                }
                
                this._addMessage(`Error: ${error.message}`, 'ai');
            });
    }

    _handleToolCalls(toolCalls, originalResponse) {
        // Log tool calls for debugging
        log(`Handling tool calls: ${JSON.stringify(toolCalls)}`);
        
        // Check for tool call limits and loops
        this._toolCallCount++;
        if (this._toolCallCount > this._maxToolCalls) {
            const errorMsg = `Tool call limit exceeded (${this._maxToolCalls} calls). This might indicate a loop in the AI's reasoning. Stopping further tool calls.`;
            log(errorMsg);
            this._addMessage(errorMsg, 'system');
            this._toolCallCount = 0; // Reset counter
            this._recentToolCalls = []; // Clear recent calls
            
            // Add a final response using the information we have
            const finalResponse = `Based on the information gathered so far, the current time is ${new Date().toLocaleTimeString()}.`;
            this._addMessage(finalResponse, 'ai');
            return;
        }

        // Store and check for repeated tool calls
        const currentCall = toolCalls.map(call => ({
            name: call.function.name,
            args: call.function.arguments
        }));
        
        // Check for repeated identical calls with context awareness
        const isRepeatedCall = this._recentToolCalls.some(prevCall => {
            // For web search and content fetching, allow repeated calls with different arguments
            if (currentCall[0].name === 'web_search' || currentCall[0].name === 'fetch_web_content') {
                return false; // Allow repeated calls for these tools
            }
            // For other tools, check for exact matches
            return JSON.stringify(prevCall) === JSON.stringify(currentCall);
        });

        if (isRepeatedCall) {
            const errorMsg = "Detected repeated identical tool calls. Stopping to prevent loops.";
            log(errorMsg);
            this._addMessage(errorMsg, 'system');
            this._toolCallCount = 0; // Reset counter
            this._recentToolCalls = []; // Clear recent calls
            
            // Add a final response that uses the information we have
            const finalResponse = `I've already executed this tool call. Based on the previous results, the current time is ${new Date().toLocaleTimeString()}.`;
            this._addMessage(finalResponse, 'ai');
            return;
        }

        // Add current call to recent calls
        this._recentToolCalls.push(currentCall);
        if (this._recentToolCalls.length > this._maxRecentToolCalls) {
            this._recentToolCalls.shift(); // Remove oldest call
        }

        // Remove the "Thinking..." message if it exists
        const children = this._messageContainer.get_children();
        const lastChild = children[children.length - 1];
        if (lastChild && lastChild._isThinking) {
            this._messageContainer.remove_child(lastChild);
        }
        
        // Create an array of promises for all tool calls
        const toolPromises = toolCalls.map(toolCall => {
            return new Promise((resolve, reject) => {
                try {
                    log(`Executing tool call: ${toolCall.function.name} with args: ${toolCall.function.arguments}`);
                    let args;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        log(`Failed to parse arguments JSON: ${e.message}, using as-is`);
                        args = toolCall.function.arguments;
                    }
                    const runTool = (toolCallObj) => {
                        const result = this._executeToolCall(toolCallObj);
                        if (result instanceof Promise) {
                            result.then(r => resolve({
                                toolName: toolCallObj.name,
                                args: toolCallObj.arguments,
                                result: r
                            })).catch(reject);
                        } else {
                            resolve({
                                toolName: toolCallObj.name,
                                args: toolCallObj.arguments,
                                result: result
                            });
                        }
                    };
                    // First run the tool call
                    const result = this._executeToolCall({
                        name: toolCall.function.name,
                        arguments: args
                    });
                    const handleResult = (r) => {
                        if (r && r.confirmation_required) {
                            this._addConfirmationMessage(r.summary, r.params).then(() => {
                                // On confirm, run the tool call with confirm: true
                                const confirmedToolCall = {
                                    name: r.params.tool || r.params.tool_name || toolCall.function.name,
                                    arguments: r.params
                                };
                                runTool(confirmedToolCall);
                            }).catch(() => {
                                // If denied, resolve with error result
                            resolve({
                                toolName: toolCall.function.name,
                                args: args,
                                    result: { error: 'Action was not confirmed by the user.' }
                            });
                        });
                            return;
                        }
                        log(`Tool ${toolCall.function.name} returned result: ${JSON.stringify(r)}`);
                        resolve({
                            toolName: toolCall.function.name,
                            args: args,
                            result: r
                        });
                    };
                    if (result instanceof Promise) {
                        result.then(handleResult).catch(e => {
                            log(`Tool ${toolCall.function.name} Promise error: ${e.message}`);
                            reject(e);
                        });
                    } else {
                        handleResult(result);
                    }
                } catch (error) {
                    log(`Error executing tool call: ${error.message}`);
                    reject(error);
                }
            });
        });

        // Wait for all tool calls to complete
        Promise.all(toolPromises)
            .then(results => {
                log(`All tool calls completed, processing results`);
                // Show user-friendly status message for each tool result
                results.forEach(result => {
                    if (result.result && result.result.message) {
                        this._addMessage(result.result.message, 'system');
                    } else if (result.result && result.result.error) {
                        this._addMessage(`❌ Tool error: ${result.result.error}`, 'system');
                    }
                });
                
                // Create a better format for the results that includes tool name and args
                const toolResults = results.map(result => ({
                    name: result.toolName,
                    arguments: result.args,
                    result: result.result
                }));

                // If we have tool results, make a follow-up request
                if (toolResults.length > 0) {
                    // Create a simplified status message for the UI
                    let toolStatusMessage = "Tool execution status:\n";
                    toolResults.forEach(result => {
                        const status = result.result?.error ? "Failed" : "Success";
                        toolStatusMessage += `• ${result.name}: ${status}\n`;
                    });
                    
                    // Display simplified tool status as system message
                    this._addMessage(toolStatusMessage, 'system', false, toolResults);
                    
                    // Build history of all tool calls made in this session
                    const toolCallHistory = this._recentToolCalls.map(calls => {
                        return calls.map(call => `${call.name}(${JSON.stringify(call.args)})`).join(", ");
                    }).join(" → ");
                    
                    // Prepare a more structured tool result text for the AI
                    const toolResultsText = toolResults.map(result => {
                        if (result.result && result.result.formatted_list) {
                            return `Tool '${result.name}' returned:\n${result.result.formatted_list}`;
                        } else if (result.result && result.result.results) {
                            // Format fetch_web_content results
                            const contentResults = result.result.results.map(contentResult => {
                                if (contentResult.formatted_content) {
                                    return `Content from ${contentResult.url}:\n${contentResult.formatted_content}`;
                                } else if (contentResult.content) {
                                    return `Content from ${contentResult.url}:\n${contentResult.content}`;
                                }
                                return `Error from ${contentResult.url}: ${contentResult.error || 'Unknown error'}`;
                            }).join('\n\n');
                            return `Tool '${result.name}' returned:\n${contentResults}`;
                        } else {
                            return `Tool '${result.name}' returned:\n${JSON.stringify(result.result, null, 2)}`;
                        }
                    }).join('\n\n');

                    // Make the follow-up prompt more directive for the LLM
                    const followUpPrompt = `Here are the results from the tools I used to help answer your request:\n\n${toolResultsText}\n\nPlease use this information to provide a complete answer to the user's question. Do not make additional tool calls.`;
                    
                    log(`Making follow-up request with tool results and instructions for next steps`);
                    
                    // Add a temporary message
                    this._addMessage("Processing tool results...", 'assistant', true);
                    
                    // Always enable tool calling for follow-up requests
                    this._providerAdapter.makeRequest(followUpPrompt, true)
                        .then(response => {
                            // Remove the temporary message
                            const children = this._messageContainer.get_children();
                            const lastChild = children[children.length - 1];
                            if (lastChild && lastChild._isThinking) {
                                this._messageContainer.remove_child(lastChild);
                            }
                            
                            // Check if the response contains more tool calls
                            if (response.toolCalls && response.toolCalls.length > 0) {
                                // Check if these are new, different tool calls
                                const isNewToolCall = !this._recentToolCalls.some(prevCalls => {
                                    return response.toolCalls.some(newCall => {
                                        const newCallData = {
                                            name: newCall.function.name,
                                            args: JSON.parse(newCall.function.arguments)
                                        };
                                        
                                        return prevCalls.some(prevCall => 
                                            prevCall.name === newCallData.name && 
                                            JSON.stringify(prevCall.args) === JSON.stringify(newCallData.args)
                                        );
                                    });
                                });
                                
                                if (isNewToolCall) {
                                    // These appear to be legitimately new tool calls
                                    log('Received new, different tool calls. Processing...');
                                    this._handleToolCalls(response.toolCalls, response.text || originalResponse);
                                } else {
                                    // These are repeated tool calls - break the loop
                                    log('Received repeated tool calls despite warnings. Breaking loop.');
                                    const errorMsg = "The AI attempted to make repeated tool calls. Stopping to prevent loops.";
                                    this._addMessage(errorMsg, 'system');
                                    
                                    // Generate a final response based on available information
                                    let finalResponse = "Based on the information I gathered: ";
                                    toolResults.forEach(result => {
                                        if (result.name === 'web_search') {
                                            finalResponse += `I found information about "${result.arguments.query}". `;
                                        } else if (result.name === 'fetch_web_content') {
                                            finalResponse += `I retrieved content from ${result.arguments.url}. `;
                                        } else {
                                            finalResponse += `I gathered information using the ${result.name} tool. `;
                                        }
                                    });
                                    
                                    this._addMessage(finalResponse, 'ai');
                                    
                                    // Reset counters
                                    this._toolCallCount = 0;
                                    this._recentToolCalls = [];
                                }
                            } else {
                                // No tool calls, just show the text response
                                this._addMessage(response.text || "I've processed the tool results.", 'ai');
                                
                                // Reset counters
                                this._toolCallCount = 0;
                                this._recentToolCalls = [];
                            }
                        })
                        .catch(error => {
                            // If the request fails, show the error
                            const children = this._messageContainer.get_children();
                            const lastChild = children[children.length - 1];
                            if (lastChild && lastChild._isThinking) {
                                this._messageContainer.remove_child(lastChild);
                            }
                            
                            this._addMessage(`Error in follow-up request: ${error.message}`, 'ai');
                        });
                } else {
                    // If no tool results, just show the original response
                    this._addMessage(originalResponse, 'ai');
                }
            })
            .catch(error => {
                log(`Failed to execute tool calls: ${error.message}`);
                this._addMessage(`Error executing tool calls: ${error.message}`, 'ai');
            });
    }

    _getConversationHistory() {
        // Get the last 10 messages for context
        const recentMessages = this._messages.slice(-10);
        let history = '';
        let tokenCount = 0;
        const MAX_TOKENS = 2000; // Approximate token limit for context
        
        // Helper function to estimate tokens (rough approximation)
        const estimateTokens = (text) => {
            // Rough estimate: 1 token ≈ 4 characters for English text
            return Math.ceil(text.length / 4);
        };

        // Helper function to truncate text to fit within token limit
        const truncateToTokens = (text, maxTokens) => {
            const estimatedTokens = estimateTokens(text);
            if (estimatedTokens <= maxTokens) return text;
            
            // Truncate to approximately the right number of characters
            const maxChars = maxTokens * 4;
            return text.substring(0, maxChars) + '...';
        };

        // Process messages in reverse to prioritize recent context
        for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            let messageText = '';

            if (msg.isThinking && msg.text) {
                // Include <think> content
                messageText = `<think>${msg.text}</think>\n`;
            } else if (msg.sender === 'user') {
                messageText = `User: ${msg.text}\n`;
            } else if (msg.sender === 'ai') {
                // For AI messages, only include non-thinking content if thinking is hidden
                let aiText = msg.text;
                if (this._settings.get_boolean('hide-thinking')) {
                    aiText = aiText.replace(/<think>[\s\S]*?<\/think>/g, '');
                }
                messageText = `Assistant: ${aiText}\n`;
            } else if (msg.sender === 'system' && msg.toolResults) {
                // For tool results, include full tool call and response
                msg.toolResults.forEach(result => {
                    // Tool call
                    messageText += `Tool Call: {\"tool\": \"${result.name}\", \"arguments\": ${JSON.stringify(result.arguments)}}\n`;

                    // Format tool response based on tool type
                    if (result.name === 'web_search' && result.result && result.result.results) {
                        messageText += 'Web Search Results:\n';
                        if (result.result.structured_results) {
                            // Use the structured format for better context
                            const structured = result.result.structured_results;
                            messageText += `Query: "${structured.query}"\n`;
                            messageText += `Total Results: ${structured.total_results}\n\n`;
                            
                            structured.top_results.forEach(item => {
                                messageText += `[${item.rank}] ${item.title}\n`;
                                messageText += `Source: ${item.source}\n`;
                                messageText += `URL: ${item.url}\n`;
                                if (item.published_date) {
                                    messageText += `Published: ${item.published_date}\n`;
                                }
                                messageText += `Relevance: ${item.relevance_score || 'N/A'}\n`;
                                messageText += `Summary: ${item.summary}\n\n`;
                            });
                        } else {
                            // Fallback to the old format if structured results aren't available
                        result.result.results.forEach((item, idx) => {
                                messageText += `[${idx+1}] ${item.title}\n`;
                                messageText += `URL: ${item.url}\n`;
                                messageText += `Summary: ${item.content || 'No summary available'}\n\n`;
                        });
                    }
                    } else if (result.name === 'fetch_web_content' && result.result && result.result.results) {
                        messageText += 'Fetched Content:\n';
                        result.result.results.forEach((item, idx) => {
                            if (item.formatted_content) {
                                messageText += `[${idx+1}] ${item.title || 'Untitled'}\n`;
                                messageText += `URL: ${item.url}\n`;
                                messageText += `Content: ${item.formatted_content}\n\n`;
                            } else if (item.content) {
                                messageText += `[${idx+1}] ${item.title || 'Untitled'}\n`;
                                messageText += `URL: ${item.url}\n`;
                                messageText += `Content: ${item.content}\n\n`;
                            } else {
                                messageText += `[${idx+1}] Error from ${item.url}: ${item.error || 'Unknown error'}\n\n`;
                            }
                        });
                    } else {
                        // For other tools, include the full result
                        messageText += `Tool Response: ${JSON.stringify(result.result, null, 2)}\n`;
                    }
                });
            }

            // Check if adding this message would exceed token limit
            const messageTokens = estimateTokens(messageText);
            if (tokenCount + messageTokens > MAX_TOKENS) {
                // If we're about to exceed the limit, truncate the message
                const remainingTokens = MAX_TOKENS - tokenCount;
                if (remainingTokens > 100) { // Only add if we have enough tokens left for meaningful content
                    messageText = truncateToTokens(messageText, remainingTokens);
                    history = messageText + history;
                }
                break;
            }

            history = messageText + history;
            tokenCount += messageTokens;
        }

        // Add a summary of older context if we have room
        if (this._messages.length > 10 && tokenCount < MAX_TOKENS * 0.8) {
            const olderMessages = this._messages.slice(0, -10);
            const summary = `[Previous ${olderMessages.length} messages omitted for brevity]\n`;
            if (tokenCount + estimateTokens(summary) <= MAX_TOKENS) {
                history = summary + history;
            }
        }

        // Add a context summary at the beginning
        const contextSummary = this._generateContextSummary();
        if (contextSummary && tokenCount + estimateTokens(contextSummary) <= MAX_TOKENS) {
            history = contextSummary + '\n\n' + history;
        }

        return history;
    }

    _generateContextSummary() {
        // Extract key information from recent tool calls
        const recentToolCalls = this._recentToolCalls.slice(-3); // Get last 3 tool calls
        if (recentToolCalls.length === 0) return null;

        let summary = 'Recent Context:\n';
        
        recentToolCalls.forEach(calls => {
            calls.forEach(call => {
                if (call.name === 'web_search') {
                    summary += `• Previous search: "${call.args.query}"\n`;
                } else if (call.name === 'fetch_web_content') {
                    summary += `• Fetched content from: ${call.args.urls.join(', ')}\n`;
                }
            });
        });

        return summary;
    }

    _addMessage(text, sender, isThinking = false, toolResults = null, addToHistory = true) {
        // Check for thinking content
        const thinkingMatch = text.match(/<think>([\s\S]*?)<\/think>/);
        let mainText = text;
        let thinkingText = '';
        if (thinkingMatch) {
            thinkingText = thinkingMatch[1].trim();
            mainText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }

        // If thinking content exists, add it as its own message entry
        if (thinkingText) {
            const thinkingMessage = {
                text: thinkingText,
                sender: sender,
                timestamp: new Date().toISOString(),
                isThinking: true,
                toolResults: null
            };
            if (addToHistory) this._messages.push(thinkingMessage);

            // Create a dedicated message actor for thinking
            const thinkingActor = new St.BoxLayout({
                vertical: true,
                style_class: 'llm-chat-message llm-chat-thinking-message'
            });
            const thinkingContent = new St.Label({
                text: thinkingText,
                style_class: 'llm-chat-thinking-content',
                x_expand: true
            });
            thinkingContent.clutter_text.line_wrap = true;
            thinkingContent.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            thinkingContent.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            thinkingContent.clutter_text.single_line_mode = false;
            thinkingActor.add_child(thinkingContent);
            // Toggle class for visibility
            if (this._settings.get_boolean('hide-thinking')) {
                thinkingActor.add_style_class_name('llm-chat-thinking-hidden');
            }
            this._messageContainer.add_child(thinkingActor);
            this._scrollToBottom();
        }

        // Add the main message (if any)
        if (mainText) {
            const message = {
                text: mainText,
                sender,
                timestamp: new Date().toISOString(),
                isThinking,
                toolResults: toolResults ? this._optimizeToolResults(toolResults) : null
            };
            if (addToHistory) this._messages.push(message);

            const messageActor = new St.BoxLayout({
                vertical: true,
                style_class: `llm-chat-message llm-chat-message-${sender}`
            });

            // Create main content
            const mainContent = new St.BoxLayout({
                vertical: true,
                style_class: 'llm-chat-message-content'
            });

            // Add the main text
            const textLabel = new St.Label({
                text: mainText,
                x_expand: true
            });
            textLabel.clutter_text.line_wrap = true;
            textLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            textLabel.clutter_text.single_line_mode = false;
            mainContent.add_child(textLabel);

            // Add sources if this is an AI message with tool results
            if (sender === 'ai' && toolResults) {
                const sources = this._extractSources(toolResults);
                if (sources && sources.length > 0) {
                    // Add a separator with improved styling
                    const separator = new St.Label({
                        text: '\n---\nSources and Citations:',
                        style_class: 'llm-chat-sources-header'
                    });
                    mainContent.add_child(separator);

                    // Add each source with improved formatting
                    sources.forEach(source => {
                        const sourceBox = new St.BoxLayout({
                            vertical: true,
                            style_class: 'llm-chat-source-box'
                        });

                        // Create title and URL container
                        const titleBox = new St.BoxLayout({
                            vertical: false,
                            style_class: 'llm-chat-source-title-box'
                        });

                        // Create clickable URL button with title
                        const urlButton = new St.Button({
                            style_class: 'llm-chat-url-button',
                            label: source.title || source.url
                        });
                        urlButton.connect('clicked', () => {
                            Gio.AppInfo.launch_default_for_uri(source.url, null);
                        });

                        // Add URL text with improved styling
                        const urlText = new St.Label({
                            text: source.url,
                            style_class: 'llm-chat-url-text'
                        });

                        // Add source attribution if available
                        if (source.source) {
                            const sourceText = new St.Label({
                                text: `Source: ${source.source}`,
                                style_class: 'llm-chat-source-text'
                            });
                            sourceBox.add_child(sourceText);
                        }

                        // Add published date if available
                        if (source.published_date) {
                            const dateText = new St.Label({
                                text: `Published: ${source.published_date}`,
                                style_class: 'llm-chat-date-text'
                            });
                            sourceBox.add_child(dateText);
                        }

                        titleBox.add_child(urlButton);
                        titleBox.add_child(urlText);
                        sourceBox.add_child(titleBox);
                        mainContent.add_child(sourceBox);
                    });
                }
            }

            messageActor.add_child(mainContent);
            this._messageContainer.add_child(messageActor);
            this._scrollToBottom();
        }
    }

    _extractSources(toolResults) {
        const sources = [];
        toolResults.forEach(result => {
            if (result.name === 'web_search' && result.result && result.result.sources) {
                sources.push(...result.result.sources);
            } else if (result.name === 'fetch_web_content' && result.result && result.result.results) {
                result.result.results.forEach(contentResult => {
                    if (contentResult.url) {
                        sources.push({
                            title: contentResult.title || contentResult.url,
                            url: contentResult.url
                        });
                    }
                });
            }
        });
        return sources;
    }

    _scrollToBottom() {
        // Add a small delay to ensure content is rendered
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (this._scrollView) {
                const adjustment = this._scrollView.vscroll.adjustment;
                if (adjustment) {
                    // Animate to bottom with easing
                    const target = adjustment.upper - adjustment.page_size;
                    const start = adjustment.value;
                    const duration = 300; // ms
                    const startTime = Date.now();
                    
                    const animate = () => {
                        const now = Date.now();
                        const elapsed = now - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        
                        // Easing function for smooth animation
                        const easeProgress = 1 - Math.pow(1 - progress, 3);
                        const current = start + (target - start) * easeProgress;
                        
                        adjustment.value = current;
                        
                        if (progress < 1) {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, animate);
                        }
                    };
                    
                    animate();
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    }

    // Update method to handle thinking visibility changes
    _updateThinkingVisibility() {
        const hideThinking = this._settings.get_boolean('hide-thinking');
        log(`Updating thinking visibility. Hide thinking: ${hideThinking}`);
        // Update all thinking message entries
        this._messageContainer.get_children().forEach(messageActor => {
            if (messageActor.has_style_class_name('llm-chat-thinking-message')) {
                if (hideThinking) {
                    messageActor.add_style_class_name('llm-chat-thinking-hidden');
                    messageActor.visible = false;
                } else {
                    messageActor.remove_style_class_name('llm-chat-thinking-hidden');
                    messageActor.visible = true;
                }
                // Force UI update
                if (messageActor.queue_relayout) messageActor.queue_relayout();
                if (messageActor.queue_redraw) messageActor.queue_redraw();
            }
        });
    }

    _optimizeToolResults(toolResults) {
        return toolResults.map(result => {
            // Create a minimal version of the tool result
            const optimized = {
                name: result.name,
                status: result.result?.status || 'unknown'
            };

            // Add only essential result data based on tool type
            if (result.name === 'web_search') {
                optimized.query = result.arguments?.query || '';
                if (result.result?.structured_results) {
                    optimized.summary = result.result.structured_results.top_results
                        .map(item => `${item.title} (${item.source})`)
                        .join(', ');
                    optimized.metadata = {
                        total_results: result.result.structured_results.total_results,
                        top_sources: result.result.structured_results.top_results
                            .map(item => item.source)
                            .filter((source, index, self) => self.indexOf(source) === index)
                    };
                } else {
                    optimized.summary = result.result?.summary || '';
                }
            } else if (result.name === 'fetch_web_content') {
                optimized.urls = result.arguments?.urls || [];
                optimized.status = result.result?.status || 'unknown';
                if (result.result?.results) {
                    optimized.summary = result.result.results
                        .map(item => item.title || item.url)
                        .join(', ');
                }
            } else if (result.name === 'system_context') {
                optimized.type = result.arguments?.type || '';
                optimized.summary = result.result?.formatted_list || '';
            }

            return optimized;
        });
    }

    _adjustWindowHeight() {
        // Calculate total height of messages
        let totalHeight = 0;
        this._messageContainer.get_children().forEach(child => {
            totalHeight += child.get_height();
        });

        // Add height for input area and padding
        const inputHeight = this._entryText.get_height() + 40; // 40px for padding and buttons
        totalHeight += inputHeight;

        // Limit height to maximum
        const height = Math.min(totalHeight, this._maxInitialHeight);

        // Set the height of the chat box
        this.actor.height = Math.max(height, this._initialHeight);
    }

    // Add method to clear session
    clearSession() {
        this._messages = [];
        this._lastSearchResults = null;
        this._lastSearchQuery = null;
        this._lastSearchUrls.clear();
        this._sessionId = GLib.uuid_string_random();
        
        // Clear the message container
        if (this._messageContainer) {
            this._messageContainer.destroy_all_children();
        }
        
        log(`New session started with ID: ${this._sessionId}`);
    }

    // Clean up settings connection
    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
        }
        
        // Save current session
        if (this._messages.length > 0) {
            this._saveCurrentSession();
        }
        
        // Clear references
        this._messages = [];
        this._currentView = null;
        
        // The rest of cleanup is handled by the Extension class
    }

    _onHistoryButtonClicked() {
        log('History button clicked');
        if (this._currentView === 'chat') {
            // Switch to history view
            this._showSessionHistoryView();
        } else {
            // Already in history view, do nothing
            log('Already in history view');
        }
    }
    
    _showSessionHistoryView() {
        log('Showing session history view');

        // Clear previous content to avoid duplicates
        if (this._messageContainer) {
            this._messageContainer.destroy_all_children();
        }

        this._currentView = 'history';
        
        // Save current session if it has messages
        if (this._messages.length > 0) {
            this._saveCurrentSession();
        }
        
        // Clear the message container to show history instead
        this._messageContainer.destroy_all_children();
        
        // Create header with back button
        const headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'session-history-header-box'
        });
        
        // Back button to return to chat
        const backButton = new St.Button({
            style_class: 'session-history-back-button',
            label: 'Back to Chat'
        });
        backButton.connect('clicked', () => {
            this._showChatView();
        });
        
        const headerLabel = new St.Label({
            text: 'Chat History',
            style_class: 'session-history-header'
        });
        
        headerBox.add_child(backButton);
        headerBox.add_child(headerLabel);
        this._messageContainer.add_child(headerBox);
        
        // Create new chat button
        const newChatBox = new St.BoxLayout({
            vertical: false,
            style_class: 'session-history-new-chat-box'
        });
        
        const newChatButton = new St.Button({
            style_class: 'session-history-new-chat-button',
            label: 'Start New Chat'
        });
        newChatButton.connect('clicked', () => {
            this._startNewSession();
            this._showChatView();
        });
        
        newChatBox.add_child(newChatButton);
        this._messageContainer.add_child(newChatBox);
        
        // Add separator
        const separator = new St.BoxLayout({
            style_class: 'session-history-separator'
        });
        this._messageContainer.add_child(separator);
        
        // Get session list and display them
        const sessions = this._sessionManager.listSessions();
        
        if (sessions.length === 0) {
            const noSessions = new St.Label({
                text: 'No saved chats',
                style_class: 'session-history-empty'
            });
            this._messageContainer.add_child(noSessions);
        } else {
            // Create scrollable container for sessions
            const sessionsScrollBox = new St.ScrollView({
                style_class: 'session-history-scrollbox',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC
            });
            
            const sessionsBox = new St.BoxLayout({
                vertical: true,
                style_class: 'session-history-list'
            });
            
            // Add each session
            sessions.forEach(session => {
                const sessionItem = this._createSessionHistoryItem(session);
                sessionsBox.add_child(sessionItem);
            });
            
            sessionsScrollBox.add_actor(sessionsBox);
            this._messageContainer.add_child(sessionsScrollBox);
        }
        
        // Disable text entry while in history view
        this._entryText.set_text('');
        this._entryText.reactive = false;
        this._entryText.can_focus = false;
    }
    
    _showChatView() {
        log('Showing chat view');
        this._currentView = 'chat';
        // Clear and rebuild message container with current session
        this._messageContainer.destroy_all_children();
        // Restore all messages from the current session, but do not add to history
        this._messages.forEach(msg => {
            this._addMessage(msg.text, msg.sender, msg.isThinking, msg.toolResults, false);
        });
        // Re-enable text entry
        this._entryText.reactive = true;
        this._entryText.can_focus = true;
        this._entryText.grab_key_focus();
    }
    
    _createSessionHistoryItem(session) {
        const item = new St.BoxLayout({
            vertical: true,
            style_class: 'session-history-item'
        });
        
        // Title and date row
        const headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'session-history-item-header'
        });
        
        const title = new St.Label({
            text: session.title || 'Untitled Chat',
            style_class: 'session-history-item-title'
        });
        
        const date = new St.Label({
            text: new Date(session.updated_at).toLocaleString(),
            style_class: 'session-history-item-date'
        });
        
        headerBox.add_child(title);
        headerBox.add_child(date);
        
        // Info row (message count, duration, model/provider)
        let infoText = `${session.message_count || 0} messages`;
        if (session.created_at && session.updated_at) {
            const start = new Date(session.created_at);
            const end = new Date(session.updated_at);
            const durationMs = end - start;
            if (!isNaN(durationMs) && durationMs > 0) {
                const min = Math.floor(durationMs / 60000);
                const sec = Math.floor((durationMs % 60000) / 1000);
                infoText += `  |  Duration: ${min}m ${sec}s`;
            }
        }
        if (session.settings && (session.settings.model || session.settings.provider)) {
            infoText += '  |  ';
            if (session.settings.provider) infoText += `Provider: ${session.settings.provider} `;
            if (session.settings.model) infoText += `Model: ${session.settings.model}`;
        }
        const infoRow = new St.Label({
            text: infoText,
            style_class: 'session-history-item-info'
        });
        
        // First/last message preview
        let firstMsg = '';
        let lastMsg = '';
        if (session.id && this._sessionManager) {
            const fullSession = this._sessionManager.loadSession(session.id);
            if (fullSession && fullSession.messages && fullSession.messages.length > 0) {
                const first = fullSession.messages[0];
                const last = fullSession.messages[fullSession.messages.length - 1];
                if (first && first.text) firstMsg = `First: ${first.sender}: ${first.text.substring(0, 60)}${first.text.length > 60 ? '...' : ''}`;
                if (last && last.text) lastMsg = `Last: ${last.sender}: ${last.text.substring(0, 60)}${last.text.length > 60 ? '...' : ''}`;
            }
        }
        const firstMsgLabel = new St.Label({
            text: firstMsg,
            style_class: 'session-history-item-preview'
        });
        const lastMsgLabel = new St.Label({
            text: lastMsg,
            style_class: 'session-history-item-preview'
        });
        
        // Preview text (existing summary)
        const preview = new St.Label({
            text: session.preview || 'No preview available',
            style_class: 'session-history-item-preview'
        });
        preview.clutter_text.line_wrap = true;
        preview.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        
        // Buttons row
        const buttonBox = new St.BoxLayout({
            vertical: false,
            style_class: 'session-history-item-buttons'
        });
        
        const resumeButton = new St.Button({
            label: 'Resume',
            style_class: 'session-history-button'
        });
        resumeButton.connect('clicked', () => {
            log(`Resume button clicked for session: ${session.id}`);
            this._loadSession(session.id);
            this._showChatView();
        });
        
        const deleteButton = new St.Button({
            label: 'Delete',
            style_class: 'session-history-button session-history-button-delete'
        });
        deleteButton.connect('clicked', () => {
            log(`Delete button clicked for session: ${session.id}`);
            this._sessionManager.deleteSession(session.id);
            // Refresh the history view
            this._showSessionHistoryView();
        });
        
        buttonBox.add_child(resumeButton);
        buttonBox.add_child(deleteButton);
        
        // Add all components
        item.add_child(headerBox);
        item.add_child(infoRow);
        if (firstMsg) item.add_child(firstMsgLabel);
        if (lastMsg) item.add_child(lastMsgLabel);
        item.add_child(preview);
        item.add_child(buttonBox);
        
        return item;
    }
    
    // Update _loadSession to switch to chat view after loading
    _loadSession(sessionId) {
        log(`[DEBUG] _loadSession called for session: ${sessionId}`);
        log(`[DEBUG] Stack trace: ` + (new Error()).stack);
        const sessionData = this._sessionManager.loadSession(sessionId);
        if (!sessionData) {
            log(`Failed to load session: ${sessionId}`);
            return;
        }

        // Clear current session
        this._messages = [];
        if (this._messageContainer) {
            this._messageContainer.destroy_all_children();
        }

        // Set new session data
        this._sessionId = sessionId;
        this._sessionTitle = sessionData.title;
        this._messages = sessionData.messages;

        // Only show chat view, do not render messages here
        this._showChatView();

        log(`Loaded session: ${sessionId}`);
    }

    _onNewChatButtonClicked() {
        this._startNewSession();
        // Make sure we show chat view
        if (this._currentView === 'history') {
            this._showChatView();
        }
    }

    _startNewSession() {
        // Save current session if it has messages
        if (this._messages.length > 0) {
            this._saveCurrentSession();
        }

        // Clear current session
        this._messages = [];
        this._sessionId = GLib.uuid_string_random();
        this._sessionTitle = null;
        this._lastSearchResults = null;
        this._lastSearchQuery = null;
        this._lastSearchUrls.clear();
        this._toolCallCount = 0;
        this._recentToolCalls = [];

        // Clear the message container
        if (this._messageContainer) {
            this._messageContainer.destroy_all_children();
        }

        log(`New session started with ID: ${this._sessionId}`);
    }

    _saveCurrentSession() {
        if (this._messages.length === 0) return;

        const metadata = {
            title: this._sessionTitle,
            created_at: new Date().toISOString(),
            settings: {
                provider: this._settings.get_string('service-provider'),
                model: this._settings.get_string('openai-model'),
                temperature: this._settings.get_double('openai-temperature')
            }
        };

        this._sessionManager.saveSession(this._sessionId, this._messages, metadata);
    }

    // Update _addConfirmationMessage to return a Promise that resolves on confirm
    _addConfirmationMessage(summary, params) {
        return new Promise((resolve, reject) => {
            const messageActor = new St.BoxLayout({
                vertical: true,
                style_class: 'llm-chat-message llm-chat-message-system llm-chat-confirmation-message'
            });
            const mainContent = new St.BoxLayout({
                vertical: true,
                style_class: 'llm-chat-message-content'
            });
            const textLabel = new St.Label({
                text: summary + '\n',
                x_expand: true
            });
            textLabel.clutter_text.line_wrap = true;
            textLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            textLabel.clutter_text.single_line_mode = false;
            mainContent.add_child(textLabel);
            // Add confirm and cancel buttons
            const buttonBox = new St.BoxLayout({ vertical: false });
            const confirmButton = new St.Button({
                style_class: 'llm-chat-confirm-button',
                label: 'Confirm'
            });
            const cancelButton = new St.Button({
                style_class: 'llm-chat-cancel-button',
                label: 'Cancel'
            });
            confirmButton.connect('clicked', () => {
                this._messageContainer.remove_child(messageActor);
                resolve();
            });
            cancelButton.connect('clicked', () => {
                this._messageContainer.remove_child(messageActor);
                reject();
            });
            buttonBox.add_child(confirmButton);
            buttonBox.add_child(cancelButton);
            mainContent.add_child(buttonBox);
            messageActor.add_child(mainContent);
            this._messageContainer.add_child(messageActor);
            this._scrollToBottom();
        });
    }
}

var LLMChatButton = GObject.registerClass(
class LLMChatButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'LLM Chat');

        this._settings = settings;

        // Add icon to the panel
        const icon = new St.Icon({
            icon_name: 'system-run-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(icon);

        // Create the chat box
        this._chatBox = new LLMChatBox(this._settings);

        // Add chat box to the menu
        this.menu.box.add_child(this._chatBox.actor);

        // Set focus to the text entry when the menu is opened:
        this.menu._openStateId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
               // Use a slightly longer delay and grab_key_focus
               GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                   this._chatBox._entryText.grab_key_focus();
                   this._chatBox._entryText.clutter_text.set_cursor_visible(true);
                   return GLib.SOURCE_REMOVE;
               });
            }
        });
    }
});


class Extension {
    constructor() {
        this._button = null;
        this._settings = null;
    }

    enable() {
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.llmchat');
        this._button = new LLMChatButton(this._settings);
        Main.panel.addToStatusArea('llm-chat', this._button);
        
        // Clear any existing session when the extension is enabled
        if (this._button._chatBox) {
            this._button._chatBox.clearSession();
        }
    }

    disable() {
        // Clean up memory service
        if (memoryService) {
            try {
                // Clear all memories before destroying the service
                memoryService.clearNamespace('memories').catch(e => {
                    log(`Error clearing memories: ${e.message}`);
                });
                memoryService.destroy();
                log('Memory service destroyed');
            } catch (e) {
                log(`Error cleaning up memory service: ${e.message}`);
            }
        }
        
        if (this._button) {
            // Clear the session before disabling
            if (this._button._chatBox) {
                this._button._chatBox.clearSession();
            }
            
            // First disconnect all signal handlers
            if (this._button._chatBox) {
                // Disconnect signal handlers from the chat box
                if (this._button._chatBox._entryText) {
                    // Disconnect specific signal handlers
                    if (this._button._chatBox._entryText.clutter_text) {
                        const text = this._button._chatBox._entryText.clutter_text;
                        // Disconnect key-press-event handler
                        if (text._keyPressHandlerId) {
                            text.disconnect(text._keyPressHandlerId);
                        }
                        // Disconnect activate handler
                        if (text._activateHandlerId) {
                            text.disconnect(text._activateHandlerId);
                        }
                        // Disconnect multi-line handler
                        if (text._multiLineHandlerId) {
                            text.disconnect(text._multiLineHandlerId);
                        }
                    }
                    
                    if (this._button._chatBox._clickAction) {
                        this._button._chatBox._clickAction.disconnect_all();
                        this._button._chatBox._clickAction.destroy();
                    }
                }

                if (this._button._chatBox._toolCallingToggleButton) {
                    if (this._button._chatBox._toolCallingToggleButton._clickHandlerId) {
                        this._button._chatBox._toolCallingToggleButton.disconnect(this._button._chatBox._toolCallingToggleButton._clickHandlerId);
                    }
                }

                // Remove all children from containers
                if (this._button._chatBox._messageContainer) {
                    this._button._chatBox._messageContainer.destroy_all_children();
                }

                if (this._button._chatBox._scrollView) {
                    this._button._chatBox._scrollView.destroy_all_children();
                }

                // Clear arrays and objects
                this._button._chatBox._messages = [];
                this._button._chatBox._availableTools = [];

                // Destroy the chat box actor
                if (this._button._chatBox.actor) {
                    this._button._chatBox.actor.destroy_all_children();
                    this._button._chatBox.actor.destroy();
                }
            }

            // Handle menu signals properly - store signal IDs in _init and disconnect them here
            if (this._button.menu) {
                // In GNOME Shell, menu typically has _openStateId for the open-state-changed signal
                // This approach disconnects signals without relying on disconnect_all
                const signals = this._button.menu._signals || [];
                if (Array.isArray(signals)) {
                    signals.forEach(signalId => {
                        if (signalId) {
                            try {
                                this._button.menu.disconnect(signalId);
                            } catch (e) {
                                log(`Error disconnecting signal: ${e.message}`);
                            }
                        }
                    });
                }
                // Also try to disconnect the menu's open-state-changed signal if we have its ID
                if (this._button.menu._openStateId) {
                    try {
                        this._button.menu.disconnect(this._button.menu._openStateId);
                    } catch (e) {
                        log(`Error disconnecting open-state-changed: ${e.message}`);
                    }
                }
                
                // Clean up menu children properly
                try {
                    // The menu's box contains the actual children
                    if (this._button.menu.box) {
                        // Get children and destroy each one
                        const children = this._button.menu.box.get_children() || [];
                        children.forEach(child => {
                            if (child) {
                                this._button.menu.box.remove_child(child);
                                child.destroy();
                            }
                        });
                    }
                } catch (e) {
                    log(`Error cleaning up menu children: ${e.message}`);
                }
            }

            // Remove from panel and destroy the button
            try {
                if (Main.panel.statusArea['llm-chat']) {
                    Main.panel.statusArea['llm-chat'].destroy();
                }
            } catch (e) {
                log(`Error removing from panel: ${e.message}`);
            }
            
            this._button.destroy();
            this._button = null;
        }

        if (this._settings) {
            this._settings = null;
        }
    }
}

function init() {
    return new Extension();
}
