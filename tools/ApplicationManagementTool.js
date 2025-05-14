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
            category: 'system',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['launch', 'list'],
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
            case 'list':
                return this._listApplications();
            default:
                return { error: 'Invalid action' };
        }
    }

    _launchApplication(appName) {
        try {
            if (!appName) {
                return { error: 'Application name is required' };
            }

            const appSystem = Shell.AppSystem.get_default();
            const apps = appSystem.get_installed();
            
            for (let app of apps) {
                if (app.get_name().toLowerCase().includes(appName.toLowerCase())) {
                    app.launch([], null);
                    return { success: true, message: `Launched ${app.get_name()}` };
                }
            }

            return { error: `Application '${appName}' not found` };
        } catch (error) {
            return { error: `Failed to launch application: ${error.message}` };
        }
    }

    _listApplications() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const apps = appSystem.get_installed();
            
            const appList = apps.map(app => ({
                name: app.get_name(),
                description: app.get_description(),
                executable: app.get_executable(),
                command_line: app.get_commandline()
            }));

            return { success: true, applications: appList };
        } catch (error) {
            return { error: `Failed to list applications: ${error.message}` };
        }
    }
}); 