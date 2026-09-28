/* crypto_box_seal de libsodium en JavaScript puro (sin dependencias), para guardar
   secrets de GitHub Actions directamente desde el navegador, como hace GitHub CLI.
   X25519 + XSalsa20-Poly1305 + nonce = BLAKE2b-192(epk || pk).
   Verificado contra libsodium (crypto_box_seal_open) en los tests. Solo se usa para cifrar
   unos pocos bytes, así que prima la claridad (BigInt) sobre la velocidad. */
(function (root) {
  'use strict';
  const P = (1n << 255n) - 19n;
  const mod = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
  const pow = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; };
  const le2n = (u8) => { let n = 0n; for (let i = u8.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u8[i]); return n; };
  const n2le = (n, len) => { const o = new Uint8Array(len); for (let i = 0; i < len; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };

  /* ---- X25519 (RFC 7748) ---- */
  function x25519(k, u) {
    const kk = Uint8Array.from(k); kk[0] &= 248; kk[31] &= 127; kk[31] |= 64;
    const scalar = le2n(kk);
    const uu = Uint8Array.from(u); uu[31] &= 127;
    const x1 = le2n(uu); let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
    const A24 = 121665n;
    for (let t = 254n; t >= 0n; t--) {
      const kt = (scalar >> t) & 1n; swap ^= kt;
      if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
      swap = kt;
      const A = mod(x2 + z2), AA = mod(A * A), B = mod(x2 - z2), BB = mod(B * B), E = mod(AA - BB);
      const C = mod(x3 + z3), D = mod(x3 - z3), DA = mod(D * A), CB = mod(C * B);
      x3 = mod((DA + CB) ** 2n); z3 = mod(x1 * mod((DA - CB) ** 2n));
      x2 = mod(AA * BB); z2 = mod(E * (AA + A24 * E));
    }
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    return n2le(mod(x2 * pow(z2, P - 2n)), 32);
  }
  const BASE = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();

  /* ---- Salsa20 / HSalsa20 ---- */
  const rotl = (v, c) => ((v << c) | (v >>> (32 - c))) >>> 0;
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  function core(input, hsalsa) {
    const x = input.slice();
    const qr = (a, b, c, d) => { x[b] ^= rotl((x[a] + x[d]) >>> 0, 7); x[c] ^= rotl((x[b] + x[a]) >>> 0, 9); x[d] ^= rotl((x[c] + x[b]) >>> 0, 13); x[a] ^= rotl((x[d] + x[c]) >>> 0, 18); };
    for (let i = 0; i < 10; i++) {
      qr(0, 4, 8, 12); qr(5, 9, 13, 1); qr(10, 14, 2, 6); qr(15, 3, 7, 11);
      qr(0, 1, 2, 3); qr(5, 6, 7, 4); qr(10, 11, 8, 9); qr(15, 12, 13, 14);
    }
    if (hsalsa) return [0, 5, 10, 15, 6, 7, 8, 9].map((i) => x[i] >>> 0);
    return x.map((v, i) => (v + input[i]) >>> 0);
  }
  function state(key, n0, n1, n2, n3) {
    return [SIGMA[0], u32(key, 0), u32(key, 4), u32(key, 8), u32(key, 12), SIGMA[1], n0, n1, n2, n3,
      SIGMA[2], u32(key, 16), u32(key, 20), u32(key, 24), u32(key, 28), SIGMA[3]];
  }
  const words2bytes = (w) => { const o = new Uint8Array(w.length * 4); w.forEach((v, i) => { o[i * 4] = v & 255; o[i * 4 + 1] = (v >>> 8) & 255; o[i * 4 + 2] = (v >>> 16) & 255; o[i * 4 + 3] = (v >>> 24) & 255; }); return o; };
  const hsalsa20 = (key, n16) => words2bytes(core(state(key, u32(n16, 0), u32(n16, 4), u32(n16, 8), u32(n16, 12)), true));
  function salsa20Stream(key, n8, len) {
    const out = new Uint8Array(len); let ctr = 0;
    for (let pos = 0; pos < len; pos += 64, ctr++) {
      const blk = words2bytes(core(state(key, u32(n8, 0), u32(n8, 4), ctr >>> 0, Math.floor(ctr / 4294967296)), false));
      out.set(blk.subarray(0, Math.min(64, len - pos)), pos);
    }
    return out;
  }

  /* ---- Poly1305 ---- */
  function poly1305(msg, key) {
    const r = le2n(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn, s = le2n(key.subarray(16, 32));
    const p = (1n << 130n) - 5n; let acc = 0n;
    for (let i = 0; i < msg.length; i += 16) {
      const blk = msg.subarray(i, Math.min(i + 16, msg.length));
      acc = ((acc + le2n(blk) + (1n << BigInt(8 * blk.length))) * r) % p;
    }
    return n2le((acc + s) & ((1n << 128n) - 1n), 16);
  }

  /* ---- crypto_box (XSalsa20-Poly1305) ---- */
  function box(msg, nonce24, pk, sk) {
    const k = hsalsa20(x25519(sk, pk), new Uint8Array(16));
    const sub = hsalsa20(k, nonce24.subarray(0, 16));
    const ks = salsa20Stream(sub, nonce24.subarray(16, 24), 32 + msg.length);
    const c = new Uint8Array(msg.length); for (let i = 0; i < msg.length; i++) c[i] = msg[i] ^ ks[32 + i];
    const out = new Uint8Array(16 + c.length); out.set(poly1305(c, ks.subarray(0, 32))); out.set(c, 16);
    return out;
  }

  /* ---- BLAKE2b (RFC 7693), sin clave ---- */
  const M64 = (1n << 64n) - 1n;
  const IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const SG = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]];
  const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & M64;
  function blake2b(data, outlen) {
    const h = IV.slice(); h[0] ^= 0x01010000n ^ BigInt(outlen);
    const blocks = Math.max(1, Math.ceil(data.length / 128));
    for (let b = 0; b < blocks; b++) {
      const chunk = new Uint8Array(128); chunk.set(data.subarray(b * 128, b * 128 + 128));
      const m = Array.from({ length: 16 }, (_, i) => le2n(chunk.subarray(i * 8, i * 8 + 8)));
      const last = b === blocks - 1, t = BigInt(Math.min(data.length, (b + 1) * 128));
      const v = [...h, ...IV]; v[12] ^= t & M64; v[13] ^= t >> 64n; if (last) v[14] ^= M64;
      const G = (a, bb, c, d, x, y) => {
        v[a] = (v[a] + v[bb] + x) & M64; v[d] = rotr(v[d] ^ v[a], 32n);
        v[c] = (v[c] + v[d]) & M64; v[bb] = rotr(v[bb] ^ v[c], 24n);
        v[a] = (v[a] + v[bb] + y) & M64; v[d] = rotr(v[d] ^ v[a], 16n);
        v[c] = (v[c] + v[d]) & M64; v[bb] = rotr(v[bb] ^ v[c], 63n);
      };
      for (let r = 0; r < 12; r++) {
        const s = SG[r % 10];
        G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]); G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
        G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]); G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
      }
      for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    const out = new Uint8Array(64); h.forEach((x, i) => out.set(n2le(x, 8), i * 8));
    return out.subarray(0, outlen);
  }

  /* ---- crypto_box_seal ---- */
  function seal(msg, pk, _esk) {
    const esk = _esk || crypto.getRandomValues(new Uint8Array(32));
    const epk = x25519(esk, BASE);
    const nin = new Uint8Array(64); nin.set(epk); nin.set(pk, 32);
    const c = box(msg, blake2b(nin, 24), pk, esk);
    const out = new Uint8Array(32 + c.length); out.set(epk); out.set(c, 32);
    return out;
  }
  const api = { seal, x25519, blake2b, box, poly1305, hsalsa20 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SealBox = api;
})(typeof self !== 'undefined' ? self : this);
