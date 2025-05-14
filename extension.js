/* extension.js
*/

const { Clutter, Gio, GLib, GObject, Pango, St, Shell } = imports.gi;
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Import tool system
const { ToolLoader } = Me.imports.tools.ToolLoader;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Initialize tool loader
const toolLoader = new ToolLoader();
toolLoader.loadTools();

// Provider Adapter class to handle different AI providers
class ProviderAdapter {
    constructor(settings) {
        this._settings = settings;
    }

    // Common interface for all providers
    async makeRequest(text, toolCalls = null) {
        const provider = this._settings.get_string('service-provider');
        log(`Making request to provider: ${provider}, tool calling: ${toolCalls ? 'enabled' : 'disabled'}`);
        
        try {
            let response;
        switch (provider) {
            case 'openai':
                    response = await this._makeOpenAIRequest(text, toolCalls);
                    break;
            case 'gemini':
                    response = await this._makeGeminiRequest(text, toolCalls);
                    break;
            case 'anthropic':
                    response = await this._makeAnthropicRequest(text, toolCalls);
                    break;
            case 'llama':
                    response = await this._makeLlamaRequest(text, toolCalls);
                    break;
            case 'ollama':
                    response = await this._makeOllamaRequest(text, toolCalls);
                    break;
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
            
            return response;
        } catch (error) {
            log(`Error in makeRequest: ${error.message}`);
            throw error;
        }
    }

    // Shared tool processing methods
    _extractToolCalls(text) {
        log('Attempting to extract tool calls from response...');
        let toolCalls = [];
        let remainingText = text;

        // Try multiple approaches to extract JSON
        let jsonMatches = [];
        
        try {
            // 1. Try specific pattern for tool call JSON
            const specificPattern = /\{"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\}/g;
            const specificMatches = text.match(specificPattern) || [];
            
            if (specificMatches.length > 0) {
                log(`Found ${specificMatches.length} potential tool call objects with specific pattern`);
                
                for (const match of specificMatches) {
                    try {
                        const parsed = JSON.parse(match);
                        if (parsed.tool && parsed.arguments) {
                            jsonMatches.push({
                                parsed,
                                match
                            });
                            log(`Found valid tool call JSON with specific pattern: ${match}`);
                        }
                    } catch (e) {
                        log(`Failed to parse specific pattern JSON: ${e.message}`);
                    }
                }
            }

            // 2. Try XML-style tool_call tags
            if (jsonMatches.length === 0) {
                const toolCallXmlMatch = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
                if (toolCallXmlMatch) {
                    try {
                        const parsed = JSON.parse(toolCallXmlMatch[1]);
                        if (parsed.tool && parsed.arguments) {
                            jsonMatches.push({
                                parsed,
                                match: toolCallXmlMatch[0]
                            });
                            log(`Found valid tool call in XML tags: ${toolCallXmlMatch[1]}`);
                        }
                    } catch (e) {
                        log(`Failed to parse XML tool call: ${e.message}`);
                    }
                }
            }

            // 3. Try code blocks with JSON
            if (jsonMatches.length === 0) {
                const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (codeBlockMatch) {
                    try {
                        const parsed = JSON.parse(codeBlockMatch[1].trim());
                        if (parsed.tool && parsed.arguments) {
                            jsonMatches.push({
                                parsed,
                                match: codeBlockMatch[0]
                            });
                            log(`Found valid tool call in code block: ${codeBlockMatch[1]}`);
                        }
                    } catch (e) {
                        log(`Failed to parse code block JSON: ${e.message}`);
                    }
                }
            }

            // Process found matches
            if (jsonMatches.length > 0) {
                const { parsed, match } = jsonMatches[0];
                log(`Processing tool call: ${parsed.tool} with arguments: ${JSON.stringify(parsed.arguments)}`);
                
                toolCalls = [{
                    function: {
                        name: parsed.tool,
                        arguments: JSON.stringify(parsed.arguments)
                    }
                }];
                
                // Remove the tool call from the text
                remainingText = text.replace(match, '').trim();
                log(`Remaining text after removing tool call: ${remainingText.substring(0, 100)}...`);
            }
        } catch (error) {
            log(`Error in tool call extraction: ${error.message}`);
        }

        return { toolCalls, remainingText };
    }

    _processToolResponse(response) {
        log(`Processing response for tool calls: ${JSON.stringify(response)}`);
        let text = '';
        let toolCalls = [];

        try {
            // Handle different response formats
            if (response.choices && response.choices[0]) {
                const message = response.choices[0].message;
                if (message) {
                    text = message.content || '';
                    
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
            }
        } catch (error) {
            log(`Error processing tool response: ${error.message}`);
        }

        log(`Processed response - text length: ${text.length}, tool calls: ${toolCalls.length}`);
        return { text, toolCalls };
    }

    // Update LlamaCPP request method to use shared processing
    _makeLlamaRequest(text, toolCalls) {
        const serverUrl = this._settings.get_string('llama-server-url');
        if (!serverUrl) {
            throw new Error('Llama server URL is not set');
        }

        const modelName = this._settings.get_string('llama-model-name') || 'llama';
        const temperature = this._settings.get_double('llama-temperature');

        // Create the system message with tool instructions
        const systemMessage = {
            role: 'system',
            content: this._getToolSystemPrompt()
        };

        // Create the user message
        const userMessage = {
            role: 'user',
            content: text
        };

        // Prepare the request data
        const requestData = {
            model: modelName,
            messages: [systemMessage, userMessage],
            max_tokens: Math.round(this._settings.get_int('max-response-length') / 4),
            temperature: temperature,
            stream: false
        };

        // Add tools if tool calling is enabled
        if (toolCalls) {
            const tools = toolLoader.getToolsAsSchemaArray();
            requestData.functions = tools;
            requestData.function_call = 'auto';
        }

        log(`Making Llama request with data: ${JSON.stringify(requestData)}`);

        const message = Soup.Message.new('POST', `${serverUrl}/v1/chat/completions`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

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

    // Provider-specific request implementations
    _makeOpenAIRequest(text, toolCalls) {
        const apiKey = this._settings.get_string('openai-api-key');
        if (!apiKey) {
            throw new Error('OpenAI API key is not set');
        }

        const model = this._settings.get_string('openai-model');
        const temperature = this._settings.get_double('openai-temperature');

        const requestData = {
            model: model,
            messages: [{ role: 'user', content: text }],
            max_tokens: Math.round(this._settings.get_int('max-response-length') / 4),
            temperature: temperature
        };

        if (toolCalls) {
            requestData.tools = toolLoader.getToolsAsSchemaArray();
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

    _makeGeminiRequest(text, toolCalls) {
        const apiKey = this._settings.get_string('gemini-api-key');
        if (!apiKey) {
            throw new Error('Gemini API key is not set');
        }

        const requestData = {
            contents: [{
                parts: [{ text: text }]
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

    _makeAnthropicRequest(text, toolCalls) {
        const apiKey = this._settings.get_string('anthropic-api-key');
        if (!apiKey) {
            throw new Error('Anthropic API key is not set');
        }

        const model = this._settings.get_string('anthropic-model');
        const temperature = this._settings.get_double('anthropic-temperature');
        const maxTokens = this._settings.get_int('anthropic-max-tokens');

        const requestData = {
            model: model,
            prompt: `\n\nHuman: ${text}\n\nAssistant:`,
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

    _makeOllamaRequest(text, toolCalls) {
        const serverUrl = this._settings.get_string('ollama-server-url');
        if (!serverUrl) {
            throw new Error('Ollama server URL is not set');
        }

        const modelName = this._settings.get_string('ollama-model-name') || 'llama2';
        const temperature = this._settings.get_double('ollama-temperature');

        // For Ollama, we need to use their chat API which has better support for tools
        let requestUrl = `${serverUrl}/api/generate`;
        let requestData = {
            model: modelName,
            prompt: text,
            stream: false,
            options: {
                temperature: temperature
            }
        };

        // If tool calls are enabled, use the chat API format instead
        if (toolCalls) {
            // Add system message with tool instructions at the beginning of the prompt
            const toolSystemPrompt = this._getToolSystemPrompt();
            requestData.prompt = `${toolSystemPrompt}\n\nUser: ${text}`;
            
            log(`Making Ollama request with tool support. Model: ${modelName}, temp: ${temperature}`);
        }

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

    _getToolSystemPrompt() {
        // Get the formatted tool descriptions from all loaded tools
        const toolsArray = toolLoader.getTools();
        const toolDescriptions = toolsArray.map(tool => {
            return `Tool: ${tool.name}
Description: ${tool.description}
Category: ${tool.category}
Parameters: ${JSON.stringify(tool.parameters, null, 2)}`;
        }).join('\n\n');

        // Return the formatted prompt with general guidance to prevent loops
        return `You are a helpful assistant that has access to tools. You must understand when to use these tools to respond to user queries.

Available tools:

${toolDescriptions}

TOOL USAGE INSTRUCTIONS - FOLLOW THESE EXACTLY:

1. When a user asks something that requires a tool, you MUST respond ONLY with a valid JSON object in this format:
{
    "tool": "tool_name",
    "arguments": {
        "param1": "value1",
        "param2": "value2"
    }
}

2. Do NOT include ANY explanatory text, markdown, or code formatting when using a tool.
3. Do NOT include backticks (\`\`\`) or any other text before or after the JSON.
4. ONLY output the raw JSON object - nothing else.
5. Make sure your JSON is valid and properly formatted.

IMPORTANT LOOP PREVENTION GUIDELINES:

1. DO NOT request the same tool with the same arguments twice in a row.
2. After receiving tool results, prioritize providing a natural language response over making additional tool calls.
3. Only request additional tools when you genuinely need more information that wasn't provided in the first result.
4. You are limited to 10 tool calls per conversation chain.

EXAMPLES:

To get the current time:
{"tool": "time_date", "arguments": {"action": "get_current_time"}}

To search the web:
{"tool": "web_search", "arguments": {"query": "latest news about AI", "engine": "google"}}

If not using a tool, respond conversationally as you normally would.`;
    }
}

class LLMChatBox {
    constructor(settings) {
        this._settings = settings;
        this._messages = [];
        this._maxResponseLength = settings.get_int('max-response-length');
        this._maxInitialHeight = 800;
        this._initialHeight = 600;
        this._sessionId = GLib.uuid_string_random(); // Generate unique session ID
        this._lastSearchResults = null; // Store last search results for the current session
        this._lastSearchQuery = null;
        this._lastSearchUrls = new Map(); // Store URLs with their titles for reference
        
        // Add tool call tracking for loop protection
        this._toolCallCount = 0;
        this._maxToolCalls = 10; // Maximum number of tool calls in a single conversation chain
        this._recentToolCalls = []; // Store recent tool calls to detect loops
        this._maxRecentToolCalls = 5; // Number of recent tool calls to track for loop detection
        
        // Create main container
        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-box',
            y_expand: true
        });

        // Chat history scroll view - set to fill all available space
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
        
        // Check for repeated identical calls
        const isRepeatedCall = this._recentToolCalls.some(prevCall => 
            JSON.stringify(prevCall) === JSON.stringify(currentCall)
        );

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
                    
                    // Parse arguments again to be safe
                    let args;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        log(`Failed to parse arguments JSON: ${e.message}, using as-is`);
                        args = toolCall.function.arguments;
                    }
                    
                    const result = this._executeToolCall({
                        name: toolCall.function.name,
                        arguments: args
                    });
                    
                    if (result instanceof Promise) {
                        result.then(r => {
                            log(`Tool ${toolCall.function.name} returned Promise result: ${JSON.stringify(r)}`);
                            resolve({
                                toolName: toolCall.function.name,
                                args: args,
                                result: r
                            });
                        }).catch(e => {
                            log(`Tool ${toolCall.function.name} Promise error: ${e.message}`);
                            reject(e);
                        });
                    } else {
                        log(`Tool ${toolCall.function.name} returned result: ${JSON.stringify(result)}`);
                        resolve({
                            toolName: toolCall.function.name,
                            args: args,
                            result: result
                        });
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
                
                // Create a better format for the results that includes tool name and args
                const toolResults = results.map(result => ({
                    name: result.toolName,
                    arguments: result.args,
                    result: result.result
                }));

                // If we have tool results, make a follow-up request
                if (toolResults.length > 0) {
                    // Add an intermediate message showing the tool results
                    let toolResultMessage = "Tool execution results:\n";
                    toolResults.forEach(result => {
                        toolResultMessage += `\n• ${result.name}: ${JSON.stringify(result.result, null, 2)}\n`;
                    });
                    
                    // Display tool results as system message
                    this._addMessage(toolResultMessage, 'system');
                    
                    // Build history of all tool calls made in this session
                    const toolCallHistory = this._recentToolCalls.map(calls => {
                        return calls.map(call => `${call.name}(${JSON.stringify(call.args)})`).join(", ");
                    }).join(" → ");
                    
                    // Prepare a more structured tool result text for the AI
                    const toolResultsText = toolResults.map(result => 
                        `Tool '${result.name}' with arguments ${JSON.stringify(result.arguments)} returned:\n${JSON.stringify(result.result, null, 2)}`
                    ).join('\n\n');

                    // Create a more strongly-worded follow-up prompt
                    const followUpPrompt = `I have executed the tools you requested. Here are the results:\n\n${toolResultsText}\n\n` +
                        `IMPORTANT INSTRUCTIONS:\n` +
                        `1. DO NOT request the same tool calls again. You've already called: ${toolCallHistory}\n` +
                        `2. You already have the information requested above - please use it.\n` +
                        `3. YOU MUST NOW provide a complete, natural language response using the information gathered.\n` +
                        `4. DO NOT request additional tools unless absolutely necessary for a completely different purpose.\n\n` +
                        `Previous context: ${originalResponse}\n\n` +
                        `Please provide your final answer as a natural language response based on the tool results above.`;
                    
                    log(`Making follow-up request with tool results and explicit instructions to provide final answer`);
                    
                    // Add a temporary message
                    this._addMessage("Processing tool results...", 'assistant', true);
                    
                    // First try without tool calling enabled to encourage a text response
                    this._providerAdapter.makeRequest(followUpPrompt, false)
                        .then(response => {
                            // Remove the temporary message
                            const children = this._messageContainer.get_children();
                            const lastChild = children[children.length - 1];
                            if (lastChild && lastChild._isThinking) {
                                this._messageContainer.remove_child(lastChild);
                            }
                            
                            // Use the text response
                            if (response.text && response.text.trim()) {
                            this._addMessage(response.text, 'ai');
                            } else {
                                // If no text response, generate one based on the tool results
                                let generatedResponse = "Based on the information I gathered: ";
                                
                                // Generate a response based on tool results
                                toolResults.forEach(result => {
                                    if (result.name === 'time_date' && result.arguments.action === 'get_current_time') {
                                        generatedResponse += `The current time is ${result.result.time}.`;
                                    } else if (result.name === 'time_date' && result.arguments.action === 'get_current_date') {
                                        generatedResponse += `Today's date is ${result.result.date}.`;
                                    } else if (result.name === 'web_search') {
                                        generatedResponse += `I performed a web search for "${result.arguments.query}".`;
                                    } else {
                                        generatedResponse += `I used the ${result.name} tool to get information.`;
                                    }
                                });
                                
                                this._addMessage(generatedResponse, 'ai');
                            }
                            
                            // Reset the loop detection after a successful response
                            this._toolCallCount = 0;
                            this._recentToolCalls = [];
                        })
                        .catch(error => {
                            // If the initial request without tools fails, try again with tools enabled
                            log(`First attempt failed: ${error.message}. Retrying with tools enabled for legitimate follow-up needs.`);
                            
                            // Modify the prompt to more explicitly explain follow-up tool usage
                            const retryPrompt = followUpPrompt + `\n\nIf you absolutely need additional different tools to complete the answer, you may request them, but DO NOT repeat previous tool calls.`;
                            
                            this._providerAdapter.makeRequest(retryPrompt, this._toolCallingEnabled)
                                .then(response => {
                                    // Remove the temporary message if it still exists
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
                                            
                                            // Generate a final response
                                            let finalResponse = "Based on the information I gathered: ";
                                            toolResults.forEach(result => {
                                                if (result.name === 'time_date' && result.arguments.action === 'get_current_time') {
                                                    finalResponse += `The current time is ${result.result.time}.`;
                                                } else if (result.name === 'time_date' && result.arguments.action === 'get_current_date') {
                                                    finalResponse += `Today's date is ${result.result.date}.`;
                                                } else if (result.name === 'web_search') {
                                                    finalResponse += `I found information about "${result.arguments.query}".`;
                                                } else {
                                                    finalResponse += `I gathered information using the ${result.name} tool.`;
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
                                .catch(retryError => {
                                    // If both attempts fail, show the error
                                    const children = this._messageContainer.get_children();
                                    const lastChild = children[children.length - 1];
                                    if (lastChild && lastChild._isThinking) {
                                        this._messageContainer.remove_child(lastChild);
                                    }
                                    
                                    this._addMessage(`Error in follow-up requests: ${retryError.message}`, 'ai');
                                });
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
        
        // Add last search query and results if available
        if (this._lastSearchQuery) {
            history += `Last search query: ${this._lastSearchQuery}\n`;
            if (this._lastSearchResults) {
                history += 'Last search results:\n';
                this._lastSearchResults.slice(0, 3).forEach(result => {
                    history += `- ${result.title} (${result.url})\n`;
                });
                history += '\n';
            }
        }
        
        recentMessages.forEach(msg => {
            if (msg.sender === 'user') {
                history += `User: ${msg.text}\n`;
            } else if (msg.sender === 'ai') {
                history += `Assistant: ${msg.text}\n`;
            }
        });
        
        return history;
    }

    _addMessage(text, sender, thinking = false) {
        // Ensure text is a string and not null or undefined
        if (text === null || text === undefined) {
            text = '';
        }
        
        // Log the original message for debugging
        log(`Adding message from ${sender}, thinking=${thinking}, text length=${text.length}`);
        if (text.length > 0 && text.length < 100) {
            log(`Message content: ${text}`);
        }

        // Check if this is a thinking message (explicit thinking flag)
        if (this._settings.get_boolean('hide-thinking') && thinking) {
            log('Skipping explicit thinking message');
            return;
        }
        
        // Handle <think> tags if present
        const thinkTagPattern = /<think>([\s\S]*?)<\/think>/;
        const hasThinkTags = thinkTagPattern.test(text);
        
        if (hasThinkTags) {
            log('Message contains thinking tags');
            // Remove the thinking part but keep the rest of the message
            text = text.replace(thinkTagPattern, '');
            
            // Trim any resulting whitespace and check if there's anything left
            text = text.trim();
            
            if (text.length === 0) {
                log('Message was only thinking content, skipping');
                return;
            }
            
            log(`After removing thinking tags, message length: ${text.length}`);
        }

        const messageBox = new St.BoxLayout({
            style_class: `llm-chat-message llm-chat-message-${sender}`,
            vertical: true
        });
        
        // Mark thinking messages so they can be identified later
        if (thinking) {
            messageBox._isThinking = true;
        }

        const messageText = new St.Label({
            text: text,
            style_class: 'llm-chat-message-text',
            y_expand: true
        });

        // Set line wrap properties on the Clutter.Text inside the St.Label
        messageText.clutter_text.line_wrap = true;
        messageText.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        messageText.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        messageText.clutter_text.single_line_mode = false;

        // Create a container to ensure proper spacing
        const textContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-text-container',
            x_expand: true
        });

        // Add text to container, then container to message box
        textContainer.add_child(messageText);
        messageBox.add_child(textContainer);

        this._messageContainer.add_child(messageBox);
        this._adjustWindowHeight();

        // Store the message in history if it's not a thinking message
        if (!thinking) {
            this._messages.push({
                sender: sender,
                text: text
            });
        }

        // Scroll to the bottom - ensure this happens after the UI has updated
        // Use a small delay to ensure the message is fully rendered before scrolling
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (this._scrollView && this._scrollView.vscroll && this._scrollView.vscroll.adjustment) {
                // Ensure we scroll to the very bottom
                this._scrollView.vscroll.adjustment.value = this._scrollView.vscroll.adjustment.upper - this._scrollView.vscroll.adjustment.page_size;
            }
            return GLib.SOURCE_REMOVE;
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

    _getToolSystemPrompt() {
        // Get the formatted tool descriptions from all loaded tools
        const toolsArray = toolLoader.getTools();
        const toolDescriptions = toolsArray.map(tool => {
            return `Tool: ${tool.name}
Description: ${tool.description}
Category: ${tool.category}
Parameters: ${JSON.stringify(tool.parameters, null, 2)}`;
        }).join('\n\n');

        // Return the formatted prompt with general guidance to prevent loops
        return `You are a helpful assistant that has access to tools. You must understand when to use these tools to respond to user queries.

Available tools:

${toolDescriptions}

TOOL USAGE INSTRUCTIONS - FOLLOW THESE EXACTLY:

1. When a user asks something that requires a tool, you MUST respond ONLY with a valid JSON object in this format:
{
    "tool": "tool_name",
    "arguments": {
        "param1": "value1",
        "param2": "value2"
    }
}

2. Do NOT include ANY explanatory text, markdown, or code formatting when using a tool.
3. Do NOT include backticks (\`\`\`) or any other text before or after the JSON.
4. ONLY output the raw JSON object - nothing else.
5. Make sure your JSON is valid and properly formatted.

IMPORTANT LOOP PREVENTION GUIDELINES:

1. DO NOT request the same tool with the same arguments twice in a row.
2. After receiving tool results, prioritize providing a natural language response over making additional tool calls.
3. Only request additional tools when you genuinely need more information that wasn't provided in the first result.
4. You are limited to 10 tool calls per conversation chain.

EXAMPLES:

To get the current time:
{"tool": "time_date", "arguments": {"action": "get_current_time"}}

To search the web:
{"tool": "web_search", "arguments": {"query": "latest news about AI", "engine": "google"}}

If not using a tool, respond conversationally as you normally would.`;
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

// Add CSS for the new tool button
const style = `
.llm-chat-tool-button {
    padding: 5px 10px;
    border-radius: 4px;
    background-color: #4a4a4a;
    color: #ffffff;
    margin: 0 5px;
}

.llm-chat-tool-button-selected {
    background-color: #3584e4;
}

.llm-chat-tool-button:hover {
    background-color: #5a5a5a;
}

.llm-chat-tool-button-selected:hover {
    background-color: #4a8fe4;
}
`;