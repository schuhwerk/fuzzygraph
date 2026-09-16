import { parse } from 'mathjs';

// Complex values are (real, imaginary). Keep intermediates intact until the
// complete left and right sides have been evaluated, just like the CPU path.
export const COMPLEX_GLSL = `
const float fgPi = 3.141592653589793;
vec2 fgMul(vec2 a, vec2 b) {
  return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}
vec2 fgDiv(vec2 a, vec2 b) {
  if (abs(b.x) >= abs(b.y)) {
    float ratio = b.y / b.x;
    float denominator = b.x + b.y * ratio;
    return vec2(a.x + a.y*ratio, a.y - a.x*ratio) / denominator;
  }
  float ratio = b.x / b.y;
  float denominator = b.y + b.x * ratio;
  return vec2(a.x*ratio + a.y, a.y*ratio - a.x) / denominator;
}
float fgArg(vec2 z) {
  if (z.y == 0.0) return z.x < 0.0 ? fgPi : 0.0;
  return atan(z.y, z.x);
}
vec2 fgLog(vec2 z) { return vec2(log(length(z)), fgArg(z)); }
vec2 fgExp(vec2 z) { return exp(z.x) * vec2(cos(z.y), sin(z.y)); }
vec2 fgSqrt(vec2 z) {
  if (z.y == 0.0) {
    return z.x >= 0.0 ? vec2(sqrt(z.x), 0.0) : vec2(0.0, sqrt(-z.x));
  }
  float t = sqrt(0.5 * (length(z) + abs(z.x)));
  return z.x >= 0.0 ? vec2(t, z.y/(2.0*t))
                   : vec2(abs(z.y)/(2.0*t), sign(z.y)*t);
}
float fgRealPow(float base, float exponent) {
  if (exponent == 0.0) return 1.0;
  if (base == 0.0 && exponent > 0.0) return 0.0;
  return pow(base, exponent);
}
float fgIntegerPow(float base, float exponent) {
  float magnitude = fgRealPow(abs(base), exponent);
  return base < 0.0 && mod(abs(exponent), 2.0) == 1.0 ? -magnitude : magnitude;
}
vec2 fgPow(vec2 base, vec2 exponent) {
  if (exponent == vec2(0.0)) return vec2(1.0, 0.0);
  if (base == vec2(0.0) && exponent.x > 0.0) return vec2(0.0);
  if (base.y == 0.0 && exponent.y == 0.0) {
    if (base.x >= 0.0) return vec2(fgRealPow(base.x, exponent.x), 0.0);
    if (floor(exponent.x) == exponent.x) {
      return vec2(fgIntegerPow(base.x, exponent.x), 0.0);
    }
  }
  return fgExp(fgMul(exponent, fgLog(base)));
}
vec2 fgSin(vec2 z) {
  if (z.y == 0.0) return vec2(sin(z.x), 0.0);
  float p = exp(z.y), n = exp(-z.y);
  return vec2(sin(z.x)*(p+n), cos(z.x)*(p-n)) * 0.5;
}
vec2 fgCos(vec2 z) {
  if (z.y == 0.0) return vec2(cos(z.x), 0.0);
  float p = exp(z.y), n = exp(-z.y);
  return vec2(cos(z.x)*(p+n), -sin(z.x)*(p-n)) * 0.5;
}
vec2 fgTan(vec2 z) {
  if (z.y == 0.0) return vec2(tan(z.x), 0.0);
  // Scale by exp(-2*abs(imaginary)) to avoid overflowing cosh/sinh.
  float q = exp(-2.0*abs(z.y));
  return vec2(2.0*q*sin(2.0*z.x), sign(z.y)*(1.0-q*q)) /
         (2.0*q*cos(2.0*z.x) + 1.0 + q*q);
}
vec2 fgAsin(vec2 z) {
  if (z.y == 0.0) {
    if (abs(z.x) <= 1.0) return vec2(asin(z.x), 0.0);
    float h = log(abs(z.x) + sqrt(z.x*z.x - 1.0));
    return vec2(sign(z.x)*fgPi*0.5, -sign(z.x)*h);
  }
  vec2 w = fgLog(vec2(-z.y, z.x) + fgSqrt(vec2(1.0, 0.0) - fgMul(z, z)));
  return vec2(w.y, -w.x);
}
vec2 fgAcos(vec2 z) { return vec2(fgPi*0.5, 0.0) - fgAsin(z); }
vec2 fgAtan(vec2 z) {
  if (z.y == 0.0) return vec2(atan(z.x), 0.0);
  vec2 iz = vec2(-z.y, z.x);
  vec2 w = fgLog(vec2(1.0, 0.0) - iz) - fgLog(vec2(1.0, 0.0) + iz);
  return vec2(-w.y, w.x)*0.5;
}
`;

