'use strict';

const { GObject, Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const Soup = imports.gi.Soup;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Import improved Logger
const { Logger } = Me.imports.utils.Logger;
const { debug, info, warn, error, log } = Logger;

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
    static initializationListeners = new Set();

    static getInstance() {
        if (!MemoryService.instance) {
            MemoryService.instance = new MemoryService();
        }
        return MemoryService.instance;
    }

    _init() {
        super._init();
        this._initialized = false;
        this._initializationError = null;
        this._serverProcess = null;
        this._serverUrl = null;
        this._serverPort = 5000;
        this._modelLoaded = false;
        this._pythonPath = null;
        this._venvPath = null;
        this._venvPythonPath = null;
        this._venvPipPath = null;
        this._toolDescriptions = [];
        this._indexedDescriptions = null;
        this._httpSession = new Soup.Session();
        
        // Create logs directory
        this._createLogsDirectory();
        
        // Watch for reindex trigger
        this._settings = ExtensionUtils.getSettings();
        this._reindexId = this._settings.connect('changed::trigger-reindex', () => {
            if (this._settings.get_boolean('trigger-reindex')) {
                this._handleReindexTrigger();
            }
        });
    }

    async initialize() {
        // If already initialized successfully, return immediately
        if (this._initialized) {
            return Promise.resolve();
        }

        // If there's a previous initialization error, clear it
        if (this._initializationError) {
            this._initializationError = null;
        }

        // If already initializing, wait for the existing initialization
        if (MemoryService.isInitializing && MemoryService.initializationPromise) {
            return MemoryService.initializationPromise;
        }

        // Start new initialization
        MemoryService.isInitializing = true;
        MemoryService.initializationPromise = this._startInitialization()
            .then(() => {
                this._initialized = true;
                // Notify all listeners
                MemoryService.initializationListeners.forEach(listener => {
                    try {
                        listener();
                    } catch (e) {
                        log(`Error in initialization listener: ${e.message}`);
                    }
                });
                MemoryService.initializationListeners.clear();
            })
            .catch(error => {
                this._initializationError = error;
                throw error;
            })
            .finally(() => {
                MemoryService.isInitializing = false;
                MemoryService.initializationPromise = null;
            });

        return MemoryService.initializationPromise;
    }

    addInitializationListener(listener) {
        if (this._initialized) {
            listener();
        } else {
            MemoryService.initializationListeners.add(listener);
        }
    }

    removeInitializationListener(listener) {
        MemoryService.initializationListeners.delete(listener);
    }

    async _startInitialization() {
        try {
            // Find Python path
                const pythonPath = await this._findPythonPath();
                if (!pythonPath) {
                throw new Error('Python not found');
                }
                this._pythonPath = pythonPath;
            log(`Found Python at: ${pythonPath}`);
            
            // Create and activate virtual environment
            await this._setupVirtualEnv();
            
            // Install dependencies
            await this._installDependencies();
            
            // Start server only after dependencies are installed
                await this._startServer();
                
            // Don't set _initialized here - it's set in _waitForServer when health check passes
            log('Server startup process completed');
            
        } catch (error) {
            log(`Error in _startInitialization: ${error.message}`);
            this._initializationError = error;
            this.emit('server-error', { message: error.message });
            throw error;
        }
    }

    async _installDependencies() {
        try {
            // Install dependencies one by one with specific order and error handling
            const dependencies = [
                { name: 'numpy', version: 'numpy>=1.21.6,<1.28.0', timeout: 120000, required: true },
                { name: 'flask', version: 'flask>=2.0.1', timeout: 60000, required: true },
                { name: 'qdrant-client', version: 'qdrant-client>=1.1.1', timeout: 60000, required: true },
                { name: 'requests', version: 'requests>=2.31.0', timeout: 60000, required: true },
                { name: 'torch', version: 'torch>=2.0.0+cpu --index-url https://download.pytorch.org/whl/cpu', timeout: 180000, required: false },
                { name: 'sentence-transformers', version: 'sentence-transformers>=2.2.2', timeout: 120000, required: false }
            ];
            
            for (const dep of dependencies) {
                try {
                    // Check if package is already installed first
                    log(`Checking if ${dep.name} is installed...`);
                    const result = await this._runAsyncCommand([this._venvPythonPath, '-m', 'pip', 'show', dep.name]);
                    
                    if (result.error) {
                        log(`${dep.name} not installed, will install it`);
                        this.emit('dependency-installation', { message: `Installing ${dep.name}...` });
                        await this._runAsyncCommandWithTimeout(
                            [this._venvPythonPath, '-m', 'pip', 'install', dep.version],
                            dep.timeout
                        );
                        log(`Successfully installed ${dep.name}`);
                    } else {
                        log(`${dep.name} already installed`);
                    }
                } catch (error) {
                    if (dep.required) {
                        throw new Error(`Failed to install required dependency ${dep.name}: ${error.message}`);
                    } else {
                        log(`Warning: Failed to install optional dependency ${dep.name}: ${error.message}`);
                    }
                }
            }
            
            log('All dependencies installed successfully');
        } catch (error) {
            log(`Error installing dependencies: ${error.message}`);
            throw error;
        }
    }

    async _setupVirtualEnv() {
        const venvPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/venv`;
        this._venvPath = venvPath;
        
        try {
            // Check if venv exists and create it if it doesn't
            if (!GLib.file_test(venvPath, GLib.FileTest.EXISTS)) {
                log('Creating virtual environment...');
                await this._runAsyncCommand([this._pythonPath, '-m', 'venv', venvPath]);
                log('Virtual environment created successfully');
            } else {
                log('Virtual environment already exists');
            }
            
            // Set venv paths AFTER ensuring venv exists
            this._venvPythonPath = `${venvPath}/bin/python3`;
            this._venvPipPath = `${venvPath}/bin/pip`;
            
            // Verify that the venv Python executable exists
            if (!GLib.file_test(this._venvPythonPath, GLib.FileTest.EXISTS)) {
                log('Virtual environment Python not found, recreating venv...');
                // Remove corrupted venv and recreate
                await this._runAsyncCommand(['rm', '-rf', venvPath]);
                await this._runAsyncCommand([this._pythonPath, '-m', 'venv', venvPath]);
                log('Virtual environment recreated successfully');
            }
            
            // Upgrade pip in venv
            log('Upgrading pip...');
            await this._runAsyncCommand([this._venvPythonPath, '-m', 'pip', 'install', '--upgrade', 'pip']);
            
            // Install dependencies one by one with specific order and error handling
            const dependencies = [
                { name: 'numpy', version: 'numpy>=1.21.6,<1.28.0', timeout: 120000, required: true },
                { name: 'flask', version: 'flask>=2.0.1', timeout: 60000, required: true },
                { name: 'qdrant-client', version: 'qdrant-client>=1.1.1', timeout: 60000, required: true },
                { name: 'requests', version: 'requests>=2.31.0', timeout: 60000, required: true },
                { name: 'torch', version: 'torch>=2.0.0+cpu --index-url https://download.pytorch.org/whl/cpu', timeout: 180000, required: false },
                { name: 'sentence-transformers', version: 'sentence-transformers>=2.2.2', timeout: 120000, required: false }
            ];
            
            let criticalFailures = [];
            let optionalFailures = [];
            
            for (const dep of dependencies) {
                try {
                    // Check if package is already installed first
                    log(`Checking if ${dep.name} is installed...`);
                    try {
                        const checkResult = await this._runAsyncCommandWithTimeout([
                            this._venvPipPath, 'show', dep.name
                        ], 10000);
                        log(`${dep.name} is already installed, skipping`);
                        continue; // Skip installation if already installed
                    } catch (checkError) {
                        log(`${dep.name} not installed, will install it`);
                    }
                    
                    log(`Installing ${dep.name}...`);
                    if (dep.name === 'torch') {
                        // Special handling for PyTorch CPU-only version
                        await this._runAsyncCommandWithTimeout([
                            this._venvPipPath, 'install',
                            'torch',
                            '--index-url', 'https://download.pytorch.org/whl/cpu',
                            '--no-cache-dir'
                        ], dep.timeout);
                    } else {
                        await this._runAsyncCommandWithTimeout([
                            this._venvPipPath, 'install',
                            dep.version,
                            '--no-cache-dir'
                        ], dep.timeout);
                    }
                    log(`Successfully installed ${dep.name}`);
                } catch (error) {
                    log(`Warning: Failed to install ${dep.name}: ${error.message}`);
                    
                    if (dep.required) {
                        criticalFailures.push(dep.name);
                        // Try alternative installation without version constraints for required packages
                        try {
                            log(`Trying alternative installation for required package ${dep.name}...`);
                            await this._runAsyncCommandWithTimeout([
                                this._venvPipPath, 'install',
                                dep.name,
                                '--no-cache-dir'
                            ], dep.timeout);
                            log(`Successfully installed ${dep.name} (alternative)`);
                            criticalFailures.pop(); // Remove from failures if successful
                        } catch (altError) {
                            log(`Failed to install required package ${dep.name} with alternative method: ${altError.message}`);
                        }
                    } else {
                        optionalFailures.push(dep.name);
                        log(`Skipping optional package ${dep.name}, will continue without it`);
                    }
                }
            }
            
            // Check if we have critical failures
            if (criticalFailures.length > 0) {
                log(`Critical package installation failures: ${criticalFailures.join(', ')}`);
                log('Some core functionality may not work properly');
            }
            
            if (optionalFailures.length > 0) {
                log(`Optional package installation failures: ${optionalFailures.join(', ')}`);
                log('Some advanced features may be disabled');
            }
            
            // Install llama-cpp-python with CPU support
            log('Checking llama-cpp-python installation...');
            try {
                const checkOutput = await this._runAsyncCommandWithTimeout([
                    this._venvPipPath, 'show', 'llama-cpp-python'
                ], 10000);
                
                // Check if package is not installed (output contains "WARNING: Package(s) not found")
                const isNotInstalled = checkOutput.includes('WARNING: Package(s) not found') || 
                                     checkOutput.includes('Package(s) not found');
                
                if (isNotInstalled) {
                    log('llama-cpp-python not found, installing with CPU support...');
                    
                    // Set up environment variables for CPU build
                    const env = GLib.listenv();
                    env.push('CMAKE_ARGS="-DLLAMA_BLAS=ON -DLLAMA_BLAS_VENDOR=OpenBLAS"');
                    
                    // Install with CPU-specific build flags
                    const installOutput = await this._runAsyncCommandWithTimeout([
                        this._venvPipPath, 'install',
                        'llama-cpp-python',
                        '--no-cache-dir'
                    ], 600000, env); // 10 minute timeout for build
                    
                    log('Successfully installed llama-cpp-python with CPU support');
                } else {
                    log('llama-cpp-python is already installed in venv, skipping installation');
                }
            } catch (error) {
                // Only treat as error if it's not the "package not found" warning
                if (!error.message.includes('WARNING: Package(s) not found')) {
                    log(`Failed to install llama-cpp-python: ${error.message}`);
                    log('Memory processing will be disabled, but other features will work');
                } else {
                    // If we get here, we need to install
                    log('Installing llama-cpp-python with CPU support...');
                    
                    // Set up environment variables for CPU build
                    const env = GLib.listenv();
                    env.push('CMAKE_ARGS="-DLLAMA_BLAS=ON -DLLAMA_BLAS_VENDOR=OpenBLAS"');
                    
                    // Install with CPU-specific build flags
                    try {
                        const installOutput = await this._runAsyncCommandWithTimeout([
                            this._venvPipPath, 'install',
                            'llama-cpp-python',
                            '--no-cache-dir'
                        ], 600000, env); // 10 minute timeout for build
                        
                        log('Successfully installed llama-cpp-python with CPU support');
                    } catch (installError) {
                        log(`Failed to install llama-cpp-python: ${installError.message}`);
                        log('Memory processing will be disabled, but other features will work');
                    }
                }
            }
            
            log('Virtual environment setup complete');
            
        } catch (error) {
            log(`Error setting up virtual environment: ${error.message}`);
            throw error;
        }
    }

    async _startServer() {
        if (this._serverProcess) {
            log('Server already running');
            return;
        }

        const serverScript = this._getServerScript();
        if (!serverScript) {
            throw new Error('Server script not found');
        }

        try {
            // Verify venv Python exists
            if (!this._venvPythonPath || !GLib.file_test(this._venvPythonPath, GLib.FileTest.EXISTS)) {
                throw new Error('Virtual environment Python not found. Try removing the venv directory and restarting.');
            }

            // Set server URL immediately since we know the port
            this._serverUrl = `http://127.0.0.1:${this._serverPort}`;
            log(`Server URL set to: ${this._serverUrl}`);

            // Get memory verbosity from settings (context window is now fixed in server)
            const memoryVerbosity = this._settings.get_string('memory-verbosity') || 'balanced';

            // Prepare environment variables for the subprocess
            let envp = GLib.listenv().map(name => `${name}=${GLib.getenv(name)}`);
            envp.push(`MEMORY_VERBOSITY=${memoryVerbosity}`);

            // Start the server process using venv Python, passing envp
            log(`Starting server with Python: ${this._venvPythonPath}`);
            log(`Server script: ${serverScript}`);
            log(`Passing MEMORY_VERBOSITY=${memoryVerbosity}`);
            
            // Create environment array for subprocess
            const env = GLib.listenv().reduce((acc, name) => {
                acc[name] = GLib.getenv(name);
                return acc;
            }, {});
            env['MEMORY_VERBOSITY'] = memoryVerbosity;
            
            this._serverProcess = Gio.Subprocess.new(
                [this._venvPythonPath, serverScript],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            if (!this._serverProcess) {
                throw new Error('Failed to create server process');
            }

            // Set up output monitoring
            const stdout = this._serverProcess.get_stdout_pipe();
            const stderr = this._serverProcess.get_stderr_pipe();
            
            if (!stdout || !stderr) {
                throw new Error('Failed to get server process pipes');
            }

            const stdoutStream = new Gio.DataInputStream({
                base_stream: stdout,
                close_base_stream: true
            });
            
            const stderrStream = new Gio.DataInputStream({
                base_stream: stderr,
                close_base_stream: true
            });
            
            this._readOutput(stdoutStream, 'stdout');
            this._readOutput(stderrStream, 'stderr');

            // Monitor server status
            this._monitorServerStatus();
            
            // Wait for server to be ready with timeout
            try {
                await Promise.race([
                    this._waitForServer(),
                    new Promise((_, reject) => 
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
                            reject(new Error('Server startup timeout after 30 seconds'));
                            return GLib.SOURCE_REMOVE;
                        })
                    )
                ]);
            } catch (e) {
                // Clean up process on timeout
                if (this._serverProcess) {
                    this._serverProcess.force_exit();
                    this._serverProcess = null;
                }
                throw e;
            }
            
            log('Server started successfully');
        } catch (e) {
            log(`Error starting server: ${e.message}`);
            if (this._serverProcess) {
                try {
                    this._serverProcess.force_exit();
                } catch (exitError) {
                    log(`Error forcing server exit: ${exitError.message}`);
                }
                this._serverProcess = null;
            }
            throw e;
        }
    }

    _readOutput(stream, type) {
        stream.read_line_async(0, null, (stream, res) => {
            try {
                const [line, length] = stream.read_line_finish(res);
                if (line) {
                    const text = new TextDecoder().decode(line);
                    if (type === 'stderr') {
                        log(`Server error: ${text}`);
        } else {
                        log(`Server: ${text}`);
                        
                        // Check for server URL
                        if (text.includes('Running on http://127.0.0.1:')) {
                            const portMatch = text.match(/Running on http:\/\/127\.0\.0\.1:(\d+)/);
                            if (portMatch && portMatch[1]) {
                                this._serverPort = portMatch[1];
                                this._serverUrl = `http://127.0.0.1:${this._serverPort}`;
                                log(`Server URL set to: ${this._serverUrl}`);
                            }
                        }
                        
                        // Check for model loaded message
                        if (text.includes('Model loaded successfully')) {
                            this._modelLoaded = true;
                            log('Model loaded successfully');
                        }
                        
                        // Check for dependency installation messages
                        if (text.includes('Installing') || text.includes('Successfully installed')) {
                            this._emit('dependency-installation', { message: text.trim() });
                        }
                    }
                    
                    // Continue reading
                    this._readOutput(stream, type);
                }
            } catch (e) {
                log(`Error reading ${type}: ${e.message}`);
            }
        });
    }

    _monitorServerStatus() {
        if (!this._serverProcess) return;
        
        this._serverProcess.wait_async(null, (process, res) => {
            try {
                process.wait_finish(res);
                // If we get here, the process has exited
                const exitStatus = this._serverProcess.get_exit_status();
                log(`Server process exited with status ${exitStatus}`);
                this._serverProcess = null;
                this._emit('server-error', { message: `Server process exited with status ${exitStatus}` });
            } catch (e) {
                log(`Error monitoring server: ${e.message}`);
                this._serverProcess = null;
                this._emit('server-error', { message: e.message });
            }
        });
    }

    async _waitForServer() {
        if (!this._serverProcess) {
            log('Server process not running');
            return;
        }

        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds timeout
            
            const checkServerStatus = () => {
                if (!this._serverProcess) {
                    reject(new Error('Server process terminated'));
                return;
            }

                attempts++;
                if (attempts > maxAttempts) {
                    reject(new Error('Server startup timeout'));
                    return;
                }

                // Check if server is responding by trying a health check
                this._checkServerHealth()
                    .then((isHealthy) => {
                        if (isHealthy) {
                            log('Server is healthy and responding');
                            // Set the initialized flag here when server is confirmed working
                            this._initialized = true;
                            this._isInitializing = false;
                            log('Memory service marked as initialized');
                            resolve();
                        } else {
                            // Continue checking
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                                checkServerStatus();
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    })
                    .catch((error) => {
                        // Continue checking on error (server might still be starting)
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                            checkServerStatus();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
            };
            
            // Start checking immediately
            checkServerStatus();
        });
    }

    async _checkServerHealth() {
        return new Promise((resolve) => {
            try {
                const message = Soup.Message.new('GET', 'http://127.0.0.1:5000/health');
                message.request_headers.append('Content-Type', 'application/json');
                
                // Use a session for the request
                const session = new Soup.Session();
                session.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            // Check both that the server is healthy AND the model is loaded
                            const isHealthy = response.status === 'healthy' && response.model_loaded === true;
                            if (isHealthy) {
                                debug('Server is healthy and model is loaded');
                            } else {
                                debug(`Server status: ${response.status}, model loaded: ${response.model_loaded}`);
                            }
                            resolve(isHealthy);
                        } catch (e) {
                            debug(`Error parsing health response: ${e.message}`);
                            resolve(false);
                        }
                    } else {
                        debug(`Health check failed with status: ${msg.status_code}`);
                        resolve(false);
                    }
                });
            } catch (e) {
                debug(`Error in health check: ${e.message}`);
                resolve(false);
            }
        });
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

    async _loadTools() {
        try {
            debug('Loading tools for memory service...');
            
            // Create tool loader instance if not exists
            if (!this._toolLoader) {
                this._toolLoader = new ToolLoader();
                this._toolLoader.setMemoryService(this);
            }
            
            // Initialize tool loader with proper path
            const toolsPath = GLib.build_filenamev([Me.path, 'tools']);
            this._toolLoader.initialize(toolsPath);
            
            const tools = this._toolLoader.getTools();
            if (!tools || tools.length === 0) {
                throw new Error('No tools available to load');
            }

            // Store the tool descriptions for later matching
            this._toolDescriptions = tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                category: tool.category || 'general',
                parameters: tool.parameters,
                keywords: tool.keywords || []
            }));
            
            debug(`Loaded ${this._toolDescriptions.length} tool descriptions into memory`);
            
            // Get currently indexed tools
            const indexedTools = await this.getIndexedToolNames();
            debug(`Found ${indexedTools.size} tools already indexed`);
            
            // Only index tools that are new or have changed
            const toolsToIndex = this._toolDescriptions.filter(tool => {
                if (!indexedTools.has(tool.name)) {
                    debug(`Tool ${tool.name} is not indexed, will be added`);
                    return true;
                }
                return false;
            });
            
            if (toolsToIndex.length > 0) {
                // Format tool descriptions for indexing
                const formattedDescriptions = toolsToIndex.map(tool => ({
                    id: tool.name,
                    text: `${tool.name}: ${tool.description}\nKeywords: ${tool.keywords.join(', ')}\nParameters: ${JSON.stringify(tool.parameters)}`,
                    context: {
                        category: tool.category,
                        parameters: tool.parameters,
                        keywords: tool.keywords
                    }
                }));

                await this._indexDescriptions(formattedDescriptions, 'tools');
                info(`Indexed ${formattedDescriptions.length} new tool descriptions into memory system`);
            } else {
                debug('All tools are already indexed, no new tools to add');
            }
            
        } catch (error) {
            log(`Error loading tools: ${error.message}`);
            throw error;
        }
    }

    async loadToolDescriptions(tools) {
        if (!this._initialized) {
            log('Memory service not initialized, cannot load tool descriptions');
            return;
        }

        log(`Starting tool indexing process with ${tools.length} tools`);
        log(`Tools to process: ${tools.map(t => t.name).join(', ')}`);

        try {
            // Format tool descriptions
            const descriptions = tools.map(tool => ({
                id: tool.name,
                text: `${tool.name}: ${tool.description}\nKeywords: ${tool.keywords.join(', ')}\nParameters: ${JSON.stringify(tool.parameters)}`,
                context: {
                    category: tool.category,
                    parameters: tool.parameters,
                    keywords: tool.keywords
                }
            }));
            
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
                            log(`Successfully indexed ${descriptions.length} tool descriptions`);
                            log(`Indexed tools: ${descriptions.map(d => d.id).join(', ')}`);
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
        } catch (e) {
            log(`Error in loadToolDescriptions: ${e.message}`);
            log(`Stack trace: ${e.stack}`);
            throw e;
        }
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
        if (!this._initialized) {
            log('Memory service not initialized, cannot get tool descriptions');
            return [];
        }

            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({
                    query,
                    top_k,
                namespace: 'tools',
                min_score: 0.1  // Lower threshold for tool descriptions
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (!msg) {
                        log('HTTP response message is null in getRelevantToolDescriptions');
                        resolve([]);
                        return;
                    }
                    
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            if (response.status === 'success' && response.results) {
                                // Convert results to tool descriptions
                                const tools = response.results.map(result => {
                                    // Extract tool name from the text field since result.id is a UUID
                                    // The text format is: "tool_name: description\nKeywords: ...\nParameters: ..."
                                    const textLines = result.text.split('\n');
                                    const firstLine = textLines[0] || '';
                                    const colonIndex = firstLine.indexOf(':');
                                    const toolName = colonIndex > 0 ? firstLine.substring(0, colonIndex).trim() : result.id;
                                    
                                    return {
                                        name: toolName,
                                        description: result.text,
                                        category: result.context?.category || 'general',
                                        parameters: result.context?.parameters || {}
                                    };
                                });
                                resolve(tools);
                            } else {
                                log('No tool descriptions found in response');
                                resolve([]);
                            }
                        } catch (e) {
                            log(`Error parsing tool descriptions response: ${e.message}`);
                            resolve([]);
                        }
                    } else {
                        log(`Failed to get tool descriptions: ${msg.status_code}`);
                        resolve([]);
                    }
                });
                });
            } catch (e) {
                log(`Error in getRelevantToolDescriptions: ${e.message}`);
            return [];
            }
    }

    /**
     * Get the Python script content for the embedding server
     * @returns {string} The Python script content
     */
    _getServerScript() {
        const extensionDir = Me.path;
        const serverScript = Gio.File.new_for_path(`${extensionDir}/services/qdrant_server.py`);
        
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

    async getRelevantMemories(query, topK = 3) {
        if (!this._initialized) {
            log('Memory service not initialized');
            return { conversation_history: [], user_info: [], world_facts: [], volatile_info: [] };
        }

        try {
            // Search across multiple namespaces for different types of memories
            const searchPromises = [
                // Search conversation history (existing behavior)
                this._searchNamespace(query, 'conversation_history', topK, 0.3),
                // Search user personal information
                this._searchNamespace(query, 'user_info', topK, 0.25),
                // Search world facts
                this._searchNamespace(query, 'world_facts', topK, 0.3),
                // Search volatile information (time-sensitive data)
                this._searchNamespace(query, 'volatile_info', topK, 0.25)
            ];

            const results = await Promise.all(searchPromises);
            
            return {
                conversation_history: results[0] || [],
                user_info: results[1] || [],
                world_facts: results[2] || [],
                volatile_info: results[3] || []
            };
        } catch (error) {
            log(`Error retrieving memories: ${error.message}`);
            return { conversation_history: [], user_info: [], world_facts: [], volatile_info: [] };
        }
    }

    async _searchNamespace(query, namespace, topK, minScore) {
        return new Promise((resolve, reject) => {
            const searchData = {
                query: query,
                top_k: topK,
                namespace: namespace,
                min_score: minScore
            };

            log(`Searching ${namespace} namespace for: "${query.substring(0, 50)}..."`);
            
            const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
            message.request_headers.append('Content-Type', 'application/json');
            message.set_request_body_from_bytes('application/json', 
                new GLib.Bytes(JSON.stringify(searchData)));

            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code === 200) {
                    try {
                        const response = JSON.parse(msg.response_body.data);
                        if (response.status === 'success' && response.results) {
                            // Filter out expired volatile memories
                            const filteredResults = response.results.filter(result => {
                                if (result.context?.is_volatile && result.context?.expires_at) {
                                    const now = new Date();
                                    const expires = new Date(result.context.expires_at);
                                    if (now > expires) {
                                        log(`Filtering out expired volatile memory: ${result.text.substring(0, 50)}...`);
                                        return false;
                                    }
                                }
                                return true;
                            });
                            
                            log(`Found ${filteredResults.length} results in ${namespace} (${response.results.length - filteredResults.length} expired)`);
                            resolve(filteredResults);
                        } else {
                            log(`Search failed for ${namespace}: ${response.error || 'Unknown error'}`);
                            resolve([]);
                        }
                    } catch (error) {
                        log(`Error parsing search response for ${namespace}: ${error.message}`);
                        resolve([]);
                    }
                } else {
                    log(`Search request failed for ${namespace}: ${msg.status_code}`);
                    resolve([]);
                }
            });
        });
    }

    async indexMemory(memory) {
        if (!this._modelLoaded) {
            log('Server not running, cannot index memory');
            return;
        }

        // Validate input parameters
        if (!memory) {
            log('Error in indexMemory: memory parameter is null or undefined');
            return;
        }

        if (!memory.text || typeof memory.text !== 'string') {
            log('Error in indexMemory: memory.text is required and must be a string');
            return;
        }

        // Ensure server URL is set (fallback to default)
        if (!this._serverUrl) {
            this._serverUrl = `http://127.0.0.1:${this._serverPort}`;
            log(`Server URL was null, setting fallback: ${this._serverUrl}`);
        }

        // Ensure HTTP session is valid
        if (!this._httpSession) {
            log('HTTP session is null, creating new session');
            this._httpSession = new Soup.Session();
        }

        try {
            // Determine which namespace to use based on memory type
            const namespace = memory.context?.metadata?.type === 'llm_memory' 
                ? 'llm_memories' 
                : 'conversation_history';

            log(`Indexing memory to namespace '${namespace}': ${memory.text.substring(0, 50)}...`);

            // Format memory for indexing
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
                        type: memory.context?.metadata?.type || 'conversation',
                        importance: memory.context?.metadata?.importance || 'normal',
                        tags: memory.context?.metadata?.tags || []
                    },
                    // Add all other context properties that might be present
                    ...memory.context
                }
            };

            // Debug the URL being used
            const targetUrl = `${this._serverUrl}/index`;
            log(`Creating Soup message for URL: ${targetUrl}`);
            log(`HTTP session valid: ${!!this._httpSession}`);

            // Index memory in the appropriate namespace
            const message = Soup.Message.new('POST', targetUrl);
            if (!message) {
                log(`Error in indexMemory: failed to create Soup message for URL: ${targetUrl}`);
                log(`Server URL: ${this._serverUrl}, Server Port: ${this._serverPort}`);
                log(`URL length: ${targetUrl.length}, URL valid: ${targetUrl.startsWith('http')}`);
                
                // Try with a simpler URL format
                const simpleUrl = 'http://127.0.0.1:5000/index';
                log(`Attempting with simple URL: ${simpleUrl}`);
                const simpleMessage = Soup.Message.new('POST', simpleUrl);
                if (!simpleMessage) {
                    log('Failed to create Soup message even with simple URL - possible Soup library issue');
                    return;
                } else {
                    log('Simple URL worked, using that instead');
                    return this._indexWithMessage(simpleMessage, namespace, memoryDoc);
                }
            }
            
            return this._indexWithMessage(message, namespace, memoryDoc);
            
        } catch (e) {
            log(`Error in indexMemory: ${e.message}`);
            throw e;
        }
    }

    _indexWithMessage(message, namespace, memoryDoc) {
            message.request_headers.append('Content-Type', 'application/json');
            
            const payload = JSON.stringify({
                namespace: namespace,
                documents: [memoryDoc]
            });
            
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
            
            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                if (!msg) {
                    const error = new Error('HTTP response message is null');
                    log(`Error in indexMemory: ${error.message}`);
                    reject(error);
                    return;
                }
                
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            if (response.status === 'success') {
                            log(`Successfully indexed memory in namespace '${namespace}'`);
                            resolve(response);
                            } else {
                                const errorMessage = response.error || 'Unknown error';
                                log(`Failed to index memory: ${errorMessage}`);
                                reject(new Error(errorMessage));
                            }
                        } catch (e) {
                            log(`Error parsing memory indexing response: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(msg.response_body.data);
                            const errorMessage = errorResponse.error || `Failed to index memory: ${msg.status_code}`;
                            log(errorMessage);
                            reject(new Error(errorMessage));
                        } catch (e) {
                            const errorMessage = `Failed to index memory: ${msg.status_code}`;
                            log(errorMessage);
                            reject(new Error(errorMessage));
                        }
                    }
                });
            });
    }

    async clearNamespace(namespace) {
        if (!this._initialized) {
            log('Memory service not initialized, cannot clear namespace');
            return;
        }

            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/clear`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({ namespace });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (!msg) {
                        log('HTTP response message is null in clearNamespace');
                        reject(new Error('No response from server'));
                        return;
                    }
                    
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            if (response.status === 'success') {
                                resolve();
                            } else {
                                reject(new Error(response.error || 'Failed to clear namespace'));
                            }
                        } catch (e) {
                            reject(new Error(`Error parsing response: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`Server returned status ${msg.status_code}`));
                    }
                });
                });
            } catch (e) {
                log(`Error in clearNamespace: ${e.message}`);
            throw e;
            }
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
                    namespace: 'tools'
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

    async _handleReindexTrigger() {
        try {
            log('Starting reindexing process...');
            
            // Only clear conversation history, preserve LLM memories
            await this.clearNamespace('conversation_history');
            
            // Verify server health and collections
            const healthCheck = new Soup.Message('GET', `${this._serverUrl}/health`);
            const healthResponse = await new Promise((resolve, reject) => {
                this._httpSession.queue_message(healthCheck, (session, msg) => {
                    if (msg.status_code === 200) {
                        resolve(JSON.parse(msg.response_body.data));
                    } else {
                        reject(new Error(`Health check failed: ${msg.status_code}`));
                    }
                });
            });
            
            if (!healthCheck.collections.includes('conversation_history')) {
                throw new Error('Failed to create conversation history collection');
            }
            
            // Reload tools
            log('Reloading tools...');
            await this._loadTools();
            
            // Reindex all sessions
            log('Reindexing sessions...');
            const sessions = await this._getAllSessions();
            
            for (const session of sessions) {
                try {
                    // Index the full session as conversation history
                    const sessionSummary = session.messages
                        .map(msg => `${msg.role}: ${msg.content}`)
                        .join('\n');
                    
                    await this.indexMemory({
                        id: `session_${session.id}`,
                        text: sessionSummary,
                        context: {
                            conversation_id: session.id,
                            metadata: {
                                type: 'conversation',
                                importance: 'normal'
                            }
                        }
                    });
                    
                    // Index chunks of the session
                    const chunks = this._chunkSession(session.messages);
                    for (const chunk of chunks) {
                        const chunkSummary = chunk
                            .map(msg => `${msg.role}: ${msg.content}`)
                            .join('\n');
                        
                        await this.indexMemory({
                            id: `session_${session.id}_chunk_${chunks.indexOf(chunk)}`,
                            text: chunkSummary,
                            context: {
                                conversation_id: session.id,
                                metadata: {
                                    type: 'conversation',
                                    importance: 'normal'
                                }
                            }
                        });
                    }
                } catch (error) {
                    log(`Error reindexing session: ${error.message}`);
                }
            }
            
            log('Reindexing completed successfully');
        } catch (error) {
            log(`Error during reindexing: ${error.message}`);
            throw error;
        }
    }

    destroy() {
        if (this._reindexId) {
            this._settings.disconnect(this._reindexId);
            this._reindexId = null;
        }
        // ... existing destroy code ...
    }

    _extractQueryIntent(query) {
        const lowerQuery = query.toLowerCase();
        
        // Check for weather-related queries
        if (lowerQuery.includes('weather') || 
            lowerQuery.includes('forecast') || 
            lowerQuery.includes('temperature')) {
            return { type: 'weather' };
        }
        
        // Check for system-related queries
        if (lowerQuery.includes('volume') || 
            lowerQuery.includes('brightness') || 
            lowerQuery.includes('system') ||
            lowerQuery.includes('setting')) {
            return { type: 'system' };
        }
        
        // Default to general conversation
        return { type: 'conversation' };
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

    async _runAsyncCommand(args) {
        return new Promise((resolve, reject) => {
            try {
                const proc = Gio.Subprocess.new(
                    args,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );

                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                        const status = proc.get_exit_status();

                        if (status === 0) {
                            if (stdout) {
                                log(`Command output: ${stdout.trim()}`);
                            }
                            resolve(stdout);
                        } else {
                            const error = stderr ? stderr.trim() : 'Unknown error';
                            log(`Command error: ${error}`);
                            reject(new Error(error));
                        }
                    } catch (e) {
                        log(`Error in command execution: ${e.message}`);
                        reject(e);
                    }
                });
            } catch (e) {
                log(`Error starting command: ${e.message}`);
                reject(e);
            }
        });
    }

    async _runAsyncCommandWithTimeout(args, timeout, env = null) {
        return new Promise((resolve, reject) => {
            try {
                const subprocessFlags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
                
                let proc;
                if (env) {
                    // Create subprocess launcher with custom environment
                    const launcher = new Gio.SubprocessLauncher({
                        flags: subprocessFlags
                    });
                    
                    // Set environment variables
                    for (const envVar of env) {
                        if (envVar.includes('=')) {
                            const [key, value] = envVar.split('=', 2);
                            launcher.setenv(key, value, true);
                        }
                    }
                    
                    proc = launcher.spawnv(args);
                } else {
                    proc = Gio.Subprocess.new(args, subprocessFlags);
                }

                const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
                    reject(new Error('Command timed out'));
                    return GLib.SOURCE_REMOVE;
                });

                proc.communicate_utf8_async(null, null, (proc, res) => {
                    GLib.source_remove(timeoutId);
                    try {
                        const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                        const status = proc.get_exit_status();

                        if (status === 0) {
                            if (stdout) {
                                log(`Command output: ${stdout.trim()}`);
                            }
                            resolve(stdout);
                        } else {
                            const error = stderr ? stderr.trim() : 'Unknown error';
                            log(`Command error: ${error}`);
                            reject(new Error(error));
                        }
                    } catch (e) {
                        log(`Error in command execution: ${e.message}`);
                        reject(e);
                    }
                });
            } catch (e) {
                log(`Error starting command: ${e.message}`);
                reject(e);
            }
        });
    }
}); 