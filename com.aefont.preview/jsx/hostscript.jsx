// AE Font Preview - ExtendScript Host Script
// This script provides functions for After Effects integration

(function() {
    
    // Global variables
    var AEFontPreview = {
        version: "1.0.0",
        debug: true
    };
    
    // Logging function
    function log(message) {
        if (AEFontPreview.debug) {
            // Try to write to console if available
            try {
                $.writeln("[AE Font Preview] " + message);
            } catch (e) {
                // Fallback: do nothing
            }
        }
    }

    function encodeForTransport(value) {
        if (value === undefined || value === null) {
            return "";
        }
        var result = value;
        try {
            result = value.toString();
        } catch (toStringError) {
            result = "";
        }
        try {
            return encodeURIComponent(result);
        } catch (encodeError) {
            return "";
        }
    }
    
    // Helper: safely read property from ExtendScript objects
    function readProp(target, keys, fallbackValue) {
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            try {
                if (target[key] !== undefined && target[key] !== null && target[key] !== "") {
                    return target[key];
                }
            } catch (propError) {
                // ignore
            }
        }
        return fallbackValue;
    }
    
    // Get all available fonts from the system
    function getSystemFonts() {
        var fonts = [];
        var fontList = [];
        
        try {
            var usedFontCollection = false;
            
            // Method 0: Try to use app.fonts (AE 22.0+)
            // NOTE: app.fonts.allFonts is a 2D array: [fontFamily][fontStyle]
            try {
                if (app && app.fonts && app.fonts.allFonts) {
                    var allFonts = app.fonts.allFonts;
                    var familyCount = allFonts.length;
                    
                    log("Found " + familyCount + " font families in app.fonts.allFonts");
                    
                    if (familyCount && familyCount > 0) {
                        // Iterate through font families
                        for (var i = 0; i < familyCount; i++) {
                            var fontFamily = allFonts[i];
                            
                            if (!fontFamily || !fontFamily.length) {
                                continue;
                            }
                            
                            // Iterate through font styles in this family
                            for (var j = 0; j < fontFamily.length; j++) {
                                var fontItem = fontFamily[j];
                                
                                if (!fontItem) {
                                    continue;
                                }
                                
                                try {
                                    // Use official API properties
                                    var familyName = fontItem.familyName || fontItem.nativeFamilyName || "";
                                    var styleName = fontItem.styleName || fontItem.nativeStyleName || "Regular";
                                    var fullName = fontItem.fullName || fontItem.nativeFullName || "";
                                    var psName = fontItem.postScriptName || "";
                                    
                                    // Get native (localized) names - 네이티브 이름 추가
                                    var nativeFamilyName = encodeForTransport(fontItem.nativeFamilyName || "");
                                    var nativeStyleName = encodeForTransport(fontItem.nativeStyleName || "");
                                    var nativeFullName = encodeForTransport(fontItem.nativeFullName || "");
                                    
                                    // Get font file location (may be empty for some font types)
                                    var fontPath = "";
                                    try {
                                        fontPath = fontItem.location || "";
                                    } catch (locError) {
                                        // location property may not exist on some systems
                                    }
                                    
                                    // Use fullName if available, otherwise combine family + style
                                    var displayName = fullName || (familyName + " " + styleName);
                                    
                                    fonts.push({
                                        name: displayName,
                                        family: familyName,
                                        style: styleName,
                                        postScriptName: psName,
                                        location: fontPath,
                                        available: true,
                                        // Native (localized) names for Korean/Japanese/Chinese fonts
                                        nativeFamily: nativeFamilyName,
                                        nativeStyle: nativeStyleName,
                                        nativeFull: nativeFullName
                                    });
                                    
                                } catch (propError) {
                                    log("Error reading font properties at [" + i + "][" + j + "]: " + propError.toString());
                                }
                            }
                        }
                        usedFontCollection = fonts.length > 0;
                        log("Collected " + fonts.length + " font styles from " + familyCount + " families");
                    }
                }
            } catch (collectionFailure) {
                log("app.fonts access failed: " + collectionFailure.toString());
            }
            
            if (usedFontCollection) {
                log("Collected " + fonts.length + " fonts via app.fonts");
                return {
                    success: true,
                    fonts: fonts,
                    count: fonts.length,
                    source: "app.fonts"
                };
            }
            
            // Method 1: Try to get fonts from text document (only if app.fonts failed)
            if (!usedFontCollection) {
                log("Trying text document method...");
                try {
                    if (app && app.project && app.project.activeItem) {
                        var comp = app.project.activeItem;
                        if (comp instanceof CompItem) {
                            var tempLayer = null;
                            try {
                                // Create temporary text layer
                                tempLayer = comp.layers.addText("Temp");
                                var textProp = tempLayer.property("ADBE Text Properties").property("ADBE Text Document");
                                var textDoc = textProp.value;
                                
                                // Get font list
                                if (textDoc.fontList && textDoc.fontList.length > 0) {
                                    fontList = textDoc.fontList;
                                    log("Got " + fontList.length + " fonts from text document");
                                }
                                
                            } catch (textErr) {
                                log("Text document method failed: " + textErr.toString());
                            } finally {
                                // Always try to clean up temp layer
                                try {
                                    if (tempLayer) {
                                        tempLayer.remove();
                                    }
                                } catch (cleanupError) {
                                    log("Cleanup error: " + cleanupError.toString());
                                }
                            }
                        }
                    }
                } catch (compError) {
                    log("Composition access failed: " + compError.toString());
                }
            }
            
            // Method 2: Fallback to common system fonts
            if (fontList.length === 0) {
                fontList = [
                    "Arial", "Arial Black", "Arial Narrow", "Arial Unicode MS",
                    "Calibri", "Calibri Light", "Cambria", "Candara",
                    "Consolas", "Constantia", "Corbel", "Courier", "Courier New",
                    "Georgia", "Helvetica", "Impact", "Lucida Console", "Lucida Sans Unicode",
                    "Microsoft Sans Serif", "Palatino", "Segoe UI", "Segoe UI Light",
                    "Tahoma", "Times", "Times New Roman", "Trebuchet MS", "Verdana",
                    "Webdings", "Wingdings", "Wingdings 2", "Wingdings 3",
                    // Korean fonts
                    "Malgun Gothic", "Malgun Gothic Semilight", "Dotum", "DotumChe",
                    "Gulim", "GulimChe", "Batang", "BatangChe", "Gungsuh", "GungsuhChe",
                    // Japanese fonts
                    "MS Gothic", "MS PGothic", "MS Mincho", "MS PMincho", "Meiryo", "Meiryo UI",
                    // Chinese fonts
                    "SimSun", "SimHei", "Microsoft YaHei", "Microsoft JhengHei"
                ];
                log("Using fallback font list with " + fontList.length + " fonts");
            }
            
            // Create font objects
            for (var i = 0; i < fontList.length; i++) {
                var fallbackName = fontList[i] || "";
                fonts.push({
                    name: fontList[i],
                    family: fontList[i],
                    style: "Regular",
                    available: true,
                    nativeFamily: encodeForTransport(fallbackName),
                    nativeStyle: encodeForTransport("Regular"),
                    nativeFull: encodeForTransport(fallbackName)
                });
            }
            
            return {
                success: true,
                fonts: fonts,
                count: fonts.length,
                source: fontList.length > 0 ? "textDocument.fontList" : "fallback"
            };
            
        } catch (error) {
            log("Critical error in getSystemFonts: " + error.toString());
            // Even on critical error, return fallback fonts to prevent empty response
            var fallbackFonts = [
                "Arial", "Arial Black", "Times New Roman", "Courier New",
                "Verdana", "Georgia", "Comic Sans MS", "Trebuchet MS",
                "Malgun Gothic", "Gulim", "Batang", "Dotum"
            ];
            var fallbackList = [];
            for (var i = 0; i < fallbackFonts.length; i++) {
                fallbackList.push({
                    name: fallbackFonts[i],
                    family: fallbackFonts[i],
                    style: "Regular",
                    available: true
                });
            }
            return {
                success: true,
                fonts: fallbackList,
                count: fallbackList.length,
                source: "error-fallback",
                error: error.toString()
            };
        }
    }

    // Apply font to selected text layers
    function applyFontToSelectedLayers(fontName) {
        try {
            var comp = app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                return {
                    success: false,
                    error: "No active composition found",
                    appliedCount: 0
                };
            }
            
            var selectedLayers = comp.selectedLayers;
            if (selectedLayers.length === 0) {
                return {
                    success: false,
                    error: "No layers selected",
                    appliedCount: 0
                };
            }
            
            var appliedCount = 0;
            var errors = [];
            
            for (var i = 0; i < selectedLayers.length; i++) {
                var layer = selectedLayers[i];
                if (layer instanceof TextLayer) {
                    try {
                        var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
                        var textDoc = textProp.value;
                        
                        // Store original font for rollback if needed
                        var originalFont = textDoc.font;
                        
                        // Apply new font
                        textDoc.font = fontName;
                        textProp.setValue(textDoc);
                        
                        appliedCount++;
                        log("Applied font '" + fontName + "' to layer '" + layer.name + "'");
                        
                    } catch (layerError) {
                        var errorMsg = "Failed to apply font to layer '" + layer.name + "': " + layerError.toString();
                        errors.push(errorMsg);
                        log(errorMsg);
                    }
                } else {
                    errors.push("Layer '" + layer.name + "' is not a text layer");
                }
            }
            
            if (appliedCount > 0) {
                return {
                    success: true,
                    appliedCount: appliedCount,
                    errors: errors.length > 0 ? errors : null
                };
            } else {
                return {
                    success: false,
                    error: "No text layers were modified",
                    appliedCount: 0,
                    errors: errors
                };
            }
            
        } catch (error) {
            log("Error in applyFontToSelectedLayers: " + error.toString());
            return {
                success: false,
                error: error.toString(),
                appliedCount: 0
            };
        }
    }

    // Get text from the first selected text layer
    function getSelectedTextContent() {
        try {
            var comp = app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                return {
                    success: false,
                    error: "No active composition found"
                };
            }

            var selectedLayers = comp.selectedLayers;
            if (!selectedLayers || selectedLayers.length === 0) {
                return {
                    success: false,
                    error: "No layers selected"
                };
            }

            for (var i = 0; i < selectedLayers.length; i++) {
                var layer = selectedLayers[i];
                if (layer instanceof TextLayer) {
                    try {
                        var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
                        var textDoc = textProp.value;
                        return {
                            success: true,
                            text: textDoc.text || "",
                            layerName: layer.name
                        };
                    } catch (textError) {
                        return {
                            success: false,
                            error: "Unable to read text from layer: " + textError.toString()
                        };
                    }
                }
            }

            return {
                success: false,
                error: "No text layers selected"
            };

        } catch (error) {
            log("Error in getSelectedTextContent: " + error.toString());
            return {
                success: false,
                error: error.toString()
            };
        }
    }
    
    // Create preview text layer
    function createPreviewLayer(fontName, previewText, fontSize) {
        try {
            var comp = app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                return {
                    success: false,
                    error: "No active composition found"
                };
            }
            
            // Create text layer
            var textLayer = comp.layers.addText(previewText || "Preview Text");
            var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
            var textDoc = textProp.value;
            
            // Set font properties
            textDoc.font = fontName;
            textDoc.fontSize = fontSize || 24;
            textDoc.fillColor = [1, 1, 1]; // White color
            textDoc.justification = ParagraphJustification.LEFT_JUSTIFY;
            
            // Apply changes
            textProp.setValue(textDoc);
            
            // Position layer in center
            textLayer.position.setValue([comp.width / 2, comp.height / 2]);
            
            return {
                success: true,
                layerName: textLayer.name,
                layerId: textLayer.index
            };
            
        } catch (error) {
            log("Error in createPreviewLayer: " + error.toString());
            return {
                success: false,
                error: error.toString()
            };
        }
    }
    
    // Get font information
    function getFontInfo(fontName) {
        try {
            var comp = app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                return {
                    success: false,
                    error: "No active composition found"
                };
            }
            
            // Create temporary text layer to get font info
            var tempLayer = comp.layers.addText("Temp");
            var textProp = tempLayer.property("ADBE Text Properties").property("ADBE Text Document");
            var textDoc = textProp.value;
            
            // Set font and get info
            textDoc.font = fontName;
            textProp.setValue(textDoc);
            
            var fontInfo = {
                name: textDoc.font,
                family: textDoc.fontFamily || fontName,
                style: textDoc.fontStyle || "Regular",
                size: textDoc.fontSize,
                available: true
            };
            
            // Clean up
            tempLayer.remove();
            
            return {
                success: true,
                fontInfo: fontInfo
            };
            
        } catch (error) {
            log("Error in getFontInfo: " + error.toString());
            return {
                success: false,
                error: error.toString(),
                fontInfo: null
            };
        }
    }
    
    // Check if font is available
    function isFontAvailable(fontName) {
        try {
            var result = getFontInfo(fontName);
            return result.success && result.fontInfo.available;
        } catch (error) {
            return false;
        }
    }
    
    // Get project information
    function getProjectInfo() {
        try {
            var projectInfo = {
                hasProject: app.project !== null,
                projectName: app.project ? app.project.name : "No Project",
                activeComp: null,
                selectedLayers: [],
                textLayers: []
            };
            
            if (app.project && app.project.activeItem) {
                var comp = app.project.activeItem;
                if (comp instanceof CompItem) {
                    projectInfo.activeComp = {
                        name: comp.name,
                        width: comp.width,
                        height: comp.height,
                        duration: comp.duration,
                        frameRate: comp.frameRate
                    };
                    
                    // Get selected layers
                    for (var i = 1; i <= comp.numLayers; i++) {
                        var layer = comp.layer(i);
                        if (layer.selected) {
                            projectInfo.selectedLayers.push({
                                name: layer.name,
                                type: layer instanceof TextLayer ? "Text" : "Other",
                                index: layer.index
                            });
                        }
                        
                        if (layer instanceof TextLayer) {
                            projectInfo.textLayers.push({
                                name: layer.name,
                                index: layer.index,
                                font: layer.property("ADBE Text Properties").property("ADBE Text Document").value.font
                            });
                        }
                    }
                }
            }
            
            return {
                success: true,
                projectInfo: projectInfo
            };
            
        } catch (error) {
            log("Error in getProjectInfo: " + error.toString());
            return {
                success: false,
                error: error.toString(),
                projectInfo: null
            };
        }
    }
    
    // Expose helpers globally for evalScript entry points
    $.global.AEFontPreview_getFonts = function() {
        return JSON.stringify(getSystemFonts());
    };
    
    $.global.AEFontPreview_applyFont = function(fontName) {
        return JSON.stringify(applyFontToSelectedLayers(fontName));
    };
    
    $.global.AEFontPreview_getFontInfo = function(fontName) {
        return JSON.stringify(getFontInfo(fontName));
    };
    
    $.global.AEFontPreview_getProjectInfo = function() {
        return JSON.stringify(getProjectInfo());
    };
    $.global.AEFontPreview_getSelectedText = function() {
        return JSON.stringify(getSelectedTextContent());
    };
    
    // Export functions for CEP interface
    AEFontPreview.getSystemFonts = getSystemFonts;
    AEFontPreview.applyFontToSelectedLayers = applyFontToSelectedLayers;
    AEFontPreview.createPreviewLayer = createPreviewLayer;
    AEFontPreview.getFontInfo = getFontInfo;
    AEFontPreview.isFontAvailable = isFontAvailable;
    AEFontPreview.getProjectInfo = getProjectInfo;
    AEFontPreview.getSelectedTextContent = getSelectedTextContent;
    
    // Make AEFontPreview globally available
    this.AEFontPreview = AEFontPreview;
    
    log("AE Font Preview host script loaded successfully");
    
})();
