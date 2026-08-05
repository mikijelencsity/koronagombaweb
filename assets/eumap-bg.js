/* ============================================================
   EURÓPAI JELENLÉT — procedurális topográfiai háttér
   Valódi izovonalak (marching squares) egy zajmezőn, egyszer
   kirajzolva 2D vászonra. Nincs külső kép, nincs animációs
   ciklus — csak méretváltozáskor rajzol újra.
   ============================================================ */
(function () {
  var canvas = document.getElementById('eumapBg');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  /* --- egyszerű, determinisztikus érték-zaj (value noise) --- */
  function hash(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = smooth(xf), v = smooth(yf);
    var a = hash(xi, yi), b = hash(xi + 1, yi);
    var c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function fbm(x, y) {
    var sum = 0, amp = 0.5, freq = 1;
    for (var i = 0; i < 4; i++) {
      sum += valueNoise(x * freq, y * freq) * amp;
      freq *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  /* --- marching squares: egy szintvonal szakaszai --- */
  function isoSegments(field, cols, rows, level, cell, out) {
    function at(c, r) { return field[r * (cols + 1) + c]; }
    function lerpX(c, r, v1, v2) { return (c + (level - v1) / (v2 - v1)) * cell; }
    function lerpY(c, r, v1, v2) { return (r + (level - v1) / (v2 - v1)) * cell; }

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var tl = at(c, r), tr = at(c + 1, r), br = at(c + 1, r + 1), bl = at(c, r + 1);
        var idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        var top = [lerpX(c, r, tl, tr), r * cell];
        var right = [(c + 1) * cell, lerpY(c, r, tr, br)];
        var bottom = [lerpX(c, r + 1, bl, br), (r + 1) * cell];
        var left = [c * cell, lerpY(c, r, tl, bl)];

        switch (idx) {
          case 1: case 14: out.push(left, bottom); break;
          case 2: case 13: out.push(bottom, right); break;
          case 3: case 12: out.push(left, right); break;
          case 4: case 11: out.push(top, right); break;
          case 6: case 9:  out.push(top, bottom); break;
          case 7: case 8:  out.push(left, top); break;
          case 5:          out.push(left, top); out.push(bottom, right); break;
          case 10:         out.push(left, bottom); out.push(top, right); break;
          default: break;
        }
      }
    }
  }

  var lastW = 0, lastH = 0;

  function draw() {
    var host = canvas.parentElement;
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    if (!w || !h) return;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;

    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* a zajmező felbontása — nagyobb cella = olcsóbb, lágyabb vonalak */
    var cell = w < 700 ? 18 : 14;
    var cols = Math.ceil(w / cell);
    var rows = Math.ceil(h / cell);
    var scale = 0.055;   /* a "domborzat" léptéke */

    var field = new Float32Array((cols + 1) * (rows + 1));
    for (var r = 0; r <= rows; r++) {
      for (var c = 0; c <= cols; c++) {
        /* enyhén nyújtva vízszintesen, hogy fekvő, tájszerű formák legyenek */
        field[r * (cols + 1) + c] = fbm(c * scale * 0.72, r * scale);
      }
    }

    var levels = 16;
    ctx.lineCap = 'round';
    for (var i = 1; i < levels; i++) {
      var level = i / levels;
      var segs = [];
      isoSegments(field, cols, rows, level, cell, segs);
      if (!segs.length) continue;
      /* minden 4. szintvonal vastagabb — mint egy valódi topográfiai térképen */
      var major = i % 4 === 0;
      ctx.beginPath();
      for (var s = 0; s < segs.length; s += 2) {
        ctx.moveTo(segs[s][0], segs[s][1]);
        ctx.lineTo(segs[s + 1][0], segs[s + 1][1]);
      }
      /* sötét háttéren világos vonalak — a korábbi barna nem látszana */
      ctx.strokeStyle = major ? 'rgba(214,226,196,0.16)' : 'rgba(198,214,182,0.075)';
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.stroke();
    }
  }

  var t = null;
  /* Csak SZÉLESSÉG-változásra rajzolunk újra. A draw() ~50 ms a fő szálon;
     iPhone-on a címsáv be-/kiúszása is resize-t lő, és a host magassága ilyenkor
     változhat — enélkül felfelé görgetve ismételten újrarajzolt volna, ami
     ott akasztja meg a görgetést, ahol a legjobban látszik. */
  var lastResizeW = window.innerWidth;
  function schedule() {
    if (window.innerWidth === lastResizeW) return;
    lastResizeW = window.innerWidth;
    clearTimeout(t); t = setTimeout(draw, 140);
  }

  /* a rajzolás ~50 ms a fő szálon, a szekció pedig jóval a hajtás alatt van —
     ezért tétlen időben (vagy késleltetve) fut, hogy ne akassza a betöltést */
  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 400);
  }
  function start() { idle(draw); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('resize', schedule);
})();
