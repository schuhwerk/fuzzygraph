import { PAGE_HTML } from './js/page_snapshot.js';
import { atom, map } from "nanostores";
import { matplotlibColorData } from "./js/ga_color.js";
import {
    parseEquationString,
    displayGraph,
    calcWindowBounds,
    getXWidth,
    makeLinearMapper,
    ZOOM_RATE,
    isMandelbrotEquation,
    createMandelbrotFunction,
    parseMandelbrotParams,
    isJuliaEquation,
    createJuliaFunction,
    parseJuliaParams,
    DEFAULT_FUZZY_FUNCTION,
    FUZZY_FUNCTION_PRESETS,
    validateFuzzyFunction,
    createColormapLUT,
    describeEquationError
} from './js/fuzzygraph_glsl.js';
import {
    uniformly_distributed_points,
    cymatics_equation_generator
} from './js/cymatics.js';
import { attachInputScrub, attachTextScrub, attachSelectWheel, attachWheelStep } from './js/scrub.js';

const yHeightAtZoom1 = 6;
const defaultMaxOverride = 5;

const equation = atom('y ≈ x^2 - 1');
const max_iterations = atom(1000);
const threshold = atom(100);
const fuzzyLevel = atom(30);
const fuzzyFunction = atom(DEFAULT_FUZZY_FUNCTION);
const showAxes = atom(true);
const colorMap = atom('plasma');
const reverseColor = atom(true);
const invertColor = atom(false);
const colorStart = atom(0);
const colorCycles = atom(1);
const hueShiftDegrees = atom(0);
const saturationPercent = atom(0);
const luminosityPercent = atom(0);
const rotationDegrees = atom(0);
const xCenter = atom(0);
const yCenter = atom(0);

const zoom = atom(1);  // Corresponds to a yHeight of 6
let lastRotationRadians = 0;

const getYHeightFromZoom = (zoomVal) => {
    const numericZoom = Number(zoomVal);
    if (!Number.isFinite(numericZoom) || numericZoom === 0) {
        return yHeightAtZoom1;
    }
    return yHeightAtZoom1 / numericZoom;
};

const getZoomFromYHeight = (heightVal) => {
    const numericHeight = Number(heightVal);
    if (!Number.isFinite(numericHeight) || numericHeight === 0) {
        return 1;
    }
    return yHeightAtZoom1 / numericHeight;
};

const getYHeight = () => getYHeightFromZoom(zoom.get());

const setZoomSafely = (zoomVal) => {
    const numericZoom = Number(zoomVal);
    if (Number.isFinite(numericZoom) && numericZoom !== 0) {
        zoom.set(numericZoom);
    }
};

const setZoomFromYHeight = (heightVal) => {
    const computedZoom = getZoomFromYHeight(heightVal);
    if (Number.isFinite(computedZoom) && computedZoom !== 0) {
        zoom.set(computedZoom);
    }
};

// Advanced stuff
const advancedMode = atom(false);
const minVal = atom(null);
const maxVal = atom(null);
const minOverride = atom(null);
const maxOverride = atom(defaultMaxOverride);

const sidebarOpen = atom(true);

const hoverMsg = atom('Loading...');
const showError = atom(false);
const isLoading = atom(true);

const showShareModal = atom(false);
const showSaveModal = atom(false);
const showGotoModal = atom(false);
const showOpenModal = atom(false);
const showHelpModal = atom(false);
const showEquationModal = atom(false);
const showCymaticsModal = atom(false);
const showMandelbrotModal = atom(false);
const showJuliaModal = atom(false);
const mandelbrot_mode = atom(false);
const julia_mode = atom(false);
const fractal_mode = atom(false);
const CY_PARAM_MAP = {
    cyNumResonators: 'numResonators',
    cyDistance: 'distance',
    cyAmplitude: 'amplitude',
    cyFrequency: 'frequency',
    cyPhase: 'phase',
    cyCombineOperator: 'combineOperator',
    cyRotateRadians: 'rotateRadians',
    cyWaveform: 'waveform'
};
const cymaticsConfig = map({
    numResonators: 2,
    distance: 2,
    amplitude: 1.0,
    frequency: 1.0,
    phase: 0.0,
    combineOperator: '+',
    rotateRadians: 0,
    waveform: 'sinc',
});
const unmodifiedCymaticsEquation = atom(false);

// Save modal variables
const saveWidth = atom(0);
const saveHeight = atom(0);
const saveCenterX = atom(0);
const saveCenterY = atom(0);
const saveZoom = atom(zoom.get());
const saveYHeight = atom(getYHeight());
const saveShowAxes = atom(true);
const saveDefaultConfig = atom(true);

const juliaCReal = atom(-0.796);
const juliaCImag = atom(0.185);

// Reads the error value at a canvas pixel of the last painted graph.
let getGraphValueAt = () => null;

// An equation loaded from a share link or image. If it is JavaScript code it
// is not run until the user edits it, so links cannot execute code.
let untrustedEquation = null;

function getStrippedEquation() {
    return equation.get().replace(/\s+/g, "");
}

const updateFractalMode = () => {
    fractal_mode.set(mandelbrot_mode.get() || julia_mode.get());
};

mandelbrot_mode.listen(updateFractalMode);
julia_mode.listen(updateFractalMode);

function getParsedEquation() {
    const eqStr = getStrippedEquation();
    const { equation: baseEquation } = parseRotationWrapper(eqStr);
    const isMandelbrot = isMandelbrotEquation(baseEquation);
    const isJulia = isJuliaEquation(baseEquation);
    mandelbrot_mode.set(isMandelbrot);
    julia_mode.set(isJulia);
    updateFractalMode();

    if (isMandelbrot) {
        const baseMax = Number(max_iterations.get()) || 1000;
        const baseThreshold = Number(threshold.get()) || 100;
        return createMandelbrotFunction(baseEquation, {
            defaultMax: baseMax,
            defaultThreshold: baseThreshold,
            onParamsParsed: ({ maxVal, thresholdVal }) => {
                max_iterations.set(maxVal);
                threshold.set(thresholdVal);
            }
        });
    }

    if (isJulia) {
        const baseMax = Number(max_iterations.get()) || 1000;
        const baseThreshold = Number(threshold.get()) || 100;
        const baseCRe = Number(juliaCReal.get());
        const baseCIm = Number(juliaCImag.get());

        return createJuliaFunction(baseEquation, {
            defaultMax: baseMax,
            defaultThreshold: baseThreshold,
            defaultCRe: baseCRe,
            defaultCIm: baseCIm,
            onParamsParsed: ({ maxVal, thresholdVal, cRe, cIm }) => {
                max_iterations.set(maxVal);
                threshold.set(thresholdVal);
                juliaCReal.set(cRe);
                juliaCImag.set(cIm);
            }
        });
    }

    return parseEquationString(baseEquation, { allowJs: eqStr !== untrustedEquation });
}

function checkCanvasSize(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // user-space: CSS pixels
}

function startLoading() {
    isLoading.set(true);
    document.getElementById('hoverMsgDiv').style.display = 'block';
    hoverMsg.set("Loading...");
}

function stopLoading() {
    document.getElementById('hoverMsgDiv').style.display = 'none';
    hoverMsg.set('');
    isLoading.set(false);
}

