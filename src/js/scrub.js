// scrub.js
// Change numbers by dragging them left/right or by scrolling the mouse wheel
// over them, in number inputs and inside text (equations). The step follows
// the number's own precision. Shift: 10x finer. Ctrl/Cmd: 10x coarser.
// Alt+Up/Down steps the number at the caret. A click without dragging edits
// text as usual.

const DRAG_THRESHOLD_PX = 3;
const PX_PER_STEP = 6;
const MAX_DECIMALS = 10;
const WHEEL_PX_PER_STEP = 50;
const SCROLL_LATCH_MS = 300;

// While the page (or a panel) is scrolling, wheel events keep scrolling it, so a
// number sliding under the cursor doesn't capture the scroll.
let lastScrollTime = -Infinity;
document.addEventListener('scroll', () => { lastScrollTime = performance.now(); }, { capture: true, passive: true });

// Converts a wheel event into whole steps (positive = up/increase). A mouse
// notch is one step; trackpad deltas accumulate per element.
function wheelSteps(event, state) {
  const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;  // Shift+wheel may scroll sideways
  const px = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  if (Math.abs(px) >= WHEEL_PX_PER_STEP) {
    state.acc = 0;
    return px < 0 ? 1 : -1;
  }
  state.acc = (state.acc || 0) + px;
  const steps = -Math.trunc(state.acc / WHEEL_PX_PER_STEP);
  state.acc += steps * WHEEL_PX_PER_STEP;
  return steps;
}

function wheelLatched() {
  return performance.now() - lastScrollTime < SCROLL_LATCH_MS;
}

function modifierFactor(event) {
  if (event.shiftKey) return 0.1;
  if (event.ctrlKey || event.metaKey) return 10;
  return 1;
}

