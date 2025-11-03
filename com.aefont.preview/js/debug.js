// Debug Helper Script for AE Font Preview

(function() {
    'use strict';

    // Wait for page to load
    window.addEventListener('DOMContentLoaded', function() {
        console.log('=== AE Font Preview Debug Info ===');
        
        // Check if CSInterface is available
        if (typeof CSInterface !== 'undefined') {
            console.log('✓ CSInterface is available');
            
            const csInterface = new CSInterface();
            
            // Get system info
            const hostEnv = csInterface.hostEnvironment;
            console.log('Host App:', hostEnv.appName);
            console.log('Host Version:', hostEnv.appVersion);
            console.log('Extension Path:', csInterface.getSystemPath('extension'));
            
            // Check JSX availability
            console.log('\n=== JSX Function Check ===');
            
            // Test basic ExtendScript
            csInterface.evalScript('app.version', function(result) {
                console.log('After Effects Version:', result);
            });
            
            // Check if our JSX is loaded
            csInterface.evalScript('typeof AEFontPreview_getFonts', function(result) {
                if (result === 'function') {
                    console.log('✓ AEFontPreview_getFonts is available');
                } else {
                    console.log('✗ AEFontPreview_getFonts is NOT available (result: ' + result + ')');
                    console.log('Attempting to load JSX manually...');
                    
                    // Try to load JSX
                    const jsxPath = csInterface.getSystemPath('extension') + '/jsx/hostscript.jsx';
                    const loadScript = '$.evalFile("' + jsxPath.replace(/\\/g, '/') + '")';
                    
                    csInterface.evalScript(loadScript, function(loadResult) {
                        console.log('JSX load result:', loadResult);
                        
                        // Check again
                        csInterface.evalScript('typeof AEFontPreview_getFonts', function(checkResult) {
                            if (checkResult === 'function') {
                                console.log('✓ JSX loaded successfully!');
                            } else {
                                console.log('✗ JSX loading failed');
                            }
                        });
                    });
                }
            });
            
            // Test font API availability
            csInterface.evalScript('typeof app.fonts', function(result) {
                if (result === 'object') {
                    console.log('✓ app.fonts API is available');
                    
                    csInterface.evalScript('app.fonts.allFonts ? app.fonts.allFonts.length : "N/A"', function(count) {
                        console.log('Total system fonts:', count);
                    });
                } else {
                    console.log('✗ app.fonts API is NOT available (older AE version)');
                }
            });
            
            // Add global debug function
            window.debugFonts = function() {
                console.log('\n=== Manual Font Test ===');
                csInterface.evalScript('AEFontPreview_getFonts()', function(result) {
                    console.log('Raw result:', result);
                    try {
                        const data = JSON.parse(result);
                        console.log('Parsed data:', data);
                        console.log('Font count:', data.count);
                        console.log('Font source:', data.source);
                        if (data.fonts && data.fonts.length > 0) {
                            console.log('First 5 fonts:', data.fonts.slice(0, 5));
                        }
                    } catch(e) {
                        console.error('Parse error:', e);
                    }
                });
            };
            
            console.log('\n=== Debug Commands ===');
            console.log('Run "debugFonts()" in console to test font loading');
            console.log('Run "testJSXConnection()" for connection test');
            
        } else {
            console.error('✗ CSInterface is NOT available!');
            console.error('This usually means the extension is not running in CEP context');
        }
        
        console.log('=== End Debug Info ===\n');
    });
})();
