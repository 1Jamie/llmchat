'use strict';

const { GObject } = imports.gi;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

var Tool = GObject.registerClass(
class DisplayManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'display_management',
            description: 'Get display information and manage settings. Use to check monitors, resolutions, primary display, or multi-monitor setup.',
            category: 'system',
            keywords: ['display', 'monitor', 'screen', 'resolution', 'primary', 'secondary', 'multi', 'setup', 'configuration', 'arrange', 'layout', 'position', 'size', 'dimension', 'physical'],
            parameters: {
                action: {
                    type: 'string',
                    enum: ['get_display_info', 'get_primary_display'],
                    description: 'Action to perform'
                }
            }
        });
        
        // Initialize with information about capabilities and recent changes
        log('DisplayManagementTool initialized with the following capabilities:');
        log('1. Get information about all connected displays/monitors');
        log('2. Get detailed information about the primary display');
        log('3. Using modern Main.layoutManager.monitors API instead of deprecated global.screen');
        log('4. Fixed "screen is undefined" and "monitor_manager.get_n_monitors is not a function" errors');
        log('5. Properly handles multi-monitor setups with accurate geometry information');
    }

    execute(params = {}) {
        const { action } = params;

        switch (action) {
            case 'get_display_info':
                return this._getDisplayInfo();
            case 'get_primary_display':
                return this._getPrimaryDisplay();
            default:
                return { error: 'Invalid action' };
        }
    }

    _getDisplayInfo() {
        try {
            if (!global.display) {
                return { error: 'Display not available' };
            }

            const displays = [];
            const monitors = Main.layoutManager.monitors;
            
            if (!monitors || monitors.length === 0) {
                return { error: 'No monitors found' };
            }
            
            for (let i = 0; i < monitors.length; i++) {
                const monitor = monitors[i];
                const workArea = Main.layoutManager.getWorkAreaForMonitor(i);
                
                const display = {
                    index: i,
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
                displays.push(display);
            }

            return {
                success: true,
                count: displays.length,
                displays: displays
            };
        } catch (error) {
            return { error: `Failed to get display info: ${error.message}` };
        }
    }

    _getPrimaryDisplay() {
        try {
            if (!global.display) {
                return { error: 'Display not available' };
            }
            
            // Find primary monitor
            const monitors = Main.layoutManager.monitors;
            let primaryMonitor = null;
            
            if (!monitors || monitors.length === 0) {
                return { error: 'No monitors found' };
            }
            
            for (let i = 0; i < monitors.length; i++) {
                if (monitors[i].is_primary) {
                    primaryMonitor = monitors[i];
                    break;
                }
            }
            
            if (!primaryMonitor) {
                return { error: 'No primary display found' };
            }
            
            const primaryIndex = monitors.indexOf(primaryMonitor);
            const workArea = Main.layoutManager.getWorkAreaForMonitor(primaryIndex);

            const display = {
                index: primaryIndex,
                geometry: {
                    x: primaryMonitor.x,
                    y: primaryMonitor.y,
                    width: primaryMonitor.width,
                    height: primaryMonitor.height
                },
                work_area: {
                    x: workArea.x,
                    y: workArea.y,
                    width: workArea.width,
                    height: workArea.height
                }
            };

            return {
                success: true,
                display: display
            };
        } catch (error) {
            return { error: `Failed to get primary display: ${error.message}` };
        }
    }
}); 