function debounceLatest(fn, delay) {
    let timeoutId;
    return function (...args) {
        // Clear the previous scheduled call
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        // Schedule the new call
        timeoutId = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
}

const equationErrorEl = document.getElementById('equationError');
function setEquationError(message) {
    equationErrorEl.textContent = message || '';
    equationErrorEl.classList.toggle('hidden', !message);
    document.getElementById('equationInput').setAttribute('aria-invalid', String(!!message));
}

function paintGraph() {
    // startLoading();
    const canvas = document.getElementById('mainCanvas');

    // Compile equation using math.js (parseEquationString)
    const parsedEquation = getParsedEquation();

    if (parsedEquation) {
        var graphConfig = {
            equationFunction: parsedEquation,
            fuzzyLevel: fuzzyLevel.get(),
            fuzzyFunction: fuzzyFunction.get(),
            colorMap: colorMap.get(),
            reverseColor: reverseColor.get(),
            invertColor: invertColor.get(),
            colorStart: colorStart.get(),
            colorCycles: colorCycles.get(),
            hueShiftDegrees: hueShiftDegrees.get(),
            saturationPercent: saturationPercent.get(),
            luminosityPercent: luminosityPercent.get(),
            xCenter: xCenter.get(),
            yCenter: yCenter.get(),
            yHeight: getYHeight(),
            zoom: zoom.get(),
            showAxes: showAxes.get(),
            minOverride: minOverride.get(),
            maxOverride: maxOverride.get(),
            rotationRadians: toRadians(rotationDegrees.get())
        };

        const graphResult = displayGraph(graphConfig, canvas);
        const minV = graphResult['min'];
        const maxV = graphResult['max'];
        minVal.set(minV);
        maxVal.set(maxV);
        
        stopLoading();
        syncUrl();
        recordHistory();
        getGraphValueAt = graphResult.getValueAt;
        showFuzzyFunctionError(graphResult.fuzzyFunctionError);
        setEquationError(null);
        // hoverMsg.set('');
        // document.getElementById('hoverMsgDiv').style.display = 'none';
    } else {
        document.getElementById('hoverMsgDiv').style.display = 'block';

        if (getStrippedEquation() === untrustedEquation) {
            const message = 'JavaScript equations from links and images do not run automatically. Edit the equation to run it.';
            hoverMsg.set(message);
            setEquationError(message);
            return;
        }
        const { equation: baseEquation } = parseRotationWrapper(equation.get().trim());
        const message = describeEquationError(baseEquation) || 'This equation cannot be graphed';
        hoverMsg.set(`Equation is invalid: ${message}`);
        setEquationError(message);
    }
}

// Paint on the next animation frame so sliders and inputs update live.
// Repaints are coalesced, so a burst of changes costs one paint. If painting
// is slow (e.g. CPU-evaluated JavaScript equations), fall back to a short
// debounce and show the loading message instead of freezing the UI.
const SLOW_PAINT_MS = 120;
let lastPaintMs = 0;
let repaintFrame = null;

function timedPaint() {
    repaintFrame = null;
    const start = performance.now();
    try {
        paintGraph();
    } finally {
        lastPaintMs = performance.now() - start;
    }
}

const paintGraphDebounced = debounceLatest(timedPaint, 250);

function scheduleRepaint() {
    if (lastPaintMs > SLOW_PAINT_MS) {
        startLoading();
        paintGraphDebounced();
        return;
    }
    if (repaintFrame === null) {
        repaintFrame = requestAnimationFrame(timedPaint);
    }
}

// Download FuzzyGraph
function downloadFuzzygraph() {
    const blob = new Blob([PAGE_HTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'FuzzyGraph_v4.6.1.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Save Image
async function saveImage(w=null, h=null, cX=null, cY=null, z=null, yH=null, filename=null) {
    const fallbackW = canvas.width;
    const fallbackH = canvas.height;

    const toNumberOr = (val, fallback) => {
        const num = Number(val);
        return Number.isFinite(num) ? num : fallback;
    };

    const sW = toNumberOr(w ?? saveWidth.get(), fallbackW);
    const sH = toNumberOr(h ?? saveHeight.get(), fallbackH);
    const sCX = toNumberOr(cX ?? saveCenterX.get(), xCenter.get());
    const sCY = toNumberOr(cY ?? saveCenterY.get(), yCenter.get());
    const sZoom = toNumberOr(z ?? saveZoom.get(), zoom.get());
    const sYH = toNumberOr(yH ?? saveYHeight.get(), getYHeight());

    let finalZoom = Number.isFinite(sZoom) && sZoom !== 0 ? sZoom : null;
    if (!finalZoom && Number.isFinite(sYH) && sYH !== 0) {
        finalZoom = getZoomFromYHeight(sYH);
    }
    if (!finalZoom) {
        finalZoom = zoom.get();
    }
    const finalYHeight = getYHeightFromZoom(finalZoom);

    if (w || h || cX || cY || z || yH) {
        // If we received any of these, then this is not from the UI, and we need to render
        saveDefaultConfig.set(false);
    }

    const { rotationDegrees: rotationFromEquation } = parseRotationWrapper(getStrippedEquation());
    const rotationDegForSave = Number.isFinite(rotationDegrees.get())
        ? rotationDegrees.get()
        : (Number.isFinite(rotationFromEquation) ? rotationFromEquation : 0);
    const rotationRadForSave = toRadians(rotationDegForSave);

    let saveCanvas = null;

    if (saveDefaultConfig.get()) {
        // If no defaults were changed in the Save Image modal,
        // we can just copy the image from the main canvas.
        saveCanvas = canvas;
    } else {
        // But if any parameters in the Save Image modal were changed,
        // we need to fully repaint the image in a new off-DOM canvas.
        saveCanvas = document.createElement('canvas');
        saveCanvas.width = sW;
        saveCanvas.height = sH;

        // Compile equation using math.js (parseEquationString)
        const parsedEquation = getParsedEquation();

        var graphConfig = {
            equationFunction: parsedEquation,
            fuzzyLevel: fuzzyLevel.get(),
            fuzzyFunction: fuzzyFunction.get(),
            colorMap: colorMap.get(),
            reverseColor: reverseColor.get(),
            invertColor: invertColor.get(),
            colorStart: colorStart.get(),
            colorCycles: colorCycles.get(),
            hueShiftDegrees: hueShiftDegrees.get(),
            saturationPercent: saturationPercent.get(),
            luminosityPercent: luminosityPercent.get(),
            xCenter: parseFloat(sCX),
            yCenter: parseFloat(sCY),
            yHeight: parseFloat(finalYHeight),
            zoom: parseFloat(finalZoom),
            minOverride: minOverride.get(),
            maxOverride: maxOverride.get(),
            showAxes: saveShowAxes.get(),
            rotationRadians: rotationRadForSave
        };

        displayGraph(graphConfig, saveCanvas);
        // The offscreen render replaced the main canvas's values (used for hover).
        scheduleRepaint();
    }

    const ctx = saveCanvas.getContext('2d');

    // Logic to embed graph config data into the generated png file
    // Add a JSON object as UTF-8 iTXt metadata to a PNG Blob.
    // Returns a new PNG Blob.
    async function addJsonITXtToPng(blob, json, keyword = "graphconfig") {
        // NOTE: This function generated by ChatGPT 5 (2025-09-08)
        const buf = await blob.arrayBuffer();
        const u8  = new Uint8Array(buf);

        // --- sanity check signature ---
        const sig = [137,80,78,71,13,10,26,10];
        for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new Error("Not a PNG");

        // --- walk chunks to find IEND offset ---
        let p = 8;
        let iendPos = -1;
        while (p + 8 <= u8.length) {
            const len = readU32(u8, p);          // chunk data length
            const type = readType(u8, p + 4);    // e.g., 'IHDR','IDAT','IEND'
            const next = p + 12 + len;           // move past [len][type][data][crc]
            if (type === "IEND") { iendPos = p; break; }
            p = next;
        }
        if (iendPos < 0) throw new Error("Malformed PNG (no IEND)");

        // --- build iTXt chunk data (UTF-8, uncompressed) ---
        // iTXt layout:
        // keyword\0 compressionFlag(0|1) compressionMethod(0)
        // languageTag\0 translatedKeyword\0 text(UTF-8 or zlib-compressed UTF-8)
        const enc = new TextEncoder();
        const keywordBytes = enc.encode(keyword);             // ASCII in spec, but encoder is fine
        const langBytes = new Uint8Array(0);                  // empty language tag
        const translatedBytes = new Uint8Array(0);            // empty translated keyword
        const textBytes = enc.encode(JSON.stringify(json));   // your JSON as UTF-8

        const parts = [
            keywordBytes, zero(),                               // keyword\0
            u8byte(0),                                          // compressionFlag = 0 (uncompressed)
            u8byte(0),                                          // compressionMethod = 0
            langBytes, zero(),                                  // languageTag\0
            translatedBytes, zero(),                            // translatedKeyword\0
            textBytes                                           // the text payload
        ];
        const itxtData = concat(parts);

        const itxtChunk = buildChunk("iTXt", itxtData);

        // --- assemble: everything before IEND + our iTXt + IEND..end ---
        const out = new Uint8Array(u8.length + itxtChunk.length);
        out.set(u8.subarray(0, iendPos), 0);
        out.set(itxtChunk, iendPos);
        out.set(u8.subarray(iendPos), iendPos + itxtChunk.length);

        return new Blob([out], { type: "image/png" });

        // -------- helpers --------
        function readU32(a, i)   { return (a[i]<<24 | a[i+1]<<16 | a[i+2]<<8 | a[i+3]) >>> 0; }
        function readType(a, i)  { return String.fromCharCode(a[i],a[i+1],a[i+2],a[i+3]); }
        function u8byte(n)       { return new Uint8Array([n & 255]); }
        function zero()          { return u8byte(0); }
        function concat(arrs) {
            let len = 0; arrs.forEach(a => len += a.length);
            const o = new Uint8Array(len);
            let off = 0; arrs.forEach(a => { o.set(a, off); off += a.length; });
            return o;
        }
        function buildChunk(type4, data) {
            const enc = new TextEncoder();
            const typeBytes = enc.encode(type4); // 4 bytes
            const lenBytes  = u32BE(data.length);
            const crcBytes  = u32BE(crc32(join(typeBytes, data)));
            const out = new Uint8Array(4 + 4 + data.length + 4);
            out.set(lenBytes, 0);
            out.set(typeBytes, 4);
            out.set(data, 8);
            out.set(crcBytes, 8 + data.length);
            return out;

            function join(a,b){ const o=new Uint8Array(a.length+b.length); o.set(a,0); o.set(b,a.length); return o; }
            function u32BE(n){ const b=new Uint8Array(4); b[0]=n>>>24; b[1]=n>>>16; b[2]=n>>>8; b[3]=n; return b; }
            function crc32(bytes){
            let c = 0xFFFFFFFF >>> 0;
            for (let i=0;i<bytes.length;i++){
                c = (c ^ bytes[i]) >>> 0;
                for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
            }
            return (~c) >>> 0;
            }
        }
    }

    function getFilenameWithTimestamp() {
        const now = new Date();
        const timestamp = now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, '0') + "-" +
            String(now.getDate()).padStart(2, '0') + "_" +
            String(now.getHours()).padStart(2, '0') + "_" +
            String(now.getMinutes()).padStart(2, '0') + "_" +
            String(now.getSeconds()).padStart(2, '0');

        return `fuzzygraph_${timestamp}.png`;
    }

    // Helpers
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function canvasToBlob(canvas, type = 'image/png', quality) {
      return new Promise(resolve => canvas.toBlob(resolve, type, quality));
    }

    // Convert canvas into an in-memory PNG file
    const imgBlob = await canvasToBlob(saveCanvas, 'image/png');

    // Embed graph config data into the PNG file (so it can be re-opened in FuzzyGraph)
    var graphConfig = getAppConfig();
    graphConfig['rotationDegrees'] = rotationDegForSave;
    graphConfig['zoom'] = finalZoom;
    graphConfig['xCenter'] = parseFloat(sCX);
    graphConfig['yCenter'] = parseFloat(sCY);
    graphConfig['showAxes'] = saveShowAxes.get();

    // Don't add advanced stuff if not in advanced mode
    if (!graphConfig['advancedMode']) {
        delete graphConfig['advancedMode'];
        delete graphConfig['minOverride'];
        delete graphConfig['maxOverride'];
    }

    // Add some metadata
    graphConfig['source'] = 'FuzzyGraph';
    graphConfig['createdDate'] = new Date().toISOString().split('T')[0];

    const imgBlobWithData = await addJsonITXtToPng(imgBlob, graphConfig);

    const finalFilename = (filename && String(filename).trim() !== '')
        ? filename
        : getFilenameWithTimestamp();
    downloadBlob(imgBlobWithData, finalFilename);
}


// // // // // // // Open Logic
const pngInput  = document.getElementById('pngInput');
const uploadResult = document.getElementById('openResult');

// var configFromImage = {};
function loadGraphFromImage(configFromImage) {
    if (configFromImage) {
        setConfigFromObj(configFromImage);
        // Close Open Modal
        showOpenModal.set(false);
        uploadResult.textContent = "";
    }
}

pngInput.addEventListener('change', async () => {
    const file = pngInput.files?.[0];
    if (!file) return;
    try {
        const text = await readITXtByKeyword(file, "graphconfig");
        let parsed;
        try { parsed = JSON.parse(text); } catch {}
        loadGraphFromImage(parsed);
    } catch (err) {
        uploadResult.textContent = "No FuzzyGraph config found";
    }
});

/** Read iTXt chunk with a given keyword from a PNG Blob/ArrayBuffer. Returns UTF-8 text string. */
async function readITXtByKeyword(blobOrArrayBuffer, targetKeyword) {
    const ab = blobOrArrayBuffer.arrayBuffer
                ? await blobOrArrayBuffer.arrayBuffer()
                : blobOrArrayBuffer;
    const u8 = new Uint8Array(ab);

    // --- PNG signature check ---
    const sig = [137,80,78,71,13,10,26,10];
    for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new Error("Not a PNG.");

    // --- iterate chunks ---
    let p = 8;
    while (p + 8 <= u8.length) {
        const len  = readU32(u8, p);
        const type = strFrom4(u8, p + 4);
        const dataStart = p + 8;
        const dataEnd   = dataStart + len;
        const next      = dataEnd + 4; // + CRC

        if (dataEnd > u8.length || next > u8.length) break;

        if (type === "iTXt") {
        const maybe = await parseITXt(u8.subarray(dataStart, dataEnd), targetKeyword);
        if (maybe != null) return maybe; // found it
        }
        if (type === "IEND") break;
        p = next;
    }
    throw new Error(`No iTXt chunk with keyword "${targetKeyword}" found.`);
}

/** Parse an iTXt chunk and return the UTF-8 text if the keyword matches; else null. */
async function parseITXt(data, targetKeyword) {
    // iTXt data layout:
    // keyword\0 compressionFlag(1) compressionMethod(1)
    // languageTag\0 translatedKeyword\0 text(UTF-8 or zlib-compressed UTF-8)
    let off = 0;

    const decLatin1 = new TextDecoder("latin1");
    const decUTF8   = new TextDecoder("utf-8");

    const key = readZ(data, off);               off = key.next;
    const keyword = decLatin1.decode(key.bytes); // spec uses Latin-1 for keyword
    if (keyword !== targetKeyword) return null;

    const compressionFlag   = data[off++];
    const compressionMethod = data[off++];
    const lang = readZ(data, off);              off = lang.next; // languageTag (ignored)
    const trkw = readZ(data, off);              off = trkw.next; // translated keyword (ignored)

    let textBytes = data.subarray(off);

    if (compressionFlag === 0) {
        return decUTF8.decode(textBytes);
    } else if (compressionFlag === 1 && compressionMethod === 0) {
        // zlib-compressed UTF-8 text
        const inflated = await inflateZlib(textBytes);
        return decUTF8.decode(inflated);
    } else {
        throw new Error(`Unsupported iTXt compression (flag=${compressionFlag}, method=${compressionMethod}).`);
    }
}

/** Inflate zlib bytes using the browser’s DecompressionStream when available (no libs). */
async function inflateZlib(bytes) {
    if (typeof DecompressionStream === "function") {
        // 'deflate' works for zlib-wrapped DEFLATE streams in modern Chromium/Firefox.
        const ds = new DecompressionStream('deflate');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }
    // Fallback: tell the caller they need a small library (e.g., pako) if their PNG uses compression.
    throw new Error("Compressed iTXt requires DecompressionStream support or a small inflate library.");
}

/** Helpers */
function readU32(a, i) { return ((a[i]<<24) | (a[i+1]<<16) | (a[i+2]<<8) | a[i+3]) >>> 0; }
function strFrom4(a,i) { return String.fromCharCode(a[i],a[i+1],a[i+2],a[i+3]); }
function readZ(a, start) {
    let i = start;
    while (i < a.length && a[i] !== 0) i++;
    return { bytes: a.subarray(start, i), next: i + 1 };
}

function formatNumber(num) {
    if (num == null) { return ''; }

     // Handle very small numbers like 8.88e-16
    if (Math.abs(num) < 0.000001) {
        return '0';
    }
    else if (Math.abs(num) >= 1000000) {
        return num.toExponential(8); // e.g., "8.8888e-16"
    }

    // Otherwise, use fixed decimal, trimmed
    let str = num.toFixed(8);      // up to 8 decimals
    str = str.replace(/\.?0+$/, ''); // strip trailing zeros
    return str.length > 8 ? str.slice(0, 8) : str;
}

function parseRotationWrapper(eqStr) {
    const trimmed = (eqStr || '').trim();
    if (!trimmed.toLowerCase().startsWith('rotate(') || !trimmed.endsWith(')')) {
        return { equation: trimmed, rotationDegrees: 0 };
    }

    const innerContent = trimmed.slice('rotate('.length, -1);
    let depth = 0;
    let splitIndex = -1;

    for (let i = innerContent.length - 1; i >= 0; i--) {
        const ch = innerContent[i];
        if (ch === ')') depth++;
        else if (ch === '(') depth--;
        else if (ch === ',' && depth === 0) {
            splitIndex = i;
            break;
        }
    }

    if (splitIndex === -1) {
        return { equation: trimmed, rotationDegrees: 0 };
    }

    const innerEquation = innerContent.slice(0, splitIndex).trim();
    const angleStr = innerContent.slice(splitIndex + 1).trim();
    const parsedAngle = Number(angleStr);

    if (!Number.isFinite(parsedAngle)) {
        return { equation: innerEquation, rotationDegrees: 0 };
    }

    return { equation: innerEquation, rotationDegrees: parsedAngle };
}

function toRadians(degreesVal) {
    const numeric = Number(degreesVal);
    return Number.isFinite(numeric) ? numeric * (Math.PI / 180) : 0;
}

function rotatePointAroundOrigin(x, y, radians) {
    const cosTheta = Math.cos(radians);
    const sinTheta = -Math.sin(radians);

    return {
        x: x * cosTheta - y * sinTheta,
        y: x * sinTheta + y * cosTheta
    };
}

lastRotationRadians = toRadians(rotationDegrees.get());

minVal.subscribe((minV) => {
    document.getElementById('minOverrideInput').placeholder = `min · ${formatNumber(minV)}`;
});

maxVal.subscribe((maxV) => {
    document.getElementById('maxOverrideInput').placeholder = `max · ${formatNumber(maxV)}`;
});

const minToggle = document.getElementById("minOverrideToggle");
const minInput = document.getElementById("minOverrideInput");

const maxToggle = document.getElementById("maxOverrideToggle");
const maxInput = document.getElementById("maxOverrideInput");

let minInputHasFocus = false;
let maxInputHasFocus = false;
let updatingRotationFromEquation = false;

// An override is "enabled" while it has a value or is being edited; the clear
// button only shows when there is a value to clear.
function setMinOverrideEnabled(enabled) {
    minToggle.classList.toggle('hidden', !(enabled && minInput.value !== ''));
    if (!enabled) minOverride.set(null);
}

function setMaxOverrideEnabled(enabled) {
    maxToggle.classList.toggle('hidden', !(enabled && maxInput.value !== ''));
    if (!enabled) maxOverride.set('');
}

function toggleMinOverride() {
    setMinOverrideEnabled(false);
}

function toggleMaxOverride() {
    setMaxOverrideEnabled(false);
}

minToggle.addEventListener("click", toggleMinOverride);
maxToggle.addEventListener("click", toggleMaxOverride);

minOverride.subscribe((minO) => {
    document.getElementById('minOverrideInput').value = minO;
    const shouldEnable = minInputHasFocus || (minO != null && minO != '');
    setMinOverrideEnabled(shouldEnable);
    scheduleRepaint();
});

maxOverride.subscribe((maxO) => {
    document.getElementById('maxOverrideInput').value = maxO;
    const shouldEnable = maxInputHasFocus || (maxO != null && maxO != '');
    setMaxOverrideEnabled(shouldEnable);
    scheduleRepaint();
});

colorStart.subscribe((startVal) => {
    document.getElementById('colorStartInput').value = startVal;
    scheduleRepaint();
});

colorCycles.subscribe((cyclesVal) => {
    document.getElementById('colorCyclesInput').value = cyclesVal;
    scheduleRepaint();
});

hueShiftDegrees.subscribe((hueVal) => {
    document.getElementById('hueShiftInput').value = hueVal;
    scheduleRepaint();
});

saturationPercent.subscribe((satVal) => {
    document.getElementById('saturationAdjustInput').value = satVal;
    scheduleRepaint();
});

luminosityPercent.subscribe((lumVal) => {
    document.getElementById('luminosityAdjustInput').value = lumVal;
    scheduleRepaint();
});

rotationDegrees.subscribe((rotationDeg) => {
    const rotationInput = document.getElementById('rotationDegreesInput');
    if (rotationInput && rotationInput !== document.activeElement) {
        rotationInput.value = rotationDeg;
    }

    const newRotationRadians = toRadians(rotationDeg);
    if (Number.isFinite(newRotationRadians) && newRotationRadians !== lastRotationRadians) {
        const deltaRadians = lastRotationRadians - newRotationRadians;
        const { x: adjustedXCenter, y: adjustedYCenter } = rotatePointAroundOrigin(
            xCenter.get(),
            yCenter.get(),
            deltaRadians
        );

        xCenter.set(adjustedXCenter);
        yCenter.set(adjustedYCenter);
        lastRotationRadians = newRotationRadians;
    }

    if (updatingRotationFromEquation) {
        return;
    }

    const equationInput = document.getElementById('equationInput');
    if (!equationInput) return;

    const currentEquation = (equation.get() || equationInput.value || '').trim();
    const { equation: baseEquation } = parseRotationWrapper(currentEquation);
    const hasRotation = Number.isFinite(rotationDeg) && rotationDeg !== 0;
    const nextEquation = hasRotation ? `rotate(${baseEquation}, ${rotationDeg})` : baseEquation;

    if (equation.get() !== nextEquation) {
        equation.set(nextEquation);
    }
});

function clearMinAndMaxOverrides() {
    minOverride.set(null);
    if (fractal_mode.get()) {
        maxOverride.set('');
    } else {
        maxOverride.set(defaultMaxOverride);
    }
}

document.getElementById('minOverrideInput').addEventListener('input', (event) => {
    minOverride.set(event.target.value);
});

document.getElementById('minOverrideInput').addEventListener('focus', () => {
    minInputHasFocus = true;
    setMinOverrideEnabled(true);
});

document.getElementById('minOverrideInput').addEventListener('blur', () => {
    minInputHasFocus = false;
    const minVal = minOverride.get();
    const shouldEnable = minVal != null && minVal != '';
    setMinOverrideEnabled(shouldEnable);
});

document.getElementById('maxOverrideInput').addEventListener('input', (event) => {
    maxOverride.set(event.target.value);
});

document.getElementById('maxOverrideInput').addEventListener('focus', () => {
    maxInputHasFocus = true;
    setMaxOverrideEnabled(true);
});

document.getElementById('maxOverrideInput').addEventListener('blur', () => {
    maxInputHasFocus = false;
    const maxVal = maxOverride.get();
    const shouldEnable = maxVal != null && maxVal != '';
    setMaxOverrideEnabled(shouldEnable);
});

fractal_mode.listen((isFractal) => {
    if (isFractal) {
        maxOverride.set('');
    }

    const shouldEnable = maxInputHasFocus || (maxOverride.get() != null && maxOverride.get() != '');
    setMaxOverrideEnabled(shouldEnable);
});

document.getElementById('colorStartInput').addEventListener('input', (event) => {
    const value = parseFloat(event.target.value);
    colorStart.set(Number.isFinite(value) ? value : 0);
});

document.getElementById('colorCyclesInput').addEventListener('input', (event) => {
    const value = parseFloat(event.target.value);
    colorCycles.set(Number.isFinite(value) ? value : 1);
});

document.getElementById('hueShiftInput').addEventListener('input', (event) => {
    const value = parseFloat(event.target.value);
    hueShiftDegrees.set(Number.isFinite(value) ? value : 0);
});

document.getElementById('saturationAdjustInput').addEventListener('input', (event) => {
    const value = parseFloat(event.target.value);
    saturationPercent.set(Number.isFinite(value) ? value : 0);
});

document.getElementById('luminosityAdjustInput').addEventListener('input', (event) => {
    const value = parseFloat(event.target.value);
    luminosityPercent.set(Number.isFinite(value) ? value : 0);
});

document.getElementById('rotationDegreesInput').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    rotationDegrees.set(Number.isFinite(value) ? value : 0);
});

document.getElementById('saveImageButton').addEventListener('click', async () => {
    saveImage();
});

const advancedSection = document.getElementById('advancedSection');

function setMode(checked) {
    if (advancedSection.open !== checked) advancedSection.open = checked;
    if (!checked) {
        // Clear min and max overrides since they are no longer visible
        clearMinAndMaxOverrides();
    }
}

advancedSection.addEventListener('toggle', () => {
    if (advancedMode.get() !== advancedSection.open) advancedMode.set(advancedSection.open);
});

advancedMode.subscribe((checked) => {
    setMode(checked);
});

function setSwitch(id, on) {
    document.getElementById(id).setAttribute('aria-checked', String(!!on));
}

saveShowAxes.subscribe((show) => setSwitch('saveAxesToggle', show));

document.getElementById('saveWidthInput').addEventListener('input', (event) => {
    saveWidth.set(event.target.value);
    saveDefaultConfig.set(false);
});
document.getElementById('saveHeightInput').addEventListener('input', (event) => {
    saveHeight.set(event.target.value);
    saveDefaultConfig.set(false);
});
document.getElementById('saveCenterXInput').addEventListener('input', (event) => {
    saveCenterX.set(event.target.value);
    saveDefaultConfig.set(false);
});
document.getElementById('saveCenterYInput').addEventListener('input', (event) => {
    saveCenterY.set(event.target.value);
    saveDefaultConfig.set(false);
});
document.getElementById('saveYHeightInput').addEventListener('input', (event) => {
    const yHeightVal = Number(event.target.value);
    saveYHeight.set(event.target.value);
    if (Number.isFinite(yHeightVal) && yHeightVal !== 0) {
        saveZoom.set(getZoomFromYHeight(yHeightVal));
    }
    saveDefaultConfig.set(false);
});
document.getElementById('saveZoomInput').addEventListener('input', (event) => {
    const zoomVal = Number(event.target.value);
    saveZoom.set(event.target.value);
    if (Number.isFinite(zoomVal) && zoomVal !== 0) {
        saveYHeight.set(getYHeightFromZoom(zoomVal));
    }
    saveDefaultConfig.set(false);
});
document.getElementById('saveAxesToggle').addEventListener('click', () => {
    saveShowAxes.set(!saveShowAxes.get());
    saveDefaultConfig.set(false);
});

saveWidth.subscribe((val) => {
    document.getElementById('saveWidthInput').value = val;
});
saveHeight.subscribe((val) => {
    document.getElementById('saveHeightInput').value = val;
});
saveCenterX.subscribe((val) => {
    document.getElementById('saveCenterXInput').value = val;
});
saveCenterY.subscribe((val) => {
    document.getElementById('saveCenterYInput').value = val;
});
saveYHeight.subscribe((val) => {
    document.getElementById('saveYHeightInput').value = val;
});
saveZoom.subscribe((val) => {
    document.getElementById('saveZoomInput').value = val;
});

function populateGotoModalFields() {
    document.getElementById('gotoCenterXInput').value = xCenter.get();
    document.getElementById('gotoCenterYInput').value = yCenter.get();
    document.getElementById('gotoZoomInput').value = zoom.get();
}


// // // // // // // Event handling

// Download offline copy of FuzzyGraph
document.getElementById("downloadFuzzyGraphBtn").addEventListener('click', downloadFuzzygraph);

// TOP MENU EVENTS
showShareModal.listen((visible) => { document.getElementById('shareModal').classList.toggle('hidden', !visible); showURL(); });
showHelpModal.listen((visible) => { document.getElementById('helpModal').classList.toggle('hidden', !visible); });
showOpenModal.listen((visible) => { document.getElementById('openModal').classList.toggle('hidden', !visible); });
showSaveModal.listen((visible) => {
    document.getElementById('saveModal').classList.toggle('hidden', !visible);
    // Set default values in Save Modal form
    if (visible) {
        saveWidth.set(canvas.width);
        saveHeight.set(canvas.height);
        saveCenterX.set(xCenter.get());
        saveCenterY.set(yCenter.get());
        const currentZoom = zoom.get();
        saveZoom.set(currentZoom);
        saveYHeight.set(getYHeightFromZoom(currentZoom));
        saveShowAxes.set(showAxes.get());
        saveDefaultConfig.set(true);
    }
});
showGotoModal.listen((visible) => {
    document.getElementById('gotoModal').classList.toggle('hidden', !visible);
    if (visible) {
        populateGotoModalFields();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        showShareModal.set(false);
        showSaveModal.set(false);
        showOpenModal.set(false);
        showHelpModal.set(false);
        closeColorMapList();
        showEquationModal.set(false);
        showCymaticsModal.set(false);
        showGotoModal.set(false);
        showMandelbrotModal.set(false);
        showJuliaModal.set(false);
        closePopover();
    }
});

// Share logic
function showURL() {
    // setUrlFromParams();
    // const shareURL = window.location.href;
    const shareURL = getShareUrl();
    document.getElementById('shareUrlInput').value = shareURL;
}

function copyURL() {
    const urlInput = document.getElementById('shareUrlInput');
    urlInput.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        alert('Failed to copy URL');
    }
}

