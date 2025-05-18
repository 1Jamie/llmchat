'use strict';

const { Gio, GLib, GObject } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

class SessionManagerCore {
    constructor() {
        this._sessionDir = GLib.build_filenamev([
            GLib.get_user_config_dir(),
            'llmchat',
            'sessions'
        ]);
        this._ensureSessionDir();
    }

    _ensureSessionDir() {
        const dir = Gio.File.new_for_path(this._sessionDir);
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }
    }

    _getSessionFilePath(sessionId) {
        return GLib.build_filenamev([
            this._sessionDir,
            `session-${sessionId}.json`
        ]);
    }

    saveSession(sessionId, messages, metadata = {}) {
        try {
            const sessionData = {
                id: sessionId,
                messages: messages,
                title: metadata.title || this._generateSessionTitle(messages),
                created_at: metadata.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                settings: metadata.settings || {},
                tool_results: metadata.tool_results || []
            };

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

            return true;
        } catch (error) {
            log(`Error saving session: ${error.message}`);
            return false;
        }
    }

    loadSession(sessionId) {
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

    listSessions() {
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
                    const sessionData = this.loadSession(sessionId);
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

        saveSession(sessionId, messages, metadata) {
            const success = this._manager.saveSession(sessionId, messages, metadata);
            if (success) {
                this.emit('session-saved', sessionId);
            }
            return success;
        }

        loadSession(sessionId) {
            return this._manager.loadSession(sessionId);
        }

        listSessions() {
            return this._manager.listSessions();
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