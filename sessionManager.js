'use strict';

const { Gio, GLib, GObject } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { MemoryService } = Me.imports.services.MemoryService;

class SessionManagerCore {
    constructor() {
        this._sessionDir = GLib.build_filenamev([
            GLib.get_user_config_dir(),
            'llmchat',
            'sessions'
        ]);
        this._ensureSessionDir();
        
        // Initialize memory service for vector storage
        this._memoryService = MemoryService.getInstance();
    }

    _ensureSessionDir() {
        try {
        const dir = Gio.File.new_for_path(this._sessionDir);
        if (!dir.query_exists(null)) {
                log(`Creating session directory: ${this._sessionDir}`);
            dir.make_directory_with_parents(null);
            }
        } catch (error) {
            log(`Error ensuring session directory exists: ${error.message}`);
        }
    }

    _getSessionFilePath(sessionId) {
        return GLib.build_filenamev([
            this._sessionDir,
            `session-${sessionId}.json`
        ]);
    }

    _chunkSession(messages) {
        // Split messages into chunks of 5 for better context management
        const chunks = [];
        for (let i = 0; i < messages.length; i += 5) {
            chunks.push(messages.slice(i, i + 5));
        }
        return chunks;
    }

    _generateSessionEmbedding(messages) {
        // Create a summary of the session for embedding
        const summary = messages.map(msg => `${msg.sender}: ${msg.text}`).join('\n');
        return summary;
    }

    async saveSession(sessionId, messages, metadata = {}) {
        try {
            // Create chunks for better context management
            const chunks = this._chunkSession(messages);
            
            const sessionData = {
                id: sessionId,
                messages: messages,
                chunks: chunks,
                title: metadata.title || this._generateSessionTitle(messages),
                created_at: metadata.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                settings: metadata.settings || {},
                tool_results: metadata.tool_results || []
            };

            // Save session to file
            const file = Gio.File.new_for_path(this._getSessionFilePath(sessionId));
            const [success, tag] = file.replace_contents(
                JSON.stringify(sessionData, null, 2),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            if (!success) {
                throw new Error('Failed to save session');
            }

            // Index session chunks in vector store
            const sessionSummary = this._generateSessionEmbedding(messages);
            await this._memoryService.indexMemory({
                id: `session_${sessionId}`,
                text: sessionSummary,
                context: {
                    type: 'session_history',
                    importance: 'normal',
                    conversation_id: sessionId,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        title: sessionData.title,
                        message_count: messages.length,
                        chunk_count: chunks.length
                    }
                }
            });

            // Index individual chunks
            for (let i = 0; i < chunks.length; i++) {
                const chunkSummary = this._generateSessionEmbedding(chunks[i]);
                await this._memoryService.indexMemory({
                    id: `session_${sessionId}_chunk_${i}`,
                    text: chunkSummary,
                    context: {
                        type: 'session_chunk',
                        importance: 'normal',
                        conversation_id: sessionId,
                        chunk_index: i,
                        timestamp: new Date().toISOString(),
                        metadata: {
                            parent_session: sessionId,
                            message_count: chunks[i].length
                        }
                    }
                });
            }

            return true;
        } catch (error) {
            log(`Error saving session: ${error.message}`);
            return false;
        }
    }

    async loadSession(sessionId) {
        try {
            const file = Gio.File.new_for_path(this._getSessionFilePath(sessionId));
            if (!file.query_exists(null)) {
                throw new Error('Session file does not exist');
            }

            const [success, contents] = file.load_contents(null);
            if (!success) {
                throw new Error('Failed to read session file');
            }

            const sessionData = JSON.parse(contents);
            return sessionData;
        } catch (error) {
            log(`Error loading session: ${error.message}`);
            return null;
        }
    }

    async listSessions() {
        try {
            const dir = Gio.File.new_for_path(this._sessionDir);
            const enumerator = dir.enumerate_children(
                'standard::name,standard::type,standard::size,standard::modified',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            const sessions = [];
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (name.startsWith('session-') && name.endsWith('.json')) {
                    const sessionId = name.replace('session-', '').replace('.json', '');
                    const sessionData = await this.loadSession(sessionId);
                    if (sessionData) {
                        sessions.push({
                            id: sessionId,
                            title: sessionData.title,
                            created_at: sessionData.created_at,
                            updated_at: sessionData.updated_at,
                            message_count: sessionData.messages.length,
                            preview: this._getSessionPreview(sessionData.messages)
                        });
                    }
                }
            }
            enumerator.close(null);

            // Sort sessions by updated_at, newest first
            return sessions.sort((a, b) => 
                new Date(b.updated_at) - new Date(a.updated_at)
            );
        } catch (error) {
            log(`Error listing sessions: ${error.message}`);
            return [];
        }
    }