document.getElementById('copyUrlButton').addEventListener('click', () => { copyURL(); });

// Small notification to show when the share url was copied
document.getElementById('shareUrlInput').addEventListener('copy', function (e) {
    // Get input field position
    const rect = document.getElementById('shareUrlInput').getBoundingClientRect();
    const copytooltip = document.getElementById('copytooltip');

    // Position tooltip
    copytooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    copytooltip.style.left = `${rect.left + window.scrollX}px`;

    // Show tooltip
    copytooltip.style.display = 'block';

    // Hide tooltip after 2 seconds
    setTimeout(() => {
        copytooltip.style.display = 'none';
    }, 2000);
});

// Desktop menu buttons
document.getElementById('showShareButton').addEventListener('click', () => { showShareModal.set(!showShareModal.get()); });
document.getElementById('showSaveButton').addEventListener('click', () => { showSaveModal.set(!showSaveModal.get()); });
document.getElementById('showOpenButton').addEventListener('click', () => { showOpenModal.set(!showOpenModal.get()); });
document.getElementById('showHelpButton').addEventListener('click', () => { if (showHelpModal.get()) showHelpModal.set(false); else openHelp(); });

// Mobile menu buttons

// Modal X buttons
document.getElementById('shareModalX').addEventListener('click', () => { showShareModal.set(false); });
document.getElementById('saveModalX').addEventListener('click', () => { showSaveModal.set(false); });
document.getElementById('openModalX').addEventListener('click', () => { showOpenModal.set(false); });
document.getElementById('helpModalX').addEventListener('click', () => { showHelpModal.set(false); });
document.getElementById('gotoModalX').addEventListener('click', () => { showGotoModal.set(false); });
document.getElementById('gotoCancelButton').addEventListener('click', () => { showGotoModal.set(false); });
document.getElementById('gotoSubmitButton').addEventListener('click', () => {
    const newX = parseFloat(document.getElementById('gotoCenterXInput').value);
    const newY = parseFloat(document.getElementById('gotoCenterYInput').value);
    const newZoom = parseFloat(document.getElementById('gotoZoomInput').value);

    if (!Number.isFinite(newX) || !Number.isFinite(newY) || !Number.isFinite(newZoom) || newZoom === 0) {
        return;
    }

    xCenter.set(newX);
    yCenter.set(newY);
    setZoomSafely(newZoom);
    scheduleRepaint();
    showGotoModal.set(false);
});

