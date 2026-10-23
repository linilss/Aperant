# Malvy (formerly Auto Claude)

**Autonomous multi-agent coding app that plans, builds, and validates software for you.**

Malvy is a fork of [AndyMik90/Aperant](https://github.com/AndyMik90/Aperant) (formerly Auto Claude). It is a TypeScript Electron app; the old Python backend has been removed.

![Malvy Kanban Board](.github/assets/Auto-Claude-Kanban.png)

[![License](https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/linilss/Aperant/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/linilss/Aperant/actions)

---

## Download

Builds are published on the [releases page](https://github.com/linilss/Aperant/releases) when available. Otherwise, build from source (see [Development](#development)).

---

## Requirements

- **Claude Pro/Max subscription** - [Get one here](https://claude.ai/upgrade)
- **Claude Code CLI** - `npm install -g @anthropic-ai/claude-code`
- **Git repository** - Your project must be initialized as a git repo

---

## Quick Start

1. **Install** the app (or build it from source)
2. **Open your project** - Select a git repository folder
3. **Connect Claude** - The app guides you through sign-in
4. **Create a task** - Describe what you want to build
5. **Watch it work** - Agents plan, code, and validate autonomously

---

## Features

| Feature | Description |
|---------|-------------|
| **Autonomous Tasks** | Describe your goal; agents handle spec, planning, implementation, and QA |
| **Isolated Workspaces** | All changes happen in git worktrees - your main branch stays safe |
| **Agent Terminals** | Up to 12 Claude Code terminals per project, with task context injection |
| **Funnel Sidebar** | Views grouped as Understand / Plan / Build / Review / Ship / Configure |
| **Roadmap + MoSCoW** | AI-assisted roadmap with a drag-and-drop MoSCoW priority matrix |
| **Deploy** | Finds your `deploy*.sh` scripts and runs them in an agent terminal |
| **Context Hub** | Per-branch CLAUDE.md docs (written only to `.malvy/docs`) and developer pointers that agents read |
| **Built-in Memory** | Local project memory: agents get relevant notes from earlier tasks and save what they learn for you to review |
| **Invisible Mode** | No tracked files touched in your repo (`.git/info/exclude`), configurable branch prefix, no Malvy signatures in commits or reviews |
| **LAN Remote Access** | Open the app from a phone browser on your local network |
| **Issue Import** | GitHub, GitLab, Azure DevOps and Linear issues; AI PR/MR reviews |
| **Cross-Platform** | Desktop app for Windows, macOS, and Linux |

---

## Interface

### Kanban Board
Visual task management from planning through completion. Create tasks and monitor agent progress in real time.

### Agent Terminals
AI-powered terminals with one-click task context injection. Spawn multiple agents for parallel work.

![Agent Terminals](.github/assets/Auto-Claude-Agents-terminals.png)

### Roadmap
AI-assisted feature planning with competitor analysis and a MoSCoW matrix.

![Roadmap](.github/assets/Auto-Claude-roadmap.png)

### Additional Features
- **Insights** - Chat interface for exploring your codebase
- **Ideation** - Discover improvements, performance issues, and vulnerabilities
- **Changelog** - Generate release notes from completed tasks

---

## Project Structure

```
Aperant/
├── apps/
│   └── desktop/     # Electron app (TypeScript AI agent layer + React UI)
├── guides/          # Additional documentation
└── scripts/         # Build utilities
```

---

## Development

Want to build from source or contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

For Linux-specific builds (Flatpak, AppImage), see [guides/linux.md](guides/linux.md).

---

## Security

Malvy uses a three-layer security model:

1. **OS Sandbox** - Bash commands run in isolation
2. **Filesystem Restrictions** - Operations limited to the project directory
3. **Dynamic Command Allowlist** - Only approved commands based on the detected project stack

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run install:all` | Install all dependencies |
| `npm start` | Build and run the desktop app |
| `npm run dev` | Run in development mode with hot reload |
| `npm run package` | Package for current platform |
| `npm run package:mac` | Package for macOS |
| `npm run package:win` | Package for Windows |
| `npm run package:linux` | Package for Linux |
| `npm run package:flatpak` | Package as Flatpak (see [guides/linux.md](guides/linux.md)) |
| `npm run lint` | Run linter |
| `npm test` | Run tests |

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style, testing, and the pull request process.

- **Issues** - [Report bugs or request features](https://github.com/linilss/Aperant/issues)

---

## License

**AGPL-3.0** - GNU Affero General Public License v3.0

Malvy is free to use. If you modify and distribute it, or run it as a service, your code must also be open source under AGPL-3.0.
