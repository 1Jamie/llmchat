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

    _getToolSystemPrompt(relevantToolsPrompt, recentToolCalls = [], toolResultsSummary = '') {
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

        const now = new Date();
        const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
        const currentTime = `${dayOfWeek}, ${now.toLocaleString()}`;

        // Summarize recent tool calls if provided
        let recentToolCallsText = '';
        if (recentToolCalls && recentToolCalls.length > 0) {
            recentToolCallsText = '\nRECENT TOOL CALLS (do NOT repeat these):\n' +
                recentToolCalls.map((call, idx) => {
                    return `${idx+1}. ${call}`;
                }).join('\n') + '\n';
        }
        // Add tool results summary if provided
        let toolResultsSection = '';
        if (toolResultsSummary && toolResultsSummary.length > 0) {
            toolResultsSection = `\nTOOL RESULTS AVAILABLE (use these to answer if possible):\n${toolResultsSummary}\n`;
        }

        return `You are a helpful assistant with access to tools when needed. Use tools strategically to gather information when you cannot answer from existing knowledge or context.

🔧 TOOL USAGE DECISION TREE:
1. **FIRST**: Can you answer the user's question with your existing knowledge or information already in the conversation?
   - If YES: Answer directly, no tools needed
   - If NO: Proceed to step 2

2. **SECOND**: What specific information do you need that you don't have?
   - Current/real-time data (weather, news, time, system status)
   - Specific web content or recent information
   - System operations (volume, files, applications)
   - If you can identify specific missing info: Use appropriate tools
   - If the question is too vague: Ask for clarification instead of guessing

3. **THIRD**: After using tools, do you have enough information to answer?
   - If YES: Synthesize and provide complete answer
   - If NO: Use additional tools for missing pieces only

🎯 TOOL CALL FORMAT:
When you need to use a tool, respond with JSON on its own line:
{"tool": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}

AVAILABLE TOOLS:
${toolsText}
${recentToolCallsText}${toolResultsSection}

✅ GOOD TOOL USAGE EXAMPLES:
- User: "What's the weather tomorrow?" → web_search (need current data)
- User: "Set volume to 50%" → system_settings (need system operation)
- User: "What's 2+2?" → Answer directly (basic math, no tools needed)
- User: "Tell me about Python" → Answer directly (general knowledge)
- User: "What's the latest news about AI and what's the weather?" → web_search for news, then web_search for weather

🚫 AVOID THESE MISTAKES:
- Using tools for general knowledge questions
- Making redundant tool calls for the same information
- Using tools when the answer is already in the conversation
- Making tool calls "just to be thorough" when you have sufficient info
- Using web_search for basic facts that don't change

🔄 MULTI-STEP WORKFLOWS:
- For complex requests, break them into logical steps
- Use tools sequentially to gather all needed information
- After each tool use, assess if you have enough to answer
- Don't make additional calls once you have sufficient information

Current time: ${currentTime}

Remember: Be efficient and purposeful with tool usage. Your goal is to help the user, not to use as many tools as possible.`;
    }

    async assembleMessages(text, relevantToolsPrompt, chatBox = null, memoryService = null) {
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
        const systemPrompt = this._getToolSystemPrompt(relevantToolsPrompt) + '\n- Use the current time provided to determine if memories or tool results are outdated or expired.';
        const systemMessage = {
            role: 'system',
            content: systemPrompt
        };

        let systemTokens = this._estimateTokens(systemPrompt, provider);
        const now = new Date();
        const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
        const nowString = `${dayOfWeek}, ${now.toLocaleString()}`;
        let currentUserText = `${text}\n\n[Current time: ${nowString}]`;
        let userTextTokens = this._estimateTokens(currentUserText, provider);

        // Reserve tokens for system message and current user input
        let remainingTokens = MAX_TOKENS - systemTokens - userTextTokens - 200; // 200 token buffer for safety
        
        // Initialize messages array with system message
        const messages = [systemMessage];

        // Try to retrieve relevant memories if memory service is available
        let memoryContext = '';
        if (memoryService) {
            try {
                log(`[Memory] Memory service available, checking initialization: ${!!memoryService._initialized}`);
                debug(`[Memory] Retrieving relevant memories for query: ${text.substring(0, 50)}...`);
                const relevantMemories = await memoryService.getRelevantMemories(text, 3);
                
                log(`[Memory] Retrieved memories: ${JSON.stringify(relevantMemories)}`);
                
                if (relevantMemories && (relevantMemories.conversation_history?.length > 0 || 
                    relevantMemories.user_info?.length > 0 || 
                    relevantMemories.world_facts?.length > 0 || 
                    relevantMemories.volatile_info?.length > 0)) {
                    
                    // Combine all types of memories
                    const allMemories = [
                        ...(relevantMemories.conversation_history || []),
                        ...(relevantMemories.user_info || []),
                        ...(relevantMemories.world_facts || []),
                        ...(relevantMemories.volatile_info || [])
                    ];
                    
                    log(`[Memory] Combined memories count: ${allMemories.length}`);
                    
                    // Filter out expired volatile memories
                    const now = new Date();
                    const filteredMemories = allMemories.filter(memory => {
                        if (memory.context?.is_volatile && memory.context?.expires_at) {
                            const expires = new Date(memory.context.expires_at);
                            if (now > expires) {
                                log(`[Memory] Skipping expired volatile memory: ${memory.text.substring(0, 50)}...`);
                                return false;
                            }
                        }
                        return true;
                    });
                    
                    // Sort by relevance and take top memories that fit in context
                    filteredMemories.sort((a, b) => (b.score || 0) - (a.score || 0));
                    
                    let memoryText = '';
                    let memoryTokens = 0;
                    const maxMemoryTokens = Math.floor(remainingTokens * 0.3); // Use up to 30% of remaining tokens for memories
                    
                    debug(`[Memory] Processing ${filteredMemories.length} memories, max tokens: ${maxMemoryTokens}`);
                    
                    // Group memories by type for better organization
                    const memoryGroups = {
                        personal: filteredMemories.filter(m => relevantMemories.user_info?.includes(m)),
                        facts: filteredMemories.filter(m => relevantMemories.world_facts?.includes(m)),
                        volatile: filteredMemories.filter(m => relevantMemories.volatile_info?.includes(m)),
                        history: filteredMemories.filter(m => relevantMemories.conversation_history?.includes(m))
                    };
                    
                    // Add memories by priority: personal info first, then current/volatile, then facts, then history
                    const priorityOrder = ['personal', 'volatile', 'facts', 'history'];
                    
                    for (const groupName of priorityOrder) {
                        const groupMemories = memoryGroups[groupName];
                        if (groupMemories.length > 0) {
                            let groupHeader = '';
                            switch (groupName) {
                                case 'personal':
                                    groupHeader = 'PERSONAL CONTEXT:\n';
                                    break;
                                case 'volatile':
                                    groupHeader = 'CURRENT/TIME-SENSITIVE INFO:\n';
                                    break;
                                case 'facts':
                                    groupHeader = 'RELEVANT FACTS:\n';
                                    break;
                                case 'history':
                                    groupHeader = 'CONVERSATION HISTORY:\n';
                                    break;
                            }
                            
                            const headerTokens = this._estimateTokens(groupHeader, provider);
                            if (memoryTokens + headerTokens <= maxMemoryTokens) {
                                memoryText += groupHeader;
                                memoryTokens += headerTokens;
                                
                                for (const memory of groupMemories) {
                                    const formattedMemory = this._formatSingleMemory(memory);
                                    const memoryTokensEstimate = this._estimateTokens(formattedMemory, provider);
                                    
                                    log(`[Memory] ${groupName}: ${memory.text.substring(0, 50)}... (${memoryTokensEstimate} tokens)`);
                                    
                                    if (memoryTokens + memoryTokensEstimate <= maxMemoryTokens) {
                                        memoryText += formattedMemory + '\n';
                                        memoryTokens += memoryTokensEstimate;
                                    } else {
                                        log(`[Memory] Skipping memory due to token limit`);
                                        break;
                                    }
                                }
                                memoryText += '\n';
                            }
                        }
                    }
                    
                    if (memoryText.trim()) {
                        memoryContext = `\n\nRELEVANT CONTEXT:\n${memoryText}Use this context to inform your response, but only reference it when directly relevant to the user's query.\n\n`;
                        remainingTokens -= memoryTokens;
                        debug(`[Memory] Added ${memoryTokens} tokens of memory context`);
                        log(`[Memory] Final memory context length: ${memoryContext.length} chars`);
                    } else {
                        log(`[Memory] No memory text generated after filtering expired volatile memories`);
                    }
                } else {
                    log(`[Memory] No relevant memories found or empty response structure`);
                }
            } catch (error) {
                log(`[Memory] Error retrieving memories: ${error.message}`);
                log(`[Memory] Error stack: ${error.stack}`);
                // Continue without memories if retrieval fails
            }
        } else {
            log(`[Memory] No memory service provided to PromptAssembler`);
        }

        // Add memory context to system message if available
        if (memoryContext) {
            systemMessage.content += memoryContext;
            systemTokens = this._estimateTokens(systemMessage.content, provider);
        }

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

    _formatSingleMemory(memory) {
        const currentTime = new Date();
        let context = `MEMORY: ${memory.text}\n`;
        
        // Add relevance score if available
        if (memory.relevance) {
            const relevancePercent = Math.round(memory.relevance * 100);
            context += `RELEVANCE: ${relevancePercent}%\n`;
        }
        
        // Add age information if available
        if (memory.context?.created_at || memory.context?.timestamp) {
            const createdDate = new Date(memory.context.created_at || memory.context.timestamp);
            const ageInHours = Math.round((currentTime - createdDate) / (1000 * 60 * 60));
            
            if (ageInHours < 24) {
                context += `AGE: ${ageInHours} hours ago\n`;
            } else {
                const ageInDays = Math.round(ageInHours / 24);
                context += `AGE: ${ageInDays} days ago\n`;
            }
        }
        
        // Add expiration info for volatile data
        if (memory.context?.is_volatile && memory.context?.expires_at) {
            const expiresDate = new Date(memory.context.expires_at);
            const isExpired = currentTime > expiresDate;
            
            if (isExpired) {
                context += `STATUS: ⚠️ EXPIRED - UPDATE NEEDED\n`;
            } else {
                context += `STATUS: ✓ VALID\n`;
            }
        }
        
        return context;
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