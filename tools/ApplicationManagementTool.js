'use strict';

const { GObject, Gio, Shell } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class ApplicationManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'application_management',
            description: 'Launch and manage applications, list installed and running applications with enhanced formatting',
            category: 'application',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['launch', 'list_installed', 'list_running'],
                    description: 'Action to perform'
                },
                app_name: {
                    type: 'string',
                    description: 'Name of the application to launch'
                }
            }
        });
        
        this._windowTracker = Shell.WindowTracker.get_default();
        
        // Initialize with information about capabilities
        log('ApplicationManagementTool initialized with the following capabilities:');
        log('1. Launch applications by name, desktop ID, or executable');
        log('2. List all installed applications with details (name, ID, description, executable)');
        log('3. List running applications with active windows (uses modern WindowTracker API)');
        log('4. Enhanced formatted output for better readability in response');
        log('5. Running applications are now properly filtered to show only those with active windows');
    }

    execute(params = {}) {
        const { action, app_name } = params;

        switch (action) {
            case 'launch':
                return this._launchApplication(app_name);
            case 'list_installed':
                return this._listInstalledApplications();
            case 'list_running':
                return this._listRunningApplications();
            default:
                return { error: 'Invalid action' };
        }
    }

    _launchApplication(appName) {
        try {
            if (!appName) {
                return { error: 'Application name is required' };
            }

            // Try to get app info using different methods
            let app = null;
            const appSystem = Shell.AppSystem.get_default();
            
            // Method 1: Try direct lookup by name
            const apps = appSystem.get_installed();
            for (let installedApp of apps) {
                if (installedApp.get_name().toLowerCase().includes(appName.toLowerCase())) {
                    app = installedApp;
                    log(`Found matching app by name: ${installedApp.get_name()}`);
                    break;
                }
            }
            
            // Method 2: Try with .desktop extension if not found by name
            if (!app) {
                const desktopId = appName.endsWith('.desktop') ? appName : `${appName}.desktop`;
                app = Shell.AppSystem.get_default().lookup_app(desktopId);
                
                if (app) {
                    log(`Found application by desktop ID: ${desktopId}`);
                }
            }
            
            // Method 3: Try to find by executable name
            if (!app) {
                for (let installedApp of apps) {
                    const exec = installedApp.get_executable();
                    if (exec && exec.toLowerCase().includes(appName.toLowerCase())) {
                        app = installedApp;
                        log(`Found matching app by executable: ${exec}`);
                        break;
                    }
                }
            }

            if (app) {
                log(`Launching application: ${app.get_name()}`);
                const success = app.launch([], null);
                
                if (success) {
                    log(`Successfully launched ${app.get_name()}`);
                    return { 
                        success: true, 
                        app_name: app.get_name(),
                        app_id: app.get_id(),
                        message: `Launched ${app.get_name()}`
                    };
                } else {
                    log(`Failed to launch ${app.get_name()}`);
                    return { error: `Failed to launch ${app.get_name()}` };
                }
            } else {
                log(`Could not find application matching: ${appName}`);
                
                // Provide helpful message with available apps
                const appNames = apps.map(a => a.get_name()).slice(0, 5).join(', ');
                return { 
                    error: `Could not find application "${appName}". Some available apps: ${appNames}...` 
                };
            }
        } catch (error) {
            log(`Error launching application: ${error.message}`);
            return { error: `Failed to launch application: ${error.message}` };
        }
    }

    _listInstalledApplications() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const apps = appSystem.get_installed();
            
            const appList = apps.map(app => ({
                name: app.get_name(),
                id: app.get_id(),
                description: app.get_description() || 'No description available',
                executable: app.get_executable() || 'Unknown'
            }));

            return { 
                success: true, 
                applications: appList,
                count: appList.length
            };
        } catch (error) {
            log(`Error listing applications: ${error.message}`);
            return { error: `Failed to list applications: ${error.message}` };
        }
    }
    
    _listRunningApplications() {
        try {
            log('Getting running applications using WindowTracker');
            
            // Get all windows
            const windows = global.get_window_actors()
                .map(actor => actor.get_meta_window())
                .filter(win => win && !win.is_skip_taskbar());
            
            if (!windows || windows.length === 0) {
                log('No windows found');
                return { 
                    success: true, 
                    applications: [],
                    count: 0,
                    formatted_list: "No running applications found.",
                    message: 'No running applications found'
                };
            }
            
            log(`Found ${windows.length} windows`);
            
            // Track unique applications
            const apps = new Map();
            
            // Associate windows with applications
            for (const win of windows) {
                if (!win.get_title()) continue;
                
                // Get the app associated with this window
                const app = this._windowTracker.get_window_app(win);
                
                if (app) {
                    const appId = app.get_id();
                    
                    if (!apps.has(appId)) {
                        // Create a new app entry without trying to call get_executable
                        apps.set(appId, {
                            name: app.get_name(),
                            id: appId,
                            windows: []
                        });
                    }
                    
                    // Add this window to the app's window list
                    const appInfo = apps.get(appId);
                    appInfo.windows.push({
                        title: win.get_title(),
                        workspace: win.get_workspace().index() + 1
                    });
                }
            }
            
            // Convert map to array and format the response
            const runningApps = Array.from(apps.values()).map(app => ({
                name: app.name,
                id: app.id,
                windows_count: app.windows.length,
                windows: app.windows
            }));
            
            log(`Returning ${runningApps.length} running applications`);
            
            // Format a readable list for display
            let formattedList = '';
            if (runningApps.length > 0) {
                formattedList = 'Running Applications:\n\n';
                runningApps.forEach((app, index) => {
                    formattedList += `${index + 1}. ${app.name} (${app.windows_count} window${app.windows_count > 1 ? 's' : ''})\n`;
                    app.windows.forEach(win => {
                        formattedList += `   • "${win.title}" on workspace ${win.workspace}\n`;
                    });
                    formattedList += '\n';
                });
            } else {
                formattedList = "No running applications found.";
            }
            
            return { 
                success: true, 
                applications: runningApps,
                count: runningApps.length,
                formatted_list: formattedList,
                message: formattedList // Use the formatted list as the message for better display
            };
        } catch (error) {
            log(`Error listing running applications: ${error.message}`);
            return { error: `Failed to list running applications: ${error.message}` };
        }
    }
}); 