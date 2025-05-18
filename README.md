# LLM Chat - GNOME Shell Extension

A seamless integration of AI into your GNOME desktop environment. Chat naturally with AI assistants that understand your system, can help manage windows and workspaces, and execute desktop tasks - all through a native interface. Making your desktop experience smarter and more efficient.

The only ones verifiable working ~well ish is the ollama provider and llamacpp. Both verified working with tool calls. others were half crap built based on the docs and has never been tested... dont expect them to work without a fight.


## Features

- **Multiple AI Models**: Supports various AI services:
  - Llama (local via API)
  - Ollama (local)


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
  - Session history management
  - Chat persistence between sessions

## Session Management

The extension now includes comprehensive session management features:

- **Session History**: Access your previous chat sessions through the history panel
- **Session Information**: View detailed information about each session:
  - Message count
  - Session duration
  - Model and provider details
  - First and last message previews
- **Session Controls**:
  - Resume previous conversations
  - Start new chat sessions
  - Delete old sessions
  - Automatic session saving
- **Session Persistence**: Chats are automatically saved and persist between extension restarts
- **Session Metadata**: Each session includes:
  - Creation and update timestamps
  - AI model and provider settings
  - Conversation previews
  - Message statistics

To access your chat history:
1. Click the history icon in the chat interface
2. Browse through your saved sessions
3. Click "Resume" to continue a previous conversation
4. Use "New Chat" to start a fresh session

## Installation

### From source

1. Clone this repository:
   ```bash
    git clone https://github.com/1Jamie/llmchat.git
   ```

2. Copy or link the extension to your GNOME Shell extensions directory:
   ```bash
   cp -r llmchat ~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com
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

1. **Select AI Provider**: Choose from Llamacpp, or Ollama
2. **API Keys**: Enter your API keys for cloud-based services
   - Brave Search API key (required for web search functionality)
3. **Server URLs**: Configure local model server addresses
4. **Model Settings**: Select models and adjust parameters like temperature
5. **Response Options**: Set max response length and thinking message visibility

### Getting a Brave Search API Key

To use the web search functionality:

1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for an API key
3. Enter your API key in the extension settings
4. Restart the extension to apply changes

## Usage

1. Click the LLM Chat icon in the top panel to open the chat interface
2. Type your message and press Enter or click Send
3. Tools are automatically enabled to allow the AI to interact with your system

## Tool System

The extension uses a modular tool system that allows the AI to interact with your system through structured function calls.

### How Tools Work

Tools are implemented as separate JavaScript modules in the `tools/` directory. Each tool extends a base class and provides specific functionality like system information, window management, or web search.

The extension loads tools dynamically using the `ToolLoader` system, making it easy to add new capabilities without modifying the core extension code.

### Available Tools

The extension currently includes these tools:

#### SystemContextTool
- **Name:** `system_context`
- **Description:** Get system context information including windows, workspaces, system info, and clipboard content
- **Functions:** Get active window title, workspace information, system specifications, RAM usage, CPU info, running applications, clipboard content, and selected text
- **Example Use:** "What applications are running on my system right now?"

#### WindowManagementTool
- **Name:** `window_management`
- **Description:** Manage windows including minimizing, maximizing, arranging, moving, resizing and closing
- **Functions:** Minimize all windows, maximize current window, arrange windows in grid, move/resize windows
- **Example Use:** "Maximize my current window" or "Arrange my windows in a 2x2 grid"

#### WorkspaceManagementTool
- **Name:** `workspace_management`
- **Description:** Manage workspaces including switching, creating, and removing
- **Functions:** Switch to workspace, create new workspace, remove workspace, list workspaces
- **Example Use:** "Switch to workspace 2" or "Create a new workspace"

#### TimeDateTool
- **Name:** `time_date`
- **Description:** Get time and date information from the system
- **Functions:** Current time, date, timezone, calendar information
- **Example Use:** "What time is it?" or "What's today's date?"

#### WebSearchTool
- **Name:** `web_search`
- **Description:** Search the web for information using Brave Search API
- **Functions:** Perform web searches and return results with enhanced relevance and privacy
- **Example Use:** "Search the web for the latest news about GNOME Shell"
- **Requirements:** Brave Search API key (configure in settings)

#### FetchContentTool
- **Name:** `fetch_web_content`
- **Description:** Fetch and extract content from webpages with intelligent content extraction
- **Functions:** 
  - Fetch content from multiple URLs simultaneously
  - Extract main content with context awareness
  - Clean and format content for readability
  - Extract metadata (title, author, date)
  - Special handling for recipes and articles
- **Features:**
  - Smart content extraction algorithms
  - Context-aware content processing
  - Automatic content cleaning and formatting
  - Metadata extraction
  - Recipe-specific content handling
- **Example Use:** "Get the recipe from this cooking website" or "Extract the main article content from this news site"
- **Parameters:**
  - `urls`: Array of URLs to fetch content from
  - `context`: Optional context including original query and focus keywords

#### ApplicationManagementTool 
- **Name:** `application_management`
- **Description:** Launch and manage applications
- **Functions:** Launch apps, list installed apps, get running apps
- **Example Use:** "Launch Firefox" or "What applications do I have installed?"

#### DisplayManagementTool
- **Name:** `display_management`
- **Description:** Control display settings
- **Functions:** Set brightness, change display settings
- **Example Use:** "Set my screen brightness to 80%"

#### SystemSettingsTool
- **Name:** `system_settings` 
- **Description:** Access and modify system settings
- **Functions:** Toggle night light, modify system settings
- **Example Use:** "Turn on night light" or "Turn down the volume"

### Creating Custom Tools

You can create your own tools to extend the capability of the extension. The process is as follows:

1. Copy `tools/ToolTemplate.js` to a new file in the `tools/` directory
2. Modify the tool class with your implementation
3. Restart the extension to load your custom tool

Each tool follows a standard format that includes:
- Unique name and category
- Parameter definitions with types and descriptions
- An execute method that implements the tool's functionality
- Structured return values

See the `tools/README.md` file for detailed information on creating custom tools.

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

## Testing the Extension

Here's a comprehensive list of commands to test the functionality of the extension:

### Session Management
```
start a new chat
view chat history
resume previous chat
delete a chat session
check session information
```

### Web Search and Content
```
search for latest GNOME news
search for a specific recipe
fetch content from a news article
get recipe instructions from a cooking website
search for technical documentation
```

### Display Management
```
get display information
get primary display
set brightness to 50%
toggle night light
```

### Window Management
```
minimize all windows
maximize all windows
maximize current window
arrange windows in grid
move window to x=100 y=100
resize window to width=800 height=600
close current window
```

### System Settings
```
get brightness
set brightness to 50
get volume
set volume to 75
toggle night light
get system theme
```

### Workspace Management
```
list workspaces
switch to workspace 1
create new workspace
remove last workspace
move current window to workspace 2
```

### Application Management
```
list installed applications
list running applications
launch firefox
close firefox
get application window information
```

### Time and Date
```
get current time
get current date
get timezone
get calendar information
```

### System Context
```
show system info
show window information
show detailed system information
get clipboard content
get selected text
get CPU usage
get memory usage
get running processes
```

### Tool Integration
```
search for a recipe and fetch its instructions
search for news and get article content
get system info and launch an application
search for documentation and open it
```

### Error Handling
```
search with invalid query
fetch content from invalid URL
try to access non-existent workspace
try to launch non-existent application
```

### UI Testing
```
test multi-line input
check message history scrolling
verify session history display
test settings panel
check tool status messages
verify source citations
```
