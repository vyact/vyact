# Building Vyact

This guide explains how to build the open-source Vyact desktop application from source.

## Supported build targets

| Target | Supported architecture | Build script |
| --- | --- | --- |
| macOS | Apple Silicon (arm64) | `./build_dmg.sh` |
| Windows | x64 | `build.bat` |

Intel-based Macs are not currently supported.

## Prerequisites

- Git
- Node.js 22 and npm
- Python 3.12 (backend development only; release builds download and bundle it automatically)
- [Ollama](https://ollama.com/download) for local-model features
- Docker Desktop (optional; Vyact can also use its supported native Elasticsearch setup)

The build scripts install the required Node.js dependencies. Application services and local-model features may require additional runtime setup on first launch.

## Clone the source

```bash
git clone https://github.com/vyact/vyact.git
cd vyact
```

## Build for macOS

Run the following from the repository root on an Apple Silicon Mac:

```bash
./build_dmg.sh
```

The script offers a choice between a normal or clean build, downloads the pinned standalone Python 3.12 runtime, builds the frontend, packages the Electron app, and writes the DMG to `dist/`.

## Build for Windows

Run the following from the repository root in Command Prompt on Windows:

```bat
build.bat
```

The script downloads the pinned standalone Python 3.12 runtime, builds the frontend, packages the Windows Electron app, and writes the installer to `dist/`.

## Build Windows from macOS

For maintainers who need a Windows build from macOS, use:

```bash
./build_win_on_mac.sh
```

This script temporarily applies the Windows-specific Electron and Docker configuration, restores the original files when it exits, and writes the resulting installer to `dist/`.

## Build the frontend only

For frontend development or validation:

```bash
cd frontend
npm ci
npm run build
```

Use `npm run lint` and `npm test` to run the available frontend checks.

## Run the backend during development

Create a virtual environment and install the backend dependencies:

```bash
cd app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

On Windows, activate the virtual environment with:

```bat
.venv\Scripts\activate
```

## Signing and release credentials

Official Vyact releases may use platform signing, notarization, and distribution credentials. These credentials are not included in this repository and are not required to build a local development version.

Do not commit API keys, OAuth credentials, code-signing certificates, private keys, notarization credentials, or distribution tokens.