function numberLiteral(value) {
  if (!Number.isFinite(value)) throw new Error(`Non-finite numeric literal: ${value}`);
  const text = String(value);
  // Exponential notation already supplies a valid floating-point literal.
  return Number.isInteger(value) && !/[eE]/.test(text) ? `${text}.0` : text;
}

// Fold only literal arithmetic, never expressions that depend on coordinates.
// This recognizes 1/2, (2), and -1 without assuming their AST shape.
function constantNumber(node) {
  if (node.type === 'ParenthesisNode') return constantNumber(node.content);
  if (node.type === 'ConstantNode' && typeof node.value === 'number') return node.value;
  if (node.type === 'SymbolNode') {
    if (node.name === 'pi' || node.name === 'PI') return Math.PI;
    if (node.name === 'e' || node.name === 'E') return Math.E;
  }
  if (node.type !== 'OperatorNode') return undefined;
  const values = node.args.map(constantNumber);
  if (values.some(v => v === undefined)) return undefined;
  const [a, b] = values;
  let result;
  if (node.op === '+') result = values.length === 1 ? a : a + b;
  else if (node.op === '-') result = values.length === 1 ? -a : a - b;
  else if (node.op === '*') result = a * b;
  else if (node.op === '/') result = a / b;
  else if (node.op === '^') result = a ** b;
  return Number.isFinite(result) ? result : undefined;
}