function decimalsOf(step) {
  if (!(step > 0)) return 0;
  return Math.min(MAX_DECIMALS, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

function formatNumber(value, decimals) {
  const fixed = value.toFixed(decimals);
  // Avoid "-0", "-0.00"
  return Number(fixed) === 0 ? (0).toFixed(decimals) : fixed;
}

// Tracks a horizontal drag from a pointerdown. Calls onStart once the pointer
// moved past the threshold, onStep(steps, finestFactor) while dragging, and
// onClick if released without dragging. `steps` can be fractional when Shift
// was held; finestFactor (<= 1) is the smallest modifier factor used so far.
function trackDrag(downEvent, target, { onStart, onStep, onEnd, onClick }) {
  const startX = downEvent.clientX;
  const startY = downEvent.clientY;
  let dragging = false;
  let factor = modifierFactor(downEvent);
  let baseX = startX;
  let baseSteps = 0;
  let lastSteps = 0;
  let finestFactor = Math.min(1, factor);

  try { target.setPointerCapture(downEvent.pointerId); } catch (e) { /* element may be detached */ }

  function move(event) {
    if (event.pointerId !== downEvent.pointerId) return;
    if (!dragging) {
      if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      baseX = event.clientX;
      onStart && onStart();
    }
    const newFactor = modifierFactor(event);
    if (newFactor !== factor) {
      // Re-base so changing modifiers mid-drag doesn't make the value jump.
      baseSteps = lastSteps;
      baseX = event.clientX;
      factor = newFactor;
      finestFactor = Math.min(finestFactor, factor);
    }
    // Round to the factor's grid so repeated fine steps don't accumulate float noise.
    const raw = baseSteps + Math.round((event.clientX - baseX) / PX_PER_STEP) * factor;
    const steps = Math.round(raw / finestFactor) * finestFactor;
    if (steps !== lastSteps) {
      lastSteps = steps;
      onStep(steps, finestFactor);
    }
    event.preventDefault();
  }

  function up(event) {
    if (event.pointerId !== downEvent.pointerId) return;
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    try { target.releasePointerCapture(downEvent.pointerId); } catch (e) { /* already released */ }
    if (dragging) onEnd && onEnd();
    else if (event.type === 'pointerup') onClick && onClick(event);
  }

  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function setFieldValue(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

// // // // // // // Number inputs

function inputStep(input, value) {
  const attr = Number(input.getAttribute('step'));
  if (attr > 0) return attr;
  // step="any" or missing: one unit of the second significant digit.
  if (!Number.isFinite(value) || value === 0) return 0.1;
  return 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1);
}

function clampToInput(input, value) {
  const min = input.getAttribute('min');
  const max = input.getAttribute('max');
  if (min !== null && min !== '' && Number.isFinite(Number(min))) value = Math.max(Number(min), value);
  if (max !== null && max !== '' && Number.isFinite(Number(max))) value = Math.min(Number(max), value);
  return value;
}

export function attachInputScrub(input) {
  if (input._scrubAttached) return;
  input._scrubAttached = true;

  const updateCursor = () => {
    input.style.cursor = document.activeElement === input || input.disabled || input.readOnly ? '' : 'ew-resize';
  };
  updateCursor();
  input.addEventListener('focus', updateCursor);
  input.addEventListener('blur', updateCursor);
  if (!input.title) input.title = 'Drag left/right or scroll to change (Shift: finer, Ctrl: coarser)';

  const wheelState = {};
  input.addEventListener('wheel', (event) => {
    if (input.disabled || input.readOnly || wheelLatched()) return;
    const value = Number(input.value === '' ? input.placeholder || 0 : input.value);
    if (!Number.isFinite(value)) return;
    event.preventDefault();
    const steps = wheelSteps(event, wheelState);
    if (!steps) return;
    const factor = modifierFactor(event);
    const step = inputStep(input, value);
    const decimals = Math.max(decimalsOf(step * Math.min(1, factor)), decimalsOf(step));
    setFieldValue(input, formatNumber(clampToInput(input, value + steps * step * factor), decimals));
  }, { passive: false });

  input.addEventListener('pointerdown', (event) => {
    if (document.activeElement === input || input.disabled || input.readOnly) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const startValue = Number(input.value === '' ? input.placeholder || 0 : input.value);
    if (!Number.isFinite(startValue)) return;
    event.preventDefault();  // Don't focus yet; a click focuses on release.

    const step = inputStep(input, startValue);
    trackDrag(event, input, {
      onStart() { document.body.style.cursor = 'ew-resize'; },
      onStep(steps, finestFactor) {
        const decimals = Math.max(decimalsOf(step * finestFactor), decimalsOf(step));
        const value = clampToInput(input, startValue + steps * step);
        setFieldValue(input, formatNumber(value, decimals));
      },
      onEnd() {
        document.body.style.cursor = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      onClick() {
        input.focus();
        if (typeof input.select === 'function') input.select();
      },
    });
  });
}

// // // // // // // Numbers inside text

// Not part of an identifier like log2; may be followed by a symbol (0.5x).
const NUMBER_RE = /(?<![A-Za-z_0-9.])(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?![0-9.])/g;

// Finds numeric literals. A preceding +/- is included: as a binary operator
// (flipped between + and - so "x - 1" scrubs to "x + 0.5", not "x - -0.5") or
// as a unary sign.
export function findNumberTokens(text) {
  const tokens = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const numStart = m.index;
    const numEnd = numStart + m[0].length;
    const literal = m[0];
    let start = numStart;
    let sign = 1;
    let kind = 'none';
    let gap = '';

    let i = numStart - 1;
    while (i >= 0 && text[i] === ' ') i--;
    if (i >= 0 && (text[i] === '-' || text[i] === '+')) {
      let j = i - 1;
      while (j >= 0 && text[j] === ' ') j--;
      const binary = j >= 0 && /[A-Za-z_0-9.)\]]/.test(text[j]);
      kind = binary ? 'binary' : 'unary';
      sign = text[i] === '-' ? -1 : 1;
      gap = text.slice(i + 1, numStart);
      start = i;
    }

    const mantissa = literal.split(/[eE]/)[0];
    const exponent = /[eE]/.test(literal) ? Number(literal.split(/[eE]/)[1]) : 0;
    const decimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    tokens.push({
      start,
      end: numEnd,
      numStart,
      value: sign * Number(literal),
      kind,
      gap,
      step: 10 ** (exponent - decimals),
      hasExponent: exponent !== 0 || /[eE]/.test(literal),
    });
  }
  return tokens;
}

function formatToken(token, value, decimals) {
  const magnitude = Math.abs(value);
  let digits;
  if (token.hasExponent) {
    digits = String(Number(magnitude.toPrecision(12)));
  } else {
    digits = formatNumber(magnitude, decimals);
  }
  const negative = value < 0 && Number(digits) !== 0;
  if (token.kind === 'binary') return `${negative ? '-' : '+'}${token.gap}${digits}`;
  return negative ? `-${digits}` : digits;
}

function replaceToken(field, token, value, decimals) {
  const text = field.value;
  const replacement = formatToken(token, value, decimals);
  const newText = text.slice(0, token.start) + replacement + text.slice(token.end);
  const newEnd = token.start + replacement.length;
  setFieldValue(field, newText);
  return { ...token, end: newEnd };
}

const MIRROR_PROPS = [
  'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
  'lineHeight', 'fontFamily', 'fontFeatureSettings', 'fontKerning',
  'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
  'wordBreak', 'overflowWrap',
];

// Lays out a hidden copy of the field over it to find where each number is drawn.
function measureTokens(field, tokens) {
  const rect = field.getBoundingClientRect();
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];
  const isInput = field.tagName === 'INPUT';
  Object.assign(mirror.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: 'border-box',
    borderColor: 'transparent',
    visibility: 'hidden',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: isInput ? 'pre' : 'pre-wrap',
  });
  if (!isInput && field.scrollHeight > field.clientHeight) mirror.style.overflowY = 'scroll';
  if (isInput) {
    const contentHeight = field.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    mirror.style.lineHeight = `${Math.max(0, contentHeight)}px`;
  }

  const text = field.value;
  const spans = [];
  let pos = 0;
  for (const token of tokens) {
    mirror.appendChild(document.createTextNode(text.slice(pos, token.start)));
    const span = document.createElement('span');
    span.textContent = text.slice(token.start, token.end);
    mirror.appendChild(span);
    spans.push(span);
    pos = token.end;
  }
  // Trailing character keeps a final newline from collapsing.
  mirror.appendChild(document.createTextNode(text.slice(pos) + ' '));
  document.body.appendChild(mirror);
  mirror.scrollTop = field.scrollTop;
  mirror.scrollLeft = field.scrollLeft;
  const rects = spans.map(span => [...span.getClientRects()]);
  mirror.remove();
  return { rects, fieldRect: rect };
}