// CONTROL PANEL
const controlPanel = document.getElementById('controlPanel');

sidebarOpen.subscribe((visible) => {
    controlPanel.classList.toggle('hidden', !visible);
    document.getElementById('openControlPanelButton').classList.toggle('hidden', visible);
    if (visible) requestAnimationFrame(autosizeCodeFields);
});

document.getElementById('openControlPanelButton').addEventListener('click', () => { sidebarOpen.set(true); });
document.getElementById('hideControlPanelButton').addEventListener('click', () => { sidebarOpen.set(false); });

// Panel theme: dark unless the user switched to light (remembered)
const THEME_KEY = 'fuzzygraph.panelTheme';
const themeToggle = document.getElementById('themeToggle');
function setPanelTheme(theme) {
    const dark = theme !== 'light';
    for (const id of ['controlPanel', 'mathPopover', 'colorMapList']) {
        document.getElementById(id).classList.toggle('dark', dark);
    }
    themeToggle.textContent = dark ? 'Light panel' : 'Dark panel';
}
setPanelTheme(localStorage.getItem(THEME_KEY));
themeToggle.addEventListener('click', () => {
    const next = controlPanel.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    setPanelTheme(next);
});

// Drag the panel edge to resize it (desktop); the width is remembered.
const PANEL_WIDTH_KEY = 'fuzzygraph.panelWidth';
function setPanelWidth(px) {
    const max = Math.max(280, Math.min(900, window.innerWidth * 0.7));
    const w = Math.round(Math.min(max, Math.max(260, px)));
    controlPanel.style.setProperty('--panel-w', `${w}px`);
    return w;
}
{
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (saved > 0) setPanelWidth(saved);

    const resizer = document.getElementById('panelResizer');
    resizer.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        resizer.setPointerCapture(event.pointerId);
        const left = controlPanel.getBoundingClientRect().left;
        const move = (e) => setPanelWidth(e.clientX - left);
        const up = (e) => {
            resizer.removeEventListener('pointermove', move);
            resizer.removeEventListener('pointerup', up);
            resizer.removeEventListener('pointercancel', up);
            localStorage.setItem(PANEL_WIDTH_KEY, String(setPanelWidth(e.clientX - left)));
        };
        resizer.addEventListener('pointermove', move);
        resizer.addEventListener('pointerup', up);
        resizer.addEventListener('pointercancel', up);
    });
    resizer.addEventListener('dblclick', () => {
        controlPanel.style.removeProperty('--panel-w');
        localStorage.removeItem(PANEL_WIDTH_KEY);
    });
}

// Equation and fuzzy function fields grow to show the whole expression.
function autosize(el) {
    if (!el || !el.offsetParent) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
}
function autosizeCodeFields() {
    autosize(document.getElementById('equationInput'));
    autosize(document.getElementById('fuzzyFunctionInput'));
}
{
    let lastPanelWidth = 0;
    new ResizeObserver(() => {
        const w = controlPanel.clientWidth;
        if (w !== lastPanelWidth) {
            lastPanelWidth = w;
            autosizeCodeFields();
        }
    }).observe(controlPanel);
}

// CONTROL PANEL / Equation
const equationModalTextarea = document.getElementById('equationModalTextarea');

