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
        
        // Watch for reindex trigger
        this._settings = ExtensionUtils.getSettings();
        this._reindexId = this._settings.connect('changed::trigger-reindex', () => {
            if (this._settings.get_boolean('trigger-reindex')) {
                this._handleReindexTrigger();
            }
        });
        
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
                
                // Check if we need to install dependencies
                if (await this._needsDependencyInstallation()) {
                    log('Dependencies need installation, starting async installation...');
                    this._startAsyncDependencyInstallation();
                    
                    // Wait for dependencies to be installed
                    await this._waitForDependencyInstallation();
                    log('Dependencies installation completed');
                }
                
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
                                        //convert to string
                                        let strLine = line.toString();
                                        // Only log important server output
                                        if (strLine.indexOf('Running on') !== -1 || 
                                            strLine.indexOf('Model loaded') !== -1 || 
                                            strLine.indexOf('ERROR') !== -1) {
                                            log(`Server: ${strLine}`);
                                        }
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
                                            this._modelLoaded = true; // Set the instance flag
                                            log('Model loaded successfully');
                                            
                                            // Only resolve if both conditions are met
                                            if (serverUrlFound && modelLoaded) {
                                                log('Server fully initialized');
                                                    resolve();
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

    async _needsDependencyInstallation() {
        try {
            // Check if virtual environment exists
            const venvPath = GLib.build_filenamev([Me.path, 'venv']);
            if (!GLib.file_test(venvPath, GLib.FileTest.EXISTS)) {
                log('Virtual environment not found');
                return true;
            }

            // Check if venv python exists
            const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
            if (!GLib.file_test(venvPython, GLib.FileTest.EXISTS)) {
                log('Virtual environment python not found');
                return true;
            }

            // Try to check if dependencies are working
            try {
                const checkCmd = `${venvPython} -c "import numpy; import sentence_transformers; print('OK')"`;
                const [success, stdout, stderr, exitStatus] = GLib.spawn_command_line_sync(checkCmd);
                
                if (!success || exitStatus !== 0 || !stdout || stdout.toString().indexOf('OK') === -1) {
                    log('Dependencies check failed, need installation');
                    return true;
                }
                
                log('Dependencies appear to be working');
                this._pythonPath = venvPython; // Set the venv python path
                return false;
            } catch (e) {
                log(`Error checking dependencies: ${e.message}`);
                return true;
            }
        } catch (error) {
            log(`Error in _needsDependencyInstallation: ${error.message}`);
            return true;
        }
    }

    async _waitForDependencyInstallation() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 300; // Wait up to 5 minutes for CPU-only packages
            
            const checkInstallation = () => {
                attempts++;
                
                // Check if dependencies are now working
                const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
                if (GLib.file_test(venvPython, GLib.FileTest.EXISTS)) {
                    try {
                        const checkCmd = `${venvPython} -c "import numpy; import sentence_transformers; print('OK')"`;
                        const [success, stdout, stderr, exitStatus] = GLib.spawn_command_line_sync(checkCmd);
                        
                        if (success && exitStatus === 0 && stdout && stdout.toString().indexOf('OK') !== -1) {
                            log('Dependencies installation verified');
                            this._pythonPath = venvPython; // Set the venv python path
                            resolve();
                            return;
                        }
                    } catch (e) {
                        // Continue checking
                    }
                }
                
                if (attempts >= maxAttempts) {
                    reject(new Error('Dependency installation timeout after 5 minutes'));
                    return;
                }
                
                // Check again in 1 second
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    checkInstallation();
                    return GLib.SOURCE_REMOVE;
                });
            };
            
            checkInstallation();
        });
    }

    _startAsyncDependencyInstallation() {
        // Create virtual environment if it doesn't exist
        const venvPath = GLib.build_filenamev([Me.path, 'venv']);
        if (!GLib.file_test(venvPath, GLib.FileTest.EXISTS)) {
            log('Creating virtual environment...');
            this._runAsyncCommand(
                `${this._pythonPath} -m venv ${venvPath}`,
                () => {
                    log('Virtual environment created successfully');
                    this._upgradePip();
                },
                (error) => {
                    log(`Failed to create virtual environment: ${error}`);
                }
            );
        } else {
            this._upgradePip();
        }
    }

    _upgradePip() {
        const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
        log('Upgrading pip...');
        this._runAsyncCommand(
            `${venvPython} -m pip install --upgrade pip`,
            () => {
                log('Pip upgraded successfully');
                this._installNumpy();
            },
            (error) => {
                log(`Failed to upgrade pip: ${error}`);
            }
        );
    }

    _installNumpy() {
        const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
        log('Installing compatible NumPy version...');
        this._runAsyncCommand(
            `${venvPython} -m pip install 'numpy>=1.21.6,<1.28.0'`,
            () => {
                log('NumPy installed successfully');
                this._installDependencies();
            },
            (error) => {
                log(`Failed to install NumPy: ${error}`);
            }
        );
    }

    _installDependencies() {
        const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
        
        log('Installing CPU-only PyTorch first...');
        // Install CPU-only PyTorch first to avoid CUDA dependencies
        this._runAsyncCommand(
            `${venvPython} -m pip install torch>=2.0.0,<2.5.0 --index-url https://download.pytorch.org/whl/cpu`,
            () => {
                log('CPU-only PyTorch installed successfully');
                this._installOtherDependencies();
            },
            (error) => {
                log(`Failed to install PyTorch: ${error}`);
                // Try with a simpler approach
                this._runAsyncCommand(
                    `${venvPython} -m pip install torch --index-url https://download.pytorch.org/whl/cpu`,
                    () => {
                        log('CPU-only PyTorch installed successfully (fallback)');
                        this._installOtherDependencies();
                    },
                    (error) => {
                        log(`Failed to install PyTorch (fallback): ${error}`);
                    }
                );
            }
        );
    }

    _installOtherDependencies() {
        const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
        const requirementsPath = GLib.build_filenamev([Me.path, 'requirements.txt']);
        
        if (GLib.file_test(requirementsPath, GLib.FileTest.EXISTS)) {
            log('Installing other dependencies...');
            this._runAsyncCommand(
                `${venvPython} -m pip install --no-cache-dir --upgrade -r ${requirementsPath}`,
                (output) => {
                    log(`Other dependencies installed successfully:\n${output}`);
                    this._verifyInstallation();
                },
                (error) => {
                    log(`Failed to install other dependencies: ${error}`);
                    // Try without the --no-cache-dir flag as fallback
                    this._runAsyncCommand(
                        `${venvPython} -m pip install --upgrade -r ${requirementsPath}`,
                        (output) => {
                            log(`Other dependencies installed successfully (fallback):\n${output}`);
                            this._verifyInstallation();
                        },
                        (error) => {
                            log(`Failed to install other dependencies (fallback): ${error}`);
                        }
                    );
                }
            );
                } else {
            log('No requirements.txt found, skipping other dependencies installation');
            this._verifyInstallation();
        }
    }

    _verifyInstallation() {
        const venvPython = GLib.build_filenamev([Me.path, 'venv', 'bin', 'python3']);
        log('Verifying installation...');
        this._runAsyncCommand(
            `${venvPython} -c "import numpy; print(f'NumPy version: {numpy.__version__}'); import sentence_transformers; print('OK')"`,
            (output) => {
                log(`Installation verified successfully:\n${output}`);
                this._pythonPath = venvPython;
                // Don't start server here - let the main initialization flow handle it
                log('Dependencies installation completed successfully');
            },
            (error) => {
                log(`Failed to verify installation: ${error}`);
            }
        );
    }

    _runAsyncCommand(command, onSuccess, onError) {
        try {
            const [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                null, // working directory
                ['/bin/sh', '-c', command], // command
                null, // environment
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null // child setup function
            );

            if (!success) {
                onError('Failed to start command');
                return;
            }

            // Set up output monitoring
            const stdoutStream = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({ fd: stdout }),
                close_base_stream: true
            });

            const stderrStream = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({ fd: stderr }),
                close_base_stream: true
            });

            let stdoutData = '';
            let stderrData = '';

            const readStream = (stream, data, isStdout) => {
                stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                    try {
                        const [line] = stream.read_line_finish(res);
                        if (line) {
                            const strLine = ByteArray.toString(line);
                            if (isStdout) {
                                stdoutData += strLine + '\n';
                                log(`Command output: ${strLine}`);
            } else {
                                stderrData += strLine + '\n';
                                log(`Command error: ${strLine}`);
                            }
                            readStream(stream, data, isStdout);
                        } else {
                            // End of stream
                            if (isStdout) {
                                stream.close(null);
                            } else {
                                // Both streams are done, check process exit
                                GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
                                    if (status === 0) {
                                        onSuccess(stdoutData);
                                    } else {
                                        onError(stderrData || 'Command failed');
                                    }
                                    GLib.spawn_close_pid(pid);
                                });
                            }
            }
        } catch (e) {
                        log(`Error reading ${isStdout ? 'stdout' : 'stderr'}: ${e.message}`);
                    }
                });
            };

            readStream(stdoutStream, stdoutData, true);
            readStream(stderrStream, stderrData, false);

        } catch (e) {
            log(`Error running async command: ${e.message}`);
            onError(e.message);
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
            debug('Loading tools for memory service...');
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
                parameters: tool.parameters,
                keywords: tool.keywords || []
            }));
            
            debug(`Loaded ${this._toolDescriptions.length} tool descriptions into memory`);
            
            // Only index tools that are new or have changed
            const formattedDescriptions = this._toolDescriptions.filter(tool => {
                if (!indexedNames.has(tool.name)) return true;
                // Compare description and parameters
                const indexed = currentIndexed[tool.name];
                if (!indexed) return true;
                return indexed.description !== tool.description || 
                       JSON.stringify(indexed.parameters) !== JSON.stringify(tool.parameters) ||
                       JSON.stringify(indexed.keywords) !== JSON.stringify(tool.keywords);
            }).map(tool => ({
                id: tool.name,
                text: `${tool.name}: ${tool.description}\nKeywords: ${tool.keywords.join(', ')}\nParameters: ${JSON.stringify(tool.parameters)}`
            }));

            if (formattedDescriptions.length > 0) {
                await this._indexDescriptions(formattedDescriptions, 'tools');
                info(`Indexed/updated ${formattedDescriptions.length} tool descriptions into memory system`);
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
                    top_k: 1000, // Large number to get all tools
                    namespace: 'tools'
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
                    namespace: 'tools',  // Only search in tools namespace
                    min_score: 0.05  // Lower threshold for better recall
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            debug(`Search response: ${JSON.stringify(response)}`);
                            
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

                            // Check for keyword matches
                            const lowerQuery = query.toLowerCase();
                            const keywordMatches = this._toolDescriptions.filter(tool => {
                                if (!tool.keywords) return false;
                                return tool.keywords.some(keyword => 
                                    lowerQuery.includes(keyword.toLowerCase())
                                );
                            });

                            // Combine semantic matches with keyword matches, removing duplicates
                            const allMatches = new Map();
                            relevantDescriptions.forEach(tool => {
                                allMatches.set(tool.name, tool);
                            });
                            keywordMatches.forEach(tool => {
                                allMatches.set(tool.name, tool);
                            });

                            const finalDescriptions = Array.from(allMatches.values());
                            debug(`Found ${finalDescriptions.length} relevant tools (${relevantDescriptions.length} semantic matches, ${keywordMatches.length} keyword matches)`);
                            
                            // Build the raw prompt
                            const rawPrompt = `You are a helpful assistant with access to the following tools:

${finalDescriptions.map(tool => {
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
}).join('\n\n')}

CRITICAL INSTRUCTIONS FOR TOOL USAGE:
1. You MUST respond with ONLY a JSON object when using a tool. No other text, no XML, no explanations.
2. The JSON object MUST follow this EXACT format:
   {"tool": "tool_name", "arguments": {"param1": "value1", ...}}
3. DO NOT use XML tags like <web_search> or any other format
4. DO NOT use any other formatting or tags like markdown or html.
5. DO NOT include your thoughts or reasoning
6. DO NOT include placeholders or waiting messages
7. If no tool is needed, respond conversationally
CORRECT EXAMPLE:
{"tool": "web_search", "arguments": {"query": "weather forecast Memphis"}}

INCORRECT EXAMPLES (DO NOT USE THESE):
❌ <web_search query="weather forecast">
❌ {"tool": "web_search"...} [waiting for results]

Remember: Your response must be ONLY the JSON object, nothing else.`;

                            // Developer note: The LLM must respond with a single JSON object as above for tool calls.
                            resolve({
                                descriptions: finalDescriptions,
                                raw_prompt: rawPrompt,
                                functions: finalDescriptions,
                                system_message: rawPrompt
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

    async getRelevantMemories(query, top_k = 3) {
        if (!this._modelLoaded) {
            log('Server not running, cannot retrieve memories');
            return [];
        }

        // Extract query intent to filter memories
        const queryIntent = this._extractQueryIntent(query);
        
        // Get both conversation history and LLM memories
        const [historyMemories, llmMemories] = await Promise.all([
            this._getConversationHistory(query, top_k),
            this._getLLMMemories(query, top_k)
        ]);

        // Combine and format the results
        return {
            conversation_history: historyMemories,
            llm_memories: llmMemories
        };
    }

    async _getConversationHistory(query, top_k) {
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({
                    query,
                    top_k,
                    namespace: 'conversation_history',
                    min_score: 0.3
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            const formattedHistory = response.results
                                .filter(memory => {
                                    const relevance = this._calculateRelevance(memory.score, memory.context);
                                    return relevance > 0.3;
                                })
                                .map(memory => ({
                                    id: memory.id,
                                    text: memory.text,
                                    score: memory.score,
                                    context: memory.context || {},
                                    relevance: this._calculateRelevance(memory.score, memory.context)
                                }))
                                .sort((a, b) => b.relevance - a.relevance)
                                .slice(0, 2);
                            
                            resolve(formattedHistory);
                        } catch (e) {
                            log(`Error parsing conversation history: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        reject(new Error(`Conversation history search failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async _getLLMMemories(query, top_k) {
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('POST', `${this._serverUrl}/search`);
                message.request_headers.append('Content-Type', 'application/json');
                
                const payload = JSON.stringify({
                    query,
                    top_k,
                    namespace: 'llm_memories',
                    min_score: 0.3
                });
                
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
                
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            const formattedMemories = response.results
                                .filter(memory => {
                                    const relevance = this._calculateRelevance(memory.score, memory.context);
                                    if (relevance <= 0.3) return false;
                                    
                                    // Filter by query intent
                                    const queryIntent = this._extractQueryIntent(query);
                                    if (queryIntent.type === 'weather' && 
                                        memory.context?.metadata?.type !== 'weather') {
                                        return false;
                                    }
                                    if (queryIntent.type === 'system' && 
                                        memory.context?.metadata?.type !== 'system') {
                                        return false;
                                    }
                                    
                                    return true;
                                })
                                .map(memory => ({
                                    id: memory.id,
                                    text: memory.text,
                                    score: memory.score,
                                    context: memory.context || {},
                                    relevance: this._calculateRelevance(memory.score, memory.context)
                                }))
                                .sort((a, b) => b.relevance - a.relevance)
                                .slice(0, 2);
                            
                            resolve(formattedMemories);
                        } catch (e) {
                            log(`Error parsing LLM memories: ${e.message}`);
                            reject(e);
                        }
                    } else {
                        reject(new Error(`LLM memories search failed: ${msg.status_code}`));
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async indexMemory(memory) {
        if (!this._modelLoaded) {
            log('Server not running, cannot index memory');
            return;
        }

        try {
            // Determine which namespace to use based on memory type
            const namespace = memory.context?.metadata?.type === 'llm_memory' 
                ? 'llm_memories' 
                : 'conversation_history';

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
                    }
                }
            };

            // Index memory in the appropriate namespace
            const message = Soup.Message.new('POST', `${this._serverUrl}/index`);
            message.request_headers.append('Content-Type', 'application/json');
            
            const payload = JSON.stringify({
                namespace: namespace,
                documents: [memoryDoc]
            });
            
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(payload));
            
            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code === 200) {
                        try {
                            const response = JSON.parse(msg.response_body.data);
                            log(`Successfully indexed memory in namespace '${namespace}'`);
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

    async clearNamespace(namespace) {
        if (!this._modelLoaded) {
            log('Server not running, cannot clear namespace');
            return;
        }

        // Only clear the specified namespace, never clear llm_memories
        if (namespace === 'llm_memories') {
            log('Warning: Attempted to clear llm_memories namespace - operation blocked');
            return Promise.resolve();
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
}); 