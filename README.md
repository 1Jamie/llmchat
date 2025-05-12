# LLM Chat - GNOME Shell Extension

A powerful GNOME Shell extension that integrates AI capabilities into your desktop experience. Chat with various AI models directly from your GNOME desktop.

The only verifiable working ~well ish is the ollama provider, llama might still work but probably needs tweaking.... and the others were half crap built based on the docs and has never been tested... dont expect them to work without a fight.


## Features

- **Multiple AI Models**: Supports various AI services:
  - OpenAI (GPT models)
  - Google Gemini
  - Anthropic Claude
  - Llama (local via API)
  - Ollama (local)

- **Context-Aware Conversations**: Enable context mode to provide the AI with information about your system including:
  - Current workspace and window information
  - System resource usage
  - Hardware details
  - Running applications
  - Selected text and clipboard content

- **Shell Integration**: Let the AI control your desktop with built-in shell commands:
  - Switch workspaces
  - Manage windows (minimize, maximize, arrange in grid)
  - Launch applications
  - Toggle system settings like night light

- **Tool Calling**: Support for AI models with tool calling capabilities, allowing the model to:
  - Execute shell operations via structured API
  - Get current time and date
  - Search the web for information
  - Fetch content from URLs
  - And much more!

- **User-Friendly Interface**:
  - Multi-line text input
  - Smooth scrolling chat history
  - Settings panel for configuration

## Installation

### From source

1. Clone this repository:
   ```bash

   ```

2. Copy or link the extension to your GNOME Shell extensions directory:
   ```bash
   cp -r gnome-shell-extension-llmchat ~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com
   ```

3. Restart GNOME Shell:
   - Press `Alt+F2`, type `r`, and press `Enter` (X11)
   - Log out and log back in (Wayland)

4. Enable the extension using GNOME Extensions app or:
   ```bash
   gnome-extensions enable llmchat@charja113.gmail.com
   ```

## Configuration

Click the settings icon in the extension menu or use GNOME Extensions app to configure:

1. **Select AI Provider**: Choose from OpenAI, Gemini, Anthropic, Llama, or Ollama
2. **API Keys**: Enter your API keys for cloud-based services
3. **Server URLs**: Configure local model server addresses
4. **Model Settings**: Select models and adjust parameters like temperature
5. **Response Options**: Set max response length and thinking message visibility

## Usage

1. Click the LLM Chat icon in the top panel to open the chat interface
2. Type your message and press Enter or click Send
3. Toggle Context to provide system information to the AI (will be phased out and replaced by tools)
4. Toggle Tools to enable AI to interact with the shell and web tools

### Shell Commands

You can directly type shell commands for the AI to execute:

- `switch to workspace 2` - Switch to workspace 2
- `minimize all windows` - Minimize all windows
- `maximize current window` - Maximize the active window
- `arrange windows 2 2` - Arrange windows in a 2x2 grid
- `launch firefox` - Launch Firefox
- `toggle night light` - Toggle night light feature

## Development

### Running in nested GNOME Shell

For development, you can test the extension in a nested GNOME Shell:

```bash
# Set larger window size using environmental variables
gnome-shell --nested --wayland --replace
```

### Building the extension

Compile the settings schema:

```bash
cd ~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/schemas
glib-compile-schemas .
```

## Troubleshooting

- **Extension crashes on enable/disable**: Fixed various cleanup issues in recent updates
- **API calls fail**: Check your API keys and internet connection
- **Missing UI elements**: Ensure you have the latest GNOME Shell version
- **Thinking messages not displayed**: Toggle the "Hide Thinking Messages" setting



## Credits

Developed by 1jamie
