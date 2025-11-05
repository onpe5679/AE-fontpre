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
    const childProcess = safeRequire('child_process');

    class PythonProcessManager {
        constructor() {
            this.process = null;
            this.started = false;
            this.platform = os ? os.platform() : 'unknown';
        }

        start(extensionPathOverride) {
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
            const exePath = path.join(extensionPath, 'bin', 'win', 'font_server.exe');
            const scriptPath = path.join(extensionPath, 'python', 'font_server.py');

            let command;
            let args = [];

                if (fs.existsSync(exePath)) {
                    command = exePath;
                } else if (fs.existsSync(scriptPath)) {
                command = 'python';
                args = [scriptPath];
            } else {
                console.warn('[PythonProcessManager] No font server executable or script found.');
                return false;
            }

            console.log(`[PythonProcessManager] Launching helper: ${command} ${args.join(' ')}`);

            const workingDir = extensionPath;

            this.process = childProcess.spawn(command, args, {
                cwd: workingDir,
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
        }
    }

    window.PythonProcessManager = PythonProcessManager;
})(window);
