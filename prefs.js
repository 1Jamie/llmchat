'use strict';

const { Adw, Gio, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
}

function fillPreferencesWindow(window) {
    // Create a preferences page and group
    const page = new Adw.PreferencesPage();
    const apiGroup = new Adw.PreferencesGroup({
        title: 'API Configuration'
    });
    page.add(apiGroup);

    // Service provider dropdown
    const serviceProviders = [
        { id: 'openai', name: 'OpenAI' },
        { id: 'gemini', name: 'Google Gemini' },
        { id: 'anthropic', name: 'Anthropic' },
        { id: 'llama', name: 'Llama (local)' },
        { id: 'ollama', name: 'Ollama (local)' }
    ];

    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.llmchat');

    // Create the service provider dropdown row
    const serviceProviderRow = new Adw.ComboRow({
        title: 'Service Provider',
        subtitle: 'Select the AI service to use'
    });

    // Create a string list store for the dropdown
    const serviceProviderModel = new Gtk.StringList();
    serviceProviders.forEach(provider => {
        serviceProviderModel.append(provider.name);
    });

    serviceProviderRow.set_model(serviceProviderModel);
    
    // Set the active item based on current settings
    const currentProvider = settings.get_string('service-provider');
    const currentIndex = serviceProviders.findIndex(provider => provider.id === currentProvider);
    serviceProviderRow.set_selected(currentIndex >= 0 ? currentIndex : 0);

    // Create containers for each provider's settings
    const providerSettings = {
        openai: new Adw.PreferencesGroup({ title: 'OpenAI Settings' }),
        gemini: new Adw.PreferencesGroup({ title: 'Gemini Settings' }),
        anthropic: new Adw.PreferencesGroup({ title: 'Anthropic Settings' }),
        llama: new Adw.PreferencesGroup({ title: 'Llama Settings' }),
        ollama: new Adw.PreferencesGroup({ title: 'Ollama Settings' })
    };

    // Common settings group (always visible)
    const commonSettings = new Adw.PreferencesGroup({
        title: 'Common Settings'
    });

    // OpenAI API Key entry
    const openaiBox = new Adw.ActionRow({
        title: 'OpenAI API Key'
    });
    const openaiEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    openaiEntry.set_text(settings.get_string('openai-api-key'));
    openaiEntry.connect('changed', widget => {
        settings.set_string('openai-api-key', widget.get_text());
    });
    openaiBox.add_suffix(openaiEntry);
    providerSettings.openai.add(openaiBox);

    // OpenAI Model selection
    const openaiModelBox = new Adw.ActionRow({
        title: 'OpenAI Model'
    });
    const openaiModelEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    openaiModelEntry.set_text(settings.get_string('openai-model'));
    openaiModelEntry.connect('changed', widget => {
        settings.set_string('openai-model', widget.get_text());
    });
    openaiModelBox.add_suffix(openaiModelEntry);
    providerSettings.openai.add(openaiModelBox);

    // Gemini API Key entry
    const geminiBox = new Adw.ActionRow({
        title: 'Google Gemini API Key'
    });
    const geminiEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    geminiEntry.set_text(settings.get_string('gemini-api-key'));
    geminiEntry.connect('changed', widget => {
        settings.set_string('gemini-api-key', widget.get_text());
    });
    geminiBox.add_suffix(geminiEntry);
    providerSettings.gemini.add(geminiBox);

    // Anthropic API Key entry
    const anthropicBox = new Adw.ActionRow({
        title: 'Anthropic API Key'
    });
    const anthropicEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    anthropicEntry.set_text(settings.get_string('anthropic-api-key'));
    anthropicEntry.connect('changed', widget => {
        settings.set_string('anthropic-api-key', widget.get_text());
    });
    anthropicBox.add_suffix(anthropicEntry);
    providerSettings.anthropic.add(anthropicBox);

    // Anthropic Model selection
    const anthropicModelBox = new Adw.ActionRow({
        title: 'Anthropic Model'
    });
    const anthropicModelEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    anthropicModelEntry.set_text(settings.get_string('anthropic-model'));
    anthropicModelEntry.connect('changed', widget => {
        settings.set_string('anthropic-model', widget.get_text());
    });
    anthropicModelBox.add_suffix(anthropicModelEntry);
    providerSettings.anthropic.add(anthropicModelBox);

    // Llama Server URL entry
    const llamaBox = new Adw.ActionRow({
        title: 'Llama Server URL'
    });
    const llamaEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    llamaEntry.set_text(settings.get_string('llama-server-url'));
    llamaEntry.connect('changed', widget => {
        settings.set_string('llama-server-url', widget.get_text());
    });
    llamaBox.add_suffix(llamaEntry);
    providerSettings.llama.add(llamaBox);

    // Llama Model Name entry
    const llamaModelBox = new Adw.ActionRow({
        title: 'Llama Model Name'
    });
    const llamaModelEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    llamaModelEntry.set_text(settings.get_string('llama-model-name'));
    llamaModelEntry.connect('changed', widget => {
        settings.set_string('llama-model-name', widget.get_text());
    });
    llamaModelBox.add_suffix(llamaModelEntry);
    providerSettings.llama.add(llamaModelBox);

    // Ollama Server URL entry
    const ollamaBox = new Adw.ActionRow({
        title: 'Ollama Server URL'
    });
    const ollamaEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    ollamaEntry.set_text(settings.get_string('ollama-server-url'));
    ollamaEntry.connect('changed', widget => {
        settings.set_string('ollama-server-url', widget.get_text());
    });
    ollamaBox.add_suffix(ollamaEntry);
    providerSettings.ollama.add(ollamaBox);

    // Ollama Model Name entry
    const ollamaModelBox = new Adw.ActionRow({
        title: 'Ollama Model Name'
    });
    const ollamaModelEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    ollamaModelEntry.set_text(settings.get_string('ollama-model-name'));
    ollamaModelEntry.connect('changed', widget => {
        settings.set_string('ollama-model-name', widget.get_text());
    });
    ollamaModelBox.add_suffix(ollamaModelEntry);
    providerSettings.ollama.add(ollamaModelBox);

    // Common settings - Temperature for each provider
    const temperatureSettings = {
        openai: new Adw.ActionRow({
            title: 'Temperature',
            subtitle: 'Controls randomness (0.0-2.0)'
        }),
        gemini: new Adw.ActionRow({
            title: 'Temperature',
            subtitle: 'Controls randomness (0.0-2.0)'
        }),
        anthropic: new Adw.ActionRow({
            title: 'Temperature',
            subtitle: 'Controls randomness (0.0-1.0)'
        }),
        llama: new Adw.ActionRow({
            title: 'Temperature',
            subtitle: 'Controls randomness (0.0-2.0)'
        }),
        ollama: new Adw.ActionRow({
            title: 'Temperature',
            subtitle: 'Controls randomness (0.0-2.0)'
        })
    };

    // Create temperature scales for each provider
    Object.entries(temperatureSettings).forEach(([provider, row]) => {
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({
                lower: 0.0,
                upper: provider === 'anthropic' ? 1.0 : 2.0,
                step_increment: 0.1,
                page_increment: 0.5,
                value: settings.get_double(`${provider}-temperature`)
            }),
            digits: 1,
            draw_value: true
        });

        scale.connect('value-changed', widget => {
            settings.set_double(`${provider}-temperature`, widget.get_value());
        });

        row.add_suffix(scale);
        providerSettings[provider].add(row);
    });

    // Max context tokens (common setting)
    const maxContextTokensRow = new Adw.ActionRow({
        title: 'Max Context Tokens',
        subtitle: 'Maximum tokens of chat history/context sent to the LLM (higher = more context, lower = faster)'
    });
    const maxContextTokensScale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({
            lower: 500,
            upper: 8000,
            step_increment: 100,
            page_increment: 500,
            value: settings.get_int('max-context-tokens') || 2000
        }),
        digits: 0,
        draw_value: true
    });
    maxContextTokensScale.connect('value-changed', widget => {
        settings.set_int('max-context-tokens', Math.round(widget.get_value()));
    });
    maxContextTokensRow.add_suffix(maxContextTokensScale);
    commonSettings.add(maxContextTokensRow);

    // Max response length (common setting)
    const maxResponseLengthRow = new Adw.ActionRow({
        title: 'Max Response Length',
        subtitle: 'Maximum length of responses in characters'
    });

    // Brave Search API Key entry (common setting)
    const braveSearchBox = new Adw.ActionRow({
        title: 'Brave Search API Key',
        subtitle: 'Required for web search functionality. Get your key from https://brave.com/search/api/'
    });
    const braveSearchEntry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER
    });
    braveSearchEntry.set_text(settings.get_string('brave-search-api-key'));
    braveSearchEntry.connect('changed', widget => {
        settings.set_string('brave-search-api-key', widget.get_text());
    });
    braveSearchBox.add_suffix(braveSearchEntry);
    commonSettings.add(braveSearchBox);

    const maxResponseLengthScale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({
            lower: 100,
            upper: 10000,
            step_increment: 100,
            page_increment: 1000,
            value: settings.get_int('max-response-length')
        }),
        digits: 0,
        draw_value: true
    });

    maxResponseLengthScale.connect('value-changed', widget => {
        settings.set_int('max-response-length', Math.round(widget.get_value()));
    });

    maxResponseLengthRow.add_suffix(maxResponseLengthScale);
    commonSettings.add(maxResponseLengthRow);

    // Add hide thinking setting
    const hideThinkingRow = new Adw.ActionRow({
        title: 'Hide Thinking Messages',
        subtitle: 'Hide the "thinking" messages while waiting for responses'
    });

    const hideThinkingSwitch = new Gtk.Switch({
        active: settings.get_boolean('hide-thinking'),
        valign: Gtk.Align.CENTER
    });

    hideThinkingSwitch.connect('notify::active', widget => {
        settings.set_boolean('hide-thinking', widget.active);
    });

    hideThinkingRow.add_suffix(hideThinkingSwitch);
    commonSettings.add(hideThinkingRow);

    // Function to update visible settings
    function updateVisibleSettings(providerId) {
        // Remove all provider settings groups
        Object.values(providerSettings).forEach(group => {
            if (group.get_parent()) {
                group.get_parent().remove(group);
            }
        });

        // Add the selected provider's settings
        if (providerSettings[providerId]) {
            page.add(providerSettings[providerId]);
        }

        // Always add common settings at the bottom
        if (!commonSettings.get_parent()) {
            page.add(commonSettings);
        }
    }

    // Connect the service provider selection to update visible settings
    serviceProviderRow.connect('notify::selected', widget => {
        const selected = widget.get_selected();
        if (selected >= 0 && selected < serviceProviders.length) {
            const providerId = serviceProviders[selected].id;
            settings.set_string('service-provider', providerId);
            updateVisibleSettings(providerId);
        }
    });

    // Add the service provider row to the API group
    apiGroup.add(serviceProviderRow);

    // Add the API group to the page
    page.add(apiGroup);

    // Initial setup of visible settings
    updateVisibleSettings(currentProvider);

    // Add our page to the window
    window.add(page);
}