let highlightEl = null;
function showHighlight(rects) {
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    Object.assign(highlightEl.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
      background: 'rgba(59, 130, 246, 0.18)', borderBottom: '2px solid rgba(59, 130, 246, 0.8)',
      borderRadius: '2px',
    });
    document.body.appendChild(highlightEl);
  }
  const r = rects[0];
  Object.assign(highlightEl.style, {
    display: 'block', left: `${r.left - 1}px`, top: `${r.top}px`,
    width: `${r.width + 2}px`, height: `${r.height}px`,
  });
}
function hideHighlight() {
  if (highlightEl) highlightEl.style.display = 'none';
}

export function attachTextScrub(field) {
  if (field._scrubAttached) return;
  field._scrubAttached = true;
  field.style.touchAction = 'pan-y';

  let cache = null;
  let scrubbing = false;

  function layout() {
    const r = field.getBoundingClientRect();
    const key = `${field.value}|${field.scrollTop}|${field.scrollLeft}|${r.left}|${r.top}|${r.width}|${r.height}`;
    if (!cache || cache.key !== key) {
      const tokens = findNumberTokens(field.value);
      cache = { key, tokens, ...measureTokens(field, tokens) };
    }
    return cache;
  }

  function hitTest(clientX, clientY) {
    const { tokens, rects, fieldRect } = layout();
    if (clientX < fieldRect.left || clientX > fieldRect.right || clientY < fieldRect.top || clientY > fieldRect.bottom) return null;
    for (let i = 0; i < tokens.length; i++) {
      for (const r of rects[i]) {
        if (clientX >= r.left - 1 && clientX <= r.right + 1 && clientY >= r.top && clientY <= r.bottom) {
          return { token: tokens[i], rect: r, rects: rects[i] };
        }
      }
    }
    return null;
  }

  field.addEventListener('pointermove', (event) => {
    if (scrubbing) return;
    if (event.buttons) { hideHighlight(); return; }  // Selecting text
    const hit = hitTest(event.clientX, event.clientY);
    field.style.cursor = hit ? 'ew-resize' : '';
    if (hit) showHighlight([hit.rect]); else hideHighlight();
  });
  field.addEventListener('pointerleave', () => {
    if (scrubbing) return;
    field.style.cursor = '';
    hideHighlight();
  });
  field.addEventListener('scroll', hideHighlight);

  let lastClick = { time: 0, start: -1 };

  field.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();  // Keep the caret where it is unless this turns out to be a click.

    let token = hit.token;
    const startValue = token.value;
    const baseStep = token.step;

    trackDrag(event, field, {
      onStart() {
        scrubbing = true;
        document.body.style.cursor = 'ew-resize';
      },
      onStep(steps, finestFactor) {
        const decimals = decimalsOf(baseStep * finestFactor);
        token = replaceToken(field, token, startValue + steps * baseStep, decimals);
        const { rects } = layout();
        const idx = cache.tokens.findIndex(t => t.start === token.start);
        if (idx >= 0 && rects[idx].length) showHighlight(rects[idx]);
      },
      onEnd() {
        scrubbing = false;
        document.body.style.cursor = '';
        field.dispatchEvent(new Event('change', { bubbles: true }));
      },
      onClick(upEvent) {
        field.focus();
        const now = performance.now();
        if (now - lastClick.time < 400 && lastClick.start === token.start) {
          // Double click selects the number
          field.setSelectionRange(token.numStart, token.end);
          lastClick = { time: 0, start: -1 };
          return;
        }
        lastClick = { time: now, start: token.start };
        const r = hit.rect;
        const frac = r.width > 0 ? Math.min(1, Math.max(0, (upEvent.clientX - r.left) / r.width)) : 1;
        const caret = token.start + Math.round(frac * (token.end - token.start));
        field.setSelectionRange(caret, caret);
      },
    });
  });

  const wheelState = {};
  field.addEventListener('wheel', (event) => {
    if (scrubbing || wheelLatched()) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (!hit) return;  // Not over a number: scroll the field as usual
    event.preventDefault();
    const steps = wheelSteps(event, wheelState);
    if (!steps) return;
    const factor = modifierFactor(event);
    const { token } = hit;
    const updated = replaceToken(field, token, token.value + steps * token.step * factor, decimalsOf(token.step * Math.min(1, factor)));
    const { rects } = layout();
    const idx = cache.tokens.findIndex(t => t.start === updated.start);
    if (idx >= 0 && rects[idx].length) showHighlight(rects[idx]); else hideHighlight();
  }, { passive: false });

  // Alt+Up/Down steps the number at the caret (Shift: finer, Ctrl/Cmd: coarser).
  field.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const caret = field.selectionStart;
    const token = findNumberTokens(field.value).find(t => caret >= t.start && caret <= t.end);
    if (!token) return;
    event.preventDefault();
    const factor = event.shiftKey ? 0.1 : (event.ctrlKey || event.metaKey) ? 10 : 1;
    const step = token.step * factor;
    const delta = event.key === 'ArrowUp' ? step : -step;
    const updated = replaceToken(field, token, token.value + delta, decimalsOf(Math.min(step, token.step)));
    field.setSelectionRange(updated.end, updated.end);
  });
}

// // // // // // // Selects

// Scrolling over a select steps through its options (down = next). Options
// marked data-no-wheel are skipped.
export function attachSelectWheel(select) {
  if (select._scrubAttached) return;
  select._scrubAttached = true;
  const wheelState = {};
  select.addEventListener('wheel', (event) => {
    if (select.disabled || wheelLatched()) return;
    event.preventDefault();
    const steps = wheelSteps(event, wheelState);
    if (!steps) return;
    const options = [...select.options].filter(o => !o.disabled && !('noWheel' in o.dataset));
    if (!options.length) return;
    const current = options.indexOf(select.options[select.selectedIndex]);
    const next = Math.min(options.length - 1, Math.max(0, (current < 0 ? 0 : current) - steps));
    if (next === current) return;
    select.value = options[next].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });
}
