'use strict';

// DEPRECATED: This class is no longer used. Session history functionality 
// has been integrated directly into the main chat window in extension.js.
// This file is kept for compatibility but will be removed in a future version.

const { GObject, St, Clutter, Pango } = imports.gi;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Signals = imports.signals;

var SessionHistory = class SessionHistory extends PopupMenu.PopupMenu {
    _init(sourceActor, sessionManager) {
        super._init(sourceActor, 0.5, St.Side.TOP);
        
        this._sessionManager = sessionManager;
        this._sessions = [];
        
        // Add header
        const header = new PopupMenu.PopupMenuItem('Chat History', {
            reactive: false,
            style_class: 'session-history-header'
        });
        this.addMenuItem(header);
        
        // Add separator
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add "New Chat" button
        const newChatItem = new PopupMenu.PopupMenuItem('New Chat');
        newChatItem.connect('activate', () => {
            log('New chat menu item activated');
            this.emit('new-chat');
            this.close();
        });
        this.addMenuItem(newChatItem);
        
        // Add another separator
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add sessions container
        this._sessionsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'session-history-list'
        });
        
        const sessionsContainer = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'session-history-container'
        });
        sessionsContainer.add_child(this._sessionsBox);
        this.addMenuItem(sessionsContainer);
        
        // Connect to session manager signals
        this._sessionManager.connect('session-saved', () => this._refreshSessions());
        this._sessionManager.connect('session-deleted', () => this._refreshSessions());
        
        // Initial load
        this._refreshSessions();
    }
    
    _refreshSessions() {
        log('Refreshing session list');
        // Clear existing sessions
        this._sessionsBox.destroy_all_children();
        
        // Get updated session list
        this._sessions = this._sessionManager.listSessions();
        
        if (this._sessions.length === 0) {
            log('No sessions found');
            const noSessions = new St.Label({
                text: 'No saved chats',
                style_class: 'session-history-empty'
            });
            this._sessionsBox.add_child(noSessions);
            return;
        }
        
        log(`Found ${this._sessions.length} sessions`);
        // Add each session
        this._sessions.forEach(session => {
            const sessionItem = this._createSessionItem(session);
            this._sessionsBox.add_child(sessionItem);
        });
    }
    
    _createSessionItem(session) {
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
            this.emit('resume-session', session.id);
            this.close();
        });
        
        const deleteButton = new St.Button({
            label: 'Delete',
            style_class: 'session-history-button session-history-button-delete'
        });
        deleteButton.connect('clicked', () => {
            log(`Delete button clicked for session: ${session.id}`);
            this._sessionManager.deleteSession(session.id);
        });
        
        buttonBox.add_child(resumeButton);
        buttonBox.add_child(deleteButton);
        
        // Add all components
        item.add_child(headerBox);
        item.add_child(preview);
        item.add_child(buttonBox);
        
        return item;
    }
};

// Add Signals to SessionHistory prototype
Signals.addSignalMethods(SessionHistory.prototype); 