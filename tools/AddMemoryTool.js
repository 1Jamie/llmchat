'use strict';

const { GObject, Soup, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

var Tool = GObject.registerClass(
class AddMemoryTool extends BaseTool {
    _init() {
        super._init({
            name: 'add_memory',
            description: 'Store important information in the memory system for future reference. Use this tool when you need to: save user preferences, remember personal information, store important decisions, or keep track of significant details. The memory system can store text with optional context metadata (like importance level, tags, or source). This tool is essential for maintaining continuity in conversations and remembering user-specific information. Use it whenever you learn something important about the user or their preferences.',
            category: 'memory',
            keywords: ['memory', 'remember', 'store', 'save', 'preference', 'information', 'context', 'metadata', 'tag', 'important', 'reference', 'future', 'recall', 'retrieve', 'persist'],
            parameters: {
                text: {
                    type: 'string',
                    description: 'The memory content to store.'
                },
                context: {
                    type: 'object',
                    description: 'Optional metadata or context for this memory.'
                }
            }
        });
    }

    async execute(params = {}) {
        const { text, context } = params;
        if (!text) return { error: 'Missing text parameter' };
        try {
            // Create HTTP session if not exists
            if (!this._httpSession) {
                this._httpSession = new Soup.Session();
            }

            // Prepare the memory data
            const memoryData = {
                namespace: 'memories',
                documents: [{
                    id: Date.now().toString(),
                    text: text,
                    context: {
                        timestamp: new Date().toISOString(),
                        conversation_id: context?.conversation_id || 'default',
                        response: context?.response || '',
                        relevant_memories: context?.relevant_memories || [],
                        tool_results: context?.tool_results || [],
                        metadata: {
                            type: context?.type || 'conversation',
                            importance: context?.importance || 'normal',
                            tags: context?.tags || [],
                            source: context?.source || 'user'
                        }
                    }
                }]
            };

            // Create and send the request
            const message = Soup.Message.new('POST', 'http://localhost:5000/index');
            message.request_headers.append('Content-Type', 'application/json');
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(memoryData)));

            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code !== 200) {
                        const errorMsg = `Failed to add memory: ${msg.status_code} - ${msg.reason_phrase}`;
                        log(errorMsg);
                        resolve({ success: false, error: errorMsg });
                        return;
                    }

                    try {
                        const response = JSON.parse(msg.response_body.data);
                        log(`Memory added successfully: ${text}`);
                        resolve({ 
                            success: true, 
                            message: 'Memory added successfully.',
                            indexed: response.indexed
                        });
                    } catch (e) {
                        log(`Error parsing response: ${e.message}`);
                        resolve({ success: false, error: e.message });
                    }
                });
            });
        } catch (e) {
            log(`Error in add_memory tool: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
}); 