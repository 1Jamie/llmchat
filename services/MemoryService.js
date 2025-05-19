'use strict';

const { GObject, Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const Soup = imports.gi.Soup;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Import ToolLoader
const { ToolLoader } = Me.imports.utils.ToolLoader;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Initialize tool loader
const toolLoader = new ToolLoader();
toolLoader.loadTools();

/**
 * MemoryService - A RAG system for storing and retrieving tool descriptions 
 * using semantic search with sentence transformers
 */
var MemoryService = GObject.registerClass({
    GTypeName: 'LLMChatMemoryService',
}, class MemoryService extends GObject.Object {
    static instance = null;
    static serverProcess = null;
    static initializationPromise = null;
    static isInitializing = false;

    static getInstance() {
        if (!MemoryService.instance) {
            MemoryService.instance = new MemoryService();
        }
        return MemoryService.instance;
    }

    _init() {
        super._init();
        
        // Initialize properties
        this._initialized = false;
        this._initializationError = null;
        this._serverUrl = null;
        this._serverPort = null;
        this._serverProcess = null;
        this._toolDescriptions = [];
        this._indexedDescriptions = null;
        this._httpSession = new Soup.Session();
        
        // Create logs directory
        this._createLogsDirectory();
        
        // Only start initialization if not already initializing and not initialized
        if (!MemoryService.isInitializing && !this._initialized) {
            MemoryService.isInitializing = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                this._startInitialization().catch(e => {
                    log(`Error during initialization: ${e.message}`);
                    this._initializationError = e;
                }).finally(() => {
                    MemoryService.isInitializing = false;
                });
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async _startInitialization() {
        // If already initialized, return immediately
        if (this._initialized) {
            log('Memory service already initialized');
            return;
        }

        // If there's an initialization error, throw it
        if (this._initializationError) {
            throw this._initializationError;
        }

        // If another initialization is in progress, wait for it
        if (MemoryService.isInitializing && MemoryService.initializationPromise) {
            log('Waiting for existing initialization to complete');
            return MemoryService.initializationPromise;
        }

        // Create a new initialization promise
        MemoryService.initializationPromise = (async () => {
            try {
                // Find Python path asynchronously
                const pythonPath = await this._findPythonPath();
                if (!pythonPath) {
                    throw new Error('Python 3 not found');
                }
                log(`Found Python at: ${pythonPath}`);
                this._pythonPath = pythonPath;
                
                // Check prerequisites asynchronously
                await this._checkPrerequisites();
                
                // Start server asynchronously
                await this._startServer();
                
                // Load tools asynchronously
                await this._loadTools();
                
                this._initialized = true;
                log('Memory service initialized successfully');
            } catch (e) {
                log(`Error in _startInitialization: ${e.message}`);
                this._initializationError = e;
                throw e;
            }
        })();

        return MemoryService.initializationPromise;
    }

    async _findPythonPath() {
        return new Promise((resolve) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                const paths = [
                    '/usr/bin/python3',
                    '/usr/local/bin/python3',
                    '/opt/homebrew/bin/python3',
                    '/usr/bin/python'
                ];
                
                for (const path of paths) {
                    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                        resolve(path);
                        return GLib.SOURCE_REMOVE;
                    }
                }
                
                resolve(null);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async _startServer() {
        if (this._serverProcess) {
            log('Server already running');
            return;
        }

        return new Promise((resolve, reject) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                try {
                    const serverScript = this._getServerScript();
                    const launcher = new Gio.SubprocessLauncher({
                        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    });
                    
                    this._serverProcess = launcher.spawnv([this._pythonPath, serverScript]);
                    
                    // Set up output monitoring
                    const stdout = this._serverProcess.get_stdout_pipe();
                    const stderr = this._serverProcess.get_stderr_pipe();
                    
                    let serverUrlFound = false;
                    let modelLoaded = false;
                    
                    if (stdout) {
                        const stdoutStream = new Gio.DataInputStream({
                            base_stream: stdout,
                            close_base_stream: true
                        });
                        
                        const readLine = () => {
                            stdoutStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                                try {
                                    const [line] = stream.read_line_finish(res);
                                    if (line) {
                                        log(`Server output: ${line}`);
                                        //convert to string
                                        let strLine = line.toString();
                                        // Check for server URL
                                        if (strLine.indexOf('Running on http://127.0.0.1:') !== -1) {
                                            serverUrlFound = true;
                                            // Extract the port number and set the server URL
                                            const portMatch = strLine.match(/Running on http:\/\/127\.0\.0\.1:(\d+)/);
                                            if (portMatch && portMatch[1]) {
                                                this._serverPort = portMatch[1];
                                                this._serverUrl = `http://127.0.0.1:${this._serverPort}`;
                                                log(`Server URL set to: ${this._serverUrl}`);
                                            }
                                            log('Server URL found');
                                        }
                                        
                                        // Check for model loaded message using indexOf
                                        if (strLine.indexOf('Model loaded successfully') !== -1) {
                                            modelLoaded = true;
                                            log('Model loaded successfully');
                                            
                                            // Only resolve if both conditions are met
                                            if (serverUrlFound && modelLoaded) {
                                                log('Server fully initialized, loading tools...');
                                                this._loadTools().then(() => {
                                                    log('Tools loaded successfully');
                                                    resolve();
                                                }).catch(error => {
                                                    log(`Error loading tools: ${error.message}`);
                                                    reject(error);
                                                });
                                            }
                                        }
                                        
                                        // Continue reading output
                                        readLine();
                                    }
                                } catch (e) {
                                    log(`Error reading stdout: ${e.message}`);
                                }
                            });
                        };
                        
                        readLine();
                    }
                    
                    if (stderr) {
                        const stderrStream = new Gio.DataInputStream({
                            base_stream: stderr,
                            close_base_stream: true
                        });
                        
                        const readError = () => {
                            stderrStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                                try {
                                    const [line] = stream.read_line_finish(res);
                                    if (line) {
                                        log(`Server error: ${line}`);
                                        readError();
                                    }
                                } catch (e) {
                                    log(`Error reading stderr: ${e.message}`);
                                }
                            });
                        };
                        
                        readError();
                    }
                    
                    // Check if process exited
                    this._serverProcess.wait_async(null, (proc, res) => {
                        try {
                            const exitStatus = proc.wait_finish(res);
                            if (exitStatus !== 0) {
                                reject(new Error(`Server process exited with status ${exitStatus}`));
                            }
                        } catch (e) {
                            reject(new Error(`Error waiting for server process: ${e.message}`));
                        }
                    });
                } catch (e) {
                    reject(new Error(`Failed to start server: ${e.message}`));
                }
                
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async _checkPrerequisites() {
        try {
            // Check if Python is available at the specified path
            const pythonCheck = GLib.spawn_command_line_sync(`${this._pythonPath} --version`);
            this._pythonAvailable = pythonCheck[0] && pythonCheck[3] === 0;
            
            if (this._pythonAvailable) {
                log(`Python 3 is available at ${this._pythonPath}. Checking for sentence-transformers...`);
                
                // Check if sentence-transformers is installed using the absolute path
                const [sentenceTransformersCheck, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                    `${this._pythonPath} -c "import sentence_transformers; print('OK')"`
                );
                
                this._modelLoaded = sentenceTransformersCheck && 
                                   ByteArray.toString(stdout).trim() === 'OK' && 
                                   exitCode === 0;
                
                if (!this._modelLoaded) {
                    log('sentence-transformers not installed. Will attempt to install...');
                } else {
                    log('sentence-transformers is installed.');
                }
            } else {
                throw new Error(`Python 3 is not available at ${this._pythonPath}`);
            }
        } catch (e) {
            logError(e, `Error checking prerequisites: ${e.message}`);
            throw e;
        }
    }

    async _startServerWithPortFallback() {
        const maxPortAttempts = 5;
        let currentPort = this._serverPort;
        
        for (let attempt = 0; attempt < maxPortAttempts; attempt++) {
            try {
                this._serverPort = currentPort;
                this._serverUrl = `http://localhost:${this._serverPort}`;
                await this._startServer();
                return; // Success
            } catch (error) {
                if (error.message.includes('Port') && error.message.includes('in use')) {
                    log(`Port ${currentPort} is in use, trying next port...`);
                    currentPort++;
                    continue;
                }
                throw error; // Other errors should be propagated
            }
        }
        
        throw new Error(`Failed to start server after trying ${maxPortAttempts} ports`);
    }

    async _loadTools() {
        try {
            log('Loading tools for memory service...');
            const tools = toolLoader.getTools();
            if (!tools || tools.length === 0) {
                throw new Error('No tools available to load');
            }

            // Fetch already indexed tool names and their details
            const indexedNames = await this.getIndexedToolNames();
            // Also fetch current indexed tool details for comparison
            const currentIndexed = await this._getIndexedToolDetails();
            
            // Store the tool descriptions for later matching
            this._toolDescriptions = tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                category: tool.category || 'general',
                parameters: tool.parameters
            }));
            
            log(`Loaded ${this._toolDescriptions.length} tool descriptions into memory`);
            
            // Only index tools that are new or have changed
            const formattedDescriptions = this._toolDescriptions.filter(tool => {
                if (!indexedNames.has(tool.name)) return true;
                // Compare description and parameters
                const indexed = currentIndexed[tool.name];
                if (!indexed) return true;
                return indexed.description !== tool.description || JSON.stringify(indexed.parameters) !== JSON.stringify(tool.parameters);
            }).map(tool => ({
                id: tool.name,
                text: `${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
            }));

            if (formattedDescriptions.length > 0) {
                await this._indexDescriptions(formattedDescriptions, 'tools');
                log(`Indexed/updated ${formattedDescriptions.length} tool descriptions into memory system`);
            } else {
                log('No new or changed tools to index.');
            }
        } catch (error) {
            log(`Error loading tools: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch all indexed tool details (name, description, parameters) from the 'tools' namespace
     * @returns {Promise<Object>} Map of tool name to {description, parameters}
     */
    async _getIndexedToolDetails() {
        if (!this._modelLoaded) {
            log('Server not running, cannot fetch indexed tool details');
            return {};
        }
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                const payload = JSON.stringify({
                    query: '',
                    top_k: 1000,
                    namespaces: ['tools']
                });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            const details = {};
                            response.results.forEach(result => {
                                const toolMatch = result.text.match(/^([^:]+):(.+?)\nParameters: (\{.*\})/s);
                                if (toolMatch) {
                                    const name = toolMatch[1].trim();
                                    const description = toolMatch[2].trim();
                                    let parameters = {};
                                    try {
                                        parameters = JSON.parse(toolMatch[3]);
                                    } catch {}
                                    details[name] = { description, parameters };
                                }
                            });
                            resolve(details);
                        } catch (e) {
                            log(`Error parsing tool details: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Failed to fetch tool details: ${msg.status_code}`);
                        reject(new Error(`Failed to fetch tool details: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error in _getIndexedToolDetails: ${e.message}`);
                reject(e);
            }
        });
    }

    async loadToolDescriptions(tools) {
        if (!this._modelLoaded) {
            log('Server not running, cannot load tool descriptions');
            return;
        }
        // Fetch already indexed tool names and their details
        const indexedNames = await this.getIndexedToolNames();
        const currentIndexed = await this._getIndexedToolDetails();
        // Only index tools that are new or have changed
        const descriptions = tools.filter(tool => {
            if (!indexedNames.has(tool.name)) return true;
            const indexed = currentIndexed[tool.name];
            if (!indexed) return true;
            return indexed.description !== tool.description || JSON.stringify(indexed.parameters) !== JSON.stringify(tool.parameters);
        }).map(tool => ({
            id: tool.name,
            text: `${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
        }));
        if (descriptions.length === 0) {
            log('No new or changed tools to index.');
            return;
        }
        // Index tool descriptions in the 'tools' namespace
        const message = Soup.Message.new('POST', `${this._serverUrl}/index`);
        message.request_headers.append('Content-Type', 'application/json');
        const payload = JSON.stringify({
            namespace: 'tools',
            documents: descriptions
        });
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
        return new Promise((resolve, reject) => {
            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code === 200) {
                    try {
                        const response = JSON.parse(msg.response_body.data);
                        log(`Indexed/updated ${descriptions.length} tool descriptions`);
                        this._toolDescriptions = tools;
                        resolve(response);
                    } catch (e) {
                        log(`Error parsing tool indexing response: ${e.message}`);
                        reject(e);
                    }
                } else {
                    log(`Failed to index tool descriptions: ${msg.status_code}`);
                    reject(new Error(`Failed to index tool descriptions: ${msg.status_code}`));
                }
            });
        });
    }

    /**
     * Create logs directory for the embedding server
     */
    _createLogsDirectory() {
        try {
            const logsDir = GLib.build_filenamev([Me.path, 'logs']);
            const logsFile = Gio.File.new_for_path(logsDir);
            
            if (!logsFile.query_exists(null)) {
                log(`Creating logs directory at: ${logsDir}`);
                logsFile.make_directory_with_parents(null);
            }
        } catch (e) {
            log(`Error creating logs directory: ${e.message}`);
        }
    }

    /**
     * Index tool descriptions in the embedding server
     * @param {Array} descriptions - Array of formatted tool descriptions
     * @param {string} namespace - The namespace to index into
     */
    _indexDescriptions(descriptions, namespace) {
        return new Promise((resolve, reject) => {
            try {
                if (!this._serverUrl) {
                    reject(new Error('Server URL not set'));
                    return;
                }

                const message = Soup.Message.new('POST', `${this._serverUrl}/index`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({ 
                    documents: descriptions,
                    namespace: namespace
                });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Indexed ${response.count} descriptions in namespace ${namespace}`);
                            this._indexedDescriptions = response;
                            resolve(response);
                        } catch (e) {
                            log(`Error parsing indexing response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Indexing failed: ${msg.status_code}`);
                        reject(new Error(`Indexing failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error indexing descriptions: ${e.message}`);
                reject(e);
            }
        });
    }

    /**
     * Retrieve relevant tool descriptions for a query
     * @param {string} query - The user query
     * @param {number} top_k - Number of results to return
     * @returns {Promise} Promise that resolves to relevant tool descriptions
     */
    async getRelevantToolDescriptions(query, top_k = 3) {
        if (!this._modelLoaded) {
            log('Server not running, cannot retrieve tool descriptions');
            return { descriptions: [], raw_prompt: '', functions: [] };
        }

        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({
                    query,
                    top_k,
                    namespaces: ['tools']  // Only search in tools namespace
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Search response: ${JSON.stringify(response)}`);
                            
                            // Find the corresponding tool descriptions
                            const relevantDescriptions = response.results.map(result => {
                                // Extract tool name from the result text
                                const toolMatch = result.text.match(/^([^:]+):/);
                                const toolName = toolMatch ? toolMatch[1].trim() : result.id;
                                
                                // Find the tool in our loaded tools
                                const toolDescription = this._toolDescriptions.find(t => t.name === toolName);
                                if (!toolDescription) {
                                    log(`Warning: Could not find tool description for ${toolName}`);
                                }
                                return toolDescription || null;
                            }).filter(Boolean);
                            
                            log(`Found ${relevantDescriptions.length} relevant tools`);
                            
                            // Build the raw prompt
                            const rawPrompt = `You are a helpful assistant. Available tools:\n\n${relevantDescriptions.map(tool => {
                                let prompt = `${tool.name}: ${tool.description}\n`;
                                if (tool.parameters) {
                                    prompt += 'Parameters:\n';
                                    Object.entries(tool.parameters).forEach(([name, param]) => {
                                        prompt += `  ${name}: ${param.description}\n`;
                                        if (param.enum) {
                                            prompt += `    Allowed values: ${param.enum.join(', ')}\n`;
                                        }
                                    });
                                }
                                return prompt;
                            }).join('\n')}\n\n` +
`When you need to use a tool, respond with ONLY a JSON object in this format:\n` +
`{"tool": "tool_name", "arguments": {"param1": "value1", ...}}\n` +
`Do NOT include any thoughts, reasoning, or extra text. If no tool is needed, respond conversationally.\n` +
`\nExample:\n` +
`{"tool": "file_operations", "arguments": {"action": "list", "path": "/home/username/Documents"}}\n`;
                            
                            // Developer note: The LLM must respond with a single JSON object as above for tool calls.
                            resolve({
                                descriptions: relevantDescriptions,
                                raw_prompt: rawPrompt,
                                functions: relevantDescriptions
                            });
                        } catch (e) {
                            log(`Error parsing search response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Search request failed with status: ${msg.status_code}`);
                        reject(new Error(`Search request failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error in getRelevantToolDescriptions: ${e.message}`);
                reject(e);
            }
        });
    }

    /**
     * Get the Python script content for the embedding server
     * @returns {string} The Python script content
     */
    _getServerScript() {
        const extensionDir = Me.path;
        const serverScript = Gio.File.new_for_path(`${extensionDir}/services/embedding_server.py`);
        
        if (!serverScript.query_exists(null)) {
            log(`Server script not found at: ${serverScript.get_path()}`);
            return null;
        }
        
        return serverScript.get_path();
    }

    async waitForInitialization() {
        if (this._initialized) {
            return Promise.resolve();
        }

        if (this._initializationError) {
            return Promise.reject(this._initializationError);
        }

        // Wait for initialization to complete
        return new Promise((resolve, reject) => {
            const checkInitialization = () => {
                if (this._initialized) {
                    resolve();
                } else if (this._initializationError) {
                    reject(this._initializationError);
                } else {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, checkInitialization);
                }
            };
            checkInitialization();
        });
    }

    async indexMemory(memory) {
        if (!this._modelLoaded) {
            log('Server not running, cannot index memory');
            return;
        }

        try {
            // Format memory for indexing with better structure
            const memoryDoc = {
                id: memory.id || Date.now().toString(),
                text: memory.text,
                context: {
                    timestamp: new Date().toISOString(),
                    conversation_id: memory.context?.conversation_id || 'default',
                    response: memory.context?.response || '',
                    relevant_memories: memory.context?.relevant_memories || [],
                    tool_results: memory.context?.tool_results || [],
                    metadata: {
                        type: memory.context?.type || 'conversation',
                        importance: memory.context?.importance || 'normal',
                        tags: memory.context?.tags || []
                    }
                }
            };

            // Index memory in the 'memories' namespace
            const message = Soup.Message.new('POST', `${this._serverUrl}/index`);
            message.request_headers.append('Content-Type', 'application/json');
            
            const payload = JSON.stringify({
                namespace: 'memories',
                documents: [memoryDoc]
            });
            
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
            
            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Successfully indexed memory in namespace 'memories'`);
                            resolve(response);
                        } catch (e) {
                            log(`Error parsing memory indexing response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Failed to index memory: ${msg.status_code}`);
                        reject(new Error(`Failed to index memory: ${msg.status_code}`));
                    }
                });
            });
        } catch (e) {
            log(`Error in indexMemory: ${e.message}`);
            throw e;
        }
    }

    async getRelevantMemories(query, top_k = 3) {
        if (!this._modelLoaded) {
            log('Server not running, cannot retrieve memories');
            return [];
        }

        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({
                    query,
                    top_k,
                    namespaces: ['memories'],
                    min_score: 0.1  // Lower threshold for better recall
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Found ${response.results.length} relevant memories`);
                            
                            // Format memories for better context
                            const formattedMemories = response.results.map(memory => {
                                // Ensure we have a valid context object
                                const context = memory.context || {
                                    timestamp: new Date().toISOString(),
                                    conversation_id: 'default',
                                    response: '',
                                    relevant_memories: [],
                                    tool_results: [],
                                    metadata: {
                                        type: 'conversation',
                                        importance: 'normal',
                                        tags: []
                                    }
                                };
                                
                                return {
                                    id: memory.id,
                                    text: memory.text,
                                    score: memory.score,
                                    context: context,
                                    relevance: this._calculateRelevance(memory.score, context)
                                };
                            });
                            
                            resolve(formattedMemories);
                        } catch (e) {
                            log(`Error parsing memory search response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Memory search request failed with status: ${msg.status_code}`);
                        reject(new Error(`Memory search request failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error in getRelevantMemories: ${e.message}`);
                reject(e);
            }
        });
    }

    _calculateRelevance(score, context) {
        // Calculate relevance based on score and context
        let relevance = score;
        
        // Boost relevance for recent memories
        if (context.timestamp) {
            const age = Date.now() - new Date(context.timestamp).getTime();
            const ageInDays = age / (1000 * 60 * 60 * 24);
            if (ageInDays < 1) relevance *= 1.2;  // 20% boost for memories less than a day old
        }
        
        // Boost relevance for important memories
        if (context.metadata?.importance === 'high') {
            relevance *= 1.3;  // 30% boost for high importance memories
        }
        
        return Math.min(relevance, 1.0);  // Cap at 1.0
    }

    async clearNamespace(namespace) {
        if (!this._modelLoaded) {
            log('Server not running, cannot clear namespace');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/clear`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({ namespace });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Successfully cleared namespace: ${namespace}`);
                            resolve(response);
                        } catch (e) {
                            log(`Error parsing clear namespace response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Clear namespace request failed with status: ${msg.status_code}`);
                        reject(new Error(`Clear namespace request failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error in clearNamespace: ${e.message}`);
                reject(e);
            }
        });
    }

    /**
     * Fetch all tool IDs/names currently indexed in the 'tools' namespace
     * @returns {Promise<Set<string>>} Set of tool names
     */
    async getIndexedToolNames() {
        if (!this._modelLoaded) {
            log('Server not running, cannot fetch indexed tool names');
            return new Set();
        }
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                const payload = JSON.stringify({
                    query: '',
                    top_k: 1000, // Large number to get all tools
                    namespaces: ['tools']
                });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            const names = new Set(
                                response.results.map(result => {
                                    const toolMatch = result.text.match(/^([^:]+):/);
                                    return toolMatch ? toolMatch[1].trim() : result.id;
                                })
                            );
                            resolve(names);
                        } catch (e) {
                            log(`Error parsing tool names: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        log(`Failed to fetch tool names: ${msg.status_code}`);
                        reject(new Error(`Failed to fetch tool names: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                log(`Error in getIndexedToolNames: ${e.message}`);
                reject(e);
            }
        });
    }
}); 