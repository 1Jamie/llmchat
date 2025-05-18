'use strict';

const { GObject, Meta, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;
const Main = imports.ui.main;

var Tool = GObject.registerClass(
class WindowManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'window_management',
            description: 'Advanced window management including content-based organization, multiple layout options, and workspace integration. For any action that targets a specific window (such as move, resize, close, etc.), you MUST provide the window_id from the get_window_layout tool.',
            category: 'window',
            parameters: {
                action: {
                    type: 'string',
                    enum: [
                        'minimize_all', 'maximize_current', 'maximize_all', 
                        'arrange_grid', 'arrange_cascade', 'arrange_vertical',
                        'arrange_horizontal', 'arrange_by_content', 'move',
                        'resize', 'close_current', 'move_to_workspace',
                        'tile_left', 'tile_right', 'tile_top', 'tile_bottom',
                        'center', 'snap_to_grid', 'save_layout', 'restore_layout',
                        'smart_arrange', 'move_group', 'focus_next', 'focus_prev',
                        'focus_group', 'set_window_rule', 'get_window_stats',
                        'move_to_monitor', 'arrange_on_monitor', 'get_monitor_info',
                        'clone_to_monitor', 'mirror_layout', 'handle_monitor_change',
                        'save_monitor_state', 'restore_monitor_state',
                        'smart_arrange_by_content', 'smart_arrange_by_importance',
                        'smart_arrange_by_usage', 'smart_arrange_by_project'
                    ],
                    description: 'Window action to perform'
                },
                rows: {
                    type: 'integer',
                    description: 'Number of rows for grid arrangement (default: 2)'
                },
                cols: {
                    type: 'integer',
                    description: 'Number of columns for grid arrangement (default: 2)'
                },
                x: {
                    type: 'integer',
                    description: 'X coordinate for window position'
                },
                y: {
                    type: 'integer',
                    description: 'Y coordinate for window position'
                },
                width: {
                    type: 'integer',
                    description: 'Width for window resizing'
                },
                height: {
                    type: 'integer',
                    description: 'Height for window resizing'
                },
                workspace: {
                    type: 'integer',
                    description: 'Target workspace index (1-based)'
                },
                content_type: {
                    type: 'string',
                    enum: ['browser', 'editor', 'terminal', 'media', 'chat', 'other'],
                    description: 'Content type for content-based arrangement'
                },
                layout_name: {
                    type: 'string',
                    description: 'Name for saving/restoring window layouts'
                },
                profile: {
                    type: 'string',
                    description: 'Window management profile (e.g., "work", "gaming", "presentation")'
                },
                group_id: {
                    type: 'string',
                    description: 'Identifier for window group operations'
                },
                rule_type: {
                    type: 'string',
                    enum: ['always_maximize', 'always_minimize', 'always_on_top', 'transparency'],
                    description: 'Type of window rule to apply'
                },
                rule_value: {
                    type: 'any',
                    description: 'Value for the window rule (e.g., transparency level)'
                },
                monitor: {
                    type: 'integer',
                    description: 'Target monitor index (0-based)'
                },
                monitor_layout: {
                    type: 'string',
                    enum: ['primary', 'secondary', 'all'],
                    description: 'Monitor layout to apply'
                },
                monitor_state: {
                    type: 'string',
                    description: 'Name of the monitor state to save/restore'
                },
                auto_arrange: {
                    type: 'boolean',
                    description: 'Whether to automatically arrange windows after monitor changes'
                },
                arrangement_mode: {
                    type: 'string',
                    enum: ['content', 'importance', 'usage', 'project', 'auto'],
                    description: 'Mode for smart arrangement'
                },
                project_context: {
                    type: 'string',
                    description: 'Project context for window organization'
                },
                window_id: {
                    type: 'string',
                    description: 'The unique window ID (from get_window_layout) for targeting a specific window. REQUIRED for actions like move, resize, close, etc.'
                }
            }
        });
        
        this._workspaceManager = global.workspace_manager;
        this._windowTracker = Shell.WindowTracker.get_default();
        this._displayManager = global.display;
        this._layoutManager = Main.layoutManager;
        
        // Initialize window state storage
        this._windowStates = new Map();
        this._windowRules = new Map();
        this._focusHistory = [];
        this._maxFocusHistory = 10;
        this._monitorStates = new Map();
        
        // Initialize window usage tracking
        this._windowUsage = new Map();
        this._windowImportance = new Map();
        this._projectContexts = new Map();
        
        // Load saved states
        this._loadSavedStates();
        
        // Connect to monitor change signals
        this._connectMonitorSignals();
        
        // Start usage tracking
        this._startUsageTracking();
        
        // Initialize with information about capabilities and recent changes
        log('WindowManagementTool initialized with the following capabilities:');
        log('1. Minimize all windows simultaneously');
        log('2. Maximize current focused window');
        log('3. NEW: Maximize all windows simultaneously using global.get_window_actors()');
        log('4. Arrange windows in a customizable grid layout (rows x columns)');
        log('5. Move focused window to specific coordinates');
        log('6. Resize focused window to specific dimensions');
        log('7. Close current focused window');
        log('8. All operations use the modern GNOME Shell window management APIs');
    }

    _connectMonitorSignals() {
        try {
            // Connect to monitor change signals
            this._monitorChangedId = this._layoutManager.connect('monitors-changed', () => {
                this._handleMonitorChange();
            });

            // Connect to workspace change signals
            this._workspaceChangedId = this._workspaceManager.connect('workspace-switched', () => {
                this._handleWorkspaceChange();
            });

            log('Connected to monitor and workspace change signals');
        } catch (error) {
            log(`Error connecting to monitor signals: ${error.message}`);
        }
    }

    _disconnectMonitorSignals() {
        try {
            if (this._monitorChangedId) {
                this._layoutManager.disconnect(this._monitorChangedId);
                this._monitorChangedId = null;
            }
            if (this._workspaceChangedId) {
                this._workspaceManager.disconnect(this._workspaceChangedId);
                this._workspaceChangedId = null;
            }
            log('Disconnected from monitor and workspace change signals');
        } catch (error) {
            log(`Error disconnecting from monitor signals: ${error.message}`);
        }
    }

    _handleMonitorChange() {
        try {
            const monitorInfo = this._getMonitorInfo();
            if (!monitorInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            // Save current window states before rearrangement
            const currentState = this._saveCurrentMonitorState('temp');
            
            // Get windows that were on disconnected monitors
            const windows = this._getWindowsOnWorkspace();
            const workArea = this._layoutManager.getWorkAreaForMonitor(
                this._layoutManager.primaryIndex
            );

            // Move windows to primary monitor if they're outside any monitor
            windows.forEach(window => {
                const [x, y] = window.get_position();
                let isOnAnyMonitor = false;

                for (let i = 0; i < monitorInfo.monitors.length; i++) {
                    const monitor = monitorInfo.monitors[i];
                    if (x >= monitor.geometry.x && x < monitor.geometry.x + monitor.geometry.width &&
                        y >= monitor.geometry.y && y < monitor.geometry.y + monitor.geometry.height) {
                        isOnAnyMonitor = true;
                        break;
                    }
                }

                if (!isOnAnyMonitor) {
                    // Move window to primary monitor
                    const [width, height] = window.get_size();
                    const newX = workArea.x + (workArea.width - width) / 2;
                    const newY = workArea.y + (workArea.height - height) / 2;

                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_frame(true, newX, newY);
                }
            });

            // Restore previous layout if possible
            if (currentState.success) {
                this._restoreMonitorState('temp', true);
            }

            return {
                success: true,
                monitor_count: monitorInfo.count,
                message: `Handled monitor change with ${monitorInfo.count} monitors`
            };
        } catch (error) {
            return { error: `Failed to handle monitor change: ${error.message}` };
        }
    }

    _handleWorkspaceChange() {
        try {
            const monitorInfo = this._getMonitorInfo();
            if (!monitorInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            // Check if any windows are outside monitor bounds
            const windows = this._getWindowsOnWorkspace();
            const workArea = this._layoutManager.getWorkAreaForMonitor(
                this._layoutManager.primaryIndex
            );

            windows.forEach(window => {
                const [x, y] = window.get_position();
                let isOnAnyMonitor = false;

                for (let i = 0; i < monitorInfo.monitors.length; i++) {
                    const monitor = monitorInfo.monitors[i];
                    if (x >= monitor.geometry.x && x < monitor.geometry.x + monitor.geometry.width &&
                        y >= monitor.geometry.y && y < monitor.geometry.y + monitor.geometry.height) {
                        isOnAnyMonitor = true;
                        break;
                    }
                }

                if (!isOnAnyMonitor) {
                    // Move window to primary monitor
                    const [width, height] = window.get_size();
                    const newX = workArea.x + (workArea.width - width) / 2;
                    const newY = workArea.y + (workArea.height - height) / 2;

                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_frame(true, newX, newY);
                }
            });

            return {
                success: true,
                message: 'Handled workspace change'
            };
        } catch (error) {
            return { error: `Failed to handle workspace change: ${error.message}` };
        }
    }

    _saveCurrentMonitorState(name) {
        try {
            const monitorInfo = this._getMonitorInfo();
            if (!monitorInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            const windows = this._getWindowsOnWorkspace();
            const windowStates = windows.map(window => {
                const [x, y] = window.get_position();
                const [width, height] = window.get_size();
                const app = this._windowTracker.get_window_app(window);
                return {
                    id: window.get_id(),
                    title: window.get_title(),
                    app_id: app ? app.get_id() : null,
                    position: { x, y },
                    size: { width, height },
                    is_maximized: window.maximized_horizontally && window.maximized_vertically,
                    workspace: window.get_workspace().index()
                };
            });

            const state = {
                timestamp: Date.now(),
                monitors: monitorInfo.monitors,
                windows: windowStates
            };

            this._monitorStates.set(name, state);
            this._saveStates();

            return {
                success: true,
                state_name: name,
                window_count: windowStates.length,
                monitor_count: monitorInfo.count,
                message: `Saved monitor state '${name}' with ${windowStates.length} windows`
            };
        } catch (error) {
            return { error: `Failed to save monitor state: ${error.message}` };
        }
    }

    _restoreMonitorState(name, isTemporary = false) {
        try {
            const state = this._monitorStates.get(name);
            if (!state) {
                return { error: `Monitor state '${name}' not found` };
            }

            const currentMonitorInfo = this._getMonitorInfo();
            if (!currentMonitorInfo.success) {
                return { error: 'Failed to get current monitor information' };
            }

            // Calculate scaling factors for each monitor
            const monitorScales = new Map();
            state.monitors.forEach((savedMonitor, index) => {
                const currentMonitor = currentMonitorInfo.monitors[index];
                if (currentMonitor) {
                    monitorScales.set(index, {
                        x: currentMonitor.geometry.width / savedMonitor.geometry.width,
                        y: currentMonitor.geometry.height / savedMonitor.geometry.height
                    });
                }
            });

            // Restore window positions with scaling
            state.windows.forEach(savedWindow => {
                const matchingWindow = this._getWindowsOnWorkspace().find(w => {
                    const app = this._windowTracker.get_window_app(w);
                    return app && app.get_id() === savedWindow.app_id;
                });

                if (matchingWindow) {
                    // Find which monitor the window was on
                    const monitorIndex = state.monitors.findIndex(monitor => 
                        savedWindow.position.x >= monitor.geometry.x &&
                        savedWindow.position.x < monitor.geometry.x + monitor.geometry.width &&
                        savedWindow.position.y >= monitor.geometry.y &&
                        savedWindow.position.y < monitor.geometry.y + monitor.geometry.height
                    );

                    if (monitorIndex !== -1 && monitorScales.has(monitorIndex)) {
                        const scale = monitorScales.get(monitorIndex);
                        const currentMonitor = currentMonitorInfo.monitors[monitorIndex];

                        if (savedWindow.is_maximized) {
                            matchingWindow.maximize(Meta.MaximizeFlags.BOTH);
                        } else {
                            matchingWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                            
                            // Calculate new position and size with scaling
                            const newX = currentMonitor.geometry.x + 
                                (savedWindow.position.x - state.monitors[monitorIndex].geometry.x) * scale.x;
                            const newY = currentMonitor.geometry.y + 
                                (savedWindow.position.y - state.monitors[monitorIndex].geometry.y) * scale.y;
                            const newWidth = savedWindow.size.width * scale.x;
                            const newHeight = savedWindow.size.height * scale.y;

                            matchingWindow.move_resize_frame(true, newX, newY, newWidth, newHeight);
                        }
                    }
                }
            });

            if (isTemporary) {
                this._monitorStates.delete(name);
            }

            return {
                success: true,
                state_name: name,
                message: `Restored monitor state '${name}'`
            };
        } catch (error) {
            return { error: `Failed to restore monitor state: ${error.message}` };
        }
    }

    _saveStates() {
        try {
            const settings = ExtensionUtils.getSettings();
            settings.set_string('window-states', JSON.stringify(Array.from(this._windowStates.entries())));
            settings.set_string('monitor-states', JSON.stringify(Array.from(this._monitorStates.entries())));
        } catch (error) {
            log(`Error saving states: ${error.message}`);
        }
    }

    _loadSavedStates() {
        try {
            const settings = ExtensionUtils.getSettings();
            const savedWindowStates = settings.get_string('window-states');
            const savedMonitorStates = settings.get_string('monitor-states');

            if (savedWindowStates) {
                this._windowStates = new Map(JSON.parse(savedWindowStates));
            }
            if (savedMonitorStates) {
                this._monitorStates = new Map(JSON.parse(savedMonitorStates));
            }
        } catch (error) {
            log(`Error loading saved states: ${error.message}`);
        }
    }

    _startUsageTracking() {
        try {
            // Track window focus changes
            this._focusChangedId = global.display.connect('notify::focus-window', () => {
                const window = global.display.get_focus_window();
                if (window) {
                    this._updateWindowUsage(window);
                }
            });

            // Track window title changes
            this._windowTitleChangedId = global.window_manager.connect('switch-workspace', () => {
                this._updateWindowTitles();
            });

            log('Started window usage tracking');
        } catch (error) {
            log(`Error starting usage tracking: ${error.message}`);
        }
    }

    _updateWindowUsage(window) {
        try {
            const now = Date.now();
            const windowId = window.get_id();
            const app = this._windowTracker.get_window_app(window);
            
            if (!app) return;

            const appId = app.get_id();
            const title = window.get_title();

            // Update usage statistics
            if (!this._windowUsage.has(windowId)) {
                this._windowUsage.set(windowId, {
                    app_id: appId,
                    title: title,
                    first_seen: now,
                    last_seen: now,
                    focus_count: 1,
                    total_focus_time: 0,
                    last_focus_start: now
                });
            } else {
                const usage = this._windowUsage.get(windowId);
                usage.last_seen = now;
                usage.focus_count++;
                usage.total_focus_time += (now - usage.last_focus_start);
                usage.last_focus_start = now;
            }

            // Update importance based on usage
            this._updateWindowImportance(windowId);
        } catch (error) {
            log(`Error updating window usage: ${error.message}`);
        }
    }

    _updateWindowImportance(windowId) {
        try {
            const usage = this._windowUsage.get(windowId);
            if (!usage) return;

            const appId = usage.app_id.toLowerCase();
            let importance = 1; // Default importance

            // Base importance on application type
            if (appId.includes('code') || appId.includes('sublime')) {
                importance = 3; // High importance for editors
            } else if (appId.includes('firefox') || appId.includes('chrome')) {
                importance = 2; // Medium importance for browsers
            } else if (appId.includes('terminal')) {
                importance = 2; // Medium importance for terminals
            }

            // Adjust importance based on usage
            const focusTime = usage.total_focus_time / 1000; // Convert to seconds
            if (focusTime > 3600) { // More than 1 hour of focus
                importance += 1;
            }
            if (usage.focus_count > 10) { // Frequently focused
                importance += 1;
            }

            this._windowImportance.set(windowId, importance);
        } catch (error) {
            log(`Error updating window importance: ${error.message}`);
        }
    }

    _updateWindowTitles() {
        try {
            const windows = this._getWindowsOnWorkspace();
            windows.forEach(window => {
                const windowId = window.get_id();
                const usage = this._windowUsage.get(windowId);
                if (usage) {
                    usage.title = window.get_title();
                }
            });
        } catch (error) {
            log(`Error updating window titles: ${error.message}`);
        }
    }

    execute(params = {}) {
        const { action, arrangement_mode, monitor_state, auto_arrange, ...otherParams } = params;

        try {
        switch (action) {
            case 'minimize_all':
                return this._minimizeAllWindows();
            case 'maximize_current':
                return this._maximizeCurrentWindow();
            case 'maximize_all':
                return this._maximizeAllWindows();
            case 'arrange_grid':
                    return this._arrangeWindowsInGrid(params.rows || 2, params.cols || 2);
                case 'arrange_cascade':
                    return this._arrangeWindowsCascade();
                case 'arrange_vertical':
                    return this._arrangeWindowsVertical();
                case 'arrange_horizontal':
                    return this._arrangeWindowsHorizontal();
                case 'arrange_by_content':
                    return this._arrangeWindowsByContent(params.content_type);
            case 'move':
                return this._moveWindow(params.x, params.y, params.window_id);
            case 'resize':
                    return this._resizeWindow(params.width, params.height);
            case 'close_current':
                return this._closeCurrentWindow();
                case 'move_to_workspace':
                    return this._moveWindowToWorkspace(params.workspace);
                case 'tile_left':
                    return this._tileWindow('left');
                case 'tile_right':
                    return this._tileWindow('right');
                case 'tile_top':
                    return this._tileWindow('top');
                case 'tile_bottom':
                    return this._tileWindow('bottom');
                case 'center':
                    return this._centerWindow();
                case 'snap_to_grid':
                    return this._snapWindowToGrid();
                case 'save_layout':
                    return this._saveWindowLayout(params.layout_name);
                case 'restore_layout':
                    return this._restoreWindowLayout(params.layout_name);
                case 'smart_arrange':
                    return this._smartArrangeWindows(arrangement_mode || 'auto');
                case 'smart_arrange_by_content':
                    return this._smartArrangeWindows('content');
                case 'smart_arrange_by_importance':
                    return this._smartArrangeWindows('importance');
                case 'smart_arrange_by_usage':
                    return this._smartArrangeWindows('usage');
                case 'smart_arrange_by_project':
                    return this._smartArrangeWindows('project');
                case 'move_group':
                    return this._moveWindowGroup(params.group_id, params.workspace);
                case 'focus_next':
                    return this._focusNextWindow();
                case 'focus_prev':
                    return this._focusPreviousWindow();
                case 'focus_group':
                    return this._focusWindowGroup(params.group_id);
                case 'set_window_rule':
                    return this._setWindowRule(this._getActiveWindow(), params.rule_type, params.rule_value);
                case 'get_window_stats':
                    return this._getWindowStats();
                case 'move_to_monitor':
                    return this._moveWindowToMonitor(this._getActiveWindow(), params.monitor);
                case 'arrange_on_monitor':
                    return this._arrangeWindowsOnMonitor(params.monitor, params.monitor_layout);
                case 'get_monitor_info':
                    return this._getMonitorInfo(params.monitor);
                case 'clone_to_monitor':
                    return this._cloneToMonitor(params.source_monitor, params.target_monitor);
                case 'mirror_layout':
                    return this._mirrorLayout(params.source_monitor, params.target_monitor);
                case 'handle_monitor_change':
                    return this._handleMonitorChange();
                case 'save_monitor_state':
                    return this._saveCurrentMonitorState(params.monitor_state);
                case 'restore_monitor_state':
                    return this._restoreMonitorState(params.monitor_state);
            default:
                return { error: 'Invalid window management action' };
            }
        } catch (error) {
            return { error: `Failed to execute window action: ${error.message}` };
        }
    }

    _getActiveWindow() {
        const focusWindow = global.display.get_focus_window();
        if (!focusWindow) {
            throw new Error('No active window found');
        }
        return focusWindow;
    }

    _getWindowsOnWorkspace(workspace = null) {
        const targetWorkspace = workspace || this._workspaceManager.get_active_workspace();
        return global.get_window_actors()
            .map(actor => actor.get_meta_window())
            .filter(window => window && 
                           !window.is_skip_taskbar() && 
                           window.get_workspace() === targetWorkspace);
    }

    _arrangeWindowsCascade() {
        try {
            const windows = this._getWindowsOnWorkspace();
            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            
            const offset = 30; // Pixel offset for cascade effect
            const baseWidth = workArea.width * 0.8;
            const baseHeight = workArea.height * 0.8;

            windows.forEach((window, index) => {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(
                    true,
                    workArea.x + (index * offset),
                    workArea.y + (index * offset),
                    baseWidth,
                    baseHeight
                );
            });

            return {
                success: true,
                count: windows.length,
                layout: 'cascade',
                message: `Arranged ${windows.length} windows in cascade layout`
            };
        } catch (error) {
            return { error: `Failed to arrange windows in cascade: ${error.message}` };
        }
    }

    _arrangeWindowsVertical() {
        try {
            const windows = this._getWindowsOnWorkspace();
            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            
            const windowHeight = workArea.height / windows.length;

            windows.forEach((window, index) => {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(
                    true,
                    workArea.x,
                    workArea.y + (index * windowHeight),
                    workArea.width,
                    windowHeight
                );
            });

            return {
                success: true,
                count: windows.length,
                layout: 'vertical',
                message: `Arranged ${windows.length} windows vertically`
            };
        } catch (error) {
            return { error: `Failed to arrange windows vertically: ${error.message}` };
        }
    }

    _arrangeWindowsHorizontal() {
        try {
            const windows = this._getWindowsOnWorkspace();
            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            
            const windowWidth = workArea.width / windows.length;

            windows.forEach((window, index) => {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(
                    true,
                    workArea.x + (index * windowWidth),
                    workArea.y,
                    windowWidth,
                    workArea.height
                );
            });

            return {
                success: true,
                count: windows.length,
                layout: 'horizontal',
                message: `Arranged ${windows.length} windows horizontally`
            };
        } catch (error) {
            return { error: `Failed to arrange windows horizontally: ${error.message}` };
        }
    }

    _arrangeWindowsByContent(contentType) {
        try {
            const windows = this._getWindowsOnWorkspace();
            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            // Group windows by content type
            const groupedWindows = new Map();
            windows.forEach(window => {
                const app = this._windowTracker.get_window_app(window);
                if (!app) return;

                const appId = app.get_id().toLowerCase();
                let type = 'other';

                if (appId.includes('firefox') || appId.includes('chrome') || appId.includes('brave')) {
                    type = 'browser';
                } else if (appId.includes('code') || appId.includes('sublime') || appId.includes('gedit')) {
                    type = 'editor';
                } else if (appId.includes('terminal') || appId.includes('gnome-terminal')) {
                    type = 'terminal';
                } else if (appId.includes('vlc') || appId.includes('mpv') || appId.includes('totem')) {
                    type = 'media';
                } else if (appId.includes('slack') || appId.includes('discord') || appId.includes('telegram')) {
                    type = 'chat';
                }

                if (!groupedWindows.has(type)) {
                    groupedWindows.set(type, []);
                }
                groupedWindows.get(type).push(window);
            });

            // If content type is specified, only arrange windows of that type
            const windowsToArrange = contentType ? 
                (groupedWindows.get(contentType) || []) : 
                windows;

            if (windowsToArrange.length === 0) {
                return { error: `No windows found of type: ${contentType}` };
            }

            // Arrange the windows in a grid
            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            
            const cols = Math.ceil(Math.sqrt(windowsToArrange.length));
            const rows = Math.ceil(windowsToArrange.length / cols);
            const cellWidth = workArea.width / cols;
            const cellHeight = workArea.height / rows;

            windowsToArrange.forEach((window, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(
                    true,
                    workArea.x + (col * cellWidth),
                    workArea.y + (row * cellHeight),
                    cellWidth,
                    cellHeight
                );
            });

            return {
                success: true,
                count: windowsToArrange.length,
                content_type: contentType || 'all',
                layout: 'content-based',
                message: `Arranged ${windowsToArrange.length} windows by content type: ${contentType || 'all'}`
            };
        } catch (error) {
            return { error: `Failed to arrange windows by content: ${error.message}` };
        }
    }

    _moveWindowToWorkspace(workspaceIndex) {
        try {
            if (!workspaceIndex || workspaceIndex < 1) {
                return { error: 'Valid workspace index (starting from 1) is required' };
            }

            const window = this._getActiveWindow();
            const targetWorkspace = this._workspaceManager.get_workspace_by_index(workspaceIndex - 1);
            
            if (!targetWorkspace) {
                return { error: `Workspace ${workspaceIndex} not found` };
            }

            window.change_workspace(targetWorkspace);
            
            return {
                success: true,
                workspace: workspaceIndex,
                message: `Moved window to workspace ${workspaceIndex}`
            };
        } catch (error) {
            return { error: `Failed to move window to workspace: ${error.message}` };
        }
    }

    _tileWindow(direction) {
        try {
            const window = this._getActiveWindow();
            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());

            window.unmaximize(Meta.MaximizeFlags.BOTH);

            switch (direction) {
                case 'left':
                    window.move_resize_frame(
                        true,
                        workArea.x,
                        workArea.y,
                        workArea.width / 2,
                        workArea.height
                    );
                    break;
                case 'right':
                    window.move_resize_frame(
                        true,
                        workArea.x + workArea.width / 2,
                        workArea.y,
                        workArea.width / 2,
                        workArea.height
                    );
                    break;
                case 'top':
                    window.move_resize_frame(
                        true,
                        workArea.x,
                        workArea.y,
                        workArea.width,
                        workArea.height / 2
                    );
                    break;
                case 'bottom':
                    window.move_resize_frame(
                        true,
                        workArea.x,
                        workArea.y + workArea.height / 2,
                        workArea.width,
                        workArea.height / 2
                    );
                    break;
            }

            return {
                success: true,
                direction,
                message: `Tiled window to ${direction}`
            };
        } catch (error) {
            return { error: `Failed to tile window: ${error.message}` };
        }
    }

    _centerWindow() {
        try {
            const window = this._getActiveWindow();
            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());

            const [currentWidth, currentHeight] = window.get_size();
            const x = workArea.x + (workArea.width - currentWidth) / 2;
            const y = workArea.y + (workArea.height - currentHeight) / 2;

            window.unmaximize(Meta.MaximizeFlags.BOTH);
            window.move_frame(true, x, y);

            return {
                success: true,
                message: 'Centered window'
            };
        } catch (error) {
            return { error: `Failed to center window: ${error.message}` };
        }
    }

    _snapWindowToGrid() {
        try {
            const window = this._getActiveWindow();
            const workArea = this._workspaceManager.get_active_workspace()
                .get_work_area_for_monitor(this._displayManager.get_primary_monitor());

            const gridSize = 50; // Size of grid cells in pixels
            const [currentX, currentY] = window.get_position();
            const [currentWidth, currentHeight] = window.get_size();

            // Snap to nearest grid position
            const snappedX = Math.round(currentX / gridSize) * gridSize;
            const snappedY = Math.round(currentY / gridSize) * gridSize;
            const snappedWidth = Math.round(currentWidth / gridSize) * gridSize;
            const snappedHeight = Math.round(currentHeight / gridSize) * gridSize;

            window.unmaximize(Meta.MaximizeFlags.BOTH);
            window.move_resize_frame(
                true,
                snappedX,
                snappedY,
                snappedWidth,
                snappedHeight
            );

            return {
                success: true,
                grid_size: gridSize,
                message: 'Snapped window to grid'
            };
        } catch (error) {
            return { error: `Failed to snap window to grid: ${error.message}` };
        }
    }

    _minimizeAllWindows() {
        try {
            log('Attempting to minimize all windows');
            const windows = global.get_window_actors();
            let minimizedCount = 0;
            
            windows.forEach(actor => {
                const window = actor.get_meta_window();
                if (window && !window.is_skip_taskbar()) {
                    window.minimize();
                    minimizedCount++;
                }
            });
            
            log(`Successfully minimized ${minimizedCount} windows`);
            return {
                success: true,
                count: minimizedCount,
                message: `Minimized ${minimizedCount} windows`
            };
        } catch (error) {
            log(`Error minimizing windows: ${error.message}`);
            return { error: `Failed to minimize windows: ${error.message}` };
        }
    }

    _maximizeAllWindows() {
        try {
            log('Attempting to maximize all windows');
            const windows = global.get_window_actors();
            let maximizedCount = 0;
            
            windows.forEach(actor => {
                const window = actor.get_meta_window();
                if (window && !window.is_skip_taskbar()) {
                    window.maximize(Meta.MaximizeFlags.BOTH);
                    maximizedCount++;
                }
            });
            
            log(`Successfully maximized ${maximizedCount} windows`);
            return {
                success: true,
                count: maximizedCount,
                message: `Maximized ${maximizedCount} windows`
            };
        } catch (error) {
            log(`Error maximizing windows: ${error.message}`);
            return { error: `Failed to maximize windows: ${error.message}` };
        }
    }

    _maximizeCurrentWindow() {
        try {
            log('Attempting to maximize current window');
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            log(`Maximizing window: ${focusWindow.title}`);
            focusWindow.maximize(Meta.MaximizeFlags.BOTH);
            
            log('Window maximized successfully');
            return {
                success: true,
                window_title: focusWindow.title,
                message: `Maximized window: ${focusWindow.title}`
            };
        } catch (error) {
            log(`Error maximizing window: ${error.message}`);
            return { error: `Failed to maximize window: ${error.message}` };
        }
    }

    _arrangeWindowsInGrid(rows = 2, cols = 2) {
        try {
            log(`Attempting to arrange windows in ${rows}x${cols} grid`);
            
            const workspace = this._workspaceManager.get_active_workspace();
            const windows = global.get_window_actors()
                .map(actor => actor.get_meta_window())
                .filter(window => window && !window.is_skip_taskbar() && window.get_workspace() === workspace);

            log(`Found ${windows.length} windows to arrange`);

            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            const workArea = workspace.get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            const cellWidth = workArea.width / cols;
            const cellHeight = workArea.height / rows;

            let arrangedCount = 0;
            windows.forEach((window, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                
                if (row < rows) {
                    log(`Arranging window ${window.title} at position (${row}, ${col})`);
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_resize_frame(
                        true,
                        workArea.x + (col * cellWidth),
                        workArea.y + (row * cellHeight),
                        cellWidth,
                        cellHeight
                    );
                    arrangedCount++;
                }
            });
            
            log('Window arrangement completed');
            return {
                success: true,
                count: arrangedCount,
                grid: `${rows}x${cols}`,
                message: `Arranged ${arrangedCount} windows in a ${rows}x${cols} grid`
            };
        } catch (error) {
            log(`Error arranging windows: ${error.message}`);
            return { error: `Failed to arrange windows: ${error.message}` };
        }
    }

    _moveWindow(x, y, window_id) {
        try {
            if (!window_id) {
                return { error: 'window_id is required to move a window' };
            }
            const allWindows = global.get_window_actors().map(actor => actor.get_meta_window());
            const targetWindow = allWindows.find(win => win.get_id && win.get_id() === window_id);
            if (!targetWindow) {
                return { error: `No window found with id ${window_id}` };
            }
            targetWindow.move_frame(true, x, y);
            return {
                success: true,
                window_id,
                window_title: targetWindow.get_title(),
                position: { x, y },
                message: `Moved window '${targetWindow.get_title()}' to position (${x}, ${y})`
            };
        } catch (error) {
            log(`Error moving window: ${error.message}`);
            return { error: `Failed to move window: ${error.message}` };
        }
    }

    _resizeWindow(width, height) {
        try {
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            const [x, y] = focusWindow.get_frame_rect();
            focusWindow.move_resize_frame(true, x, y, width, height);
            
            return {
                success: true,
                window_title: focusWindow.title,
                size: { width, height },
                message: `Resized window '${focusWindow.title}' to ${width}x${height}`
            };
        } catch (error) {
            log(`Error resizing window: ${error.message}`);
            return { error: `Failed to resize window: ${error.message}` };
        }
    }

    _closeCurrentWindow() {
        try {
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            const title = focusWindow.title;
            focusWindow.delete(global.get_current_time());
            
            return {
                success: true,
                window_title: title,
                message: `Closed window: ${title}`
            };
        } catch (error) {
            log(`Error closing window: ${error.message}`);
            return { error: `Failed to close window: ${error.message}` };
        }
    }

    _getMonitorInfo(monitorIndex = null) {
        try {
            const monitors = this._layoutManager.monitors;
            if (!monitors || monitors.length === 0) {
                return { error: 'No monitors found' };
            }

            if (monitorIndex !== null) {
                if (monitorIndex < 0 || monitorIndex >= monitors.length) {
                    return { error: `Invalid monitor index: ${monitorIndex}` };
                }
                const monitor = monitors[monitorIndex];
                const workArea = this._layoutManager.getWorkAreaForMonitor(monitorIndex);
                return {
                    success: true,
                    monitor: {
                        index: monitorIndex,
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
                    }
                };
            }

            // Return info for all monitors
            const monitorInfo = monitors.map((monitor, index) => {
                const workArea = this._layoutManager.getWorkAreaForMonitor(index);
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

            return {
                success: true,
                monitors: monitorInfo,
                count: monitors.length,
                primary_index: monitors.findIndex(m => m.is_primary)
            };
        } catch (error) {
            return { error: `Failed to get monitor info: ${error.message}` };
        }
    }

    _moveWindowToMonitor(window, targetMonitor) {
        try {
            const monitorInfo = this._getMonitorInfo(targetMonitor);
            if (!monitorInfo.success) {
                return monitorInfo;
            }

            const { work_area } = monitorInfo.monitor;
            const [currentWidth, currentHeight] = window.get_size();

            // Calculate new position to center window on target monitor
            const x = work_area.x + (work_area.width - currentWidth) / 2;
            const y = work_area.y + (work_area.height - currentHeight) / 2;

            window.unmaximize(Meta.MaximizeFlags.BOTH);
            window.move_frame(true, x, y);

            return {
                success: true,
                monitor: targetMonitor,
                window_title: window.get_title(),
                message: `Moved window to monitor ${targetMonitor}`
            };
        } catch (error) {
            return { error: `Failed to move window to monitor: ${error.message}` };
        }
    }

    _arrangeWindowsOnMonitor(monitorIndex, layout = 'grid') {
        try {
            const monitorInfo = this._getMonitorInfo(monitorIndex);
            if (!monitorInfo.success) {
                return monitorInfo;
            }

            const { work_area } = monitorInfo.monitor;
            const windows = this._getWindowsOnWorkspace().filter(window => {
                const [x, y] = window.get_position();
                return x >= work_area.x && x < work_area.x + work_area.width &&
                       y >= work_area.y && y < work_area.y + work_area.height;
            });

            if (windows.length === 0) {
                return { error: `No windows found on monitor ${monitorIndex}` };
            }

            switch (layout) {
                case 'grid':
                    return this._arrangeWindowsInGrid(2, 2, work_area, windows);
                case 'vertical':
                    return this._arrangeWindowsVertical(work_area, windows);
                case 'horizontal':
                    return this._arrangeWindowsHorizontal(work_area, windows);
                case 'cascade':
                    return this._arrangeWindowsCascade(work_area, windows);
                default:
                    return { error: `Invalid layout type: ${layout}` };
            }
        } catch (error) {
            return { error: `Failed to arrange windows on monitor: ${error.message}` };
        }
    }

    _cloneToMonitor(sourceMonitor, targetMonitor) {
        try {
            const sourceInfo = this._getMonitorInfo(sourceMonitor);
            const targetInfo = this._getMonitorInfo(targetMonitor);

            if (!sourceInfo.success || !targetInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            const { work_area: sourceArea } = sourceInfo.monitor;
            const { work_area: targetArea } = targetInfo.monitor;

            // Get windows on source monitor
            const sourceWindows = this._getWindowsOnWorkspace().filter(window => {
                const [x, y] = window.get_position();
                return x >= sourceArea.x && x < sourceArea.x + sourceArea.width &&
                       y >= sourceArea.y && y < sourceArea.y + sourceArea.height;
            });

            if (sourceWindows.length === 0) {
                return { error: `No windows found on source monitor ${sourceMonitor}` };
            }

            // Calculate scaling factors
            const scaleX = targetArea.width / sourceArea.width;
            const scaleY = targetArea.height / sourceArea.height;

            // Clone window positions and sizes
            sourceWindows.forEach(window => {
                const [x, y] = window.get_position();
                const [width, height] = window.get_size();

                // Calculate new position and size
                const newX = targetArea.x + (x - sourceArea.x) * scaleX;
                const newY = targetArea.y + (y - sourceArea.y) * scaleY;
                const newWidth = width * scaleX;
                const newHeight = height * scaleY;

                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(true, newX, newY, newWidth, newHeight);
            });

            return {
                success: true,
                source_monitor: sourceMonitor,
                target_monitor: targetMonitor,
                window_count: sourceWindows.length,
                message: `Cloned ${sourceWindows.length} windows from monitor ${sourceMonitor} to ${targetMonitor}`
            };
        } catch (error) {
            return { error: `Failed to clone windows to monitor: ${error.message}` };
        }
    }

    _mirrorLayout(sourceMonitor, targetMonitor) {
        try {
            const sourceInfo = this._getMonitorInfo(sourceMonitor);
            const targetInfo = this._getMonitorInfo(targetMonitor);

            if (!sourceInfo.success || !targetInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            const { work_area: sourceArea } = sourceInfo.monitor;
            const { work_area: targetArea } = targetInfo.monitor;

            // Get windows on source monitor
            const sourceWindows = this._getWindowsOnWorkspace().filter(window => {
                const [x, y] = window.get_position();
                return x >= sourceArea.x && x < sourceArea.x + sourceArea.width &&
                       y >= sourceArea.y && y < sourceArea.y + sourceArea.height;
            });

            if (sourceWindows.length === 0) {
                return { error: `No windows found on source monitor ${sourceMonitor}` };
            }

            // Calculate relative positions
            const windowPositions = sourceWindows.map(window => {
                const [x, y] = window.get_position();
                const [width, height] = window.get_size();
                return {
                    window,
                    relativeX: (x - sourceArea.x) / sourceArea.width,
                    relativeY: (y - sourceArea.y) / sourceArea.height,
                    relativeWidth: width / sourceArea.width,
                    relativeHeight: height / sourceArea.height
                };
            });

            // Apply mirrored positions
            windowPositions.forEach(({ window, relativeX, relativeY, relativeWidth, relativeHeight }) => {
                const newX = targetArea.x + (1 - relativeX - relativeWidth) * targetArea.width;
                const newY = targetArea.y + relativeY * targetArea.height;
                const newWidth = relativeWidth * targetArea.width;
                const newHeight = relativeHeight * targetArea.height;

                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(true, newX, newY, newWidth, newHeight);
            });

            return {
                success: true,
                source_monitor: sourceMonitor,
                target_monitor: targetMonitor,
                window_count: sourceWindows.length,
                message: `Mirrored layout from monitor ${sourceMonitor} to ${targetMonitor}`
            };
        } catch (error) {
            return { error: `Failed to mirror layout: ${error.message}` };
        }
    }

    _smartArrangeWindows(mode = 'auto') {
        try {
            const windows = this._getWindowsOnWorkspace();
            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            // Get monitor information
            const monitorInfo = this._getMonitorInfo();
            if (!monitorInfo.success) {
                return { error: 'Failed to get monitor information' };
            }

            // Group windows based on the selected mode
            let windowGroups;
            switch (mode) {
                case 'content':
                    windowGroups = this._groupWindowsByContent(windows);
                    break;
                case 'importance':
                    windowGroups = this._groupWindowsByImportance(windows);
                    break;
                case 'usage':
                    windowGroups = this._groupWindowsByUsage(windows);
                    break;
                case 'project':
                    windowGroups = this._groupWindowsByProject(windows);
                    break;
                case 'auto':
                default:
                    windowGroups = this._groupWindowsAuto(windows);
                    break;
            }

            // Arrange windows based on groups and monitor layout
            const result = this._arrangeWindowGroups(windowGroups, monitorInfo.monitors);
            
            return {
                success: true,
                mode: mode,
                group_count: windowGroups.size,
                window_count: windows.length,
                message: `Smart arranged ${windows.length} windows in ${windowGroups.size} groups using ${mode} mode`
            };
        } catch (error) {
            return { error: `Failed to smart arrange windows: ${error.message}` };
        }
    }

    _groupWindowsByContent(windows) {
        const groups = new Map();
        
        windows.forEach(window => {
            const app = this._windowTracker.get_window_app(window);
            if (!app) return;

            const appId = app.get_id().toLowerCase();
            let type = 'other';

            if (appId.includes('code') || appId.includes('sublime') || appId.includes('gedit')) {
                type = 'editor';
            } else if (appId.includes('firefox') || appId.includes('chrome') || appId.includes('brave')) {
                type = 'browser';
            } else if (appId.includes('terminal') || appId.includes('gnome-terminal')) {
                type = 'terminal';
            } else if (appId.includes('vlc') || appId.includes('mpv') || appId.includes('totem')) {
                type = 'media';
            } else if (appId.includes('slack') || appId.includes('discord') || appId.includes('telegram')) {
                type = 'chat';
            }

            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type).push(window);
        });

        return groups;
    }

    _groupWindowsByImportance(windows) {
        const groups = new Map();
        
        windows.forEach(window => {
            const windowId = window.get_id();
            const importance = this._windowImportance.get(windowId) || 1;
            const groupKey = `importance_${importance}`;

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(window);
        });

        return groups;
    }

    _groupWindowsByUsage(windows) {
        const groups = new Map();
        
        windows.forEach(window => {
            const windowId = window.get_id();
            const usage = this._windowUsage.get(windowId);
            if (!usage) {
                if (!groups.has('unused')) {
                    groups.set('unused', []);
                }
                groups.get('unused').push(window);
                return;
            }

            const focusTime = usage.total_focus_time / 1000; // Convert to seconds
            let groupKey;
            if (focusTime > 3600) {
                groupKey = 'heavy_usage';
            } else if (focusTime > 600) {
                groupKey = 'medium_usage';
            } else {
                groupKey = 'light_usage';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(window);
        });

        return groups;
    }

    _groupWindowsByProject(windows) {
        const groups = new Map();
        
        windows.forEach(window => {
            const windowId = window.get_id();
            const usage = this._windowUsage.get(windowId);
            if (!usage) {
                if (!groups.has('unknown')) {
                    groups.set('unknown', []);
                }
                groups.get('unknown').push(window);
                return;
            }

            // Try to determine project context from window title and app
            const title = usage.title.toLowerCase();
            const appId = usage.app_id.toLowerCase();
            let projectContext = 'unknown';

            // Look for common project indicators in title
            if (title.includes('project') || title.includes('workspace')) {
                const parts = title.split(/[_\s-]/);
                for (const part of parts) {
                    if (part.length > 3 && !['project', 'workspace'].includes(part)) {
                        projectContext = part;
                        break;
                    }
                }
            }

            // Use app-specific project detection
            if (appId.includes('code') || appId.includes('sublime')) {
                // Try to extract project name from editor
                const editorProject = this._extractEditorProject(window);
                if (editorProject) {
                    projectContext = editorProject;
                }
            }

            if (!groups.has(projectContext)) {
                groups.set(projectContext, []);
            }
            groups.get(projectContext).push(window);
        });

        return groups;
    }

    _groupWindowsAuto(windows) {
        // Try different grouping strategies and use the one that makes the most sense
        const contentGroups = this._groupWindowsByContent(windows);
        const importanceGroups = this._groupWindowsByImportance(windows);
        const usageGroups = this._groupWindowsByUsage(windows);
        const projectGroups = this._groupWindowsByProject(windows);

        // Choose the grouping with the best score
        const groups = [
            { type: 'content', groups: contentGroups },
            { type: 'importance', groups: importanceGroups },
            { type: 'usage', groups: usageGroups },
            { type: 'project', groups: projectGroups }
        ];

        // Calculate group distribution scores
        const scores = groups.map(({ type, groups }) => {
            const groupSizes = Array.from(groups.values()).map(g => g.length);
            const avgSize = groupSizes.reduce((a, b) => a + b, 0) / groupSizes.length;
            const variance = groupSizes.reduce((a, b) => a + Math.pow(b - avgSize, 2), 0) / groupSizes.length;
            return { type, score: 1 / (1 + variance) };
        });

        // Use the grouping with the best score
        const bestGrouping = scores.reduce((a, b) => a.score > b.score ? a : b);
        return groups.find(g => g.type === bestGrouping.type).groups;
    }

    _arrangeWindowGroups(groups, monitors) {
        try {
            // Sort groups by importance
            const sortedGroups = Array.from(groups.entries())
                .sort((a, b) => {
                    const aImportance = this._calculateGroupImportance(a[1]);
                    const bImportance = this._calculateGroupImportance(b[1]);
                    return bImportance - aImportance;
                });

            // Calculate available space per monitor
            const monitorSpaces = monitors.map(monitor => ({
                monitor,
                workArea: this._layoutManager.getWorkAreaForMonitor(monitor.index),
                usedSpace: 0
            }));

            // Distribute groups across monitors
            sortedGroups.forEach(([groupName, windows]) => {
                // Find monitor with most available space
                const targetMonitor = monitorSpaces.reduce((a, b) => 
                    (b.workArea.width * b.workArea.height - b.usedSpace) >
                    (a.workArea.width * a.workArea.height - a.usedSpace) ? b : a
                );

                // Calculate layout for this group
                const layout = this._calculateGroupLayout(windows, targetMonitor.workArea);
                
                // Apply layout
                windows.forEach((window, index) => {
                    const position = layout.positions[index];
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_resize_frame(
                        true,
                        targetMonitor.workArea.x + position.x,
                        targetMonitor.workArea.y + position.y,
                        position.width,
                        position.height
                    );
                });

                // Update used space
                targetMonitor.usedSpace += layout.totalArea;
            });

            return { success: true };
        } catch (error) {
            return { error: `Failed to arrange window groups: ${error.message}` };
        }
    }

    _calculateGroupImportance(windows) {
        return windows.reduce((importance, window) => {
            const windowId = window.get_id();
            return importance + (this._windowImportance.get(windowId) || 1);
        }, 0);
    }

    _calculateGroupLayout(windows, workArea) {
        const count = windows.length;
        let positions = [];
        let totalArea = 0;

        if (count === 1) {
            // Single window takes most of the space
            positions = [{
                x: workArea.width * 0.1,
                y: workArea.height * 0.1,
                width: workArea.width * 0.8,
                height: workArea.height * 0.8
            }];
            totalArea = workArea.width * workArea.height * 0.64;
        } else if (count === 2) {
            // Two windows side by side
            positions = [
                {
                    x: 0,
                    y: 0,
                    width: workArea.width * 0.5,
                    height: workArea.height
                },
                {
                    x: workArea.width * 0.5,
                    y: 0,
                    width: workArea.width * 0.5,
                    height: workArea.height
                }
            ];
            totalArea = workArea.width * workArea.height;
        } else if (count <= 4) {
            // 2x2 grid
            const cellWidth = workArea.width / 2;
            const cellHeight = workArea.height / 2;
            positions = [
                { x: 0, y: 0, width: cellWidth, height: cellHeight },
                { x: cellWidth, y: 0, width: cellWidth, height: cellHeight },
                { x: 0, y: cellHeight, width: cellWidth, height: cellHeight },
                { x: cellWidth, y: cellHeight, width: cellWidth, height: cellHeight }
            ].slice(0, count);
            totalArea = workArea.width * workArea.height;
        } else {
            // Grid layout with dynamic sizing
            const cols = Math.ceil(Math.sqrt(count));
            const rows = Math.ceil(count / cols);
            const cellWidth = workArea.width / cols;
            const cellHeight = workArea.height / rows;

            positions = Array(count).fill().map((_, i) => ({
                x: (i % cols) * cellWidth,
                y: Math.floor(i / cols) * cellHeight,
                width: cellWidth,
                height: cellHeight
            }));
            totalArea = workArea.width * workArea.height;
        }

        return { positions, totalArea };
    }

    _extractEditorProject(window) {
        try {
            const title = window.get_title();
            // Look for common project indicators in editor windows
            const projectMatch = title.match(/(?:project|workspace)[:\s-]+([^\s-]+)/i);
            if (projectMatch) {
                return projectMatch[1].toLowerCase();
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    destroy() {
        this._disconnectMonitorSignals();
        // Disconnect signals
        if (this._focusChangedId) {
            global.display.disconnect(this._focusChangedId);
        }
        if (this._windowTitleChangedId) {
            global.window_manager.disconnect(this._windowTitleChangedId);
        }
        super.destroy();
    }
}); 