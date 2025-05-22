const { GObject } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { Logger } = Me.imports.utils.Logger;
const { debug, info, warn, error, log } = Logger;

var PromptAssembler = GObject.registerClass({
    GTypeName: 'PromptAssembler',
}, class PromptAssembler extends GObject.Object {
    constructor(settings) {
        super();
        this._settings = settings;
        this._lastProviderConfig = null;
        this._lastDebugOutput = null;
        this._lastTokenCount = null;
    }

    // Token estimation function with provider-specific ratios
    _estimateTokens(text, provider) {
        if (!text) return 0;
        
        // More accurate token estimation based on provider
        let ratio;
        switch (provider) {
            case 'openai':
                ratio = 3.3; // OpenAI: ~1 token per 3.3 characters for English
                break;
            case 'anthropic':
                ratio = 3.5; // Claude: ~1 token per 3.5 characters
                break;
            case 'gemini':
                ratio = 3.8; // Gemini: ~1 token per 3.8 characters
                break;
            default:
                ratio = 4.0; // Conservative estimate for local models
        }
        
        // Account for special tokens and overhead
        const baseTokens = Math.ceil(text.length / ratio);
        const overhead = Math.ceil(baseTokens * 0.1); // 10% overhead
        return baseTokens + overhead;
    }

    _getToolSystemPrompt(relevantToolsPrompt) {
        let toolsText = '';
        let availableTools = [];
        
        if (typeof relevantToolsPrompt === 'object' && relevantToolsPrompt.descriptions) {
            // Extract tool schemas for clear instructions
            availableTools = relevantToolsPrompt.descriptions.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }));
            
            // Create detailed tool descriptions
            toolsText = availableTools.map(tool => {
                return `**${tool.name}**: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters, null, 2)}`;
            }).join('\n\n');
        } else if (typeof relevantToolsPrompt === 'string') {
            toolsText = relevantToolsPrompt;
        }

        const currentTime = new Date().toISOString();
        
        return `You are a helpful assistant with access to the following tools. When you need to use a tool, respond with a JSON object in this exact format:

{"tool": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}

AVAILABLE TOOLS:
${toolsText}

IMPORTANT TOOL USAGE INSTRUCTIONS:
1. When you need information that requires a tool, ALWAYS use the appropriate tool
2. For weather information, use web_search with a query like "weather forecast Memphis tomorrow"
3. For current time/date, use time_date
4. For system settings, use system_settings
5. Use the EXACT JSON format shown above - no extra text, no markdown code blocks
6. Put the tool call JSON on its own line
7. You can provide explanation text before or after the tool call JSON

Examples:
- For weather: {"tool": "web_search", "arguments": {"query": "weather forecast Memphis tomorrow"}}
- For time: {"tool": "time_date", "arguments": {"action": "get_current_time"}}
- For system volume: {"tool": "system_settings", "arguments": {"action": "get_volume"}}

Current time: ${currentTime}

Remember: Always use tools when you need current information that you cannot provide from your training data.`;
    }

    assembleMessages(text, relevantToolsPrompt, chatBox = null) {
        // Get provider-specific context window limits
        const provider = this._settings.get_string('service-provider');
        const userMaxTokens = this._settings.get_int('max-context-tokens') || 2000;
        
        // Provider-specific context window sizes (conservative estimates)
        const providerLimits = {
            'openai': 8000,      // GPT-4 has 8k base, some models have 32k+
            'anthropic': 100000, // Claude has very large context window
            'gemini': 30000,     // Gemini Pro has large context
            'llama': 4000,       // Local models vary, conservative estimate
            'ollama': 4000       // Local models, conservative estimate
        };
        
        const providerLimit = providerLimits[provider] || 4000;
        const MAX_TOKENS = Math.min(userMaxTokens, providerLimit);
        
        // Only log provider details on first use or when settings change
        if (!this._lastProviderConfig || 
            this._lastProviderConfig.provider !== provider || 
            this._lastProviderConfig.maxTokens !== MAX_TOKENS) {
            debug(`[Context] Provider: ${provider}, User limit: ${userMaxTokens}, Provider limit: ${providerLimit}, Effective limit: ${MAX_TOKENS}`);
            this._lastProviderConfig = { provider, maxTokens: MAX_TOKENS };
        }

        // Create the system message with tool instructions and relevant tools
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt);
        const systemMessage = {
            role: 'system',
            content: systemPrompt
        };

        let systemTokens = this._estimateTokens(systemPrompt, provider);
        let currentUserText = text;
        let userTextTokens = this._estimateTokens(currentUserText, provider);

        // Reserve tokens for system message and current user input
        let remainingTokens = MAX_TOKENS - systemTokens - userTextTokens - 200; // 200 token buffer for safety
        
        // Initialize messages array with system message
        const messages = [systemMessage];

        // Add user message
        messages.push({
            role: 'user',
            content: currentUserText
        });

        // Add chat history if available
        if (chatBox && chatBox._messages) {
            const historyMessages = [];
            let historyTokens = 0;
            let includedCount = 0;
            let truncatedCount = 0;
            let skippedCount = 0;

            // Process messages in reverse order (oldest first)
            for (let i = chatBox._messages.length - 1; i >= 0; i--) {
                const msg = chatBox._messages[i];
                if (msg.sender === 'user' || msg.sender === 'ai') {
                    const role = msg.sender === 'user' ? 'user' : 'assistant';
                    const content = msg.text;
                    const msgTokens = this._estimateTokens(content, provider);

                    // Check if we have room for this message
                    if (historyTokens + msgTokens <= remainingTokens) {
                        historyMessages.unshift({
                            role: role,
                            content: content
                        });
                        historyTokens += msgTokens;
                        includedCount++;
                    } else if (remainingTokens > 200) {
                        // If message is too large but we have some space, truncate it
                        const availableChars = Math.floor((remainingTokens - 50) * (provider === 'ollama' ? 4.0 : 3.5));
                        const truncatedContent = content.substring(0, availableChars) + '...[truncated]';
                        historyMessages.unshift({
                            role: role,
                            content: truncatedContent
                        });
                        historyTokens += this._estimateTokens(truncatedContent, provider);
                        truncatedCount++;
                        break;
                    } else {
                        skippedCount++;
                        break;
                    }
                }
            }

            // Add history messages to the conversation
            messages.push(...historyMessages);
        }

        // Calculate total tokens
        const totalTokens = messages.reduce((sum, msg) => sum + this._estimateTokens(msg.content, provider), 0);
        const utilizationPercent = (totalTokens / MAX_TOKENS) * 100;
        
        // Log consolidated context information
        info(`[Context] Final: ${totalTokens}/${MAX_TOKENS} tokens (${utilizationPercent.toFixed(1)}%), ${messages.length} messages`);
        
        // Debug output for first time or on significant changes
        if (!this._lastDebugOutput || this._lastDebugOutput.messageCount !== messages.length) {
            debug(`[Context] Message roles: ${messages.map(m => m.role).join(', ')}`);
            this._lastDebugOutput = {
                messageCount: messages.length,
                tokenCount: totalTokens
            };
        }

        return messages;
    }

    // Convert messages to provider-specific format
    formatForProvider(messages, provider) {
        switch (provider) {
            case 'anthropic':
                // Convert to Anthropic format (combine system and user messages with Human/Assistant markers)
                const systemMessage = messages.find(msg => msg.role === 'system');
                const userMessage = messages.find(msg => msg.role === 'user');
                return `${systemMessage.content}\n\nHuman: ${userMessage.content}\n\nAssistant:`;

            case 'gemini':
                // Convert to Gemini format (combine system and user messages into single prompt)
                const systemMsg = messages.find(msg => msg.role === 'system');
                const userMsg = messages.find(msg => msg.role === 'user');
                return `${systemMsg.content}\n\nUser query: ${userMsg.content}`;

            case 'ollama':
                // Convert to Ollama format (combine system and user messages into single prompt)
                const sysMsg = messages.find(msg => msg.role === 'system');
                const usrMsg = messages.find(msg => msg.role === 'user');
                return `${sysMsg.content}\n\nUser: ${usrMsg.content}`;

            default:
                // Return original messages array for providers that support it (llamacpp, openai)
                return messages;
        }
    }
});