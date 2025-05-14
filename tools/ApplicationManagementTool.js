'use strict';

const { GObject, Gio, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class ApplicationManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'application_management',
            description: 'Launch and manage applications',
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
            const appSystem = Shell.AppSystem.get_default();
            const runningApps = appSystem.get_running();
            
            const appList = runningApps.map(app => {
                const windows = app.get_windows();
                return {
                    name: app.get_name(),
                    id: app.get_id(),
                    windows_count: windows ? windows.length : 0,
                    executable: app.get_executable() || 'Unknown'
                };
            });

            return { 
                success: true, 
                applications: appList,
                count: appList.length
            };
        } catch (error) {
            log(`Error listing running applications: ${error.message}`);
            return { error: `Failed to list running applications: ${error.message}` };
        }
    }
}); 