(function(window) {
    'use strict';

    function safeRequire(moduleName) {
        try {
            return require(moduleName);
        } catch (error) {
            console.warn(`[PythonProcessManager] Unable to require ${moduleName}:`, error);
            return null;
        }
    }

    const path = safeRequire('path');
    const fs = safeRequire('fs');
    const os = safeRequire('os');
    const net = safeRequire('net');
    const childProcess = safeRequire('child_process');

    const DEFAULT_PORT = 8765;
    const PORT_SCAN_ATTEMPTS = 25;

    class PythonProcessManager {
        constructor() {
            this.process = null;
            this.started = false;
            this.platform = os ? os.platform() : 'unknown';
            this.port = null;
        }

        async start(extensionPathOverride) {
            if (this.started) {
                return true;
            }
            if (!childProcess || !path || !fs) {
                console.warn('[PythonProcessManager] Node modules unavailable. Skipping Python helper.');
                return false;
            }

            if (this.platform !== 'win32') {
                console.info('[PythonProcessManager] Python helper is only available on Windows.');
                return false;
            }

            try {
            let extensionPath = extensionPathOverride;
            if (!extensionPath) {
                if (typeof window.CSInterface === 'function') {
                    const temp = new window.CSInterface();
                    extensionPath = temp.getSystemPath('extension');
                    } else if (window.csInterface && typeof window.csInterface.getSystemPath === 'function') {
                        extensionPath = window.csInterface.getSystemPath('extension');
                    }
                }

            if (!extensionPath) {
                console.warn('[PythonProcessManager] Unable to determine extension path.');
                return false;
            }
            console.log(`[PythonProcessManager] Using extension path: ${extensionPath}`);
            const scriptPath = path.join(extensionPath, 'python', 'font_server.py');
            const commandInfo = this._resolvePythonCommand(extensionPath, scriptPath);
            if (!commandInfo) {
                console.warn('[PythonProcessManager] No embedded python runtime or script found.');
                return false;
            }

            const port = await this._findAvailablePort(DEFAULT_PORT, PORT_SCAN_ATTEMPTS);
            if (!port) {
                console.warn('[PythonProcessManager] Unable to find available port for font server.');
                return false;
            }

            this.port = port;
            const args = [...commandInfo.args, '--port', String(port)];
            const command = commandInfo.command;

            console.log(`[PythonProcessManager] Launching helper: ${command} ${args.join(' ')}`);

            const workingDir = extensionPath;
            const env = Object.assign({}, process.env, {
                AE_FONT_SERVER_PORT: String(port)
            });

            this.process = childProcess.spawn(command, args, {
                cwd: workingDir,
                env,
                windowsHide: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.process.on('error', error => {
                console.error('[PythonProcessManager] Failed to start Python helper:', error);
            });

            if (this.process.stdout) {
                this.process.stdout.on('data', data => {
                    console.log(`[font_server stdout] ${data}`);
                });
            }

            if (this.process.stderr) {
                this.process.stderr.on('data', data => {
                    console.warn(`[font_server stderr] ${data}`);
                });
            }

            this.process.unref();
            this.started = true;
            console.log('[PythonProcessManager] Python helper started.');
            return true;
            } catch (error) {
                console.error('[PythonProcessManager] Unexpected error while starting helper:', error);
                return false;
            }
        }

        stop() {
            if (this.process) {
                try {
                    this.process.kill();
                } catch (error) {
                    console.warn('[PythonProcessManager] Error while stopping helper:', error);
                }
            }
            this.process = null;
            this.started = false;
            this.port = null;
        }

        getPort() {
            return this.port || DEFAULT_PORT;
        }

        getBaseUrl() {
            const port = this.getPort();
            return `http://127.0.0.1:${port}`;
        }

        _resolvePythonCommand(extensionPath, scriptPath) {
            const embeddedPython = path && path.join(extensionPath, 'python', 'python.exe');
            const exePath = path && path.join(extensionPath, 'bin', 'win', 'font_server.exe');

            if (embeddedPython && fs && fs.existsSync(embeddedPython) && fs.existsSync(scriptPath)) {
                console.log('[PythonProcessManager] Using embedded python runtime.');
                return { command: embeddedPython, args: [scriptPath] };
            }

            if (exePath && fs && fs.existsSync(exePath)) {
                console.log('[PythonProcessManager] Using packaged font_server.exe.');
                return { command: exePath, args: [] };
            }

            if (fs && fs.existsSync(scriptPath)) {
                console.log('[PythonProcessManager] Falling back to system python.');
                return { command: 'python', args: [scriptPath] };
            }

            return null;
        }

        async _findAvailablePort(startPort, attempts) {
            if (!net || !net.createServer) {
                return startPort;
            }
            let candidate = startPort;
            for (let i = 0; i < attempts; i += 1) {
                try {
                    const result = await this._tryPort(candidate);
                    if (result) {
                        return result;
                    }
                } catch (error) {
                    console.warn('[PythonProcessManager] Port probe error:', error);
                }
                candidate += 1;
            }

            // As a last resort, allow OS to pick a random port
            const fallback = await this._tryPort(0);
            return fallback;
        }

        _tryPort(port) {
            return new Promise(resolve => {
                const server = net.createServer();

                server.once('error', err => {
                    try {
                        server.close(() => resolve(null));
                    } catch (error) {
                        resolve(null);
                    }
                });

                server.listen(port, '127.0.0.1', () => {
                    const assigned = server.address().port;
                    try {
                        server.close(() => resolve(assigned));
                    } catch (error) {
                        resolve(assigned);
                    }
                });
            });
        }
    }

    window.PythonProcessManager = PythonProcessManager;
})(window);