equation.subscribe((eq) => {
    const equationInputEl = document.getElementById('equationInput');
    if (equationInputEl.value !== eq) equationInputEl.value = eq;
    autosize(equationInputEl);

    if (!document.getElementById('equationModal').classList.contains('hidden') && equationModalTextarea) {
        equationModalTextarea.value = eq;
    }

    // If not in advancd mode, clear the min and max overrides when the equation changes
    if (!advancedMode.get()) {
        clearMinAndMaxOverrides();
    }

    const eqStripped = eq.replace(/\s+/g, '');
    const { equation: baseEquation, rotationDegrees: rotationFromEquation } = parseRotationWrapper(eqStripped);

    updatingRotationFromEquation = true;
    rotationDegrees.set(rotationFromEquation);
    updatingRotationFromEquation = false;

    if (isMandelbrotEquation(baseEquation)) {
        mandelbrot_mode.set(true);
        julia_mode.set(false);
        parseMandelbrotParams(baseEquation, {
            defaultMax: Number(max_iterations.get()) || 1000,
            defaultThreshold: Number(threshold.get()) || 100,
            onParamsParsed: ({ maxVal, thresholdVal }) => {
                max_iterations.set(maxVal);
                threshold.set(thresholdVal);
            }
        });
    } else if (isJuliaEquation(baseEquation)) {
        mandelbrot_mode.set(false);
        julia_mode.set(true);
        parseJuliaParams(baseEquation, {
            defaultMax: Number(max_iterations.get()) || 1000,
            defaultThreshold: Number(threshold.get()) || 100,
            defaultCRe: Number(juliaCReal.get()),
            defaultCIm: Number(juliaCImag.get()),
            onParamsParsed: ({ maxVal, thresholdVal, cRe, cIm }) => {
                max_iterations.set(maxVal);
                threshold.set(thresholdVal);
                juliaCReal.set(cRe);
                juliaCImag.set(cIm);
            }
        });
    } else {
        mandelbrot_mode.set(false);
        julia_mode.set(false);
    }
    updateFractalMode();

    scheduleRepaint();
});

// CONTROL PANEL / Equation / Help
document.getElementById('equationInput').addEventListener('input', (event) => {
    untrustedEquation = null;
    equation.set(event.target.value);
    unmodifiedCymaticsEquation.set(false);
});

showEquationModal.listen((visible) => {
    const modal = document.getElementById('equationModal');
    modal.classList.toggle('hidden', !visible);

    if (visible && equationModalTextarea) {
        const currentEquation = equation.get();
        equationModalTextarea.value = currentEquation;
        equationModalTextarea.focus();
        equationModalTextarea.setSelectionRange(currentEquation.length, currentEquation.length);
    }
});

document.getElementById('openEquationModalButton').addEventListener('click', () => {
    showEquationModal.set(true);
});

document.getElementById('equationModalClose').addEventListener('click', () => {
    showEquationModal.set(false);
});

document.getElementById('equationModalCancel').addEventListener('click', () => {
    showEquationModal.set(false);
});

document.getElementById('equationModalUpdate').addEventListener('click', () => {
    if (!equationModalTextarea) return;
    untrustedEquation = null;
    equation.set(equationModalTextarea.value);
    unmodifiedCymaticsEquation.set(false);
    showEquationModal.set(false);
});

// Help: one dialog; each section's "?" opens it at that section
function openHelp(sectionId) {
    showHelpModal.set(true);
    const target = sectionId && document.getElementById(sectionId);
    if (target) target.scrollIntoView({ block: 'start' });
    else document.getElementById('helpScroll').scrollTop = 0;
}
for (const [buttonId, sectionId] of [
    ['equationHelpButton', 'help-equation'], ['controlsHelpButton', 'help-fuzziness'],
    ['colorMapHelpButton', 'help-colors'], ['advancedHelpButton', 'help-advanced'],
]) {
    document.getElementById(buttonId).addEventListener('click', (event) => {
        // The Advanced help button sits in a <summary>; don't toggle the section
        event.preventDefault();
        event.stopPropagation();
        openHelp(sectionId);
    });
}
document.querySelectorAll('#helpModal nav a').forEach((link) => {
    link.addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelector(link.getAttribute('href')).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
});

// CONTROL PANEL / Fuzzy
fuzzyLevel.subscribe((fuzzyVal) => {
    // The slider is stored as a percentage; the fuzzy function sees it as f = level / 100
    const level = parseInt(fuzzyVal);
    document.getElementById('fuzzyLevelDisplay').textContent = level > 0 ? (level / 100).toFixed(2) : '0 · plain lines';
    document.getElementById('fuzzyInput').value = fuzzyVal;
    scheduleRepaint();
});
document.getElementById('fuzzyInput').addEventListener('input', (event) => {
    fuzzyLevel.set(event.target.value);
});

// CONTROL PANEL / Fuzzy Function
const fuzzyFunctionSelect = document.getElementById('fuzzyFunctionSelect');
const fuzzyFunctionInput = document.getElementById('fuzzyFunctionInput');
const fuzzyFunctionErrorEl = document.getElementById('fuzzyFunctionError');
const normalizeExpression = (expr) => String(expr).replace(/\s+/g, '');

for (const preset of [...FUZZY_FUNCTION_PRESETS, { id: 'custom', label: 'Custom' }]) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    if (preset.id === 'custom') option.dataset.noWheel = '';
    fuzzyFunctionSelect.appendChild(option);
}

function showFuzzyFunctionError(message) {
    fuzzyFunctionErrorEl.textContent = message ? `Invalid fuzzy function, using default: ${message}` : '';
    fuzzyFunctionErrorEl.classList.toggle('hidden', !message);
    fuzzyFunctionInput.setAttribute('aria-invalid', String(!!message));
}

fuzzyFunction.subscribe((expr) => {
    if (fuzzyFunctionInput.value !== expr) {
        fuzzyFunctionInput.value = expr;
    }
    autosize(fuzzyFunctionInput);
    const preset = FUZZY_FUNCTION_PRESETS.find(p => normalizeExpression(p.expression) === normalizeExpression(expr));
    fuzzyFunctionSelect.value = preset ? preset.id : 'custom';
    showFuzzyFunctionError(validateFuzzyFunction(expr));
    scheduleRepaint();
});
fuzzyFunctionSelect.addEventListener('change', (event) => {
    const preset = FUZZY_FUNCTION_PRESETS.find(p => p.id === event.target.value);
    if (preset) {
        fuzzyFunction.set(preset.expression);
    } else {
        fuzzyFunctionInput.focus();
    }
});
fuzzyFunctionInput.addEventListener('input', (event) => {
    fuzzyFunction.set(event.target.value);
});
// Single-line expression: Enter does not insert a newline
fuzzyFunctionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
});

// Drag or scroll over numbers to change them
for (const id of ['equationInput', 'equationModalTextarea', 'fuzzyFunctionInput']) {
    const el = document.getElementById(id);
    if (el) attachTextScrub(el);
}
document.querySelectorAll('input[type="number"], #minOverrideInput, #maxOverrideInput').forEach(attachInputScrub);
attachSelectWheel(fuzzyFunctionSelect);

// CONTROL PANEL / Controls Help

// CONTROL PANEL / Show Axes
showAxes.subscribe((show) => {
    setSwitch('axesToggle', show);

    saveShowAxes.set(show);
});

document.getElementById('axesToggle').addEventListener('click', () => {
    showAxes.set(!showAxes.get());
    scheduleRepaint();
});

// CONTROL PANEL / Color map picker: every map is previewed with the current color settings
const COLOR_MAP_NAMES = Object.keys(matplotlibColorData);
const colorMapButton = document.getElementById('colorMapButton');
const colorMapList = document.getElementById('colorMapList');
const colorMapFilter = document.getElementById('colorMapFilter');
const colorMapOptions = document.getElementById('colorMapOptions');

function colorSettingsLUT(name) {
    return createColormapLUT(name, reverseColor.get(), invertColor.get(), colorStart.get(),
        colorCycles.get(), hueShiftDegrees.get(), saturationPercent.get(), luminosityPercent.get());
}

function paintLUT(canvasEl, lut) {
    canvasEl.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(lut.buffer), 256, 1), 0, 0);
}

for (const name of COLOR_MAP_NAMES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.tabIndex = -1;
    option.className = 'cmap-option';
    option.setAttribute('role', 'option');
    option.dataset.value = name;
    const label = document.createElement('span');
    label.className = 'w-28 shrink-0 truncate';
    label.textContent = name;
    const preview = document.createElement('canvas');
    preview.width = 256;
    preview.height = 1;
    option.append(label, preview);
    colorMapOptions.appendChild(option);
}
const colorMapOptionEls = [...colorMapOptions.children];

let colorMapPreviewKey = null;
function renderColorMapPreviews() {
    const key = JSON.stringify([reverseColor.get(), invertColor.get(), colorStart.get(), colorCycles.get(),
        hueShiftDegrees.get(), saturationPercent.get(), luminosityPercent.get()]);
    if (key === colorMapPreviewKey) return;
    colorMapPreviewKey = key;
    for (const el of colorMapOptionEls) paintLUT(el.querySelector('canvas'), colorSettingsLUT(el.dataset.value));
}

function setActiveColorMapOption(el, scroll = true) {
    for (const option of colorMapOptionEls) option.classList.toggle('active', option === el);
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
}

function filterColorMaps() {
    const query = colorMapFilter.value.trim().toLowerCase();
    for (const el of colorMapOptionEls) el.hidden = query !== '' && !el.dataset.value.toLowerCase().includes(query);
    const active = colorMapOptions.querySelector('.active');
    if (!active || active.hidden) setActiveColorMapOption(colorMapOptionEls.find(el => !el.hidden));
}

function isColorMapListOpen() {
    return colorMapList.style.display !== 'none';
}

function positionColorMapList() {
    const r = colorMapButton.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const below = spaceBelow >= 260 || spaceBelow >= spaceAbove;
    Object.assign(colorMapList.style, {
        left: `${Math.max(6, Math.min(r.left, window.innerWidth - Math.max(r.width, 260) - 6))}px`,
        width: `${Math.max(r.width, 260)}px`,
        maxHeight: `${Math.min(440, below ? spaceBelow : spaceAbove)}px`,
        top: below ? `${r.bottom + 4}px` : '',
        bottom: below ? '' : `${window.innerHeight - r.top + 4}px`,
    });
}

function onColorMapPointerOutside(event) {
    if (!colorMapList.contains(event.target) && !colorMapButton.contains(event.target)) closeColorMapList();
}

function onColorMapScroll(event) {
    if (!colorMapList.contains(event.target)) positionColorMapList();
}

function openColorMapList() {
    renderColorMapPreviews();
    colorMapFilter.value = '';
    filterColorMaps();
    colorMapList.style.display = 'flex';
    colorMapButton.setAttribute('aria-expanded', 'true');
    positionColorMapList();
    setActiveColorMapOption(colorMapOptionEls.find(el => el.dataset.value === colorMap.get()));
    colorMapFilter.focus();
    document.addEventListener('pointerdown', onColorMapPointerOutside, true);
    window.addEventListener('resize', positionColorMapList);
    window.addEventListener('scroll', onColorMapScroll, true);
}

function closeColorMapList(refocus = false) {
    if (!isColorMapListOpen()) return;
    colorMapList.style.display = 'none';
    colorMapButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onColorMapPointerOutside, true);
    window.removeEventListener('resize', positionColorMapList);
    window.removeEventListener('scroll', onColorMapScroll, true);
    if (refocus) colorMapButton.focus();
}

