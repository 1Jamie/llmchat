/* extension.js
*/

const { Clutter, Gio, GLib, GObject, Pango, St, Shell, Soup } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Logger } = Me.imports.utils.Logger;
const { debug, info, warn, error } = Logger;
const { ToolLoader } = Me.imports.utils.ToolLoader;
const { MemoryService } = Me.imports.services.MemoryService;
const { PromptAssembler } = Me.imports.utils.PromptAssembler;

const Signals = imports.signals;

// Import session management
const { SessionManager } = Me.imports.sessionManager;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Initialize memory service for RAG
let memoryService = null;
try {
    memoryService = MemoryService.getInstance();
    // Start initialization asynchronously
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
        memoryService.initialize().catch(e => {
                log(`Error starting memory system initialization: ${e.message}`);
            });
            return GLib.SOURCE_REMOVE;
        });
} catch (e) {
    log(`Error creating memory service: ${e.message}`);
}

// Initialize tool loader after memory service
const toolLoader = new ToolLoader();
if (memoryService) {
toolLoader.setMemoryService(memoryService);
}

// Initialize session manager after memory service
const sessionManager = new SessionManager();

// LLM Search Provider for GNOME Activities
var LLMSearchProvider = class LLMSearchProvider {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension._settings;
        this.id = 'llm-chat-search-provider';
        this.isRemoteProvider = false;
        this.canLaunchSearch = true;
        
        // Create a proper app info object that implements all required methods
        this.appInfo = {
            get_name: () => 'LLM Chat',
            get_id: () => 'llm-chat-search-provider',
            get_description: () => 'LLM Chat Assistant',
            get_executable: () => 'true', // Use 'true' command as dummy
            get_commandline: () => 'true',
            get_display_name: () => 'LLM Chat',
            get_icon: () => null,
            get_filename: () => null,
            should_show: () => true, // This was the missing method causing the error
            supports_uris: () => false,
            supports_files: () => false,
            launch: () => true,
            launch_uris: () => true,
            launch_default_for_uri: () => true,
            equal: (other) => other && other.get_id && other.get_id() === this.get_id(),
            // Additional methods that might be expected
            can_delete: () => false,
            delete: () => false,
            dup: () => this,
            ref: function() { return this; },
            unref: function() { },
            // Implement the interface that GNOME Shell expects
            [Symbol.iterator]: function*() {
                // Empty iterator for interface compatibility
            }
        };
        
        log('[Search Provider] LLM Search Provider created');
    }

    getInitialSearchResults(terms, callback) {
        log(`[Search Provider] getInitialSearchResults called with terms: ${JSON.stringify(terms)}`);
        
        if (!terms || terms.length === 0) {
            log('[Search Provider] No terms provided, returning empty results');
            callback([]);
            return;
        }
        
        // Join terms into a query
        const query = terms.join(' ');
        log(`[Search Provider] Joined query: "${query}"`);
        
        // Show LLM option for any query with at least 2 characters
        if (query.length < 2) {
            log('[Search Provider] Query too short, returning empty results');
            callback([]);
            return;
        }

        // Return a simple result ID
        const resultId = 'llm-query';
        log(`[Search Provider] Returning result ID: ${resultId}`);
        callback([resultId]);
    }

    // GNOME Shell 42 uses these method names instead
    getInitialResultSet(terms, callback) {
        log(`[Search Provider] getInitialResultSet called with terms: ${JSON.stringify(terms)}`);
        this.getInitialSearchResults(terms, callback);
    }

    getSubsearchResults(previousResults, terms, callback) {
        log(`[Search Provider] getSubsearchResults called with terms: ${JSON.stringify(terms)}`);
        this.getInitialSearchResults(terms, callback);
    }

    getSubsearchResultSet(previousResults, terms, callback) {
        log(`[Search Provider] getSubsearchResultSet called with terms: ${JSON.stringify(terms)}`);
        this.getInitialSearchResults(terms, callback);
    }

    getResultMetas(resultIds, callback) {
        log(`[Search Provider] getResultMetas called with IDs: ${JSON.stringify(resultIds)}`);
        
        const metas = resultIds.map(id => {
            return {
                id: id,
                name: 'Ask LLM Chat',
                description: 'Send your search query to the LLM assistant',
                createIcon: (size) => {
                    log(`[Search Provider] Creating icon with size: ${size}`);
                    return new St.Icon({
                        icon_name: 'system-run-symbolic',
                        icon_size: size || 32
                    });
                }
            };
        });
        
        log(`[Search Provider] Returning ${metas.length} result metas`);
        callback(metas);
    }

    activateResult(resultId, terms, timestamp) {
        log(`[Search Provider] activateResult called with ID: ${resultId}, terms: ${JSON.stringify(terms)}`);
        
        const query = terms.join(' ');
        log(`[Search Provider] Activating with query: "${query}"`);
        
        try {
            // Open the LLM chat panel and send the query
            if (this._extension._button && this._extension._button._chatBox) {
                log('[Search Provider] Found chat box, opening menu');
                
                // Close overview first if it's open
                if (Main.overview.visible) {
                    log('[Search Provider] Closing overview');
                    Main.overview.hide();
                }
                
                // Open the menu
                this._extension._button.menu.open();
                log('[Search Provider] Menu opened');
                
                // Set the query in the text entry and send it after a delay
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    try {
                        const chatBox = this._extension._button._chatBox;
                        if (chatBox && chatBox._entryText) {
                            log(`[Search Provider] Setting query text: "${query}"`);
                            chatBox._entryText.set_text(query);
                            chatBox._entryText.grab_key_focus();
                            
                            // Auto-send the message if the memory service is ready
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                                try {
                                    if (chatBox && !chatBox._isMemoryServiceLoading) {
                                        log('[Search Provider] Auto-sending message');
                                        chatBox._sendMessage(query);
                                        chatBox._entryText.set_text('');
                                    } else {
                                        log('[Search Provider] Memory service still loading, not auto-sending');
                                    }
                                } catch (e) {
                                    log(`[Search Provider] Error auto-sending LLM query: ${e.message}`);
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        } else {
                            log('[Search Provider] Chat box or entry text not found');
                        }
                    } catch (e) {
                        log(`[Search Provider] Error setting LLM query: ${e.message}`);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                log('[Search Provider] Extension button or chat box not found');
            }
        } catch (e) {
            log(`[Search Provider] Error activating LLM search result: ${e.message}`);
        }
    }

    launchSearch(terms, timestamp) {
        log(`[Search Provider] launchSearch called with terms: ${JSON.stringify(terms)}`);
        this.activateResult('llm-query', terms, timestamp);
    }

    createResultObject(resultMeta, terms) {
        log(`[Search Provider] createResultObject called for: ${resultMeta.id}`);
        // Return null to use default result object rendering
        return null;
    }

    filterResults(results, maxNumber) {
        log(`[Search Provider] filterResults called with ${results.length} results, max: ${maxNumber}`);
        return results.slice(0, maxNumber);
    }
};

// Provider Adapter class to handle different AI providers
class ProviderAdapter {
    constructor(settings, chatBox = null) {
        this._settings = settings;
        this._chatBox = chatBox;
        this._promptAssembler = new PromptAssembler(settings);
        this._memoryServiceUrl = 'http://127.0.0.1:5000';
        // Pass the global memory service instance to the provider adapter
        this._memoryService = memoryService;
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

    async _processMessageForMemory(chatId, query, response, provider) {
        if (!this._memoryService) {
            log('Memory service not initialized');
            return;
        }

        // Only process memories after a complete exchange
        if (!response) {
            return;
        }

        // Determine if this memory is important enough to store
        const importance = this._determineMemoryImportance(query, response);
        if (importance.importance === 'none') {
            log('Memory not important enough to store');
            return;
        }

        // Create a clean memory object without tool history or session details
        const memory = {
            text: `User: ${query}\n\nAssistant: ${response}`,
            context: {
                timestamp: new Date().toISOString(),
                provider: provider,
                importance: importance.importance,
                // Only include expiration if it's volatile
                ...(importance.expiration_hours && {
                    is_volatile: true,
                    expires_at: new Date(Date.now() + importance.expiration_hours * 60 * 60 * 1000).toISOString(),
                    expiration_hours: importance.expiration_hours
                })
            }
        };
                                    
        try {
            // Store memory and let the server's dual-pass system categorize it
            await this._memoryService.indexMemory(memory);
            log(`Memory stored: ${importance.importance} importance${importance.expiration_hours ? `, expires in ${importance.expiration_hours}h` : ', permanent'}`);
        } catch (error) {
            log(`Error processing memory: ${error.message}`);
        }
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
        // Only log provider requests occasionally to reduce spam
        if (!this._requestCount) this._requestCount = 0;
        this._requestCount++;
        if (this._requestCount === 1 || this._requestCount % 10 === 0) {
            log(`[Request ${this._requestCount}] Using provider: ${provider}`);
        }
        
        try {
            // Get relevant tools for the query
            const relevantToolsPrompt = await this._getRelevantToolsPrompt(text);
            
            let response;
            switch (provider) {
                case 'openai':
                    response = await this._makeOpenAIRequest(text, toolCalls, relevantToolsPrompt, this._chatBox);
                    break;
                case 'gemini':
                    response = await this._makeGeminiRequest(text, toolCalls, relevantToolsPrompt, this._chatBox);
                    break;
                case 'anthropic':
                    response = await this._makeAnthropicRequest(text, toolCalls, relevantToolsPrompt, this._chatBox);
                    break;
                case 'llama':
                    response = await this._makeLlamaRequest(text, toolCalls, relevantToolsPrompt, this._chatBox);
                    break;
                case 'ollama':
                    response = await this._makeOllamaRequest(text, toolCalls, relevantToolsPrompt, this._chatBox);
                    break;
                default:
                    throw new Error(`Unknown provider: ${provider}`);
            }
            
            return response;
        } catch (error) {
            log(`Error in makeRequest: ${error.message || 'Unknown error'}`);
            if (error.stack) {
                log(`Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    _categorizeMemoriesByFreshness(memories) {
        const currentTime = new Date();
        const validMemories = [];
        const expiredMemories = [];
        
        memories.forEach(memory => {
            if (memory.context?.is_volatile && memory.context?.expires_at) {
                const expiresDate = new Date(memory.context.expires_at);
                if (currentTime > expiresDate) {
                    expiredMemories.push(memory);
                } else {
                    validMemories.push(memory);
                }
            } else {
                // Non-volatile memories are always valid
                validMemories.push(memory);
            }
        });
        
        return { validMemories, expiredMemories };
    }

    _formatMemoryContext(memories) {
        const currentTime = new Date();
        
        log(`[Memory] Formatting ${memories.length} memories for context`);
        
        return memories.map((memory, index) => {
            let context = `MEMORY #${index+1}:\n${memory.text}\n`;
            
            // Add relevance score if available with clear formatting
            if (memory.relevance) {
                const relevancePercent = Math.round(memory.relevance * 100);
                context += `RELEVANCE: ${relevancePercent}% ${
                    relevancePercent > 90 ? '(HIGHLY RELEVANT)' : 
                    relevancePercent > 70 ? '(RELEVANT)' : 
                    relevancePercent > 50 ? '(SOMEWHAT RELEVANT)' : '(LOW RELEVANCE)'
                }\n`;
            }
            
            // Add creation timestamp and current time for comparison
            if (memory.context?.created_at || memory.context?.timestamp) {
                const createdDate = new Date(memory.context.created_at || memory.context.timestamp);
                const ageInHours = Math.round((currentTime - createdDate) / (1000 * 60 * 60));
                const ageInDays = Math.round(ageInHours / 24);
                
                context += `CREATED: ${createdDate.toLocaleString()}\n`;
                context += `AGE: ${ageInDays > 0 ? `${ageInDays} days` : `${ageInHours} hours`} ago\n`;
                context += `CURRENT TIME: ${currentTime.toLocaleString()}\n`;
            }
            
            // Add expiration information for volatile data with clear formatting
            if (memory.context?.is_volatile && memory.context?.expires_at) {
                const expiresDate = new Date(memory.context.expires_at);
                const isExpired = currentTime > expiresDate;
                const timeToExpiry = Math.round((expiresDate - currentTime) / (1000 * 60 * 60));
                
                context += `TYPE: 🕒 VOLATILE DATA\n`;
                if (isExpired) {
                    context += `STATUS: ⚠️ EXPIRED (${Math.abs(timeToExpiry)} hours ago) - YOU SHOULD REFRESH THIS INFORMATION\n`;
                } else {
                    context += `EXPIRES: ${expiresDate.toLocaleString()} (in ${timeToExpiry} hours)\n`;
                    context += `STATUS: ✓ VALID (still fresh and usable)\n`;
                }
            } else {
                context += `TYPE: 📌 PERSISTENT DATA (never expires)\n`;
                context += `STATUS: ✓ ALWAYS VALID\n`;
            }
            
            // Add importance if available with clear formatting
            if (memory.context?.importance) {
                context += `IMPORTANCE: ${memory.context.importance.toUpperCase()}\n`;
            }
            
            // Add tags if available with clear formatting
            if (memory.context?.tags?.length > 0) {
                context += `TAGS: ${memory.context.tags.join(', ')}\n`;
            }
            
            // Add source if available
            if (memory.context?.source) {
                context += `SOURCE: ${memory.context.source}\n`;
            }
            
            // Add instructions for the LLM
            if (memory.context?.is_volatile && currentTime > new Date(memory.context.expires_at)) {
                context += `\n⚠️ NOTE: This information is EXPIRED. You should inform the user and get fresh data if needed.\n`;
            }
            
            return context;
        }).join('\n\n----------\n\n');
    }

    _determineMemoryImportance(query, response) {
        const text = `${query} ${response}`.toLowerCase();
        
        // Patterns for information that should NEVER be stored (tool calls, temporary actions, etc.)
        const excludePatterns = [
            // Tool calls and browser actions - these should never be stored
            /(?:open|opened|opening|launch|launched|launching)\s+(?:chrome|firefox|browser|youtube|website|url)/i,
            /(?:tool|function|command)\s+(?:call|executed|run|running|completed)/i,
            /(?:browser|window|tab)\s+(?:opened|closed|switched|focused)/i,
            /(?:application|app)\s+(?:started|launched|opened|closed)/i,
            /(?:workspace|desktop)\s+(?:switched|changed|moved)/i,
            
            // System operations and temporary states
            /(?:system|process|service)\s+(?:started|stopped|restarted|killed)/i,
            /(?:file|folder|directory)\s+(?:created|deleted|moved|copied)/i,
            /(?:volume|brightness|setting)\s+(?:changed|adjusted|set)/i,
            /(?:notification|alert|popup)\s+(?:shown|displayed|dismissed)/i,
            
            // Search results and web content (too volatile)
            /(?:search|found|fetched|retrieved)\s+(?:results|content|information|data)/i,
            /(?:web|internet|online)\s+(?:search|query|lookup|content)/i,
            /(?:weather|forecast|temperature)\s+(?:today|tomorrow|current|now)/i,
            /(?:news|article|headline)\s+(?:today|recent|latest|current)/i,
            
            // Tool execution confirmations
            /(?:successfully|completed|finished)\s+(?:executed|running|performed)/i,
            /(?:tool|function|command)\s+(?:result|output|response)/i,
            /(?:already|previously)\s+(?:ran|executed|performed|opened)/i,
            
            // Temporary session information
            /(?:current|this)\s+(?:session|conversation|chat|task)/i,
            /(?:right now|at the moment|currently|presently)/i,
            /(?:temporary|temp|cache|cached)/i,
            
            // System status and monitoring
            /(?:cpu|memory|disk|network)\s+(?:usage|status|load|activity)/i,
            /(?:process|service|daemon)\s+(?:list|status|running|active)/i,
            /(?:window|application)\s+(?:list|status|active|running)/i,
            
            // Error messages and debugging
            /(?:error|warning|debug|log)\s+(?:message|output|information)/i,
            /(?:failed|error|exception|crash)/i,
            
            // Very short or generic responses
            /^(?:ok|yes|no|done|sure|thanks|welcome)\.?$/i,
            /^(?:i see|got it|understood|alright)\.?$/i
        ];

        // Check for content that should be excluded
        for (const pattern of excludePatterns) {
            if (pattern.test(text)) {
                log(`Excluding from memory (tool/action): ${text.substring(0, 100)}...`);
                return { importance: 'none', expiration_hours: null };
            }
        }

        // Patterns for truly important personal information that should be stored permanently
        const personalPatterns = [
            // Personal identity and location
            /(?:my name is|i am|i'm called|call me)\s+\w+/i,
            /(?:i live in|i'm from|i'm located in|my location is)\s+[\w\s,]+/i,
            /(?:my email|my address|my phone|my contact)/i,
            
            // Strong personal preferences (not temporary)
            /(?:i always|i never|i prefer|i like|i love|i hate|i dislike)\s+(?!today|now|currently)/i,
            /(?:my favorite|my preferred|i usually|i typically)/i,
            
            // Important personal decisions and goals
            /(?:i decided|i chose|i'm planning|my goal|my plan)/i,
            /(?:important to me|matters to me|i care about)/i,
            
            // Skills and expertise
            /(?:i know|i'm good at|i'm experienced|my skill|my expertise)/i,
            /(?:i work as|my job|my profession|my career)/i,
            
            // Significant relationships and context
            /(?:my family|my friend|my colleague|my partner)/i,
            /(?:my project|my work|my study|my research)/i
        ];

        // Check for important personal information
        let isPersonal = false;
        for (const pattern of personalPatterns) {
            if (pattern.test(text)) {
                isPersonal = true;
                log(`Storing personal information: ${text.substring(0, 100)}...`);
                break;
            }
        }

        if (isPersonal) {
            return { importance: 'high', expiration_hours: null }; // Permanent storage
        }

        // Patterns for useful factual information (but not personal)
        const factualPatterns = [
            // Educational content and explanations
            /(?:explanation|definition|meaning|concept|theory|principle)/i,
            /(?:how to|tutorial|guide|instruction|method|technique)/i,
            /(?:fact|information|knowledge|data|statistic)/i,
            
            // Important world knowledge (not time-sensitive)
            /(?:history|historical|geography|geographical|scientific|mathematical)/i,
            /(?:programming|coding|development|technology|software)/i,
            /(?:language|grammar|vocabulary|translation)/i
        ];

        // Check for factual content worth storing
        let isFactual = false;
        for (const pattern of factualPatterns) {
            if (pattern.test(text)) {
                isFactual = true;
                break;
            }
        }

        if (isFactual && text.length > 100) { // Only store substantial factual content
            log(`Storing factual information: ${text.substring(0, 100)}...`);
            return { importance: 'normal', expiration_hours: null }; // Permanent storage
        }

        // For everything else, be very restrictive
        // Only store if it's a substantial conversation (>200 chars) and doesn't match exclusion patterns
        if (text.length > 200 && query.length > 20 && response.length > 50) {
            // Additional check: make sure it's not just tool output or system information
            const toolOutputPatterns = [
                /(?:executed|completed|finished|done|success)/i,
                /(?:result|output|response|status|information)/i,
                /(?:found|retrieved|fetched|obtained|gathered)/i
            ];
            
            let seemsLikeToolOutput = false;
            for (const pattern of toolOutputPatterns) {
                if (pattern.test(text) && text.length < 500) { // Short tool outputs
                    seemsLikeToolOutput = true;
                    break;
                }
            }
            
            if (!seemsLikeToolOutput) {
                log(`Storing conversation as short-term memory: ${text.substring(0, 100)}...`);
                return { importance: 'low', expiration_hours: 6 }; // Very short-term storage
            }
        }
        
        // Default: don't store
        log(`Not storing in memory: ${text.substring(0, 100)}...`);
        return { importance: 'none', expiration_hours: null };
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
        
        // First try to find complete JSON objects
        while (i < text.length) {
            if (text[i] === '{') {
                let stack = 1;
                let j = i + 1;
                let inString = false;
                let escape = false;
                
                // Find the matching closing brace
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
                    
                    // Only increment j if we haven't found the complete JSON object
                    if (stack > 0) {
                    j++;
                    } else {
                        j++; // Include the closing brace
                        break;
                    }
                }
                
                if (stack === 0) {
                    const candidate = text.slice(i, j);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (parsed.tool && parsed.arguments) {
                            matches.push({ parsed, match: candidate });
                        }
                    } catch (e) {
                        log(`Failed to parse JSON: ${e.message}`);
                    }
                    i = j;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        
        // Remove duplicates while preserving order
        const seen = new Set();
        const uniqueMatches = [];
        for (const m of matches) {
            const key = m.parsed.tool + JSON.stringify(m.parsed.arguments);
            if (!seen.has(key)) {
                seen.add(key);
                uniqueMatches.push(m);
            }
        }
        
        // Process each unique match and track positions for precise removal
        const matchPositions = [];
        for (const { parsed, match } of uniqueMatches) {
            toolCalls.push({
                function: {
                    name: parsed.tool,
                    arguments: JSON.stringify(parsed.arguments)
                }
            });
            
            // Find the position of this match in the original text for precise removal
            const matchIndex = text.indexOf(match);
            if (matchIndex !== -1) {
                matchPositions.push({ start: matchIndex, end: matchIndex + match.length });
            }
        }
        
        // Remove matches from the text by sorting positions in reverse order
        // and removing from the end to avoid index shifting
        matchPositions.sort((a, b) => b.start - a.start);
        remainingText = text;
        for (const { start, end } of matchPositions) {
            remainingText = remainingText.slice(0, start) + remainingText.slice(end);
        }
        remainingText = remainingText.trim();
        
        log(`Extracted ${toolCalls.length} tool calls from response`);
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
                    
                    // Remove markdown code blocks
                    text = text.replace(/```json\n?([\s\S]*?)```/g, '$1');
                    text = text.replace(/```\n?([\s\S]*?)```/g, '$1');
                    
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
                
                // Remove markdown code blocks
                text = text.replace(/```json\n?([\s\S]*?)```/g, '$1');
                text = text.replace(/```\n?([\s\S]*?)```/g, '$1');
                
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

            // Process memory commands if we have them - do this silently without UI feedback
            if (memoryCommands.length > 0 && memoryService && memoryService._initialized) {
                memoryCommands.forEach(memory => {
                    try {
                        const now = new Date();
                        const context = {
                                type: memory.type,
                                importance: memory.importance,
                                context: memory.context,
                                tags: memory.tags,
                            timestamp: now.toISOString(),
                            created_at: now.toISOString()
                        };

                        // Handle expiration for volatile data
                        if (memory.expiration_hours && memory.expiration_hours > 0) {
                            const expiresAt = new Date(now.getTime() + (memory.expiration_hours * 60 * 60 * 1000));
                            context.expires_at = expiresAt.toISOString();
                            context.expiration_hours = memory.expiration_hours;
                            context.is_volatile = true;
                            log(`Memory will expire at: ${expiresAt.toISOString()}`);
                        } else {
                            context.is_volatile = false;
                        }

                        memoryService.indexMemory({
                            text: memory.content,
                            context: context
                        });
                        
                        // Log success but don't show in UI
                        log(`Memory added silently: ${memory.content} ${context.is_volatile ? '(volatile, expires in ' + memory.expiration_hours + 'h)' : '(persistent)'}`);
                    } catch (e) {
                        log(`Error storing memory: ${e.message}`);
                    }
                });
            }

            // Process thinking tags if hide-thinking is enabled
            if (this._settings.get_boolean('hide-thinking')) {
                text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
            }

            // Clean up any remaining JSON artifacts from the text
            text = text.replace(/\{[\s\S]*?\}/g, '').trim();
            text = text.replace(/\[[\s\S]*?\]/g, '').trim();
            
            // Remove isolated brackets that might be left over after tool extraction
            text = text.replace(/^\s*[\{\}\[\]]+\s*$/gm, '').trim();
            text = text.replace(/[\{\}\[\]]/g, '').trim();
            
            // Remove empty lines and clean up whitespace
            text = text.replace(/^\s*[\n\r]+/gm, '').trim();
            text = text.replace(/\n\s*\n/g, '\n').trim(); // Remove multiple consecutive newlines
        } catch (error) {
            log(`Error processing tool response: ${error.message}`);
        }

        log(`Processed response - text length: ${text.length}, tool calls: ${toolCalls.length}, memory commands: ${memoryCommands.length}`);
        return { text, toolCalls };
    }

    // Update LlamaCPP request method to use shared processing and include relevant tools
    async _makeLlamaRequest(text, toolCalls, relevantToolsPrompt, chatBox = null) {
        const serverUrl = this._settings.get_string('llama-server-url');
        if (!serverUrl) {
            throw new Error('Llama server URL is not set');
        }

        const modelName = this._settings.get_string('llama-model-name') || 'llama';
        const temperature = this._settings.get_double('llama-temperature');

        // Use centralized message assembly with memory service
        const messages = await this._promptAssembler.assembleMessages(text, relevantToolsPrompt, chatBox, this._memoryService);

        // Create the request payload
        const payload = {
            model: modelName,
            messages: messages,
            max_tokens: 1338,
            temperature: temperature,
            stream: false
        };

        // Add tools if available in the correct format
        if (toolCalls && toolCalls.length > 0) {
            payload.tools = toolCalls.map(tool => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            payload.tool_choice = "auto";
        }

        debug(`Making Llama request with tool support. Model: ${modelName}, temp: ${temperature}`);
        debug(`Tool configuration: ${toolCalls ? toolCalls.length : 0} tools available`);

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
    async _makeOpenAIRequest(text, toolCalls, relevantToolsPrompt, chatBox = null) {
        const apiKey = this._settings.get_string('openai-api-key');
        if (!apiKey) {
            throw new Error('OpenAI API key is not set');
        }

        const model = this._settings.get_string('openai-model');
        const temperature = this._settings.get_double('openai-temperature');

        // Use centralized message assembly with memory service
        const messages = await this._promptAssembler.assembleMessages(text, relevantToolsPrompt, chatBox, this._memoryService);

        const requestData = {
            model: model,
            messages: messages,
            max_tokens: Math.round(this._settings.get_int('max-response-length') / 4),
            temperature: temperature
        };

        // Add tools if available in the correct OpenAI format
        if (toolCalls && toolCalls.length > 0) {
            requestData.tools = toolCalls.map(tool => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            requestData.tool_choice = "auto";
        }

        debug(`Making OpenAI request with tool support. Model: ${model}, temp: ${temperature}`);
        debug(`Tool configuration: ${toolCalls ? toolCalls.length : 0} tools available`);

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
                    // Use shared processing method
                    const processed = this._processToolResponse(response);
                    resolve(processed);
                } catch (error) {
                    reject(`Error parsing OpenAI response: ${error.message}`);
                }
            });
        });
    }

    async _makeGeminiRequest(text, toolCalls, relevantToolsPrompt, chatBox = null) {
        const apiKey = this._settings.get_string('gemini-api-key');
        if (!apiKey) {
            throw new Error('Gemini API key is not set');
        }

        // Use centralized message assembly with memory service
        const messages = await this._promptAssembler.assembleMessages(text, relevantToolsPrompt, chatBox, this._memoryService);
        const formattedPrompt = this._promptAssembler.formatForProvider(messages, 'gemini');
        
        const requestData = {
            contents: [{
                parts: [{
                    text: formattedPrompt
                }]
            }],
            generationConfig: {
                temperature: this._settings.get_double('gemini-temperature'),
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
            }
        };

        const model = this._settings.get_string('gemini-model') || 'gemini-2.0-flash-001';
        log(`Making Gemini request with tool support. Model: ${model}, temp: ${this._settings.get_double('gemini-temperature')}`);
        log(`Tool configuration passed via system prompt: ${toolCalls ? toolCalls.length : 0} tools available`);
        log(`Request data: ${JSON.stringify(requestData)}`);

        const message = Soup.Message.new('POST', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        return new Promise((resolve, reject) => {
            _httpSession.queue_message(message, (session, msg) => {
                try {
                    const responseText = msg.response_body.data;
                    log(`Gemini API response status: ${msg.status_code}`);
                    log(`Gemini API response: ${responseText}`);

                if (msg.status_code !== 200) {
                        let errorMessage = 'Unknown error';
                        try {
                            const errorData = JSON.parse(responseText);
                            errorMessage = errorData.error?.message || errorData.error?.details?.[0]?.message || 'Unknown error';
                        } catch (e) {
                            errorMessage = responseText;
                        }
                        reject(new Error(`Gemini API error (${msg.status_code}): ${errorMessage}`));
                    return;
                }

                    const response = JSON.parse(responseText);
                    
                    // Validate response structure
                    if (!response.candidates || !response.candidates[0] || !response.candidates[0].content) {
                        log(`Invalid response format: ${JSON.stringify(response)}`);
                        reject(new Error('Invalid response format from Gemini API'));
                        return;
                    }
                    
                    // Extract the text from the response
                    const text = response.candidates[0].content.parts[0].text;
                    if (!text) {
                        log(`Empty response text: ${JSON.stringify(response)}`);
                        reject(new Error('Empty response from Gemini API'));
                        return;
                    }
                    
                    log(`Successfully extracted response text: ${text.substring(0, 100)}...`);
                    
                    // Use shared processing method
                    const processed = this._processToolResponse({
                        choices: [{
                            message: {
                                content: text
                            }
                        }]
                    });
                    resolve(processed);
                } catch (error) {
                    log(`Error in Gemini request: ${error.message}`);
                    if (error.stack) {
                        log(`Error stack: ${error.stack}`);
                    }
                    reject(error);
                }
            });
        });
    }

    async _makeAnthropicRequest(text, toolCalls, relevantToolsPrompt, chatBox = null) {
        const apiKey = this._settings.get_string('anthropic-api-key');
        if (!apiKey) {
            throw new Error('Anthropic API key is not set');
        }

        const model = this._settings.get_string('anthropic-model');
        const temperature = this._settings.get_double('anthropic-temperature');
        const maxTokens = this._settings.get_int('anthropic-max-tokens');

        // Use centralized message assembly with memory service
        const messages = await this._promptAssembler.assembleMessages(text, relevantToolsPrompt, chatBox, this._memoryService);
        const formattedPrompt = this._promptAssembler.formatForProvider(messages, 'anthropic');

        const requestData = {
            model: model,
            prompt: formattedPrompt,
            max_tokens_to_sample: maxTokens,
            temperature: temperature
        };

        debug(`Making Anthropic request with tool support. Model: ${model}, temp: ${temperature}`);
        debug(`Tool configuration passed via system prompt: ${toolCalls ? toolCalls.length : 0} tools available`);

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
                    // Use shared processing method
                    const processed = this._processToolResponse(response);
                    resolve(processed);
                } catch (error) {
                    reject(`Error parsing Anthropic response: ${error.message}`);
                }
            });
        });
    }

    async _makeOllamaRequest(text, toolCalls, relevantToolsPrompt, chatBox = null) {
        const serverUrl = this._settings.get_string('ollama-server-url');
        if (!serverUrl) {
            throw new Error('Ollama server URL is not set');
        }

        const modelName = this._settings.get_string('ollama-model-name') || 'llama2';
        const temperature = this._settings.get_double('ollama-temperature');

        // Use centralized message assembly with memory service
        const messages = await this._promptAssembler.assembleMessages(text, relevantToolsPrompt, chatBox, this._memoryService);
        const formattedPrompt = this._promptAssembler.formatForProvider(messages, 'ollama');
        
        const requestData = {
            model: modelName,
            prompt: formattedPrompt,
            stream: false,
            options: {
                temperature: temperature
            }
        };

        debug(`Making Ollama request with tool support. Model: ${modelName}, temp: ${temperature}`);
        debug(`Tool configuration passed via system prompt: ${toolCalls ? toolCalls.length : 0} tools available`);
        
        const message = Soup.Message.new('POST', `${serverUrl}/api/generate`);
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

    // Remove the old _assembleMessages method since it's now in PromptAssembler
    // ... existing code ...

    async _getRelevantToolsPrompt(text) {
        // Use semantic search to get relevant tools
        if (!this._memoryService || !this._memoryService._initialized) {
            log('Memory service not available for tool retrieval');
            return '';
        }

        try {
            // Get relevant tools using semantic search
            const relevantTools = await this._memoryService.getRelevantToolDescriptions(text, 5);
            
            log(`[Tools] Semantic search returned ${relevantTools ? relevantTools.length : 0} tools`);
            if (relevantTools && relevantTools.length > 0) {
                log(`[Tools] Semantic tools: ${relevantTools.map(t => `${t.name || t.id || 'unknown'}(${t.description ? t.description.substring(0, 50) : 'no desc'}...)`).join(', ')}`);
            }
            
            if (!relevantTools || relevantTools.length === 0) {
                log('No relevant tools found for query');
                return '';
            }

            // Also do keyword-based matching for better tool selection
            const keywords = text.toLowerCase().split(/\s+/);
            log(`[Tools] Query keywords: ${keywords.join(', ')}`);
            
            const toolKeywords = {
                'web_search': ['search', 'web', 'find', 'look', 'weather', 'news', 'information', 'current', 'latest', 'today', 'tomorrow'],
                'fetch_web_content': ['content', 'article', 'page', 'website', 'url', 'read', 'fetch'],
                'time_date': ['time', 'date', 'clock', 'schedule', 'when', 'now'],
                'file_operations': ['file', 'folder', 'directory', 'save', 'create', 'delete', 'copy'],
                'system_settings': ['volume', 'brightness', 'settings', 'configure', 'adjust'],
                'workspace_management': ['workspace', 'desktop', 'switch', 'window', 'application'],
                'system_context': ['system', 'info', 'status', 'memory', 'cpu', 'processes']
            };

            // Find tools that match keywords
            const keywordMatches = [];
            Object.entries(toolKeywords).forEach(([toolName, toolKeywordsList]) => {
                const matchCount = keywords.filter(keyword => 
                    toolKeywordsList.some(toolKeyword => 
                        keyword.includes(toolKeyword) || toolKeyword.includes(keyword)
                    )
                ).length;
                
                if (matchCount > 0) {
                    keywordMatches.push({ toolName, matchCount });
                    log(`[Tools] Keyword match: ${toolName} (${matchCount} matches)`);
                }
            });

            // Combine semantic and keyword matches
            const allRelevantTools = new Set();
            
            // Add semantically relevant tools
            relevantTools.forEach(tool => {
                const toolName = tool.name || tool.id || 'unknown_tool';
                allRelevantTools.add(toolName);
                log(`[Tools] Added semantic tool: ${toolName}`);
            });
            
            // Add keyword-matched tools (prioritize higher matches)
            keywordMatches
                .sort((a, b) => b.matchCount - a.matchCount)
                .slice(0, 3) // Top 3 keyword matches
                .forEach(match => {
                    allRelevantTools.add(match.toolName);
                    log(`[Tools] Added keyword tool: ${match.toolName}`);
                });

            log(`[Tools] All relevant tools: ${Array.from(allRelevantTools).join(', ')}`);

            // Get tool descriptions for all relevant tools
            const finalToolDescriptions = [];
            
            // Try to get descriptions from semantic search results first
            const semanticToolMap = new Map(relevantTools.map(tool => [tool.name || tool.id, tool]));
            
            for (const toolName of allRelevantTools) {
                if (semanticToolMap.has(toolName)) {
                    // Use semantic search result
                    const tool = semanticToolMap.get(toolName);
                    finalToolDescriptions.push({
                        name: tool.name || toolName,
                        description: tool.description,
                        parameters: tool.parameters || {}
                    });
                    log(`[Tools] Using semantic description for: ${toolName}`);
                } else {
                    // For keyword-matched tools not in semantic results, 
                    // we should have static descriptions available
                    const staticDescriptions = this._getStaticToolDescriptions();
                    if (staticDescriptions[toolName]) {
                        finalToolDescriptions.push(staticDescriptions[toolName]);
                        log(`[Tools] Using static description for: ${toolName}`);
                    } else {
                        log(`[Tools] No description found for: ${toolName}`);
                    }
                }
            }

            if (finalToolDescriptions.length === 0) {
                log('[Tools] No final tool descriptions found');
                return '';
            }

            log(`Selected ${finalToolDescriptions.length} relevant tools: ${finalToolDescriptions.map(t => t.name).join(', ')}`);

            // Create tool descriptions object for the prompt assembler
            return {
                descriptions: finalToolDescriptions,
                metadata: {
                    query: text,
                    semantic_matches: relevantTools.length,
                    keyword_matches: keywordMatches.length,
                    total_tools: finalToolDescriptions.length
                }
            };

        } catch (error) {
            log(`Error getting relevant tools: ${error.message}`);
            return '';
        }
    }

    _getStaticToolDescriptions() {
        // Static tool descriptions as fallback for keyword-matched tools
        return {
            'web_search': {
                name: 'web_search',
                description: 'Search the web for current information, news, weather, or any topic that requires real-time data',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query to find relevant information'
                        }
                    },
                    required: ['query']
                }
            },
            'fetch_web_content': {
                name: 'fetch_web_content',
                description: 'Fetch and extract content from specific web URLs',
                parameters: {
                    type: 'object',
                    properties: {
                        urls: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'URLs to fetch content from'
                        }
                    },
                    required: ['urls']
                }
            },
            'time_date': {
                name: 'time_date',
                description: 'Get current time, date, or perform time-related calculations',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            description: 'Action to perform: current_time, current_date, or calculate'
                        }
                    },
                    required: ['action']
                }
            },
            'system_settings': {
                name: 'system_settings',
                description: 'Adjust system settings like volume, brightness, or other system configurations',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            description: 'Setting to adjust'
                        }
                    },
                    required: ['action']
                }
            }
        };
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
        
        // Add loading state for memory service
        this._isMemoryServiceLoading = true;
        this._memoryServiceInitialized = false;
        
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

        // Create container for chat view
        this._chatContainer = new St.BoxLayout({
            vertical: true,
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
        this._chatContainer.add_child(this._scrollView);

        // Create container for history view
        this._historyContainer = new St.BoxLayout({
            vertical: true,
            y_expand: true
        });

        // Add both containers to main actor
        this.actor.add_child(this._chatContainer);
        this.actor.add_child(this._historyContainer);

        // Initially show chat view, hide history view
        this._chatContainer.visible = true;
        this._historyContainer.visible = false;

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
        
        // Create loading overlay for memory service initialization
        this._loadingOverlay = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-loading-overlay',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        
        const loadingIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 24,
            style_class: 'llm-chat-loading-icon'
        });
        
        const loadingLabel = new St.Label({
            text: 'Setting up LLM Chat...\nInstalling dependencies and initializing memory service.\nThis may take a few minutes on first run.',
            style_class: 'llm-chat-loading-label'
        });
        loadingLabel.clutter_text.line_wrap = true;
        loadingLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        
        this._loadingOverlay.add_child(loadingIcon);
        this._loadingOverlay.add_child(loadingLabel);
        
        // Add overlay on top of everything
        this.actor.add_child(this._loadingOverlay);
        
        // Disable input initially
        this._setInputEnabled(false);
        
        this._adjustWindowHeight(); // Adjust height on creation.

        // Initialize the provider adapter with reference to this chat box
        this._providerAdapter = new ProviderAdapter(settings, this);

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
        
        // Start monitoring memory service initialization
        this._monitorMemoryServiceInitialization();
    }

    _onEntryActivated() {
        // Don't allow sending if memory service is still loading
        if (this._isMemoryServiceLoading) {
            return;
        }
        
        const text = this._entryText.get_text();
        if (text.trim() !== '') {
            this._sendMessage(text);
            this._entryText.set_text('');
        }
    }

    _onSendButtonClicked() {
        // Don't allow sending if memory service is still loading
        if (this._isMemoryServiceLoading) {
            return;
        }
        
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

    async _sendMessage(text) {
        if (!text.trim()) return;

        // Store the user's query for memory processing
        this._lastUserQuery = text;
        
        // Add user message to UI and history
        this._addMessage(text, 'user');

        // Show thinking indicator
        this._addMessage('Thinking...', 'system', true);
        
        try {
            // Get response from provider
            const response = await this._providerAdapter.makeRequest(text);
                    
            // Remove thinking indicator
                        const children = this._messageContainer.get_children();
                        const lastChild = children[children.length - 1];
                        if (lastChild && lastChild._isThinking) {
                            this._messageContainer.remove_child(lastChild);
                    }
                    
            // Process the response
            if (response.toolCalls && response.toolCalls.length > 0) {
                // Handle tool calls
                    this._handleToolCalls(response.toolCalls, response.text);
                } else {
                // No tool calls, just show the text response
                this._addMessage(response.text, 'ai');
                
                // Process memories for the complete exchange
                const fullExchangeText = `User Query: ${text}\n\nAI Response: ${response.text}`;
                const context = {
                    query: text,
                    provider: this._settings.get_string('service-provider'),
                    conversation_history: this._getConversationHistory(),
                    is_complete_exchange: true
                };
                
                // Process the memory asynchronously
                this._providerAdapter._processMessageForMemory(
                    this._sessionId || 'default',
                    text,
                    response.text,
                    this._settings.get_string('service-provider')
                )
                    .then(memories => {
                        if (memories && memories.length > 0) {
                            log(`Processed ${memories.length} memories for the exchange`);
                        }
                    })
                    .catch(error => {
                        log(`Error processing memories: ${error.message}`);
                    });
            }
        } catch (error) {
            // Remove thinking indicator if it exists
                        const children = this._messageContainer.get_children();
                        const lastChild = children[children.length - 1];
                        if (lastChild && lastChild._isThinking) {
                            this._messageContainer.remove_child(lastChild);
                    }
                    
                this._addMessage(`Error: ${error.message}`, 'system');
        }
    }

    _handleToolCalls(toolCalls, originalResponse) {
        // Log tool calls for debugging with more details
        log(`[Tools] Handling ${toolCalls.length} tool calls`);
        
        // Display the original response text first if it exists
        if (originalResponse && originalResponse.trim()) {
            log(`[Tools] Adding initial AI response (${originalResponse.length} chars)`);
            this._addMessage(originalResponse, 'ai');
        }
        
        // Check for tool call limits and loops
        this._toolCallCount++;
        if (this._toolCallCount > this._maxToolCalls) {
            const errorMsg = `Tool call limit exceeded (${this._maxToolCalls} calls). This might indicate a loop in the AI's reasoning. Stopping further tool calls.`;
            log(`[Tools] ${errorMsg}`);
            this._addMessage(errorMsg, 'system');
            this._toolCallCount = 0; // Reset counter
            this._recentToolCalls = []; // Clear recent calls
            
            // Add a final response using the information we have
            const finalResponse = `Based on the information gathered so far, the current time is ${new Date().toLocaleTimeString()}.`;
            this._addMessage(finalResponse, 'ai');
            return;
        }

        // Store and check for repeated tool calls - improve parsing of tool calls
        const currentCall = toolCalls.map(call => {
            // Make sure arguments are properly parsed
            let args;
            try {
                if (typeof call.function.arguments === 'string') {
                    args = JSON.parse(call.function.arguments);
                } else {
                    args = call.function.arguments;
                }
            } catch (e) {
                log(`[Tools] Error parsing tool arguments: ${e.message}`);
                args = call.function.arguments; // Keep as string if parsing fails
            }
            
            return {
                name: call.function.name,
                args: args
            };
        });
        
        // Improved redundancy detection - check for truly redundant calls
        const isRepeatedCall = this._recentToolCalls.some(prevCalls => {
            return currentCall.some(newCall => {
                return prevCalls.some(prevCall => {
                    // Same tool name
                    if (prevCall.name !== newCall.name) return false;
                    
                    // For web_search, check if the query is substantially similar
                    if (newCall.name === 'web_search') {
                        const prevQuery = (prevCall.args.query || '').toLowerCase().trim();
                        const newQuery = (newCall.args.query || '').toLowerCase().trim();
                        
                        // Allow different queries even for same tool
                        if (prevQuery !== newQuery) {
                            // Check for substantial similarity (>80% overlap)
                            const similarity = this._calculateStringSimilarity(prevQuery, newQuery);
                            return similarity > 0.8; // Only flag if very similar
                        }
                        return true; // Exact same query
                    }
                    
                    // For system_settings, allow different actions/values
                    if (newCall.name === 'system_settings') {
                        const prevAction = prevCall.args.action;
                        const newAction = newCall.args.action;
                        const prevValue = prevCall.args.value;
                        const newValue = newCall.args.value;
                        
                        // Different actions are allowed
                        if (prevAction !== newAction) return false;
                        // Same action with different values is allowed
                        if (prevValue !== newValue) return false;
                        
                        return true; // Same action and value
                    }
                    
                    // For fetch_web_content, check URLs
                    if (newCall.name === 'fetch_web_content') {
                        const prevUrls = JSON.stringify(prevCall.args.urls || []);
                        const newUrls = JSON.stringify(newCall.args.urls || []);
                        return prevUrls === newUrls;
                    }
                    
                    // For other tools, do a general comparison
                    return JSON.stringify(prevCall.args) === JSON.stringify(newCall.args);
                });
            });
        });

        if (isRepeatedCall) {
            // Prepare a detailed message about the redundant call for logging
            const currentToolInfo = currentCall[0].name === 'web_search' ? 
                `web_search("${currentCall[0].args.query}")` : 
                `${currentCall[0].name}()`;
            
            // Get similar previous call information
            let similarPrevCall = "";
            this._recentToolCalls.forEach((prevCalls, idx) => {
                prevCalls.forEach(prev => {
                    if (prev.name === currentCall[0].name) {
                        if (prev.name === 'web_search' && prev.args.query) {
                            similarPrevCall = `web_search("${prev.args.query}")`;
                        } else {
                            similarPrevCall = `${prev.name}()`;
                        }
                    }
                });
            });
            
            log(`[Tools] Detected redundant tool call: ${currentToolInfo}, similar to previous call: ${similarPrevCall}. Continuing with synthesis.`);
            
            // Instead of stopping, create a synthesis prompt with existing information
            const synthesisPrompt = `I notice you're trying to gather more information, but I already have sufficient data from previous tool calls to answer the user's question.

PREVIOUS TOOL RESULTS AVAILABLE:
${this._recentToolCalls.map((calls, idx) => {
                calls.map(call => {
                    if (call.name === 'web_search') {
                        return `• Web search for: "${call.args.query}"`;
                    } else if (call.name === 'fetch_web_content') {
                        const urls = Array.isArray(call.args.urls) ? call.args.urls : [call.args.urls];
                        return `• Fetched content from ${urls.length} URL(s)`;
                    } else {
                        return `• ${call.name} executed`;
                    }
                }).join('\n')
            }).join('\n')}

The information gathering phase is complete. Please provide a comprehensive answer to the user's original question using the information that was already collected. Do not make any additional tool calls - synthesize and present the information clearly.

Focus on giving the user a direct, helpful response based on what we've already gathered.`;
            
            // Make a synthesis request instead of stopping
            this._addMessage("I have all the information needed. Let me provide you with a comprehensive answer...", 'assistant', true);
            
            this._providerAdapter.makeRequest(synthesisPrompt, false) // Disable tools for synthesis
                .then(response => {
                    // Remove the temporary message
                    const children = this._messageContainer.get_children();
                    const lastChild = children[children.length - 1];
                    if (lastChild && lastChild._isThinking) {
                        this._messageContainer.remove_child(lastChild);
                    }
                    
                    // Show the synthesis response
                    this._addMessage(response.text || "Based on the information gathered, I can provide you with the answer you're looking for.", 'ai');
                    
                    // Process memories for the complete exchange
                    const fullExchangeText = `User Query: ${this._lastUserQuery}\n\nAI Response: ${response.text}`;
                    const context = {
                        query: this._lastUserQuery,
                        provider: this._settings.get_string('service-provider'),
                        conversation_history: this._getConversationHistory(),
                        tool_history: this._recentToolCalls,
                        is_complete_exchange: true
                    };
                    
                    this._providerAdapter._processMessageForMemory(
                        this._sessionId || 'default',
                        this._lastUserQuery,
                        response.text,
                        this._settings.get_string('service-provider')
                    ).catch(error => {
                        log(`Error processing memories: ${error.message}`);
                    });
                    
                    // Reset counters
                    this._toolCallCount = 0;
                    this._recentToolCalls = [];
                })
                .catch(error => {
                    // Remove the temporary message
                    const children = this._messageContainer.get_children();
                    const lastChild = children[children.length - 1];
                    if (lastChild && lastChild._isThinking) {
                        this._messageContainer.remove_child(lastChild);
                    }
                    
                    this._addMessage(`I encountered an issue while synthesizing the response: ${error.message}`, 'system');
                });
                
            return; // Exit early to prevent further tool processing
        }

        // Add current call to recent calls with proper formatting
        this._recentToolCalls.push(currentCall);
        if (this._recentToolCalls.length > this._maxRecentToolCalls) {
            log(`[Tools] Removing oldest tool call set (keeping last ${this._maxRecentToolCalls})`);
            this._recentToolCalls.shift(); // Remove oldest call
        }

        // Remove the "Thinking..." message if it exists
        const children = this._messageContainer.get_children();
        const lastChild = children[children.length - 1];
        if (lastChild && lastChild._isThinking) {
            this._messageContainer.remove_child(lastChild);
        }

        // Create promises for each tool call
        const toolPromises = toolCalls.map(async call => {
            const toolName = call.function.name;
            let args;
            try {
                args = JSON.parse(call.function.arguments);
            } catch (e) {
                log(`Error parsing tool arguments: ${e.message}`);
                return { toolName, args: call.function.arguments, result: { error: 'Invalid arguments format' } };
            }

            // Find the tool
            const tool = this.tools.find(t => t.name === toolName);
            if (!tool) {
                log(`Tool not found: ${toolName}`);
                return { toolName, args, result: { error: `Tool ${toolName} not found` } };
            }

            try {
                // Execute the tool
                const result = await tool.execute(args);
                
                // For memory tool calls, don't show the result in the UI
                if (toolName === 'add_memory') {
                    log(`Memory tool call executed silently: ${JSON.stringify(result)}`);
                    return { toolName, args, result: { success: true, message: 'Memory added silently' } };
                }
                
                return { toolName, args, result };
            } catch (e) {
                log(`Error executing tool ${toolName}: ${e.message}`);
                return { toolName, args, result: { error: e.message } };
            }
        });

        // Wait for all tool calls to complete
        Promise.all(toolPromises)
            .then(results => {
                log(`All tool calls completed, processing results`);
                
                // Check if all tool calls were memory-related
                const allMemoryCalls = results.every(result => result.toolName === 'add_memory');
                
                // Create a better format for the results that includes tool name and args
                // Also log more details about each result for debugging
                const toolResults = results.map(result => {
                    log(`[Tools] Processing result for ${result.toolName}`);
                    const formattedResult = {
                    name: result.toolName,
                    arguments: result.args,
                    result: result.result
                    };
                    // Log result size for debugging
                    const resultSize = JSON.stringify(result.result).length;
                    log(`[Tools] Result size for ${result.toolName}: ${resultSize} chars`);
                    return formattedResult;
                });

                // If we have tool results and they're not all memory calls, make a follow-up request
                if (toolResults.length > 0 && !allMemoryCalls) {
                    // Show a single, clean summary of tool execution
                    const nonMemoryResults = toolResults.filter(r => r.name !== 'add_memory');
                    if (nonMemoryResults.length > 0) {
                        const summary = nonMemoryResults.map(result => {
                            const status = result.result?.error ? "❌ Failed" : "✅ Success";
                            const args = result.arguments?.query || result.arguments?.url || result.arguments?.action || '';
                            const argsDisplay = args ? ` (${args})` : '';
                            return `${result.name}${argsDisplay}: ${status}`;
                        }).join('\n');
                        this._addMessage(`Tool execution:\n${summary}`, 'system');
                    }
                    
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
                    const followUpPrompt = `I have gathered information using tools. Here are the complete results:

${toolResultsText}

CURRENT TOOL CALL SEQUENCE: ${this._recentToolCalls.map((calls, idx) => 
    `[Set ${idx+1}] ` + calls.map(call => `${call.name}("${JSON.stringify(call.args).substring(0, 40)}...")`).join(", ")
).join(" → ")}

📋 ANALYSIS INSTRUCTIONS:
1. **FIRST**: Review the tool results above - do they contain sufficient information to answer the user's question?
2. **IF YES**: Provide a comprehensive answer using the gathered information. DO NOT make additional tool calls.
3. **IF NO**: Identify what specific information is still missing and make targeted tool calls to gather it.

🔧 WHEN TO MAKE MORE TOOL CALLS:
- The user asked for multiple pieces of information and you only have some of them
- You need to follow up on URLs or references found in the results
- The results indicate you need different tools (e.g., got search results, now need to fetch specific content)
- The user's question has multiple parts that require different tools

🚫 WHEN NOT TO MAKE TOOL CALLS:
- You have sufficient information to answer the user's question
- The tool results already contain the answer, even if not perfectly formatted
- You're just trying to get "better" or "more detailed" information when what you have is adequate
- The user asked a simple question and you have the basic answer

💡 MULTI-STEP EXAMPLE:
- User asks: "What's the weather tomorrow and show me a recipe for pasta"
- Step 1: web_search for weather ✓
- Step 2: web_search for pasta recipe ✓  
- Step 3: Synthesize both results into final answer (NO more tools needed)

🎯 YOUR TASK NOW:
Analyze the tool results above. If they answer the user's question, provide your final response. If you need additional specific information, make targeted tool calls. Be decisive - don't gather information "just in case."`;
                    
                    log(`[Tools] Making follow-up request with tool results and instructions for next steps`);
                    
                    // Add a temporary message
                    this._addMessage("Processing tool results...", 'assistant', true);
                    
                    // Keep tool calling enabled for legitimate multi-step workflows
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
                                    log(`[Tools] Received ${response.toolCalls.length} new, different tool calls. Processing...`);
                                    this._handleToolCalls(response.toolCalls, response.text || originalResponse);
                                } else {
                                    // These are repeated tool calls - break the loop
                                    log(`[Tools] Received ${response.toolCalls.length} repeated tool calls despite warnings. Breaking loop.`);
                                    const errorMsg = "The AI attempted to make repeated tool calls. Stopping to prevent loops and using existing information.";
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
                                
                                // Process memories only for the final response with no tool calls
                                const fullExchangeText = `User Query: ${this._lastUserQuery}\n\nAI Response: ${response.text}`;
                                const context = {
                                    query: this._lastUserQuery,
                                    provider: this._settings.get_string('service-provider'),
                                    conversation_history: this._getConversationHistory(),
                                    is_complete_exchange: true
                                };
                                this._providerAdapter._processMessageForMemory(
                                    this._sessionId || 'default',
                                    this._lastUserQuery,
                                    response.text,
                                    this._settings.get_string('service-provider')
                                ).catch(error => {
                                    log(`Error processing memories: ${error.message}`);
                                });
                                
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
                    // If all tool calls were memory-related or no tool results, just show the original response
                    if (originalResponse) {
                        this._addMessage(originalResponse, 'ai');
                    }
                    
                    // Reset counters
                    this._toolCallCount = 0;
                    this._recentToolCalls = [];
                }
            })
            .catch(error => {
                log(`Failed to execute tool calls: ${error.message}`);
                this._addMessage(`Error executing tool calls: ${error.message}`, 'ai');
            });
    }

    _getConversationHistory() {
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
        
        // Use the smaller of user setting or provider limit, but ensure minimum usability
        const providerLimit = providerLimits[provider] || 4000;
        const MAX_TOKENS = Math.min(userMaxTokens, providerLimit);
        const MIN_TOKENS = Math.max(500, Math.min(1000, MAX_TOKENS * 0.25)); // At least 25% for recent context
        
        // Only log provider details on first use or when settings change
        if (!this._lastProviderConfig || 
            this._lastProviderConfig.provider !== provider || 
            this._lastProviderConfig.maxTokens !== MAX_TOKENS) {
            log(`[Context] Provider: ${provider}, User limit: ${userMaxTokens}, Provider limit: ${providerLimit}, Effective limit: ${MAX_TOKENS}`);
            this._lastProviderConfig = { provider, maxTokens: MAX_TOKENS };
        }
        
        const IMPORTANT_SENDERS = ['user', 'ai']; // Only include user and AI messages, exclude system/tool messages
        const recentMessages = [...this._messages];
        let history = '';
        let tokenCount = 0;
        let omittedCount = 0;
        
        // Keywords to exclude from conversation history
        const excludeKeywords = [
            'opened', 'launched', 'executed', 'tool call', 'browser', 'chrome', 'firefox',
            'youtube', 'website', 'application', 'window', 'tab', 'workspace', 'desktop',
            'search results', 'fetched content', 'web search', 'found information',
            'successfully', 'completed', 'finished', 'already ran', 'previously executed',
            'tool execution', 'processing tool results'
        ];
        
        // Improved token estimation based on provider
        const estimateTokens = (text) => {
            if (!text) return 0;
            
            // More accurate token estimation based on provider
            let ratio;
            switch (provider) {
                case 'openai':
                    // OpenAI tokenization: roughly 1 token per 3.3 characters for English
                    ratio = 3.3;
                    break;
                case 'anthropic':
                    // Claude tokenization: roughly 1 token per 3.5 characters
                    ratio = 3.5;
                    break;
                case 'gemini':
                    // Gemini tokenization: roughly 1 token per 3.8 characters
                    ratio = 3.8;
                    break;
                default:
                    // Conservative estimate for local models
                    ratio = 4.0;
            }
            
            // Account for special tokens, formatting, and overhead
            const baseTokens = Math.ceil(text.length / ratio);
            const overhead = Math.ceil(baseTokens * 0.1); // 10% overhead for formatting
            return baseTokens + overhead;
        };

        // Enhanced message formatting with token-aware truncation and filtering
        const formatMessage = (msg, maxTokensForMessage = null) => {
            if (msg.isThinking && this._settings.get_boolean('hide-thinking')) return '';
            
            // Skip system messages and tool-related messages
            if (!IMPORTANT_SENDERS.includes(msg.sender)) return '';
            
            let content = msg.text || '';
            
            // Skip messages that contain tool/action keywords
            const contentLower = content.toLowerCase();
            if (excludeKeywords.some(keyword => contentLower.includes(keyword))) {
                return '';
            }
            
            // Skip very short messages that are likely just confirmations
            if (content.length < 20) return '';
            
            // Truncate very long messages if needed
            if (maxTokensForMessage && estimateTokens(content) > maxTokensForMessage) {
                const targetChars = Math.floor(maxTokensForMessage * 3.5); // Conservative conversion
                if (content.length > targetChars) {
                    content = content.substring(0, targetChars - 50) + '... [truncated]';
                }
            }
            
            let formatted = '';
            if (msg.sender === 'user') {
                formatted = `User: ${content}\n`;
            } else if (msg.sender === 'ai') {
                formatted = `Assistant: ${content}\n`;
            }
            
            return formatted;
        };

        // Phase 1: Collect and categorize messages by importance
        const criticalMessages = [];    // Must include (recent user queries, AI responses)
        const regularMessages = [];     // Nice to have (older conversation)
        
        // Categorize messages by importance and recency
        for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            const age = recentMessages.length - i - 1;
            
            if (msg.isThinking && this._settings.get_boolean('hide-thinking')) {
                continue; // Skip thinking messages if hidden
            }
            
            // Only include user and AI messages
            if (!IMPORTANT_SENDERS.includes(msg.sender)) {
                continue;
            }
            
            // Critical: Recent user messages and AI responses (last 8 messages)
            if (age < 8) {
                criticalMessages.push(msg);
            }
            // Regular: Everything else
            else {
                regularMessages.push(msg);
            }
        }
        
        // Phase 2: Add messages in order of priority
        let messages = [];
        
        // Always include critical messages (reverse to maintain chronological order)
        criticalMessages.reverse().forEach(msg => {
            const formatted = formatMessage(msg);
            if (formatted) {
                const tokens = estimateTokens(formatted);
                if (tokenCount + tokens <= MAX_TOKENS) {
                    messages.push({ msg, formatted, tokens });
                    tokenCount += tokens;
                }
            }
        });
        
        // Add as many regular messages as possible (newest first)
        regularMessages.forEach(msg => {
            const remainingTokens = MAX_TOKENS - tokenCount;
            if (remainingTokens > MIN_TOKENS) { // Ensure we have minimum space
                const maxForMessage = Math.min(remainingTokens, MAX_TOKENS * 0.1); // Max 10% per message
                const formatted = formatMessage(msg, maxForMessage);
                if (formatted) {
                    const tokens = estimateTokens(formatted);
                    if (tokens <= remainingTokens) {
                        messages.push({ msg, formatted, tokens });
                        tokenCount += tokens;
                    } else {
                        omittedCount++;
                    }
                }
            } else {
                omittedCount++;
            }
        });
        
        // Phase 3: Sort messages chronologically and build history
        messages.sort((a, b) => {
            const aIndex = recentMessages.indexOf(a.msg);
            const bIndex = recentMessages.indexOf(b.msg);
            return aIndex - bIndex;
        });
        
        // Build the final history string
        if (omittedCount > 0) {
            const omissionSummary = `[${omittedCount} older messages omitted to fit context window]\n\n`;
            const omissionTokens = estimateTokens(omissionSummary);
            if (tokenCount + omissionTokens <= MAX_TOKENS) {
                history += omissionSummary;
                tokenCount += omissionTokens;
            }
        }
        
        // Add formatted messages
        messages.forEach(({ formatted }) => {
            history += formatted;
        });
        
        // Phase 4: Final optimization - consolidated logging to reduce spam
        const utilizationPercent = (tokenCount / MAX_TOKENS) * 100;
        
        // Only log context details if there are significant changes or issues
        if (!this._lastTokenCount || Math.abs(tokenCount - this._lastTokenCount) > 500 || 
            utilizationPercent > 90 || utilizationPercent < 40) {
            
            let logMessage = `[Context] ${tokenCount}/${MAX_TOKENS} tokens (${utilizationPercent.toFixed(1)}%), ${messages.length} messages`;
            if (omittedCount > 0) logMessage += `, ${omittedCount} omitted`;
            
            // Add context advice only when needed
            if (utilizationPercent > 90 && omittedCount > 0) {
                logMessage += ` - High utilization, consider increasing max-context-tokens`;
            } else if (utilizationPercent < 40 && omittedCount > 0) {
                logMessage += ` - Low utilization, context window underused`;
            }
            
            log(logMessage);
            this._lastTokenCount = tokenCount;
        }
        
        return history;
    }

    _getRecentToolCallSummary() {
        if (!this._recentToolCalls || this._recentToolCalls.length === 0) {
            return null;
        }

        // Get the last 3 tool call sets (most recent)
        const recentCalls = this._recentToolCalls.slice(-3);
        
        let summary = "RECENT TOOL USAGE (to avoid redundant calls):\n";
        
        recentCalls.forEach((callSet, index) => {
            const callDescriptions = callSet.map(call => {
                if (call.name === 'web_search') {
                    return `web_search: "${call.args.query}"`;
                } else if (call.name === 'fetch_web_content') {
                    const urls = Array.isArray(call.args.urls) ? call.args.urls : [call.args.urls];
                    return `fetch_web_content: ${urls.length} URLs`;
                } else {
                    return `${call.name}: executed`;
                }
            }).join(', ');
            
            summary += `${index + 1}. ${callDescriptions}\n`;
        });
        
        summary += "NOTE: Check if the information you need was already gathered above before making new tool calls.\n\n";
        
        return summary;
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

            // Add the main text with linking support
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
        if (this._historyContainer.visible) {
            return;
        }

        this._currentView = 'history';
        
        this._chatContainer.visible = false;
        this._historyContainer.visible = true;
        this._entryText.visible = false;

        // Create header if it doesn't exist
        if (!this._historyHeader) {
            this._historyHeader = new St.BoxLayout({
                style_class: 'session-history-header',
            vertical: false,
                // Use flex-shrink to keep header fixed
                x_expand: true, // Ensure header stretches horizontally
                // vertical: false is default, so we don't need to specify
        });
        
            // Back button
        const backButton = new St.Button({
            style_class: 'session-history-back-button',
                label: '← Back',
                can_focus: true,
                x_expand: false, // Don't expand horizontally
                y_align: Clutter.ActorAlign.CENTER // Center vertically
        });
            backButton.connect('clicked', () => this._showChatView());
            this._historyHeader.add(backButton);

            // Search entry
            this._historySearchEntry = new St.Entry({
                style_class: 'session-history-search',
                hint_text: 'Search sessions...',
                can_focus: true,
                x_expand: true, // Allow search to expand horizontally
                y_align: Clutter.ActorAlign.CENTER // Center vertically
            });
            // Connect search handler after widget is fully initialized
            // Using 'notify::text' signal for StEntry text changes
            if (this._historySearchEntry && !this._searchHandlerConnected) {
                 this._historySearchEntry.connect('notify::text', () => {
                     const query = this._historySearchEntry.get_text();
                     this._searchSessions(query);
                 });
                 this._searchHandlerConnected = true;
             }
            this._historyHeader.add(this._historySearchEntry);

            this._historyContainer.add(this._historyHeader);
        }

        // Create session scroll view and container if they don't exist
        if (!this._sessionScrollView) {
             this._sessionScrollView = new St.ScrollView({
                 style_class: 'session-history-scrollview',
                 hscrollbar_policy: St.PolicyType.NEVER,
                 vscrollbar_policy: St.PolicyType.AUTOMATIC,
                 overlay_scrollbars: true,
                 y_expand: true, // Allow scroll view to take available vertical space
                 x_expand: true  // Allow scroll view to take available horizontal space
             });

             this._sessionContainer = new St.BoxLayout({
                 style_class: 'session-history-container',
                 vertical: true,
                 x_expand: true // Allow the inner container to expand horizontally
             });
             this._sessionScrollView.add_actor(this._sessionContainer);
             this._historyContainer.add(this._sessionScrollView);
         }

        // Clear existing sessions
        this._sessionContainer.destroy_all_children();
        
        // Load sessions
        this._loadSessions();
    }

    async _loadSessions() {
        try {
            const sessions = await this._sessionManager.listSessions();
            this._displaySessions(sessions);
        } catch (error) {
            log(`Error loading sessions: ${error.message}`);
        }
    }

    async _searchSessions(query) {
        if (!query || query.trim() === '') {
            await this._loadSessions();
            return;
        }

        try {
            const sessions = await this._sessionManager.searchSessions(query);
            this._displaySessions(sessions);
        } catch (error) {
            log(`Error searching sessions: ${error.message}`);
        }
    }

    _displaySessions(sessions) {
        log(`[DEBUG] _displaySessions called with ${sessions.length} sessions.`);
        // Clear existing sessions
        this._sessionContainer.destroy_all_children();
        
        if (sessions.length === 0) {
            log('[DEBUG] No sessions to display.');
            const noSessions = new St.Label({
                text: 'No saved chats',
                style_class: 'session-history-empty'
            });
            this._sessionContainer.add_child(noSessions);
            return;
        }
            
            // Add each session
            sessions.forEach(session => {
            log(`[DEBUG] Displaying session: ${session.id} - ${session.title}`);
                const sessionItem = this._createSessionHistoryItem(session);
            this._sessionContainer.add_child(sessionItem);
        });
         // Force a relayout to ensure UI updates
        this._sessionContainer.queue_relayout();
        if (this._sessionScrollView) {
            this._sessionScrollView.queue_relayout();
        }
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
        
        // Preview text
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
        item.add_child(preview);
        item.add_child(buttonBox);
        
        return item;
    }
    
    // Update _loadSession to switch to chat view after loading
    async _loadSession(sessionId) {
        log(`[DEBUG] _loadSession called for session: ${sessionId}`);
        try {
            const sessionData = await this._sessionManager.loadSession(sessionId);
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

            // Show chat view first
        this._showChatView();

            // Render all messages from the loaded session
            if (sessionData.messages && sessionData.messages.length > 0) {
                log(`Rendering ${sessionData.messages.length} messages from loaded session`);
                sessionData.messages.forEach(message => {
                    this._addMessage(message.text, message.sender, message.isThinking, message.toolResults, false);
                });
            }

            log(`Loaded and rendered session: ${sessionId}`);
        } catch (error) {
            log(`Error loading session: ${error.message}`);
        }
    }

    _onNewChatButtonClicked() {
        this._startNewSession();
            this._showChatView();
    }

    async _startNewSession() {
        // Save current session if it has messages
        if (this._messages.length > 0) {
            await this._saveCurrentSession();
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

    async _saveCurrentSession() {
        if (this._messages.length === 0) return;

        // Generate a title if one doesn't exist
        let sessionTitle = this._sessionTitle;
        if (!sessionTitle && this._messages.length > 0) {
            // Find the first user message to use as title
            const firstUserMessage = this._messages.find(msg => msg.sender === 'user' && msg.text);
            if (firstUserMessage) {
                // Use first 50 characters of the first user message as title
                sessionTitle = firstUserMessage.text.length > 50 
                    ? firstUserMessage.text.substring(0, 47) + '...'
                    : firstUserMessage.text;
                // Set the title for future saves in this session
                this._sessionTitle = sessionTitle;
            } else {
                sessionTitle = 'Untitled Chat';
            }
        }

        const metadata = {
            title: sessionTitle,
            created_at: new Date().toISOString(),
            settings: {
                provider: this._settings.get_string('service-provider'),
                model: this._settings.get_string('openai-model'),
                temperature: this._settings.get_double('openai-temperature')
            }
        };

        try {
            await this._sessionManager.saveSession(this._sessionId, this._messages, metadata);
            log(`Session saved successfully: ${this._sessionId} - "${sessionTitle}"`);
        } catch (error) {
            log(`Error saving session: ${error.message}`);
        }
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

    _showChatView() {
        this._historyContainer.visible = false;
        this._chatContainer.visible = true;
        this._entryText.visible = true;
        this._currentView = 'chat';
    }

    _setInputEnabled(enabled) {
        // For St.Entry, we need to set reactive and can_focus properties
        this._entryText.set_reactive(enabled);
        this._entryText.set_can_focus(enabled);
        
        // Also set editable on the underlying ClutterText
        if (this._entryText.clutter_text) {
            this._entryText.clutter_text.set_editable(enabled);
        }
        
        // Enable/disable all buttons
        const inputBox = this._entryText.get_parent();
        if (inputBox && inputBox.get_children().length > 1) {
            const buttonBox = inputBox.get_children()[1]; // Second child is the button box
            if (buttonBox) {
                buttonBox.get_children().forEach(button => {
                    button.set_reactive(enabled);
                    if (enabled) {
                        button.remove_style_class_name('llm-chat-button-disabled');
                    } else {
                        button.add_style_class_name('llm-chat-button-disabled');
                    }
                });
            }
        }
        
        if (enabled) {
            this._entryText.remove_style_class_name('llm-chat-entry-disabled');
            this._entryText.set_hint_text('Type your message here...');
        } else {
            this._entryText.add_style_class_name('llm-chat-entry-disabled');
            this._entryText.set_hint_text('Please wait while the system initializes...');
        }
    }

    _monitorMemoryServiceInitialization() {
        // Monitor memory service every 500ms
        const checkInterval = 500;
        let attempts = 0;
        const maxAttempts = 600; // 5 minutes timeout
        
        const checkMemoryService = () => {
            attempts++;
            
            // Add debug logging
            log(`[UI Monitor] Attempt ${attempts}: memoryService exists: ${!!memoryService}, initialized: ${memoryService?._initialized}, error: ${!!memoryService?._initializationError}`);
            
            // Check if we have a global memory service and if it's initialized
            if (memoryService && memoryService._initialized) {
                log('[UI Monitor] Memory service detected as initialized, triggering ready callback');
                this._onMemoryServiceReady();
                return false; // Stop the interval
            }
            
            // Check for initialization error
            if (memoryService && memoryService._initializationError) {
                log('[UI Monitor] Memory service error detected, triggering error callback');
                this._onMemoryServiceError(memoryService._initializationError);
                return false; // Stop the interval
            }
            
            // Timeout after maxAttempts
            if (attempts >= maxAttempts) {
                log('[UI Monitor] Timeout reached, triggering timeout error');
                this._onMemoryServiceError(new Error('Memory service initialization timeout'));
                return false; // Stop the interval
            }
            
            // Update loading message based on attempts
            if (attempts % 10 === 0) { // Update every 5 seconds
                const minutes = Math.floor(attempts * checkInterval / 60000);
                if (minutes > 0) {
                    const loadingLabel = this._loadingOverlay.get_children()[1];
                    loadingLabel.text = `Setting up LLM Chat...\nInstalling dependencies and initializing memory service.\nTime elapsed: ${minutes} minute${minutes > 1 ? 's' : ''}`;
                }
            }
            
            return true; // Continue checking
        };
        
        // Start checking
        log('[UI Monitor] Starting memory service monitoring');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, checkInterval, checkMemoryService);
    }

    _onMemoryServiceReady() {
        log('Memory service is ready, enabling UI');
        this._isMemoryServiceLoading = false;
        this._memoryServiceInitialized = true;
        
        // Initialize the provider adapter now that memory service is ready
        if (this._providerAdapter) {
            this._providerAdapter._initializeMemorySystem().then(() => {
                log('ProviderAdapter initialized successfully');
            }).catch(e => {
                log(`Error initializing ProviderAdapter: ${e.message}`);
            });
        }
        
        // Remove loading overlay
        if (this._loadingOverlay) {
            this.actor.remove_child(this._loadingOverlay);
            this._loadingOverlay = null;
        }
        
        // Enable input
        this._setInputEnabled(true);
        
        // Add a welcome message
        this._addMessage('✅ LLM Chat is ready! Dependencies installed and memory service initialized successfully.', 'system');
    }

    _onMemoryServiceError(error) {
        log(`Memory service initialization failed: ${error.message}`);
        this._isMemoryServiceLoading = false;
        this._memoryServiceInitialized = false;
        
        // Update loading overlay to show error
        if (this._loadingOverlay) {
            const loadingLabel = this._loadingOverlay.get_children()[1];
            loadingLabel.text = `❌ Setup failed: ${error.message}\n\nThe system can still work with reduced functionality.\nCheck the logs for more details.`;
            loadingLabel.add_style_class_name('llm-chat-error-label');
            
            // Add a retry button
            const retryButton = new St.Button({
                style_class: 'llm-chat-button',
                label: 'Continue Anyway'
            });
            retryButton.connect('clicked', () => {
                this.actor.remove_child(this._loadingOverlay);
                this._loadingOverlay = null;
                this._setInputEnabled(true);
                this._addMessage('⚠️ LLM Chat started with reduced functionality. Memory service is not available.', 'system');
            });
            
            this._loadingOverlay.add_child(retryButton);
        }
    }

    _initializeMemorySystem() {
        if (this._memoryService) {
            return;
        }

        this._memoryService = new MemoryService();
        
        // Connect to memory service signals
        this._memoryService.connect('server-error', (service, error) => {
            this._showSystemMessage(`Memory system error: ${error.message}`);
        });
        
        this._memoryService.connect('dependency-installation', (service, data) => {
            this._showSystemMessage(`Memory system: ${data.message}`);
        });
        
        this._memoryService.connect('server-ready', () => {
            this._showSystemMessage('Memory system initialized');
        });

        // First check and install dependencies, then initialize the service
        this._memoryService.checkAndInstallDependencies()
            .then(() => {
                // Only initialize after dependencies are installed
                return this._memoryService.initialize();
            })
            .catch(error => {
                this._showSystemMessage(`Failed to initialize memory system: ${error.message}`);
            });
    }

    _showSystemMessage(message) {
        const messageBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8
        });

        const icon = new Gtk.Image({
            icon_name: 'system-run-symbolic',
            pixel_size: 16
        });

        const label = new Gtk.Label({
            label: message,
            wrap: true,
            wrap_mode: Gtk.WrapMode.WORD,
            hexpand: true,
            xalign: 0
        });

        messageBox.append(icon);
        messageBox.append(label);

        this._chatBox.append(messageBox);
        this._scrollToBottom();
    }

    _calculateStringSimilarity(str1, str2) {
        // Simple similarity calculation based on common words
        if (!str1 || !str2) return 0;
        
        const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        
        if (words1.size === 0 && words2.size === 0) return 1;
        if (words1.size === 0 || words2.size === 0) return 0;
        
        const intersection = [...words1].filter(word => words2.has(word));
        const union = new Set([...words1, ...words2]);
        
        return intersection.length / union.size; // Jaccard similarity
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
        this._searchProvider = null;
        this._searchController = null;
        this._searchRegistrationMethod = null;
        this._logLevelChangedId = null;
    }

    enable() {
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.llmchat');
        
        // Set log level based on user preference
        this._setLogLevel();
        
        // Watch for log level changes
        this._logLevelChangedId = this._settings.connect('changed::log-level', () => {
            this._setLogLevel();
        });
        
        info('Extension enabled');
        this._button = new LLMChatButton(this._settings);
        Main.panel.addToStatusArea('llm-chat', this._button);
        
        // Initialize and register the search provider
        this._searchProvider = new LLMSearchProvider(this);
        
        // For GNOME Shell 42, find the correct search provider registration method
        let searchController = null;
        let registrationMethod = null;
        let registrationPath = '';
        
        // Try different paths to find the search controller
        if (Main.overview._overview && Main.overview._overview._controls && Main.overview._overview._controls._searchController) {
            searchController = Main.overview._overview._controls._searchController;
            registrationPath = 'Main.overview._overview._controls._searchController';
        } else if (Main.overview.searchController) {
            searchController = Main.overview.searchController;
            registrationPath = 'Main.overview.searchController';
        } else if (Main.overview._searchController) {
            searchController = Main.overview._searchController;
            registrationPath = 'Main.overview._searchController';
        } else if (Main.overview.viewSelector && Main.overview.viewSelector._searchResults) {
            searchController = Main.overview.viewSelector._searchResults;
            registrationPath = 'Main.overview.viewSelector._searchResults';
        }
        
        if (searchController) {
            info(`[Search Provider] Found search controller at: ${registrationPath}`);
            
            // Try different registration methods
            if (typeof searchController.addProvider === 'function') {
                searchController.addProvider(this._searchProvider);
                registrationMethod = 'addProvider';
            } else if (typeof searchController._addProvider === 'function') {
                searchController._addProvider(this._searchProvider);
                registrationMethod = '_addProvider';
            } else if (searchController._searchResults && typeof searchController._searchResults.addProvider === 'function') {
                searchController._searchResults.addProvider(this._searchProvider);
                registrationMethod = '_searchResults.addProvider';
            } else if (searchController._searchResults && typeof searchController._searchResults._registerProvider === 'function') {
                searchController._searchResults._registerProvider(this._searchProvider);
                registrationMethod = '_searchResults._registerProvider';
            } else if (typeof searchController.registerProvider === 'function') {
                searchController.registerProvider(this._searchProvider);
                registrationMethod = 'registerProvider';
            } else if (typeof searchController._registerProvider === 'function') {
                searchController._registerProvider(this._searchProvider);
                registrationMethod = '_registerProvider';
            }
            
            if (registrationMethod) {
                info(`[Search Provider] LLM Search Provider registered successfully using ${registrationMethod} on ${registrationPath}`);
                this._searchRegistrationMethod = registrationMethod;
                this._searchController = searchController;
                
                // Test if the provider is working by calling a method
                try {
                    this._searchProvider.getInitialSearchResults(['test'], (results) => {
                        info(`[Search Provider] Test call successful, got ${results.length} results`);
                    });
                } catch (e) {
                    warn(`[Search Provider] Test call failed: ${e.message}`);
                }
            } else {
                // Log available methods for debugging
                const methods = Object.getOwnPropertyNames(searchController)
                    .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(searchController)))
                    .filter(name => typeof searchController[name] === 'function')
                    .filter((name, index, self) => self.indexOf(name) === index)
                    .sort();
                warn(`[Search Provider] Could not find registration method. Available methods: ${methods.join(', ')}`);
                
                // Also check nested objects
                if (searchController._searchResults) {
                    const nestedMethods = Object.getOwnPropertyNames(searchController._searchResults)
                        .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(searchController._searchResults)))
                        .filter(name => typeof searchController._searchResults[name] === 'function')
                        .filter((name, index, self) => self.indexOf(name) === index)
                        .sort();
                    warn(`[Search Provider] _searchResults methods: ${nestedMethods.join(', ')}`);
                }
            }
        } else {
            warn('[Search Provider] Could not find search controller - search provider not registered');
            
            // Debug: Log what's available on Main.overview
            const overviewProps = Object.getOwnPropertyNames(Main.overview);
            warn(`[Search Provider] Available Main.overview properties: ${overviewProps.join(', ')}`);
        }
        
        // Clear any existing session when the extension is enabled
        if (this._button._chatBox) {
            this._button._chatBox.clearSession();
        }
    }

    _setLogLevel() {
        const logLevelString = this._settings.get_string('log-level');
        let logLevel;
        
        switch (logLevelString) {
            case 'error':
                logLevel = Logger.LogLevel.ERROR;
                break;
            case 'warn':
                logLevel = Logger.LogLevel.WARN;
                break;
            case 'info':
                logLevel = Logger.LogLevel.INFO;
                break;
            case 'debug':
                logLevel = Logger.LogLevel.DEBUG;
                break;
            default:
                logLevel = Logger.LogLevel.INFO; // Default fallback
        }
        
        Logger.setLogLevel(logLevel);
        debug(`Log level set to: ${logLevelString.toUpperCase()}`);
    }

    disable() {
        // Unregister the search provider first
        if (this._searchProvider && this._searchController && this._searchRegistrationMethod) {
            try {
                // Use the stored registration method to determine unregistration method
                if (this._searchRegistrationMethod === 'addProvider' && typeof this._searchController.removeProvider === 'function') {
                    this._searchController.removeProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered with removeProvider');
                } else if (this._searchRegistrationMethod === '_addProvider' && typeof this._searchController._removeProvider === 'function') {
                    this._searchController._removeProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered with _removeProvider');
                } else if (this._searchRegistrationMethod === '_searchResults.addProvider' && this._searchController._searchResults && typeof this._searchController._searchResults.removeProvider === 'function') {
                    this._searchController._searchResults.removeProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered via _searchResults.removeProvider');
                } else if (this._searchRegistrationMethod === '_searchResults._registerProvider' && this._searchController._searchResults && typeof this._searchController._searchResults._unregisterProvider === 'function') {
                    this._searchController._searchResults._unregisterProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered via _searchResults._unregisterProvider');
                } else if (this._searchRegistrationMethod === 'registerProvider' && typeof this._searchController.unregisterProvider === 'function') {
                    this._searchController.unregisterProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered with unregisterProvider');
                } else if (this._searchRegistrationMethod === '_registerProvider' && typeof this._searchController._unregisterProvider === 'function') {
                    this._searchController._unregisterProvider(this._searchProvider);
                    info('[Search Provider] LLM Search Provider unregistered with _unregisterProvider');
                } else {
                    warn(`[Search Provider] Could not find unregistration method for ${this._searchRegistrationMethod}`);
                }
            } catch (e) {
                warn(`[Search Provider] Error during unregistration: ${e.message}`);
            }
            
            this._searchProvider = null;
            this._searchController = null;
            this._searchRegistrationMethod = null;
        }
        
        // Disconnect settings signals
        if (this._logLevelChangedId) {
            this._settings.disconnect(this._logLevelChangedId);
            this._logLevelChangedId = null;
        }
        
        // Clean up the button and chat box
        if (this._button) {
            if (this._button._chatBox) {
                this._button._chatBox.destroy();
            }
            this._button.destroy();
            this._button = null;
        }
        
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
        
        info('Extension disabled');
    }
}

function init() {
    return new Extension();
}