// Use scalar GLSL for known-real operations, promoting to vec2 only when an
// operation can leave the real domain. Emit each subexpression once: a sinc's
// numerator and denominator can share the same expensive radial distance.
export function compileEquationToGLSL(equation) {
  const delimiter = equation.includes('≈') ? '≈' : '=';
  const sides = equation.split(delimiter);
  if (sides.length !== 2) throw new Error('Equation must contain a single equals sign.');
  const statements = [];
  const cache = new Map();
  const scalar = (code, nonnegative = false) => ({ code, complex: false, nonnegative });
  const literal = value => ({ ...scalar(numberLiteral(value), value >= 0), constant: value });
  const asComplex = value => value.complex ? value.code : `vec2(${value.code}, 0.0)`;
  const realPart = value => value.complex ? `${value.code}.x` : value.code;

  function emit(expression, complex = false, nonnegative = false) {
    const code = `fgValue${statements.length}`;
    statements.push(`  ${complex ? 'vec2' : 'float'} ${code} = ${expression};`);
    return { code, complex, nonnegative };
  }

  function binary(op, a, b) {
    if (!a.complex && !b.complex) {
      const nonnegative = op === '+' || op === '/' ? a.nonnegative && b.nonnegative
        : op === '*' && ((a.nonnegative && b.nonnegative) || a.code === b.code);
      return emit(`(${a.code} ${op} ${b.code})`, false, nonnegative);
    }
    if (op === '+' || op === '-') return emit(`(${asComplex(a)} ${op} ${asComplex(b)})`, true);
    return emit(`${op === '*' ? 'fgMul' : 'fgDiv'}(${asComplex(a)}, ${asComplex(b)})`, true);
  }

  function power(base, exponent) {
    const n = exponent.constant;
    if (n === 0) return literal(1);
    if (n === 1) return base;
    if (n === 2) return binary('*', base, base);
    if (!base.complex && !exponent.complex) {
      if (Number.isInteger(n)) {
        return emit(`fgIntegerPow(${base.code}, ${exponent.code})`, false, base.nonnegative || n % 2 === 0);
      }
      if (base.nonnegative) {
        if (n === 0.5) return emit(`sqrt(${base.code})`, false, true);
        return emit(`fgRealPow(${base.code}, ${exponent.code})`, false, true);
      }
    }
    if (n === 0.5) return emit(`fgSqrt(${asComplex(base)})`, true);
    return emit(`fgPow(${asComplex(base)}, ${asComplex(exponent)})`, true);
  }

  function logarithm(value) {
    return !value.complex && value.nonnegative
      ? emit(`log(${value.code})`)
      : emit(`fgLog(${asComplex(value)})`, true);
  }

  function functionCall(name, args) {
    if (name === 'pow' && args.length === 2) return power(...args);
    if ((name === 'log' || name === 'ln') && args.length === 2) {
      return binary('/', logarithm(args[0]), logarithm(args[1]));
    }
    if (name === 'min' || name === 'max' || name === 'atan2') {
      if (args.some(a => a.complex) || args.length < 2 || (name === 'atan2' && args.length !== 2)) {
        throw new Error(`${name} requires real arguments.`);
      }
      if (name === 'atan2') return emit(`atan(${args[0].code}, ${args[1].code})`);
      return args.slice(1).reduce((a, b) => emit(`${name}(${a.code}, ${b.code})`, false,
        name === 'max' ? a.nonnegative || b.nonnegative : a.nonnegative && b.nonnegative), args[0]);
    }
    if (args.length !== 1) throw new Error(`Unsupported arguments for ${name}.`);
    const a = args[0];
    if (name === 'sqrt') return power(a, literal(0.5));
    if (name === 'log' || name === 'ln') return logarithm(a);
    if (name === 'abs') return emit(`${a.complex ? 'length' : 'abs'}(${a.code})`, false, true);
    if (name === 're') return a.complex ? emit(`${a.code}.x`) : a;
    if (name === 'im') return a.complex ? emit(`${a.code}.y`) : literal(0);
    if (name === 'conj') return a.complex ? emit(`vec2(${a.code}.x, -${a.code}.y)`, true) : a;
    const complexFunctions = { sin: 'fgSin', cos: 'fgCos', tan: 'fgTan', exp: 'fgExp', atan: 'fgAtan', asin: 'fgAsin', acos: 'fgAcos' };
    if (complexFunctions[name]) {
      if (!a.complex && name !== 'asin' && name !== 'acos') {
        return emit(`${name}(${a.code})`, false, name === 'exp');
      }
      return emit(`${complexFunctions[name]}(${asComplex(a)})`, true);
    }
    throw new Error(`Unsupported function ${name} in equation`);
  }

  function compile(node) {
    if (node.type === 'ParenthesisNode') return compile(node.content);
    const key = node.toString();
    if (cache.has(key)) return cache.get(key);
    const constant = constantNumber(node);
    let value;
    if (constant !== undefined) value = literal(constant);
    else if (node.type === 'SymbolNode') {
      if (['x', 'y', 'r', 't'].includes(node.name)) value = scalar(node.name, node.name === 'r' || node.name === 't');
      else if (node.name === 'i') value = { code: 'vec2(0.0, 1.0)', complex: true, nonnegative: false };
      else throw new Error(`Unsupported symbol ${node.name} in equation`);
    } else if (node.type === 'OperatorNode') {
      const args = node.args.map(compile);
      if (args.length === 1 && (node.op === '+' || node.op === '-')) {
        value = node.op === '+' ? args[0] : emit(`(-${args[0].code})`, args[0].complex);
      } else if (args.length === 2 && node.op === '^') value = power(...args);
      else if (args.length === 2 && ['+', '-', '*', '/'].includes(node.op)) value = binary(node.op, ...args);
      else throw new Error(`Unsupported operator ${node.op} in equation`);
    } else if (node.type === 'FunctionNode') value = functionCall(node.name, node.args.map(compile));
    else throw new Error(`Unsupported AST node ${node.type}`);
    cache.set(key, value);
    return value;
  }

  const left = compile(parse(sides[0]));
  const right = compile(parse(sides[1]));
  return { statements: statements.join('\n'), expression: `abs(${realPart(left)} - ${realPart(right)})` };
}