function chooseColorMap(name) {
    colorMap.set(name);
    closeColorMapList(true);
}

colorMapButton.addEventListener('click', () => (isColorMapListOpen() ? closeColorMapList() : openColorMapList()));
colorMapFilter.addEventListener('input', filterColorMaps);
colorMapOptions.addEventListener('click', (event) => {
    const option = event.target.closest('.cmap-option');
    if (option) chooseColorMap(option.dataset.value);
});
colorMapOptions.addEventListener('pointermove', (event) => {
    const option = event.target.closest('.cmap-option');
    if (option && !option.classList.contains('active')) setActiveColorMapOption(option, false);
});
colorMapList.addEventListener('keydown', (event) => {
    const visible = colorMapOptionEls.filter(el => !el.hidden);
    const index = visible.findIndex(el => el.classList.contains('active'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        setActiveColorMapOption(visible[Math.min(visible.length - 1, Math.max(0, next))]);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (visible[index]) chooseColorMap(visible[index].dataset.value);
    } else if (event.key === 'Escape') {
        event.stopPropagation();
        closeColorMapList(true);
    } else if (event.key === 'Tab') {
        closeColorMapList();
    }
});
// Scrolling over the button steps through the maps (down = next)
attachWheelStep(colorMapButton, (steps) => {
    const index = COLOR_MAP_NAMES.indexOf(colorMap.get());
    const next = Math.min(COLOR_MAP_NAMES.length - 1, Math.max(0, (index < 0 ? 0 : index) - steps));
    if (next !== index) colorMap.set(COLOR_MAP_NAMES[next]);
});

colorMap.subscribe((value) => {
    document.getElementById('colorMapName').textContent = value;
    for (const el of colorMapOptionEls) el.setAttribute('aria-selected', String(el.dataset.value === value));
    scheduleRepaint();
});

// CONTROL PANEL / Reverse color
reverseColor.subscribe((show) => {
    setSwitch('reverseColorButton', show);
});

document.getElementById('reverseColorButton').addEventListener('click', () => {
    reverseColor.set(!reverseColor.get());
    scheduleRepaint();
});

// CONTROL PANEL / Invert color
invertColor.subscribe((show) => {
    setSwitch('invertColorButton', show);
});

document.getElementById('invertColorButton').addEventListener('click', () => {
    invertColor.set(!invertColor.get());
    scheduleRepaint();
});

// CONTROL PANEL / Color bar: preview of the current color settings, low values on the left
const colorbarCanvas = document.getElementById('colorbar');
const drawColorbar = debounceLatest(() => paintLUT(colorbarCanvas, colorSettingsLUT(colorMap.get())), 30);
for (const store of [colorMap, reverseColor, invertColor, colorStart, colorCycles, hueShiftDegrees, saturationPercent, luminosityPercent]) {
    store.subscribe(() => drawColorbar());
}


// Zoom In
document.getElementById('zoomInButton').addEventListener('click', () => {
    zoom.set(zoom.get() * ZOOM_RATE);

    // If not in advancedMode, clear min and max overrides on zoom. The reason is because
    // the window changes, so the min and max values can change drastically.
    if (!advancedMode.get()) {
        clearMinAndMaxOverrides();
    }

    scheduleRepaint();
});
// Zoom Out
document.getElementById('zoomOutButton').addEventListener('click', () => {
    zoom.set(zoom.get() * (1 / ZOOM_RATE));

    // If not in advancedMode, clear min and max overrides on zoom. The reason is because
    // the window changes, so the min and max values can change drastically.
    if (!advancedMode.get()) {
        clearMinAndMaxOverrides();
    }

    scheduleRepaint();
});
// Home
document.getElementById('homeButton').addEventListener('click', () => {
    zoom.set(1);
    xCenter.set(0);
    yCenter.set(0);
    scheduleRepaint();
});

// Goto
document.getElementById('gotoButton').addEventListener('click', () => {
    showGotoModal.set(true);
});

// // // // // // // Drag and drop to pan

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
// Pan by dragging (mouse, pen or one finger), zoom with the mouse wheel,
// trackpad pinch or two-finger pinch. The view follows the pointer live.
canvas.style.touchAction = 'none';

function clientToWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const yH = getYHeight();
    const xW = getXWidth(yH, canvas.width, canvas.height);
    return {
        x: xCenter.get() + ((clientX - r.left) / r.width - 0.5) * xW,
        y: yCenter.get() - ((clientY - r.top) / r.height - 0.5) * yH,
    };
}

function panByClientPixels(dx, dy) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const yH = getYHeight();
    const xW = getXWidth(yH, canvas.width, canvas.height);
    xCenter.set(xCenter.get() - dx * (xW / r.width));
    yCenter.set(yCenter.get() + dy * (yH / r.height));  // Screen y points down
    scheduleRepaint();
}

// Zooms by `factor` keeping the graph point under (clientX, clientY) fixed.
function zoomAtClient(clientX, clientY, factor) {
    const newZoom = zoom.get() * factor;
    if (!Number.isFinite(newZoom) || newZoom <= 0 || !Number.isFinite(factor) || factor <= 0) return;
    const p = clientToWorld(clientX, clientY);
    xCenter.set(p.x + (xCenter.get() - p.x) / factor);
    yCenter.set(p.y + (yCenter.get() - p.y) / factor);
    setZoomSafely(newZoom);

    // If not in advancedMode, clear min and max overrides on zoom. The reason is because
    // the window changes, so the min and max values can change drastically.
    if (!advancedMode.get()) {
        clearMinAndMaxOverrides();
    }
    scheduleRepaint();
}

canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16;  // Lines
    else if (event.deltaMode === 2) dy *= canvas.clientHeight;  // Pages
    // Trackpad pinch arrives as ctrl+wheel with small deltas
    const sensitivity = event.ctrlKey ? 0.01 : 0.0015;
    const factor = Math.exp(-Math.max(-300, Math.min(300, dy)) * sensitivity);
    zoomAtClient(event.clientX, event.clientY, factor);
}, { passive: false });

const activePointers = new Map();
let pinchDistance = null;

function pointerSpread() {
    const [a, b] = [...activePointers.values()];
    return {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
    };
}

canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchDistance = activePointers.size === 2 ? pointerSpread().distance : null;
    canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (event) => {
    const prev = activePointers.get(event.pointerId);
    if (!prev) return;
    if (activePointers.size === 1) {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        panByClientPixels(event.clientX - prev.x, event.clientY - prev.y);
    } else if (activePointers.size === 2) {
        const before = pointerSpread();
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = pointerSpread();
        panByClientPixels(after.midX - before.midX, after.midY - before.midY);
        if (pinchDistance && after.distance > 0) {
            zoomAtClient(after.midX, after.midY, after.distance / pinchDistance);
        }
        pinchDistance = after.distance;
    }
});

function endPointer(event) {
    activePointers.delete(event.pointerId);
    pinchDistance = activePointers.size === 2 ? pointerSpread().distance : null;
    if (activePointers.size === 0) canvas.style.cursor = '';
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('dblclick', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const xPixel = (event.clientX - rect.left) * sx;
    const yPixel = (event.clientY - rect.top) * sy;

    const yHeightVal = getYHeight();
    const windowBounds = calcWindowBounds(xCenter.get(), yCenter.get(), yHeightVal, canvas.width, canvas.height);
    const pixelToXMapper = makeLinearMapper([0, canvas.width], [windowBounds['xMin'], windowBounds['xMax']], false);
    const pixelToYMapper = makeLinearMapper([canvas.height, 0], [windowBounds['yMin'], windowBounds['yMax']], false);

    xCenter.set(pixelToXMapper(xPixel));
    yCenter.set(pixelToYMapper(yPixel));
    zoom.set(zoom.get() * ZOOM_RATE);

    if (!advancedMode.get()) {
        clearMinAndMaxOverrides();
    }

    scheduleRepaint();
});

function countLeadingZeros(str) {
    const match = str.match(/^0*/);
    return match ? match[0].length : 0;
}

function getDecimalPart(str) {
    const parts = str.split('.');
    return parts.length > 1 ? parts[1] : '';
}

function getPrecision() {
    const errorRange = maxVal.get() - minVal.get();
    const errorRangeLeadingZeros = countLeadingZeros(getDecimalPart(errorRange.toString()));
    const yHeightVal = getYHeight();
    const heightLeadingZeros = countLeadingZeros(getDecimalPart(yHeightVal.toString()));
    if (yHeightVal >= 0.01) {
        return 7;
    } else {
        return Math.max(errorRangeLeadingZeros, heightLeadingZeros) + 3;
    }
}

// Show (x, y) = error when the mouse moves over the canvas
// Mouse move event
hoverMsg.listen((value) => {
    document.getElementById('hoverMsg').textContent = value;
});

canvas.addEventListener('mousemove', (event) => {
    // Don't overwrite the "Loading..." message
    if (isLoading.get()) return;

    const precision = getPrecision();

    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const yHeightVal = getYHeight();
    const windowBounds = calcWindowBounds(xCenter.get(), yCenter.get(), yHeightVal, canvas.width, canvas.height);
    var pixelToXMapper = makeLinearMapper([0, canvas.width], [windowBounds['xMin'], windowBounds['xMax']], false);
    var pixelToYMapper = makeLinearMapper([canvas.height, 0], [windowBounds['yMin'], windowBounds['yMax']], false);
    const xPixel = (event.clientX - r.left) * sx;
    const yPixel = (event.clientY - r.top) * sy;
    const x = pixelToXMapper(xPixel);
    const y = pixelToYMapper(yPixel);
    const xStr = x.toFixed(precision);
    const yStr = y.toFixed(precision);
    document.getElementById('hoverMsgDiv').style.display = 'block';

    const errorVal = getGraphValueAt(Math.floor(xPixel), Math.floor(yPixel));
    if (Number.isFinite(errorVal)) {
        const isFractal = fractal_mode.get();
        const errorValStr = isFractal ? Math.round(errorVal).toString() : errorVal.toFixed(precision);
        const label = isFractal ? 'steps' : 'error';
        hoverMsg.set(`(${xStr}, ${yStr}): ${label} = ${errorValStr}`);
    }
});

canvas.addEventListener('mouseleave', (event) => {
    if (isLoading.get()) return;  // Don't overwrite "Loading..." message
    document.getElementById('hoverMsgDiv').style.display = 'none';
});

document.getElementById('clearEquationBtn').addEventListener('click', () => {
    equation.set('');
});

// // // // // // // Math Input logic
const ta = document.getElementById('equationInput');
const btn = document.getElementById('mathBtn');
const pop = document.getElementById('mathPopover');
const grid = document.getElementById('fnGrid');
const filter = document.getElementById('mathFilter');
const closeBtn = document.getElementById('closePopover');


  /** Utility: position popover near button */
function positionPopover() {
const rect = btn.getBoundingClientRect();
const popWidth = pop.offsetWidth;
const popHeight = pop.offsetHeight;

// Open below the button, left-aligned with it
let left = rect.left;
let top = rect.bottom + 6; // 6px gap

// Ensure it doesn't overflow viewport
left = Math.max(6, Math.min(left, window.innerWidth - popWidth - 6));
top = Math.max(6, Math.min(top, window.innerHeight - popHeight - 6));

pop.style.left = `${left}px`;
pop.style.top = `${top}px`;
}

