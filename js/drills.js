/* Randomized fluency drills. Each generator returns { q, answer, check(input) -> true|false|'unsimplified' }. */
(function () {
  'use strict';

  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const nz = (a, b) => { let n; do { n = rand(a, b); } while (n === 0); return n; };
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
  const paren = n => n < 0 ? '(' + fmt(n) + ')' : fmt(n);
  const fmt = n => n < 0 ? '−' + Math.abs(n) : String(n);

  function frac(n, d) {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d);
    return { n: n / g, d: d / g };
  }
  function fracStr(f) { return f.d === 1 ? fmt(f.n) : fmt(f.n) + '/' + f.d; }

  // Accepts "3/4", "-3/4", "2", "1 1/2", and the unicode minus.
  function parseFrac(s) {
    s = String(s).trim().replace(/[−–]/g, '-').replace(/\s+/g, ' ');
    let m = s.match(/^(-)?(\d+) (\d+)\/(\d+)$/);
    if (m) { const d = +m[4]; if (!d) return null; const n = +m[2] * d + +m[3]; return { n: m[1] ? -n : n, d }; }
    m = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
    if (m) { if (+m[2] === 0) return null; return { n: +m[1], d: +m[2] }; }
    m = s.match(/^-?\d+$/);
    if (m) return { n: +s, d: 1 };
    return null;
  }
  function parseNum(s) {
    s = String(s).trim().replace(/[−–]/g, '-').replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function numQ(q, answer) {
    return { q, answer: fmt(answer), check: inp => parseNum(inp) === answer };
  }

  const gens = {
    fractions() {
      const op = pick(['+', '−', '×', '÷']);
      const a = frac(rand(1, 9), rand(2, 9));
      const b = frac(rand(1, 9), rand(2, 9));
      let r;
      if (op === '+') r = frac(a.n * b.d + b.n * a.d, a.d * b.d);
      if (op === '−') r = frac(a.n * b.d - b.n * a.d, a.d * b.d);
      if (op === '×') r = frac(a.n * b.n, a.d * b.d);
      if (op === '÷') r = frac(a.n * b.d, a.d * b.n);
      return {
        q: fracStr(a) + ' ' + op + ' ' + fracStr(b),
        answer: fracStr(r),
        hint: 'Type a fraction like 3/4. Simplest form, please.',
        check(inp) {
          const f = parseFrac(inp);
          if (!f) return false;
          if (f.n * r.d !== r.n * f.d) return false;
          return gcd(f.n, f.d) === 1 ? true : 'unsimplified';
        }
      };
    },
    negatives() {
      const a = nz(-15, 15), b = nz(-15, 15);
      const kind = pick(['+', '−', '−−']);
      if (kind === '+') return numQ(fmt(a) + ' + ' + paren(b), a + b);
      if (kind === '−') return numQ(fmt(a) + ' − ' + paren(b), a - b);
      const c = nz(-9, 9);
      return numQ(fmt(a) + ' − ' + paren(b) + ' + ' + paren(c), a - b + c);
    },
    exponents() {
      const kind = pick(['pow', 'pow', 'negbase', 'product', 'quotient', 'zero']);
      if (kind === 'pow') {
        const b = rand(2, 6), e = b <= 3 ? rand(2, 5) : rand(2, 3);
        return numQ(b + '^' + e, Math.pow(b, e));
      }
      if (kind === 'negbase') {
        const b = rand(2, 5), e = rand(2, 3);
        return pick([true, false]) ? numQ('(−' + b + ')^' + e, Math.pow(-b, e)) : numQ('−' + b + '^' + e, -Math.pow(b, e));
      }
      if (kind === 'product') {
        const m = rand(2, 7), n = rand(2, 7);
        const q = numQ('x^' + m + ' · x^' + n + ' = x^?', m + n);
        q.hint = 'Type just the exponent.';
        return q;
      }
      if (kind === 'quotient') {
        const n = rand(2, 6), m = n + rand(1, 6);
        const q = numQ('x^' + m + ' ÷ x^' + n + ' = x^?', m - n);
        q.hint = 'Type just the exponent.';
        return q;
      }
      return numQ(rand(2, 99) + '^0', 1);
    },
    integers() {
      const kind = pick(['×', '×', '÷', 'order']);
      if (kind === '×') { const a = nz(-12, 12), b = nz(-12, 12); return numQ(fmt(a) + ' × ' + paren(b), a * b); }
      if (kind === '÷') { const b = nz(-12, 12), r = nz(-12, 12); return numQ(fmt(b * r) + ' ÷ ' + paren(b), r); }
      const a = nz(-10, 10), b = nz(-6, 6), c = nz(-6, 6);
      return pick([true, false])
        ? numQ(fmt(a) + ' + ' + paren(b) + ' × ' + paren(c), a + b * c)
        : numQ(fmt(a) + ' − ' + paren(b) + ' × ' + paren(c), a - b * c);
    }
  };

  // Show exponents as superscripts on screen.
  function pretty(q) {
    return q.replace(/\^(\?|\d+)/g, '<sup>$1</sup>');
  }

  window.Drills = { make: key => gens[key](), pretty };
})();
