# Farkle — Quick Start (Windows)

This README covers installing Node.js on Windows, required NPM commands, how to start the server, and how to run the server on a different port when the default port is in use.

**Prerequisites**
- **Node.js:** Install Node.js (LTS) if you don't have it.
  - Download the Windows installer from https://nodejs.org/ and run it.
  - Alternatively, install nvm-windows (Node Version Manager for Windows) from https://github.com/coreybutler/nvm-windows to manage multiple Node versions.
- **Verify installation:** Open a PowerShell or Command Prompt and run:

```
node -v
npm -v
```

**Install project dependencies**
- From the project root (the folder containing this README), run:

```
npm install
```

This will install dependencies listed in `package.json` (the project uses Express).

**Start the server**
- Run the server directly with Node:

```
node server/index.js
```

- (Optional) For development you can use `nodemon` (auto-restarts on file changes):

```
npx nodemon server/index.js
```

Notes:
- The server defaults to port `3000`.
- You can also run `node server/index.js` from PowerShell or Command Prompt after setting environment variables as shown below.

**Change the server port (Windows examples)**
If port `3000` is already in use, set a different port using the `PORT` environment variable.

- Command Prompt (cmd.exe):

```
set PORT=4000 && node server/index.js
```

- PowerShell:

```
$env:PORT = 4000; node server/index.js
```

- Using `cross-env` (cross-platform, via npm script):

```
npm install --save-dev cross-env
npx cross-env PORT=4000 node server/index.js
```

**Override server host (optional)**
- The server will detect a LAN IP automatically, but you can override the advertised host using `SERVER_HOST`:

Command Prompt:

```
set SERVER_HOST=192.168.1.50 && node server/index.js
```

PowerShell:

```
$env:SERVER_HOST = '192.168.1.50'; node server/index.js
```

**Enable event logging (optional)**
- To enable the server event log (used by the `/api/event-log` endpoint), set `EVENT_LOG_ENABLED=true`:

Command Prompt:

```
set EVENT_LOG_ENABLED=true && node server/index.js
```

PowerShell:

```
$env:EVENT_LOG_ENABLED = 'true'; node server/index.js
```

**Troubleshooting**
- If you get an error that the port is already in use, pick a different port and try again with the `PORT` examples above.
- If `node` or `npm` aren't recognized, ensure the Node installer added Node to your PATH, or reopen your terminal after installation.

If you want, I can add a convenience `start` script to `package.json` (so you can run `npm start`).