function isOpen() { return pop.style.display === 'block'; }
function openPopover() {
pop.style.display = 'block';
pop.setAttribute('aria-hidden', 'false');
btn.setAttribute('aria-expanded', 'true');
positionPopover();
requestAnimationFrame(() => filter.focus());
window.addEventListener('resize', positionPopover);
window.addEventListener('scroll', positionPopover, true);
document.addEventListener('click', onClickOutside, { capture: true });
}

function closePopover() {
pop.style.display = 'none';
btn.setAttribute('aria-expanded', 'false');
document.removeEventListener('click', onClickOutside, { capture: true });
window.removeEventListener('resize', positionPopover);
window.removeEventListener('scroll', positionPopover, true);
}

function onClickOutside(e) {
if (!pop.contains(e.target) && e.target !== btn) closePopover();
}

// Toggle open/close
btn.addEventListener('click', () => (isOpen() ? closePopover() : openPopover()));
closeBtn.addEventListener('click', closePopover);

// Keyboard shortcut: Ctrl/⌘+K
document.addEventListener('keydown', (e) => {
if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
e.preventDefault();
isOpen() ? closePopover() : openPopover();
}
});

// Filter search
filter.addEventListener('input', () => {
const q = filter.value.trim().toLowerCase();
grid.querySelectorAll('.fn').forEach(b => {
const t = (b.textContent + ' ' + (b.title || '')).toLowerCase();
b.style.display = t.includes(q) ? '' : 'none';
});
grid.querySelectorAll('.fn-group').forEach(g => {
g.style.display = [...g.querySelectorAll('.fn')].some(b => b.style.display !== 'none') ? '' : 'none';
});
});

// Insert logic
function insertOrWrap({ insert, wrapStart, wrapEnd }) {
const start = ta.selectionStart ?? 0;
const end = ta.selectionEnd ?? 0;
const hasSelection = start !== end;
let before = ta.value.slice(0, start);
let selected = ta.value.slice(start, end);
let after = ta.value.slice(end);

if (wrapStart != null && wrapEnd != null) {
const content = hasSelection ? selected : ' ';
ta.value = before + wrapStart + content + wrapEnd + after;
const cursorPos = before.length + wrapStart.length + (hasSelection ? content.length : 1);
ta.focus();
ta.setSelectionRange(cursorPos, cursorPos);
} else if (insert != null) {
ta.value = before + insert + after;
const cursorPos = before.length + insert.length;
ta.focus();
ta.setSelectionRange(cursorPos, cursorPos);
}
ta.dispatchEvent(new Event('input', { bubbles: true }));
}

grid.addEventListener('click', (e) => {
const b = e.target.closest('.fn');
if (!b) return;
insertOrWrap({
insert: b.getAttribute('data-insert'),
wrapStart: b.getAttribute('data-wrap-start'),
wrapEnd: b.getAttribute('data-wrap-end')
});
ta.focus();
});

// // // // // // // Initialization

function fitCanvasToDisplay(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Only touch backing store if it actually changed
    const newW = Math.max(1, Math.round(rect.width * dpr));
    const newH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== newW || canvas.height !== newH) {
        canvas.width = newW;
        canvas.height = newH;
    }

    // Always draw in CSS pixels; map 1 unit = 1 CSS px
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Set canvas size to match its display size
function resizeCanvas() {
    fitCanvasToDisplay(canvas);
    scheduleRepaint();
}

// Resize canvas when window is resized
// window.addEventListener('resize', resizeCanvas);

/////////////////////////////////////////////////////////////////////////////////////// URL Handling

function flattenCymaticsConfig(configObj) {
    const flattened = {};
    for (const [cyKey, configKey] of Object.entries(CY_PARAM_MAP)) {
        const val = configObj[configKey];
        if (typeof val !== 'undefined') {
            flattened[cyKey] = val;
        }
    }
    return flattened;
}

function buildCymaticsConfigFromParams(params) {
    const mapped = {};
    let hasAny = false;
    for (const [cyKey, configKey] of Object.entries(CY_PARAM_MAP)) {
        if (params[cyKey] !== null && typeof params[cyKey] !== 'undefined') {
            mapped[configKey] = params[cyKey];
            hasAny = true;
        }
    }
    if (!hasAny) return null;
    // Older saved images and links have no waveform; they used sinc.
    if (mapped.waveform !== 'sine' && mapped.waveform !== 'sinc') {
        mapped.waveform = 'sinc';
    }
    return mapped;
}

// Graph settings stored in links and images. They are applied in this order
// because some stores adjust others when set (rotation moves the center).
const CONFIG_STORES = {
    max_iterations, threshold, fuzzyLevel, fuzzyFunction, showAxes, colorMap,
    reverseColor, invertColor, colorStart, colorCycles, hueShiftDegrees,
    saturationPercent, luminosityPercent, xCenter, yCenter, rotationDegrees,
    zoom, advancedMode, minOverride, maxOverride
};

function getAppConfig() {
    const config = { equation: getStrippedEquation() };
    for (const [key, store] of Object.entries(CONFIG_STORES)) {
        config[key] = store.get();
    }
    if (unmodifiedCymaticsEquation.get()) {
        // The equation is rebuilt from the cymatics settings, so it need not be stored
        Object.assign(config, flattenCymaticsConfig(cymaticsConfig.get()));
        delete config.equation;
    }
    return config;
}

function setConfigFromObj(config) {
    if (config.equation != null) {
        const loadedEquation = String(config.equation);
        untrustedEquation = loadedEquation.replace(/\s+/g, '');
        equation.set(loadedEquation);
    }
    for (const [key, store] of Object.entries(CONFIG_STORES)) {
        const value = config[key];
        if (key === 'fuzzyFunction') {
            // Links and images from before the fuzzy function existed used the default
            store.set(value != null ? String(value).slice(0, 500) : DEFAULT_FUZZY_FUNCTION);
        } else if (key === 'zoom') {
            // Older links and images store the visible height instead of the zoom
            if (value != null) setZoomSafely(value);
            else if (config.yHeight != null) setZoomFromYHeight(config.yHeight);
        } else if (value != null) {
            store.set(value);
        }
    }

    const cymaticsConfigFromParams = buildCymaticsConfigFromParams(config);
    if (cymaticsConfigFromParams !== null) {
        cymaticsConfig.set({ ...cymaticsConfig.get(), ...cymaticsConfigFromParams });
        const cymaticsEqStr = get_cymatics_equation_generator(cymaticsConfig.get());
        // Built from link/image values (e.g. cyCombineOperator), so never run it as JS
        untrustedEquation = cymaticsEqStr.replace(/\s+/g, '');
        equation.set(cymaticsEqStr);
        unmodifiedCymaticsEquation.set(true);
    }
}

// Converts a URL parameter string to the JSON-ish type it was saved from.
// An empty value stays empty: for the min/max overrides it means "off".
function parseUrlParam(value) {
    if (value.startsWith('[') && value.endsWith(']')) {
        try { return JSON.parse(value); } catch { return value; }
    }
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    if (value.trim() !== '' && !isNaN(value)) return parseFloat(value);
    return value;
}

// The graph shown when the URL holds no settings.
const DEFAULT_GRAPH = 'equation=y%3Dx%2F(x^2%2By^2)&max_iterations=1000&threshold=100&fuzzyLevel=30&fuzzyFunction=log(v+%2B+3^(-5+*+(1+-+f)))&showAxes=false&colorMap=gray&reverseColor=true&invertColor=false&colorStart=0&colorCycles=1&hueShiftDegrees=0&saturationPercent=0&luminosityPercent=0&xCenter=0.09067702993536386&yCenter=-0.14187389580017434&rotationDegrees=0&zoom=1.860787899662108&advancedMode=true&maxOverride=3.0';

function getUrlParams() {
    // Older links put the settings in the fragment instead of the query
    const fragment = location.hash.slice(1).replace(/^[?&]/, '');
    const query = fragment.includes('=') ? fragment : location.search.slice(1);
    return new URLSearchParams(query || DEFAULT_GRAPH);
}

function setParamsFromUrl() {
    const params = getUrlParams();
    const config = {};
    for (const [key, value] of params) {
        config[key] = parseUrlParam(value);
    }
    setConfigFromObj(config);

    if (params.has('download')) {
        const get = (key) => params.get(key);
        saveImage(get('w'), get('h'), get('xCenter'), get('yCenter'), get('zoom'), get('yHeight'), get('filename'));
    }
}

function configToUrl(config) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(config)) {
        if (value == null) continue;
        params.set(key, Array.isArray(value) ? JSON.stringify(value) : value);
    }
    const url = new URL(location.href);
    url.search = params;
    url.hash = '';
    return url.href;
}

// A shared link fixes the color range so it renders exactly as it looks now.
function getShareUrl() {
    const config = getAppConfig();
    if (config.minOverride == null || config.minOverride === '') config.minOverride = minVal.get();
    if (config.maxOverride == null || config.maxOverride === '') config.maxOverride = maxVal.get();
    return configToUrl(config);
}

// Keeps the address bar in sync with the graph, so reload and bookmarks restore it.
const syncUrl = debounceLatest(() => {
    try {
        history.replaceState(null, '', configToUrl(getAppConfig()));
    } catch {
        // Some browsers refuse to change the URL of a file:// page
    }
}, 300);

// Undo/redo of the graph settings: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y. The view
// (pan and zoom) is not part of the history, so undoing an edit keeps the view.
const HISTORY_VIEW_KEYS = ['xCenter', 'yCenter', 'zoom'];
const HISTORY_LIMIT = 200;
const undoStack = [];
const redoStack = [];
let historyCurrent = null;

function historySnapshot() {
    const config = getAppConfig();
    for (const key of HISTORY_VIEW_KEYS) delete config[key];
    if (config.equation != null) config.equation = equation.get();  // keep the spacing
    return {
        config,
        key: JSON.stringify(config),
        trusted: getStrippedEquation() !== untrustedEquation,
    };
}

function recordHistoryNow() {
    const snap = historySnapshot();
    if (historyCurrent && snap.key === historyCurrent.key) return;
    if (historyCurrent) {
        undoStack.push(historyCurrent);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack.length = 0;
    }
    historyCurrent = snap;
    updateHistoryButtons();
}

const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
}
undoButton.addEventListener('click', () => undo());
redoButton.addEventListener('click', () => redo());
// Groups a burst of edits (typing, dragging a slider) into one undo step
const recordHistory = debounceLatest(recordHistoryNow, 400);

function applyHistory(snap) {
    const { config } = snap;
    if (config.equation != null) unmodifiedCymaticsEquation.set(false);
    setConfigFromObj(config);
    // setConfigFromObj skips empty values, but here empty means "off"
    for (const [key, store] of Object.entries(CONFIG_STORES)) {
        if (key in config && config[key] == null && key !== 'fuzzyFunction') store.set(config[key]);
    }
    // Equations the user typed in this session may run as JS again
    if (snap.trusted) untrustedEquation = null;
    historyCurrent = historySnapshot();
    updateHistoryButtons();
    scheduleRepaint();
}

