// fuzzygraph_glsl.js
// Logic to draw fuzzy graphs on a canvas using GLSL fragment shading

import { create, all } from 'mathjs';
const math = create(all);

// import { evaluate_cmap } from './js-colormaps.js';
import { getMatplotlibColormap } from './ga_color.js';
import { compileEquationToGLSL, compileExpressionToGLSL, COMPLEX_GLSL } from './equation_glsl.js';

export const ZOOM_RATE = 1.5;
export const MAX_FUZZY = 200;

// Samples per canvas pixel along each axis (2 = 4 samples per pixel). Higher
// values smooth thin lines further and cost that many squared more evaluations.
export const DEFAULT_SUPERSAMPLE = 2;
// Caps the values texture (4 bytes per sample) at 128 MB.
const MAX_SUPERSAMPLE_TEXELS = 32 * 1024 * 1024;

export function isMandelbrotEquation(eqStr) {
  if (!eqStr || typeof eqStr !== 'string') return false;
  return eqStr.toLowerCase().includes('mandelbrot');
}

export function isJuliaEquation(eqStr) {
  if (!eqStr || typeof eqStr !== 'string') return false;
  return eqStr.toLowerCase().includes('julia');
}

export function parseMandelbrotParams(eqStr, { defaultMax = 1000, defaultThreshold = 100, onParamsParsed } = {}) {
  const maxMatch = eqStr.match(/max_iterations\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  const thresholdMatch = eqStr.match(/threshold\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);

  const parsedMax = Number(maxMatch && maxMatch[1]);
  const parsedThreshold = Number(thresholdMatch && thresholdMatch[1]);

  const maxVal = Number.isFinite(parsedMax) ? parsedMax : defaultMax;
  const thresholdVal = Number.isFinite(parsedThreshold) ? parsedThreshold : defaultThreshold;

  if (typeof onParamsParsed === 'function') {
    onParamsParsed({ maxVal, thresholdVal });
  }

  return { maxVal, thresholdVal };
}

export function createMandelbrotFunction(eqStr, options = {}) {
  const { maxVal, thresholdVal } = parseMandelbrotParams(eqStr, options);
  const maxIterations = Math.max(1, Math.floor(maxVal));

  return {
    _source: eqStr,
    _isPolar: false,
    _isJsFunction: false,
    _isMandelbrot: true,
    maxIterations,
    threshold: thresholdVal
  };
}

export function parseJuliaParams(
  eqStr,
  {
    defaultMax = 1000,
    defaultThreshold = 100,
    defaultCRe = -0.796,
    defaultCIm = 0.185,
    onParamsParsed
  } = {}
) {
  const maxMatch = eqStr.match(/max_iterations\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  const thresholdMatch = eqStr.match(/threshold\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  const cReMatch = eqStr.match(/c_re\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  const cImMatch = eqStr.match(/c_im\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);

  const parsedMax = Number(maxMatch && maxMatch[1]);
  const parsedThreshold = Number(thresholdMatch && thresholdMatch[1]);
  const parsedCRe = Number(cReMatch && cReMatch[1]);
  const parsedCIm = Number(cImMatch && cImMatch[1]);

  const maxVal = Number.isFinite(parsedMax) ? parsedMax : defaultMax;
  const thresholdVal = Number.isFinite(parsedThreshold) ? parsedThreshold : defaultThreshold;
  const cRe = Number.isFinite(parsedCRe) ? parsedCRe : defaultCRe;
  const cIm = Number.isFinite(parsedCIm) ? parsedCIm : defaultCIm;

  if (typeof onParamsParsed === 'function') {
    onParamsParsed({ maxVal, thresholdVal, cRe, cIm });
  }

  return { maxVal, thresholdVal, cRe, cIm };
}

export function createJuliaFunction(eqStr, options = {}) {
  const { maxVal, thresholdVal, cRe, cIm } = parseJuliaParams(eqStr, options);
  const maxIterations = Math.max(1, Math.floor(maxVal));

  return {
    _source: eqStr,
    _isPolar: false,
    _isJsFunction: false,
    _isJulia: true,
    maxIterations,
    threshold: thresholdVal,
    cRe,
    cIm,
  };
}

// // // // // // // Math stuff

export function makeLinearMapper(inRange, outRange, intOut) {
  const inDelta = inRange[1] - inRange[0];
  const outDelta = outRange[1] - outRange[0];
  const m = (outDelta / inDelta);
  const b = outRange[0] - m * inRange[0];

  if (intOut) {
    var linearMapper = function(val) {
      return Math.round(m * val + b);
    }
  }
  else {
    var linearMapper = function(val) {
      return m * val + b;
    }
  }

  return linearMapper;
}

export function cartesian_to_polar(x, y) {
  const r = math.sqrt(x**2 + y**2);
  var theta = math.atan2(y, x);
  if (theta < 0) theta += 2 * Math.PI;
  return {'r': r, 't': theta};
}

export function parsePolarEquationString(eq_str) {
  if (eq_str.includes("≈")) {
    var split_result = eq_str.split("≈");
  }
  else {
    var split_result = eq_str.split("=");
  }
  if (split_result.length != 2) {
    return null;
  }

  try {
    const left_polar = math.evaluate('f(r, t) = ' + split_result[0], {});
    const right_polar = math.evaluate('f(r, t) = ' + split_result[1], {});
    var left_eq = (x, y) => {
      const p_coords = cartesian_to_polar(x, y);
      return left_polar(p_coords['r'], p_coords['t']);
    };
    var right_eq = (x, y) => {
      const p_coords = cartesian_to_polar(x, y);
      return right_polar(p_coords['r'], p_coords['t']);
    };

    left_eq(0.01, 0.01);
    right_eq(0.01, 0.01);
  } catch (error) {
    console.log(`Failed to parse polar equation: ${error}`);
    return null;
  }
  // Compare real parts only after evaluating each complete side of the equation.
  var error_func = function (x, y) { return Math.abs(math.re(left_eq(x, y)) - math.re(right_eq(x, y))); };

  return error_func;
}

// Says why an equation cannot be graphed, or returns null if it can.
export function describeEquationError(eq_str) {
  const delimiter = eq_str.includes('≈') ? '≈' : '=';
  const sides = eq_str.split(delimiter);
  if (sides.length < 2) return 'Needs an equals sign, e.g. y = x^2';
  if (sides.length > 2) return 'Use a single equals sign';
  const variables = isPolarEquation(eq_str) ? 'r, t' : 'x, y';
  for (const [index, side] of sides.entries()) {
    const name = index === 0 ? 'Left side' : 'Right side';
    if (side.trim() === '') return `${name} is empty`;
    try {
      // Parsing the side alone keeps "(char n)" positions relative to it
      math.parse(side);
      math.evaluate(`f(${variables}) = ${side}`, {})(0.01, 0.01);
    } catch (err) {
      return `${name}: ${err && err.message ? err.message : String(err)}`;
    }
  }
  return null;
}

function isPolarEquation(eq_str) {
  const cleanEq = eq_str.toLowerCase().replace(/\s+/g, '');
  const polarRegex = /\br\b|\bt\b/;
  return polarRegex.test(cleanEq);
}

function isJsFunction(eq_str) {
  if (typeof eq_str !== 'string') return false;

  try {
    const fn = new Function(`return (${eq_str});`)();
    return typeof fn === 'function';
  } catch (e) {
    return false;
  }
}

function getFunctionFromCode(jsCode) {
  return eval(`(function(){ ${jsCode}; return f; })()`);
}

const PARSE_CACHE_SIZE = 32;
const parseCache = new Map();

// Parsing with math.js is slow enough to matter when repainting on every
// slider tick, so results are memoized by equation string.
// allowJs: JavaScript function equations are executed to build them, so callers
// must pass false for equations from untrusted sources (share links, images).
export function parseEquationString(eq_str, { allowJs = true } = {}) {
  const key = `${allowJs ? 'js' : 'nojs'}|${eq_str}`;
  if (parseCache.has(key)) {
    return parseCache.get(key);
  }
  const fn = parseEquationStringUncached(eq_str, allowJs);
  parseCache.set(key, fn);
  if (parseCache.size > PARSE_CACHE_SIZE) {
    parseCache.delete(parseCache.keys().next().value);
  }
  return fn;
}

function parseEquationStringUncached(eq_str, allowJs) {
  if (isPolarEquation(eq_str)) {
    const fn = parsePolarEquationString(eq_str);
    if (fn) {
      fn._source = eq_str;
      fn._isPolar = true;
      fn._isJsFunction = false;
    }
    return fn;
  }
  else if (allowJs && isJsFunction(eq_str)) {
    const fn = getFunctionFromCode(eq_str);
    if (fn) {
      fn._source = eq_str;
      fn._isPolar = false;
      fn._isJsFunction = true;
    }
    return fn;
  }

  if (eq_str.includes("≈")) {
    var split_result = eq_str.split("≈");
  }
  else {
    var split_result = eq_str.split("=");
  }
  if (split_result.length != 2) {
    return null;
  }

  try {
    var left_eq = math.evaluate('f(x, y) = ' + split_result[0], {});
    var right_eq = math.evaluate('f(x, y) = ' + split_result[1], {});

    left_eq(0.01, 0.01);
    right_eq(0.01, 0.01);
  } catch (error) {
    console.log(`Error parsing equation: ${error}`);
    return null;
  }
  // Compare real parts only after evaluating each complete side of the equation.
  var error_func = function (x, y) { return Math.abs(math.re(left_eq(x, y)) - math.re(right_eq(x, y))); };

  error_func._source = eq_str;
  error_func._isPolar = false;
  error_func._isJsFunction = false;

  return error_func;
}

export function getXMin(xWidth, xCenter) {
  return -1 * xWidth / 2 + xCenter;
}

export function getXMax(xWidth, xCenter) {
  return xWidth / 2 + xCenter;
}

export function getYMin(yHeight, yCenter) {
  return -1 * yHeight / 2 + yCenter;
}

export function getYMax(yHeight, yCenter) {
  return yHeight / 2 + yCenter;
}

export function getHeightToWidthMultiplier(xWidth, yHeight) {
  return xWidth / yHeight;
}

export function getXWidth(yHeight, canvasWidth, canvasHeight) {
  return yHeight * getHeightToWidthMultiplier(canvasWidth, canvasHeight);
}

export function calcWindowBounds(xCenter, yCenter, yHeight, canvasWidth, canvasHeight) {
  var xWidth = getXWidth(yHeight, canvasWidth, canvasHeight);

  return {
    'xMin': getXMin(xWidth, xCenter),
    'xMax': getXMax(xWidth, xCenter),
    'yMin': getYMin(yHeight, yCenter),
    'yMax': getYMax(yHeight, yCenter)
  };
}

function glslNumber(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) {
    throw new Error(`Non-finite numeric literal: ${val}`);
  }
  if (Number.isInteger(num)) {
    return `${num}.0`;
  }
  return `${num}`;
}

function buildMandelbrotShader(maxIterations, threshold, useSmooth) {
  const maxIterInt = Math.max(1, Math.floor(maxIterations));
  const bailoutSq = glslNumber(threshold * threshold);
  const smoothLogic = useSmooth
    ? `    float mag = sqrt(escapedMagSq);
    float smooth = float(steps) + 1.0 - log2(log(mag)) / log2(2.0);
    result = smooth;`
    : `    result = float(steps);`;
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec4 uBounds;
uniform vec2 uRotation;

void main() {
  vec2 frag = gl_FragCoord.xy;
  float x = mix(uBounds.x, uBounds.y, frag.x / uResolution.x);
  float y = mix(uBounds.z, uBounds.w, (uResolution.y - frag.y) / uResolution.y);
  float rotatedX = x * uRotation.x - y * uRotation.y;
  float rotatedY = x * uRotation.y + y * uRotation.x;

  float zx = rotatedX;
  float zy = rotatedY;
  float cx = rotatedX;
  float cy = rotatedY;
  int steps = 0;
  float escapedMagSq = 0.0;
  bool escaped = false;

  for (int i = 0; i < ${maxIterInt}; i++) {
    float nextZx = (zx * zx) - (zy * zy) + cx;
    float nextZy = 2.0 * zx * zy + cy;
    zx = nextZx;
    zy = nextZy;

    escapedMagSq = (zx * zx) + (zy * zy);
    if (escapedMagSq > ${bailoutSq}) {
      escaped = true;
      break;
    }

    steps++;
  }

  float result;
  if (escaped) {
${smoothLogic}
  } else {
    result = float(${maxIterInt});
  }
  outColor = vec4(result, 0.0, 0.0, 1.0);
}`;
}

function buildJuliaShader(maxIterations, threshold, cRe, cIm, useSmooth) {
  const maxIterInt = Math.max(1, Math.floor(maxIterations));
  const bailoutSq = glslNumber(threshold * threshold);
  const smoothLogic = useSmooth
    ? `    float mag = sqrt(escapedMagSq);
    float smooth = float(steps) + 1.0 - log2(log(mag)) / log2(2.0);
    result = smooth;`
    : `    result = float(steps);`;
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec4 uBounds;
uniform vec2 uRotation;

void main() {
  vec2 frag = gl_FragCoord.xy;
  float x = mix(uBounds.x, uBounds.y, frag.x / uResolution.x);
  float y = mix(uBounds.z, uBounds.w, (uResolution.y - frag.y) / uResolution.y);
  float rotatedX = x * uRotation.x - y * uRotation.y;
  float rotatedY = x * uRotation.y + y * uRotation.x;

  float zx = rotatedX;
  float zy = rotatedY;
  float cx = ${glslNumber(cRe)};
  float cy = ${glslNumber(cIm)};
  int steps = 0;
  float escapedMagSq = 0.0;
  bool escaped = false;

  for (int i = 0; i < ${maxIterInt}; i++) {
    float nextZx = (zx * zx) - (zy * zy) + cx;
    float nextZy = 2.0 * zx * zy + cy;
    zx = nextZx;
    zy = nextZy;

    escapedMagSq = (zx * zx) + (zy * zy);
    if (escapedMagSq > ${bailoutSq}) {
      escaped = true;
      break;
    }

    steps++;
  }

  float result;
  if (escaped) {
${smoothLogic}
  } else {
    result = float(${maxIterInt});
  }
  outColor = vec4(result, 0.0, 0.0, 1.0);
}`;
}

function buildEvalShader(eqStr, isPolar) {
  const compiled = compileEquationToGLSL(eqStr);
  const polarPrelude = isPolar ? `
  float r = length(vec2(x, y));
  float t = atan(y, x);
  if (t < 0.0) { t += 6.28318530718; }
` : '';
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec4 uBounds;
uniform vec2 uRotation;
${COMPLEX_GLSL}
float evalEquation(float x, float y) {
${polarPrelude}
${compiled.statements}
  return ${compiled.expression};
}
void main() {
  vec2 frag = gl_FragCoord.xy;
  float rawX = mix(uBounds.x, uBounds.y, frag.x / uResolution.x);
  float rawY = mix(uBounds.z, uBounds.w, (uResolution.y - frag.y) / uResolution.y);
  float x = rawX * uRotation.x - rawY * uRotation.y;
  float y = rawX * uRotation.y + rawY * uRotation.x;
  float val = abs(evalEquation(x, y));
  outColor = vec4(val, 0.0, 0.0, 1.0);
}`;
}

function getMandelbrotProgram(gl, func, useSmoothColoring) {
  glState.mandelbrotPrograms = glState.mandelbrotPrograms || {};
  const key = `${func.maxIterations}|${func.threshold}|${useSmoothColoring ? 'smooth' : 'flat'}`;
  const cached = glState.mandelbrotPrograms[key];
  if (cached) {
    return cached;
  }
  const fragSrc = buildMandelbrotShader(func.maxIterations, func.threshold, useSmoothColoring);
  const program = createProgram(gl, VERT_SRC, fragSrc);
  glState.mandelbrotPrograms[key] = program;
  return program;
}

function getJuliaProgram(gl, func, useSmoothColoring) {
  glState.juliaPrograms = glState.juliaPrograms || {};
  const key = `${func.maxIterations}|${func.threshold}|${func.cRe}|${func.cIm}|${useSmoothColoring ? 'smooth' : 'flat'}`;
  const cached = glState.juliaPrograms[key];
  if (cached) {
    return cached;
  }

  const fragSrc = buildJuliaShader(func.maxIterations, func.threshold, func.cRe, func.cIm, useSmoothColoring);
  const program = createProgram(gl, VERT_SRC, fragSrc);
  glState.juliaPrograms[key] = program;
  return program;
}

function createFloatTarget(gl, internalFormat, format, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error('Failed to create float framebuffer.');
  }
  return { tex, fbo };
}

function deleteFloatTarget(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.tex);
}

function ensureValueResources(gl, width, height) {
  const sameSize = glState.valueSize && glState.valueSize.width === width && glState.valueSize.height === height;
  if (glState.valuesTex && sameSize) {
    return;
  }
  deleteFloatTarget(gl, glState.valuesTex && { tex: glState.valuesTex, fbo: glState.valueFbo });
  glState.reduceTargets.forEach(t => deleteFloatTarget(gl, t));
  glState.reduceTargets = [];
  glState.valuesTex = null;
  glState.valueFbo = null;
  glState.valueSize = null;

  const values = createFloatTarget(gl, gl.R32F, gl.RED, width, height);
  glState.valuesTex = values.tex;
  glState.valueFbo = values.fbo;
  glState.valueSize = { width, height };

  const rw = Math.ceil(width / REDUCE_BLOCK);
  const rh = Math.ceil(height / REDUCE_BLOCK);
  glState.reduceTargets = [
    createFloatTarget(gl, gl.RGBA32F, gl.RGBA, rw, rh),
    createFloatTarget(gl, gl.RGBA32F, gl.RGBA, rw, rh),
  ];
  invalidateValues();
}

// Marks the values texture as no longer matching any cached evaluation.
function invalidateValues() {
  glState.valuesKey = null;
  glState.lastEval = null;
  glState.valuesGeneration++;
}

function getEvalProgram(gl, eqStr, isPolar) {
  glState.evalPrograms = glState.evalPrograms || new Map();
  const key = `${isPolar ? 'polar' : 'cartesian'}|${eqStr}`;
  const cached = glState.evalPrograms.get(key);
  if (cached) {
    // Refresh insertion order so the cache evicts the least recently used program.
    glState.evalPrograms.delete(key);
    glState.evalPrograms.set(key, cached);
    return cached;
  }
  const fragSrc = buildEvalShader(eqStr, isPolar);
  const program = createProgram(gl, VERT_SRC, fragSrc);
  glState.evalPrograms.set(key, program);
  if (glState.evalPrograms.size > PROGRAM_CACHE_SIZE) {
    const [oldestKey, oldest] = glState.evalPrograms.entries().next().value;
    gl.deleteProgram(oldest);
    glState.evalPrograms.delete(oldestKey);
  }
  return program;
}

function getValueProgram(gl, func, useSmoothColoring) {
  if (func && func._isMandelbrot) return getMandelbrotProgram(gl, func, useSmoothColoring);
  if (func && func._isJulia) return getJuliaProgram(gl, func, useSmoothColoring);
  if (!func || !func._source || func._isJsFunction) {
    throw new Error('Equation source unavailable for GPU evaluation.');
  }
  return getEvalProgram(gl, func._source, func._isPolar);
}

// Largest per-axis sample count <= requested whose values texture fits the GPU
// limits and the memory budget.
function chooseSupersample(gl, canvasWidth, canvasHeight, requested) {
  const maxDim = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  let ss = Math.max(1, Math.floor(Number(requested) || 1));
  while (ss > 1 && (
    canvasWidth * ss > maxDim ||
    canvasHeight * ss > maxDim ||
    canvasWidth * canvasHeight * ss * ss > MAX_SUPERSAMPLE_TEXELS
  )) {
    ss--;
  }
  return ss;
}

// Sizes the values texture for `ss` x `ss` samples per canvas pixel, dropping
// to one sample per pixel if the larger texture cannot be allocated.
function ensureSupersampledValues(gl, canvasWidth, canvasHeight, ss) {
  try {
    ensureValueResources(gl, canvasWidth * ss, canvasHeight * ss);
  } catch (err) {
    if (ss === 1) throw err;
    console.warn(`Supersampling ${ss}x${ss} unavailable, using 1x1:`, err);
    ss = 1;
    ensureValueResources(gl, canvasWidth, canvasHeight);
  }
  glState.valueSS = ss;
  return ss;
}

// Evaluates the equation into the values texture, `ss` x `ss` samples per
// canvas pixel. Nothing is read back.
function renderValuesToTexture(func, windowBounds, canvasWidth, canvasHeight, cosTheta, sinTheta, useSmoothColoring, ss = 1) {
  ensureGL(canvasWidth, canvasHeight);
  const gl = glState.gl;
  const program = getValueProgram(gl, func, useSmoothColoring);
  ss = ensureSupersampledValues(gl, canvasWidth, canvasHeight, chooseSupersample(gl, canvasWidth, canvasHeight, ss));
  const valuesWidth = canvasWidth * ss;
  const valuesHeight = canvasHeight * ss;

  gl.useProgram(program);
  gl.bindVertexArray(glState.vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, glState.valueFbo);
  gl.viewport(0, 0, valuesWidth, valuesHeight);

  gl.uniform2f(uniformLoc(gl, program, 'uResolution'), valuesWidth, valuesHeight);
  gl.uniform4f(uniformLoc(gl, program, 'uBounds'), windowBounds['xMin'], windowBounds['xMax'], windowBounds['yMin'], windowBounds['yMax']);
  gl.uniform2f(uniformLoc(gl, program, 'uRotation'), cosTheta, sinTheta);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  invalidateValues();
  return ss;
}

// Min/max of the values texture via repeated block reduction on the GPU, so only
// one pixel has to be read back instead of the whole canvas.
function reduceMinMaxOnGPU(width, height) {
  const gl = glState.gl;
  if (!glState.reduceProgram) {
    glState.reduceProgram = createProgram(gl, VERT_SRC, REDUCE_SRC);
  }
  const program = glState.reduceProgram;
  gl.useProgram(program);
  gl.bindVertexArray(glState.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(uniformLoc(gl, program, 'uSrc'), 0);

  let srcTex = glState.valuesTex;
  let srcW = width;
  let srcH = height;
  let first = true;
  let target = null;
  for (let pass = 0; first || srcW > 1 || srcH > 1; pass++) {
    const dstW = Math.ceil(srcW / REDUCE_BLOCK);
    const dstH = Math.ceil(srcH / REDUCE_BLOCK);
    target = glState.reduceTargets[pass % 2];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, dstW, dstH);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform2i(uniformLoc(gl, program, 'uSrcSize'), srcW, srcH);
    gl.uniform1i(uniformLoc(gl, program, 'uFirst'), first ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    srcTex = target.tex;
    srcW = dstW;
    srcH = dstH;
    first = false;
  }

  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { min: out[0], max: out[1] };
}

function readAllValuesFromGPU(width, height) {
  const gl = glState.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, glState.valueFbo);
  const values = new Float32Array(width * height);
  gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, values);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return values;
}

// Reads the sample nearest the centre of canvas pixel (px, py).
function readValueFromGPU(px, py) {
  const gl = glState.gl;
  const ss = glState.valueSS;
  const offset = Math.floor(ss / 2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, glState.valueFbo);
  const out = new Float32Array(4);
  gl.readPixels(px * ss + offset, py * ss + offset, 1, 1, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out[0];
}

function buildMandelbrotCpuEvaluator(func) {
  const maxIterations = Math.max(1, Math.floor(func.maxIterations || 0));
  const thresholdVal = func.threshold;
  return (x, y) => {
    let zx = x;
    let zy = y;
    const cx = x;
    const cy = y;
    let stepsTaken = 0;

    for (; stepsTaken < maxIterations; stepsTaken++) {
      const prevZx = zx;
      const prevZy = zy;
      const nextZx = prevZx * prevZx - prevZy * prevZy + cx;
      const nextZy = 2 * prevZx * prevZy + cy;
      zx = nextZx;
      zy = nextZy;

      if (Math.hypot(zx, zy) > thresholdVal) {
        break;
      }
    }

    return stepsTaken === maxIterations ? maxIterations - 1 : stepsTaken;
  };
}

function buildJuliaCpuEvaluator(func) {
  const maxIterations = Math.max(1, Math.floor(func.maxIterations || 0));
  const thresholdVal = func.threshold;
  const cx = func.cRe;
  const cy = func.cIm;
  return (x, y) => {
    let zx = x;
    let zy = y;
    let stepsTaken = 0;

    for (; stepsTaken < maxIterations; stepsTaken++) {
      const prevZx = zx;
      const prevZy = zy;
      const nextZx = prevZx * prevZx - prevZy * prevZy + cx;
      const nextZy = 2 * prevZx * prevZy + cy;
      zx = nextZx;
      zy = nextZy;

      if (Math.hypot(zx, zy) > thresholdVal) {
        break;
      }
    }

    return stepsTaken === maxIterations ? maxIterations - 1 : stepsTaken;
  };
}

function rotationParams(rotationRadians, zoomLevel) {
  const hasRotation = Number.isFinite(rotationRadians) && rotationRadians !== 0;
  return {
    hasRotation,
    cosTheta: hasRotation ? Math.cos(rotationRadians) : 1,
    sinTheta: hasRotation ? -Math.sin(rotationRadians) : 0,
    useSmoothColoring: Number.isFinite(zoomLevel) && zoomLevel > 5000,
  };
}

function evaluateOnCPU(func, windowBounds, canvasWidth, canvasHeight, { hasRotation, cosTheta, sinTheta }) {
  var pixelToXMapper = makeLinearMapper([0, canvasWidth], [windowBounds['xMin'], windowBounds['xMax']], false);
  var pixelToYMapper = makeLinearMapper([canvasHeight, 0], [windowBounds['yMin'], windowBounds['yMax']], false);
  var minValue = 9999999;
  var maxValue = -9999999;
  var pixelValues = new Float32Array(canvasWidth * canvasHeight);
  const fallbackFunc = func && func._isMandelbrot
    ? buildMandelbrotCpuEvaluator(func)
    : func && func._isJulia
      ? buildJuliaCpuEvaluator(func)
      : func;

  for (var pixelX = 0; pixelX < canvasWidth; pixelX++) {
    for (var pixelY = 0; pixelY < canvasHeight; pixelY++) {
      var x = pixelToXMapper(pixelX);
      var y = pixelToYMapper(pixelY);
      const rotatedX = hasRotation ? (x * cosTheta - y * sinTheta) : x;
      const rotatedY = hasRotation ? (x * sinTheta + y * cosTheta) : y;
      var result = fallbackFunc(rotatedX, rotatedY);
      if (result > maxValue) {
        maxValue = result;
      }
      if (result < minValue) {
        minValue = result;
      }

      pixelValues[(pixelY * canvasWidth) + pixelX] = Math.abs(result);
    }
  }

  return {'pixelValues': pixelValues, 'max': maxValue, 'min': minValue, fromGPU: false};
}

// Returns every pixel value. displayGraph does not use this (it keeps values on
// the GPU); it stays for callers that need the full array.
export function calculateFuncForWindow(func, windowBounds, canvasWidth, canvasHeight, rotationRadians = 0, zoomLevel = 1) {
  const rot = rotationParams(rotationRadians, zoomLevel);

  try {
    renderValuesToTexture(func, windowBounds, canvasWidth, canvasHeight, rot.cosTheta, rot.sinTheta, rot.useSmoothColoring);
    const values = readAllValuesFromGPU(canvasWidth, canvasHeight);
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v < minValue) minValue = v;
      if (v > maxValue) maxValue = v;
    }
    return { pixelValues: values, min: minValue, max: maxValue, fromGPU: true };
  } catch (err) {
    console.warn('Falling back to CPU evaluation:', err);
  }

  return evaluateOnCPU(func, windowBounds, canvasWidth, canvasHeight, rot);
}

// Identifies everything the values texture depends on. Color, fuzzy and min/max
// settings are deliberately absent: changing them only re-runs the color pass.
function evaluationKey(func, windowBounds, canvasWidth, canvasHeight, rotationRadians, useSmoothColoring, supersample) {
  // JS functions may be impure (e.g. Math.random), so never reuse their output.
  if (!func || func._isJsFunction) return null;
  return JSON.stringify([
    func._source, !!func._isPolar, !!func._isMandelbrot, !!func._isJulia,
    func.maxIterations, func.threshold, func.cRe, func.cIm,
    windowBounds['xMin'], windowBounds['xMax'], windowBounds['yMin'], windowBounds['yMax'],
    canvasWidth, canvasHeight, rotationRadians || 0, useSmoothColoring, supersample,
  ]);
}

function evaluateForDisplay(func, windowBounds, canvasWidth, canvasHeight, rotationRadians, zoomLevel, supersample) {
  const rot = rotationParams(rotationRadians, zoomLevel);
  const key = evaluationKey(func, windowBounds, canvasWidth, canvasHeight, rotationRadians, rot.useSmoothColoring, supersample);
  if (key !== null && glState.gl && glState.valuesKey === key && glState.lastEval) {
    return glState.lastEval;
  }

  let result;
  try {
    const ss = renderValuesToTexture(func, windowBounds, canvasWidth, canvasHeight, rot.cosTheta, rot.sinTheta, rot.useSmoothColoring, supersample);
    const { min, max } = reduceMinMaxOnGPU(canvasWidth * ss, canvasHeight * ss);
    result = { pixelValues: null, min, max, fromGPU: true };
  } catch (err) {
    console.warn('Falling back to CPU evaluation:', err);
    result = evaluateOnCPU(func, windowBounds, canvasWidth, canvasHeight, rot);
    ensureGL(canvasWidth, canvasHeight);
    ensureSupersampledValues(glState.gl, canvasWidth, canvasHeight, 1);
    uploadValuesTexture(result.pixelValues, canvasWidth, canvasHeight);
    invalidateValues();
  }

  result.width = canvasWidth;
  result.height = canvasHeight;
  result.generation = glState.valuesGeneration;
  glState.valuesKey = key;
  glState.lastEval = result;
  return result;
}

// // // // // // // Display Graph

export function drawAxes(canvas, xCenter, yCenter, xMin, xMax, yMin, yMax, options = {}) {
  const ctx = canvas.getContext('2d');

  // Mid-gray, translucent lines and haloed labels stay readable on dark and
  // light color maps without covering the graph.
  const {
    fontPx = 11,
    gridColor = 'rgba(128, 128, 128, 0.18)',
    axisColor = 'rgba(128, 128, 128, 0.55)',
    labelColor = 'rgba(255, 255, 255, 0.9)',
    labelHaloColor = 'rgba(0, 0, 0, 0.45)',
  } = options;

  const dpr = window.devicePixelRatio || 1;

  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1,0,0,1,0,0);

  const spanX = Math.max(1e-12, xMax - xMin);
  const spanY = Math.max(1e-12, yMax - yMin);

  const scale = Math.min(W / spanX, H / spanY);

  const showSpanX = W / scale;
  const showSpanY = H / scale;

  const vxMin = xCenter - showSpanX/2, vxMax = xCenter + showSpanX/2;
  const vyMin = yCenter - showSpanY/2, vyMax = yCenter + showSpanY/2;

  const toCX = x => (x - xCenter) * scale + W/2;
  const toCY = y => H/2 - (y - yCenter) * scale;

  function niceStep(raw) {
    const pow10 = 10 ** Math.floor(Math.log10(raw));
    const f = raw / pow10;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * pow10;
  }
  function fmtLabel(v, step) {
    const dec = Math.max(0, -Math.floor(Math.log10(step)));
    const s = v.toFixed(Math.min(10, dec));
    return Math.abs(+s) < 1e-12 ? '0' : s;
  }

  const targetPx = 80 * dpr;
  const step = niceStep(targetPx / scale);

  const firstX = Math.ceil(vxMin / step) * step;
  const firstY = Math.ceil(vyMin / step) * step;

  // Thin lines centered on device pixels stay crisp
  const lineWidth = Math.max(1, Math.round(dpr));
  const crisp = v => Math.round(v - lineWidth / 2) + lineWidth / 2;

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = gridColor;
  ctx.beginPath();
  for (let x = firstX; x <= vxMax + 1e-12; x += step) {
    if (Math.abs(x) < step * 1e-6) continue;
    const cx = crisp(toCX(x));
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  }
  for (let y = firstY; y <= vyMax + 1e-12; y += step) {
    if (Math.abs(y) < step * 1e-6) continue;
    const cy = crisp(toCY(y));
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  }
  ctx.stroke();

  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  if (vxMin <= 0 && 0 <= vxMax) { ctx.moveTo(crisp(toCX(0)), 0); ctx.lineTo(crisp(toCX(0)), H); }
  if (vyMin <= 0 && 0 <= vyMax) { ctx.moveTo(0, crisp(toCY(0))); ctx.lineTo(W, crisp(toCY(0))); }
  ctx.stroke();

  ctx.font = `${Math.round(fontPx * dpr)}px ui-sans-serif, system-ui, sans-serif`;

  function drawLabel(text, x, y, {align='left', baseline='alphabetic'} = {}) {
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = labelHaloColor;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = labelColor;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  const pxPerTick = step * scale;
  const minLabelPx = 45 * dpr;
  const labelEvery = Math.max(1, Math.round(minLabelPx / pxPerTick));

  let k = 0;
  for (let x = firstX; x <= vxMax + 1e-12; x += step, k++) {
    if (Math.abs(x) < 1e-12) continue;
    if (k % labelEvery !== 0) continue;
    const cx = toCX(x);
    const cy = (vyMin <= 0 && 0 <= vyMax) ? toCY(0) + 4 * dpr : H - 16 * dpr;
    drawLabel(fmtLabel(x, step), cx, cy, { align: 'center', baseline: 'top' });
  }

  k = 0;
  for (let y = firstY; y <= vyMax + 1e-12; y += step, k++) {
    if (Math.abs(y) < 1e-12) continue;
    if (k % labelEvery !== 0) continue;
    const cy = toCY(y);
    const cx = (vxMin <= 0 && 0 <= vxMax) ? toCX(0) - 4 * dpr : 22 * dpr;
    drawLabel(fmtLabel(y, step), cx, cy, { align: 'right', baseline: 'middle' });
  }

  if (vxMin <= 0 && 0 <= vxMax && vyMin <= 0 && 0 <= vyMax) {
    drawLabel('0', toCX(0) + 3 * dpr, toCY(0) + 3 * dpr, { align: 'left', baseline: 'top' });
  }
}

// // // // // // // Fuzzy function

// The fuzzy function maps an error value `v` (>= 0) to the value that gets
// colored. `f` is the Fuzzy Level slider as a fraction (0.01 to 1).
export const DEFAULT_FUZZY_FUNCTION = '(v + 0.000001)^f';

export const FUZZY_FUNCTION_PRESETS = [
  { id: 'power', label: 'Power (default)', expression: DEFAULT_FUZZY_FUNCTION },
  { id: 'log', label: 'Logarithmic', expression: 'log(v + 10^(-8 * (1 - f)))' },
  { id: 'exp', label: 'Exponential', expression: '1 - exp(-v / f)' },
  { id: 'atan', label: 'Arctangent', expression: 'atan(v / f^2)' },
  { id: 'linear', label: 'Linear', expression: 'v' },
];

const FUZZY_SYMBOLS = {
  v: { nonnegative: true },
  f: { nonnegative: true },
};

function normalizeFuzzyFunction(expression) {
  if (expression == null) return DEFAULT_FUZZY_FUNCTION;
  const str = String(expression).trim();
  return str === '' ? DEFAULT_FUZZY_FUNCTION : str;
}

function compileFuzzyFunction(expression) {
  return compileExpressionToGLSL(normalizeFuzzyFunction(expression), FUZZY_SYMBOLS);
}

// Returns null when the expression is usable, otherwise an error message.
export function validateFuzzyFunction(expression) {
  try {
    compileFuzzyFunction(expression);
    return null;
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

export function createColormapLUT(colormapName, reverseColor, invertColor, colorStart = 0, colorCycles = 1, hueShiftDegrees = 0, saturationPercent = 0, luminosityPercent = 0) {
  const lut = new Uint8Array(256 * 4);
  const mapper = getMatplotlibColormap(
    0,
    1,
    colormapName,
    reverseColor,
    invertColor,
    colorCycles,
    colorStart,
    1,
    hueShiftDegrees,
    saturationPercent,
    luminosityPercent,
  );
  for (let i = 0; i < 256; i++) {
    const normalizedValue = i / 255;
    // const color = evaluate_cmap(normalizedValue, colormapName, invertColor, colorStart, colorCycles);
    const color = mapper(normalizedValue);
    const offset = i * 4;
    lut[offset] = color[0];
    lut[offset + 1] = color[1];
    lut[offset + 2] = color[2];
    lut[offset + 3] = 255;
  }
  return lut;
}

function ensureCanvasSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  // If the canvas isn't attached to the DOM (e.g. offscreen render for downloads),
  // getBoundingClientRect will return 0 for width/height. In that case, respect the
  // current intrinsic size that was already set by the caller.
  const hasSizeFromDOM = rect.width > 0 && rect.height > 0;
  const w = hasSizeFromDOM ? Math.max(1, Math.round(rect.width * dpr)) : canvas.width;
  const h = hasSizeFromDOM ? Math.max(1, Math.round(rect.height * dpr)) : canvas.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Could not compile shader: ${info}`);
  }
  return shader;
}

function createProgram(gl, vertexSrc, fragmentSrc) {
  const program = gl.createProgram();
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Could not link program: ${info}`);
  }
  return program;
}

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = (aPos + 1.0) * 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const REDUCE_BLOCK = 4;
const PROGRAM_CACHE_SIZE = 16;

// Each output texel holds (min, max) of a REDUCE_BLOCK x REDUCE_BLOCK block of
// the source. The first pass reads raw values and skips NaN, matching the CPU
// comparison loop it replaces (NaN never wins a < or > comparison).
const REDUCE_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform bool uFirst;
out vec4 outColor;

bool fgIsNaN(float v) {
  return (floatBitsToUint(v) & 0x7fffffffu) > 0x7f800000u;
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * ${REDUCE_BLOCK};
  float lo = uintBitsToFloat(0x7f800000u);
  float hi = -lo;
  for (int dy = 0; dy < ${REDUCE_BLOCK}; dy++) {
    for (int dx = 0; dx < ${REDUCE_BLOCK}; dx++) {
      ivec2 p = base + ivec2(dx, dy);
      if (p.x >= uSrcSize.x || p.y >= uSrcSize.y) continue;
      vec4 s = texelFetch(uSrc, p, 0);
      if (uFirst) {
        if (fgIsNaN(s.r)) continue;
        lo = min(lo, s.r);
        hi = max(hi, s.r);
      } else {
        lo = min(lo, s.r);
        hi = max(hi, s.g);
      }
    }
  }
  outColor = vec4(lo, hi, 0.0, 1.0);
}`;

// The fuzzy function is applied to every sample and to the raw min/max, so the
// normalization always matches the shader's own math. Each canvas pixel
// averages the colors of its uSS x uSS samples in linear light; averaging the
// values instead would blur away thin lines, since the transfer is nonlinear.
function buildColorShader(fuzzy) {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D uValues;
uniform sampler2D uColormap;
uniform vec2 uResolution;
uniform float uRawMin;
uniform float uRawMax;
uniform float uFuzzy;
uniform int uSS;
${COMPLEX_GLSL}
float fgFuzzyFunction(float v, float f) {
${fuzzy.statements}
  return ${fuzzy.expression};
}

float transfer(float value) {
  if (uFuzzy >= 1.0) {
    return fgFuzzyFunction(value, 0.01 * uFuzzy);
  } else {
    return value < 0.02 ? uRawMax : uRawMin;
  }
}

bool fgIsNaN(float v) {
  return (floatBitsToUint(v) & 0x7fffffffu) > 0x7f800000u;
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 sampleColor(ivec2 texel, float normMin, float normMax) {
  float value = texelFetch(uValues, texel, 0).r;
  float t = clamp((transfer(value) - normMin) / max(1e-6, normMax - normMin), 0.0, 1.0);
  if (fgIsNaN(t)) t = 0.0;
  return texture(uColormap, vec2(t, 0.5)).rgb;
}

void main() {
  ivec2 pixel = ivec2(int(gl_FragCoord.x), int(uResolution.y) - 1 - int(gl_FragCoord.y));
  float normMin = transfer(uRawMin);
  float normMax = transfer(uRawMax);
  if (uSS <= 1) {
    outColor = vec4(sampleColor(pixel, normMin, normMax), 1.0);
    return;
  }
  ivec2 base = pixel * uSS;
  vec3 sum = vec3(0.0);
  for (int dy = 0; dy < uSS; dy++) {
    for (int dx = 0; dx < uSS; dx++) {
      sum += srgbToLinear(sampleColor(base + ivec2(dx, dy), normMin, normMax));
    }
  }
  outColor = vec4(linearToSrgb(sum / float(uSS * uSS)), 1.0);
}`;
}

const glState = {
  gl: null,
  evalPrograms: null,
  mandelbrotPrograms: null,
  juliaPrograms: null,
  colorPrograms: new Map(),
  reduceProgram: null,
  vao: null,
  valuesTex: null,
  valueFbo: null,
  valueSize: null,
  valueSS: 1,
  reduceTargets: [],
  valuesKey: null,
  valuesGeneration: 0,
  lastEval: null,
  colormapTex: null,
  colormapKey: null,
  canvas: null,
  floatExt: null,
};

function uniformLoc(gl, program, name) {
  if (!program._uniformLocs) program._uniformLocs = Object.create(null);
  if (!(name in program._uniformLocs)) {
    program._uniformLocs[name] = gl.getUniformLocation(program, name);
  }
  return program._uniformLocs[name];
}

// Returns { program, error }. An invalid fuzzy function falls back to the
// default one and reports why, so the graph still renders.
function getColorProgram(gl, fuzzyFunction) {
  const expression = normalizeFuzzyFunction(fuzzyFunction);
  const cached = glState.colorPrograms.get(expression);
  if (cached) return cached;

  let entry;
  try {
    entry = { program: createProgram(gl, VERT_SRC, buildColorShader(compileFuzzyFunction(expression))), error: null };
  } catch (err) {
    if (expression === DEFAULT_FUZZY_FUNCTION) throw err;
    const fallback = getColorProgram(gl, DEFAULT_FUZZY_FUNCTION);
    entry = { program: fallback.program, error: err && err.message ? err.message : String(err) };
  }
  glState.colorPrograms.set(expression, entry);
  if (glState.colorPrograms.size > PROGRAM_CACHE_SIZE) {
    for (const [key, value] of glState.colorPrograms) {
      if (key === DEFAULT_FUZZY_FUNCTION || key === expression) continue;
      const shared = [...glState.colorPrograms.values()].some(e => e !== value && e.program === value.program);
      if (!shared) gl.deleteProgram(value.program);
      glState.colorPrograms.delete(key);
      break;
    }
  }
  return entry;
}

function initGL(width, height) {
  if (!glState.canvas) {
    glState.canvas = document.createElement('canvas');
  }
  glState.canvas.width = width;
  glState.canvas.height = height;
  const gl = glState.canvas.getContext('webgl2');
  if (!gl) {
    throw new Error('WebGL2 is not supported in this environment.');
  }
  const floatExt = gl.getExtension('EXT_color_buffer_float');
  if (!floatExt) {
    throw new Error('EXT_color_buffer_float is required for GPU rendering.');
  }
  glState.floatExt = floatExt;
  glState.gl = gl;
  gl.viewport(0, 0, width, height);

  const quad = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  glState.vao = vao;

  const colormapTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colormapTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  glState.colormapTex = colormapTex;
  glState.colormapKey = null;
}

// Sizes the output canvas only; the values texture is sized by its writers,
// since it may hold several samples per canvas pixel.
function ensureGL(width, height) {
  if (!glState.gl) {
    initGL(width, height);
  } else if (glState.canvas.width !== width || glState.canvas.height !== height) {
    glState.canvas.width = width;
    glState.canvas.height = height;
    glState.gl.viewport(0, 0, width, height);
  }
}

function uploadValuesTexture(pixelValues, width, height) {
  if (!pixelValues) return;
  const gl = glState.gl;
  gl.bindTexture(gl.TEXTURE_2D, glState.valuesTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, pixelValues);
}

function uploadColormapTexture(colormapName, reverseColor, invertColor, colorStart = 0, colorCycles = 1, hueShiftDegrees = 0, saturationPercent = 0, luminosityPercent = 0) {
  const key = JSON.stringify([colormapName, reverseColor, invertColor, colorStart, colorCycles, hueShiftDegrees, saturationPercent, luminosityPercent]);
  if (key === glState.colormapKey) return;
  const gl = glState.gl;
  const lut = createColormapLUT(
    colormapName,
    reverseColor,
    invertColor,
    colorStart,
    colorCycles,
    hueShiftDegrees,
    saturationPercent,
    luminosityPercent,
  );
  gl.bindTexture(gl.TEXTURE_2D, glState.colormapTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
  glState.colormapKey = key;
}

function renderToCanvas(canvasElem, rawMin, rawMax, fuzzyValue, fuzzyFunction, colormapName, reverseColor, invertColor, colorStart, colorCycles, hueShiftDegrees, saturationPercent, luminosityPercent) {
  const width = canvasElem.width;
  const height = canvasElem.height;
  ensureGL(width, height);
  const gl = glState.gl;

  uploadColormapTexture(
    colormapName,
    reverseColor,
    invertColor,
    colorStart,
    colorCycles,
    hueShiftDegrees,
    saturationPercent,
    luminosityPercent,
  );

  const { program, error } = getColorProgram(gl, fuzzyFunction);
  gl.useProgram(program);
  gl.bindVertexArray(glState.vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glState.valuesTex);
  gl.uniform1i(uniformLoc(gl, program, 'uValues'), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glState.colormapTex);
  gl.uniform1i(uniformLoc(gl, program, 'uColormap'), 1);
  gl.activeTexture(gl.TEXTURE0);

  gl.uniform2f(uniformLoc(gl, program, 'uResolution'), width, height);
  gl.uniform1f(uniformLoc(gl, program, 'uRawMin'), rawMin);
  gl.uniform1f(uniformLoc(gl, program, 'uRawMax'), rawMax);
  gl.uniform1f(uniformLoc(gl, program, 'uFuzzy'), fuzzyValue);
  gl.uniform1i(uniformLoc(gl, program, 'uSS'), glState.valueSS);

  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const ctx2d = canvasElem.getContext('2d');
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.clearRect(0, 0, width, height);
  ctx2d.drawImage(glState.canvas, 0, 0, width, height);
  return error;
}

// Returns { min, max, fromGPU, pixelValues, getValueAt, fuzzyFunctionError }.
// pixelValues is only set for CPU-evaluated equations; use getValueAt(px, py)
// (canvas pixels, origin top-left) to read single values. It returns null once
// another displayGraph call has replaced the values.
export function displayGraph(graphParams, canvasElem) {
  ensureCanvasSize(canvasElem);
  const canvasWidth = canvasElem.width;
  const canvasHeight = canvasElem.height;
  var windowBounds = calcWindowBounds(graphParams['xCenter'],
      graphParams['yCenter'],
      graphParams['yHeight'],
      canvasWidth,
      canvasHeight);

  const evalResult = evaluateForDisplay(graphParams['equationFunction'],
      windowBounds,
      canvasWidth,
      canvasHeight,
      graphParams['rotationRadians'],
      graphParams['zoom'],
      graphParams['supersample'] ?? DEFAULT_SUPERSAMPLE);

  var minVal = evalResult['min'];
  var maxVal = evalResult['max'];

  if (graphParams['minOverride'] != null && graphParams['minOverride'] != '') {
    minVal = graphParams['minOverride'];
  }
  if (graphParams['maxOverride'] != null && graphParams['maxOverride'] != '') {
    maxVal = graphParams['maxOverride'];
  }

  const fuzzyFunctionError = renderToCanvas(canvasElem,
      minVal,
      maxVal,
      graphParams['fuzzyLevel'],
      graphParams['fuzzyFunction'],
      graphParams['colorMap'],
      graphParams['reverseColor'],
      graphParams['invertColor'],
      graphParams['colorStart'],
      graphParams['colorCycles'],
      graphParams['hueShiftDegrees'] ?? 0,
      graphParams['saturationPercent'] ?? 0,
      graphParams['luminosityPercent'] ?? 0);

  if (graphParams['showAxes']) {
    drawAxes(canvasElem, graphParams['xCenter'], graphParams['yCenter'], windowBounds['xMin'], windowBounds['xMax'], windowBounds['yMin'], windowBounds['yMax']);
  }

  const { pixelValues, generation } = evalResult;
  return {
    min: evalResult['min'],
    max: evalResult['max'],
    fromGPU: evalResult['fromGPU'],
    pixelValues,
    fuzzyFunctionError,
    getValueAt(px, py) {
      if (!Number.isInteger(px) || !Number.isInteger(py)) return null;
      if (px < 0 || py < 0 || px >= canvasWidth || py >= canvasHeight) return null;
      if (pixelValues) return pixelValues[py * canvasWidth + px];
      if (!glState.gl || glState.valuesGeneration !== generation) return null;
      return readValueFromGPU(px, py);
    },
  };
}
