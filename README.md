# LLM Chat - GNOME Shell Extension

A powerful GNOME Shell extension that integrates AI capabilities into your desktop experience. Chat with various AI models directly from your GNOME desktop.

The only ones verifiable working ~well ish is the ollama provider and llamacpp. Both verified working with tool calls. others were half crap built based on the docs and has never been tested... dont expect them to work without a fight.


## Features

- **Multiple AI Models**: Supports various AI services:
  - Llama (local via API)
  - Ollama (local)
  - OpenAI (GPT models) **
  - Google Gemini **
  - Anthropic Claude **

  **: not tested or known to not be working 


- **System Information Tools**: Access system information through AI tool calls including:
  - Current workspace and window information
  - System resource usage
  - Hardware details
  - Running applications
  - Selected text and clipboard content

- **Shell Integration**: Let the AI control your desktop with built-in tools:
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
3. Toggle Tools to enable AI to interact with the shell and web tools

### Available Tools

When tools are enabled, the AI can use the following capabilities:

- **System Context**: `get_system_context` - Get detailed system information at various detail levels
- **Window Management**:
  - `switch_workspace` - Switch to a specific workspace
  - `minimize_all_windows` - Minimize all windows
  - `maximize_current_window` - Maximize the active window
  - `arrange_windows` - Arrange windows in a grid
  - `move_window` - Move a window to specific coordinates
  - `resize_window` - Resize a window to specific dimensions
  - `close_current_window` - Close the active window
- **Workspace Management**:
  - `create_workspace` - Create a new workspace
  - `remove_workspace` - Remove a workspace
- **Application Control**:
  - `launch_application` - Launch an application
  - `list_installed_apps` - Get a list of installed applications
  - `get_running_apps` - Get a list of running applications
- **System Settings**:
  - `toggle_night_light` - Toggle night light feature
  - `set_brightness` - Set screen brightness
  - `set_volume` - Set system volume
- **Time and Date**:
  - `get_current_time` - Get the current system time
  - `get_current_date` - Get the current date
- **Web Integration**:
  - `web_search` - Search the web for information
  - `fetch_url_content` - Fetch content from a URL

### Shell Commands

You can also directly type shell commands for the AI to execute:

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