    async searchSessions(query, top_k = 3) {
        try {
            log(`[DEBUG] Searching memories for query: "${query}"`);
            // Use memory service to search for relevant sessions
            const results = await this._memoryService.getRelevantMemories(query, top_k);
            
            log(`[DEBUG] Memory search returned ${results.length} results.`);
            
            // Filter for session-related memories and load full session data
            const sessions = [];
            const seenSessionIds = new Set();

            for (const result of results) {
                log(`[DEBUG] Processing memory result type: ${result.context.type}, ID: ${result.id}, Relevance: ${result.relevance}`);
                let sessionId = null;

                // Extract session ID from the memory ID by removing the "session_" prefix
                if (result.id.startsWith('session_')) {
                    sessionId = result.id.replace('session_', '');
                    // If it's a chunk, get the parent session ID
                    if (sessionId.includes('_chunk_')) {
                        sessionId = sessionId.split('_chunk_')[0];
                    }
                }

                if (sessionId && !seenSessionIds.has(sessionId)) {
                    const sessionData = await this.loadSession(sessionId);
                    if (sessionData) {
                        sessions.push({
                            id: sessionId,
                            title: sessionData.title || 'Untitled Chat',
                            created_at: sessionData.created_at,
                            updated_at: sessionData.updated_at,
                            message_count: sessionData.messages.length,
                            preview: this._getSessionPreview(sessionData.messages),
                            relevance: result.relevance // Keep relevance from memory search
                        });
                        seenSessionIds.add(sessionId);
                    } else {
                        log(`[DEBUG] Could not load session data for ID: ${sessionId}`);
                    }
                } else if (!sessionId) {
                    log(`[DEBUG] Memory result missing session ID or not a session type: ${result.id}`);
                }
            }
            
            log(`[DEBUG] searchSessions returning ${sessions.length} unique sessions.`);
            return sessions;
        } catch (error) {
            log(`Error searching sessions: ${error.message}`);
            return [];
        }
    }

    async searchSessionChunks(query, sessionId, top_k = 3) {
        try {
            // Use memory service to search for relevant chunks within a session
            const results = await this._memoryService.getRelevantMemories(query, top_k);
            
            // Filter for chunks from the specified session
            const chunks = [];
            for (const result of results) {
                if (result.context.type === 'session_chunk' && 
                    result.context.conversation_id === sessionId) {
                    chunks.push({
                        index: result.context.chunk_index,
                        text: result.text,
                        relevance: result.relevance
                    });
                }
            }
            
            return chunks;
        } catch (error) {
            log(`Error searching session chunks: ${error.message}`);
            return [];
        }
    }

    deleteSession(sessionId) {
        try {
            const file = Gio.File.new_for_path(this._getSessionFilePath(sessionId));
            if (file.query_exists(null)) {
                file.delete(null);
                return true;
            }
            return false;
        } catch (error) {
            log(`Error deleting session: ${error.message}`);
            return false;
        }
    }

    _generateSessionTitle(messages) {
        // Try to find a meaningful title from the first user message
        const firstUserMessage = messages.find(msg => msg.sender === 'user');
        if (firstUserMessage) {
            const text = firstUserMessage.text;
            // Truncate long messages
            return text.length > 50 ? text.substring(0, 47) + '...' : text;
        }
        // Fallback to timestamp
        return `Chat ${new Date().toLocaleString()}`;
    }

    _getSessionPreview(messages) {
        // Get the last few messages for preview
        const recentMessages = messages.slice(-3);
        return recentMessages.map(msg => {
            if (msg.sender === 'user') {
                return `User: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`;
            } else if (msg.sender === 'ai') {
                return `AI: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`;
            }
            return '';
        }).filter(Boolean).join('\n');
    }
}

// Export the SessionManager class
var SessionManager = GObject.registerClass(
    class SessionManager extends GObject.Object {
        static [GObject.signals] = {
            'session-saved': { param_types: [GObject.TYPE_STRING] },
            'session-loaded': { param_types: [GObject.TYPE_STRING] },
            'session-deleted': { param_types: [GObject.TYPE_STRING] }
        };

        _init() {
            super._init();
            this._manager = new SessionManagerCore();
        }

        async saveSession(sessionId, messages, metadata) {
            const success = await this._manager.saveSession(sessionId, messages, metadata);
            if (success) {
                this.emit('session-saved', sessionId);
            }
            return success;
        }

        async loadSession(sessionId) {
            return await this._manager.loadSession(sessionId);
        }

        async listSessions() {
            return await this._manager.listSessions();
        }

        async searchSessions(query, top_k) {
            return await this._manager.searchSessions(query, top_k);
        }

        async searchSessionChunks(query, sessionId, top_k) {
            return await this._manager.searchSessionChunks(query, sessionId, top_k);
        }

        deleteSession(sessionId) {
            const success = this._manager.deleteSession(sessionId);
            if (success) {
                this.emit('session-deleted', sessionId);
            }
            return success;
        }
    }
); 