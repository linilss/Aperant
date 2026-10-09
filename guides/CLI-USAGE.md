# Malvy

Malvy is a desktop application. All functionality is accessed through the Electron desktop UI (or from a phone browser via LAN remote access).

## Getting Started

1. Download a release from the [Releases page](https://github.com/linilss/Aperant/releases) if one is published, or run from source (below)
2. Install and launch the application
3. Open your project (a git repository folder)
4. Connect Claude via the sign-in guide in the app
5. Create a task and let the agents work

## Running the App from Source

```bash
# Install dependencies
npm run install:all

# Development mode (hot reload)
npm run dev

# Production build + run
npm start
```

## Configuration

All configuration is done through the app's Settings UI. You can:

- Connect Claude accounts (OAuth or API key)
- Configure multiple provider profiles (Anthropic, OpenAI, Google, etc.)
- Turn the built-in project memory on or off (app-wide, with per-project override)
- Set default models and thinking budgets
- Configure Linear/GitHub/GitLab/Azure DevOps integrations