function undo() {
    recordHistoryNow();
    if (!undoStack.length) return;
    redoStack.push(historyCurrent);
    applyHistory(undoStack.pop());
}

function redo() {
    recordHistoryNow();
    if (!redoStack.length) return;
    undoStack.push(historyCurrent);
    applyHistory(redoStack.pop());
}

document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey);
    if (!isUndo && !isRedo) return;
    // Fields in dialogs (save size, equation editor draft, ...) keep their native undo
    const field = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (field && !controlPanel.contains(field)) return;
    e.preventDefault();
    if (isUndo) undo(); else redo();
});

setParamsFromUrl();

const ro = new ResizeObserver(() => resizeCanvas());
ro.observe(document.getElementById('overCanvasControls'));
ro.observe(document.getElementById('mainCanvas'));

function removeResizeObserver() {
    ro.unobserve(document.getElementById('overCanvasControls'));
    ro.unobserve(document.getElementById('mainCanvas'));
    ro.disconnect();
}

window.addEventListener('load', () => {
    requestAnimationFrame(() => {
        resizeCanvas();
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(resizeCanvas);
        }
    });
});


// Cymatics
function drawResonatorPointsOnCanvas(canvasId, cfg) {
const canvas = document.getElementById(canvasId);
if (!canvas) return;

const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;

// Clear canvas
ctx.clearRect(0, 0, width, height);

// Background
ctx.fillStyle = '#f9fafb'; // gray-50-ish
ctx.fillRect(0, 0, width, height);

const centerX = width / 2;
const centerY = height / 2;

const points = uniformly_distributed_points(
    cfg.numResonators,
    cfg.distance,
    cfg.rotateRadians
);

let maxRadius = Math.abs(cfg.distance);
if (maxRadius === 0) maxRadius = 1;
const scale = (Math.min(width, height) * 0.4) / maxRadius;

// Axes
ctx.strokeStyle = '#e5e7eb'; // gray-200
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(centerX, 0);
ctx.lineTo(centerX, height);
ctx.moveTo(0, centerY);
ctx.lineTo(width, centerY);
ctx.stroke();

// Origin
ctx.fillStyle = '#9ca3af'; // gray-400
ctx.beginPath();
ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
ctx.fill();

// Points
ctx.fillStyle = '#111827'; // gray-900
points.forEach((p) => {
    const cx = centerX + p.x * scale;
    const cy = centerY - p.y * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
    ctx.fill();
});
}

function get_cymatics_equation_generator(cfg) {
const eqStr = cymatics_equation_generator(
    cfg.numResonators,
    cfg.distance,
    cfg.amplitude,
    cfg.frequency,
    cfg.phase,
    cfg.combineOperator,
    cfg.rotateRadians,
    cfg.waveform
);

return eqStr;
}

document.addEventListener('DOMContentLoaded', () => {
const mandelbrotModal = document.getElementById('mandelbrotModal');
const openMandelbrotBtn = document.getElementById('openMandelbrotModal');
const closeMandelbrotBtn = document.getElementById('mandelbrotModalClose');
const insertMandelbrotBtn = document.getElementById('insertMandelbrotButton');
const maxIterationsInput = document.getElementById('maxIterationsInput');
const thresholdInput = document.getElementById('thresholdInput');
const juliaModal = document.getElementById('juliaModal');
const openJuliaBtn = document.getElementById('openJuliaModal');
const closeJuliaBtn = document.getElementById('juliaModalClose');
const insertJuliaBtn = document.getElementById('insertJuliaButton');
const juliaMaxIterationsInput = document.getElementById('juliaMaxIterationsInput');
const juliaThresholdInput = document.getElementById('juliaThresholdInput');
const juliaCRealInput = document.getElementById('juliaCRealInput');
const juliaCImagInput = document.getElementById('juliaCImagInput');

if (maxIterationsInput) maxIterationsInput.value = max_iterations.get();
if (thresholdInput) thresholdInput.value = threshold.get();
if (juliaMaxIterationsInput) juliaMaxIterationsInput.value = max_iterations.get();
if (juliaThresholdInput) juliaThresholdInput.value = threshold.get();
if (juliaCRealInput) juliaCRealInput.value = juliaCReal.get();
if (juliaCImagInput) juliaCImagInput.value = juliaCImag.get();

showMandelbrotModal.subscribe((isOpen) => {
    if (!mandelbrotModal) return;
    mandelbrotModal.classList.toggle('hidden', !isOpen);
});

showJuliaModal.subscribe((isOpen) => {
    if (!juliaModal) return;
    juliaModal.classList.toggle('hidden', !isOpen);
});

if (openMandelbrotBtn) {
    openMandelbrotBtn.addEventListener('click', () => {
        closePopover();
        showMandelbrotModal.set(true);
    });
}

if (openJuliaBtn) {
    openJuliaBtn.addEventListener('click', () => {
        closePopover();
        showJuliaModal.set(true);
    });
}

if (closeMandelbrotBtn) {
    closeMandelbrotBtn.addEventListener('click', () => showMandelbrotModal.set(false));
}

if (closeJuliaBtn) {
    closeJuliaBtn.addEventListener('click', () => showJuliaModal.set(false));
}

if (maxIterationsInput) {
    maxIterationsInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        max_iterations.set(Number.isFinite(val) ? val : 0);
    });
}

if (thresholdInput) {
    thresholdInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        threshold.set(Number.isFinite(val) ? val : 0);
    });
}

if (juliaMaxIterationsInput) {
    juliaMaxIterationsInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        max_iterations.set(Number.isFinite(val) ? val : 0);
    });
}

if (juliaThresholdInput) {
    juliaThresholdInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        threshold.set(Number.isFinite(val) ? val : 0);
    });
}

if (juliaCRealInput) {
    juliaCRealInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        juliaCReal.set(Number.isFinite(val) ? val : 0);
    });
}

if (juliaCImagInput) {
    juliaCImagInput.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        juliaCImag.set(Number.isFinite(val) ? val : 0);
    });
}

max_iterations.subscribe((val) => {
    if (maxIterationsInput) maxIterationsInput.value = val;
    if (juliaMaxIterationsInput) juliaMaxIterationsInput.value = val;
});

threshold.subscribe((val) => {
    if (thresholdInput) thresholdInput.value = val;
    if (juliaThresholdInput) juliaThresholdInput.value = val;
});

juliaCReal.subscribe((val) => {
    if (juliaCRealInput) juliaCRealInput.value = val;
});

juliaCImag.subscribe((val) => {
    if (juliaCImagInput) juliaCImagInput.value = val;
});

if (insertMandelbrotBtn) {
    insertMandelbrotBtn.addEventListener('click', () => {
        const maxVal = Number(max_iterations.get()) || 100;
        const thresholdVal = Number(threshold.get()) || 2;
        const eqStr = `mandelbrot(max_iterations=${maxVal}, threshold=${thresholdVal})`;
        equation.set(eqStr);
        unmodifiedCymaticsEquation.set(false);
        showMandelbrotModal.set(false);
    });
}

if (insertJuliaBtn) {
    insertJuliaBtn.addEventListener('click', () => {
        const maxVal = Number(max_iterations.get()) || 100;
        const thresholdVal = Number(threshold.get()) || 2;
        const cReVal = Number(juliaCReal.get());
        const cImVal = Number(juliaCImag.get());
        const eqStr = `julia(max_iterations=${maxVal}, threshold=${thresholdVal}, c_re=${cReVal}, c_im=${cImVal})`;
        equation.set(eqStr);
        unmodifiedCymaticsEquation.set(false);
        showJuliaModal.set(false);
    });
}

const modal = document.getElementById('cymaticsModal');
const openBtn = document.getElementById('openCymaticsModal');
const closeBtn = document.getElementById('cymaticsModalClose');
const insertBtn = document.getElementById('insertCymaticsEquationButton');

const numInput = document.getElementById('numResonatorsInput');
const distanceInput = document.getElementById('distanceInput');
const amplitudeInput = document.getElementById('amplitudeInput');
const frequencyInput = document.getElementById('frequencyInput');
const phaseInput = document.getElementById('phaseInput');
const combineInput = document.getElementById('combineOperatorInput');
const rotateInput = document.getElementById('rotateRadiansInput');
const waveformInput = document.getElementById('waveformInput');

// Initialize inputs from store
const initial = cymaticsConfig.get();
numInput.value = initial.numResonators;
distanceInput.value = initial.distance;
amplitudeInput.value = initial.amplitude;
frequencyInput.value = initial.frequency;
phaseInput.value = initial.phase;
combineInput.value = initial.combineOperator;
rotateInput.value = initial.rotateRadians;
waveformInput.value = initial.waveform;

// Sync modal visibility with store
showCymaticsModal.subscribe((isOpen) => {
    if (!modal) return;
    if (isOpen) {
        modal.classList.remove('hidden');
        drawResonatorPointsOnCanvas('resonatorCanvas', cymaticsConfig.get());
    } else {
        modal.classList.add('hidden');
    }
});

// Open / close via buttons
if (openBtn) {
    openBtn.addEventListener('click', () => {
        closePopover();
        showCymaticsModal.set(true);
    });
}
if (closeBtn) closeBtn.addEventListener('click', () => showCymaticsModal.set(false));

// Click on overlay closes modal
// if (modal) {
//     modal.addEventListener('click', (e) => {
//         if (e.target === modal) {
//             e.preventDefault();
//             e.stopPropagation();
//             showCymaticsModal.set(false);
//         }
//     });
// }

// On each input change, update store
numInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('numResonators', Number(e.target.value || 0));
});
distanceInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('distance', Number(e.target.value || 0));
});
amplitudeInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('amplitude', Number(e.target.value || 0));
});
frequencyInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('frequency', Number(e.target.value || 0));
});
phaseInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('phase', Number(e.target.value || 0));
});
combineInput.addEventListener('change', (e) => {
    cymaticsConfig.setKey('combineOperator', e.target.value);
});
rotateInput.addEventListener('input', (e) => {
    cymaticsConfig.setKey('rotateRadians', Number(e.target.value || 0));
});
waveformInput.addEventListener('change', (e) => {
    cymaticsConfig.setKey('waveform', e.target.value);
});

// Whenever layout-related config changes, redraw canvas
cymaticsConfig.subscribe((cfg) => {
    waveformInput.value = cfg.waveform;
    drawResonatorPointsOnCanvas('resonatorCanvas', cfg);
});

// Insert equation button: use store-backed function, then close modal
if (insertBtn) {
    insertBtn.addEventListener('click', () => {
        const cfg = cymaticsConfig.get();
        const cymaticsEqStr = get_cymatics_equation_generator(cfg);
        equation.set(cymaticsEqStr);
        unmodifiedCymaticsEquation.set(true);
        showCymaticsModal.set(false);
    });
}
});
