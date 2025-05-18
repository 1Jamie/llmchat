'use strict';

const { GObject, Meta, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;
const Main = imports.ui.main;

var Tool = GObject.registerClass(
class WindowLayoutTool extends BaseTool {
    _init() {
        super._init({
            name: 'get_window_layout',
            description: 'Get detailed information about the current window layout across all workspaces and monitors',
            category: 'window',
            parameters: {
                include_minimized: {
                    type: 'boolean',
                    description: 'Whether to include minimized windows in the layout information',
                    default: false
                }
            }
        });

        this._windowTracker = Shell.WindowTracker.get_default();
        this._workspaceManager = global.workspace_manager;
        this._displayManager = global.display;
        // Track last known monitor for each window by id
        this._windowMonitorMap = new Map();
        this._settings = ExtensionUtils.getSettings();
        this._loadWindowMonitorMap();
    }

    _loadWindowMonitorMap() {
        try {
            const raw = this._settings.get_string('window-monitor-map');
            if (raw) {
                const obj = JSON.parse(raw);
                this._windowMonitorMap = new Map(Object.entries(obj));
            }
        } catch (e) {
            log('Failed to load window monitor map: ' + e.message);
        }
    }

    _saveWindowMonitorMap() {
        try {
            // Convert Map to plain object for JSON
            const obj = {};
            for (const [id, data] of this._windowMonitorMap.entries()) {
                obj[id] = data;
            }
            this._settings.set_string('window-monitor-map', JSON.stringify(obj));
        } catch (e) {
            log('Failed to save window monitor map: ' + e.message);
        }
    }

    execute(params = {}) {
        try {
            if (!this._windowTracker) {
                this._windowTracker = Shell.WindowTracker.get_default();
            }
            const { include_minimized = false } = params;
            const workspaceCount = this._workspaceManager.get_n_workspaces();
            const activeWorkspaceIndex = this._workspaceManager.get_active_workspace_index();
            
            // Get monitor information
            const monitors = Main.layoutManager.monitors;
            const monitorInfo = monitors.map((monitor, index) => {
                const workArea = Main.layoutManager.getWorkAreaForMonitor(index);
                return {
                    index,
                    is_primary: monitor.is_primary,
                    geometry: {
                        x: monitor.x,
                        y: monitor.y,
                        width: monitor.width,
                        height: monitor.height
                    },
                    work_area: {
                        x: workArea.x,
                        y: workArea.y,
                        width: workArea.width,
                        height: workArea.height
                    }
                };
            });

            // Get window information for each workspace
            const workspaces = [];
            for (let i = 0; i < workspaceCount; i++) {
                const workspace = this._workspaceManager.get_workspace_by_index(i);
                const windows = workspace.list_windows();
                
                const workspaceWindows = windows
                    .filter(window => !window.is_skip_taskbar() && (include_minimized || !window.minimized))
                    .map(window => {
                        const app = this._windowTracker.get_window_app(window);
                        const frameRect = window.get_frame_rect();
                        const monitorIndex = window.get_monitor();
                        const windowId = window.get_id();
                        // Advanced persistent tracking
                        let data = this._windowMonitorMap.get(windowId) || { last_known_monitor_index: null, monitor_history: [] };
                        if (data.last_known_monitor_index !== monitorIndex) {
                            data.last_known_monitor_index = monitorIndex;
                            data.monitor_history.push(monitorIndex);
                            // Cap history to 10
                            if (data.monitor_history.length > 10) data.monitor_history = data.monitor_history.slice(-10);
                            this._windowMonitorMap.set(windowId, data);
                            this._saveWindowMonitorMap();
                        }
                        return {
                            id: windowId,
                            title: window.get_title(),
                            app_id: app ? app.get_id() : null,
                            app_name: app ? app.get_name() : null,
                            position: { x: frameRect.x, y: frameRect.y },
                            size: { width: frameRect.width, height: frameRect.height },
                            frame_rect: { x: frameRect.x, y: frameRect.y, width: frameRect.width, height: frameRect.height },
                            is_maximized: window.maximized_horizontally && window.maximized_vertically,
                            is_minimized: window.minimized,
                            is_focused: window.has_focus(),
                            monitor_index: monitorIndex,
                            last_known_monitor_index: data.last_known_monitor_index,
                            monitor_history: data.monitor_history
                        };
                    });

                workspaces.push({
                    index: i,
                    is_active: i === activeWorkspaceIndex,
                    windows: workspaceWindows
                });
            }

            return {
                success: true,
                timestamp: Date.now(),
                active_workspace: activeWorkspaceIndex,
                monitors: monitorInfo,
                workspaces: workspaces,
                message: `Retrieved window layout information for ${workspaceCount} workspaces and ${monitors.length} monitors`
            };
        } catch (error) {
            return { error: `Failed to get window layout: ${error.message}` };
        }
    }
}); 