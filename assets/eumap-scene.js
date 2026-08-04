/* ============================================================
   EURÓPAI JELENLÉT — "természetkutató holografikus térkép"
   Vanilla JS + Three.js (ES modul) + GSAP ScrollTrigger.

   Rétegek:
     1. finoman kiemelkedő, papír-textúrás országlapok (ExtrudeGeometry)
     2. éles kontúr a lapok tetején — ettől "kész" a felület
     3. szállítási útvonalak Demjénből a 12 exportpiacra, futó fényponttal
     4. kutatói asztal-rács a térkép alatt
     5. lebegő országcímkék a célországokon
     6. Magyarország-fókusz: fénygyűrű + lebegő logó + lágy árnyék
     7. lebegő spórák

   TELJESÍTMÉNY: nincs post-processing, nincs árnyéktérkép, egyetlen sima
   render fut képkockánként, és csak amíg a szekció a képernyőn van.
   ============================================================ */
import * as THREE from 'three';
import gsap from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm';
import { ScrollTrigger } from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger/+esm';

gsap.registerPlugin(ScrollTrigger);

const CFG = {
  projScale: 3.0,
  depth: 0.9,
  depthDeliver: 1.45,
  depthHungary: 2.1,
  bevelThickness: 0.1,
  bevelSize: 0.08,
  shrink: 0.985,
  fov: 38,

  bg:        new THREE.Color('#F0E9DA'),
  paper:     new THREE.Color('#E6DCC8'),
  paperSide: new THREE.Color('#CFC2A8'),   /* a zászlós lapok oldalfala */
  deliver:   new THREE.Color('#A9C7A2'),
  hungary:   new THREE.Color('#7FB487'),
  outline:   new THREE.Color('#8C8266'),
  ring:      new THREE.Color('#3DA35D'),
  route:     new THREE.Color('#3DA35D'),
  routeHot:  new THREE.Color('#D9E34E'),
  grid:      new THREE.Color('#B9AC93'),
};

const EXCLUDE = new Set(['Russia', 'Iceland']);
const BBOX = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };
const DEMJEN = [20.2333, 47.7167];

const DELIVER = new Set(['Hungary', 'Slovakia', 'Austria', 'Romania', 'Croatia', 'Serbia',
  'Slovenia', 'Czechia', 'Poland', 'Ukraine', 'Germany', 'Bosnia and Herz.']);

/* ===== KITÖLTENDŐ =====================================================
   Az exportpiacok adatlapjának szövege. Jelenleg szándékosan általános
   helykitöltő — NEM valós adat. Cseréld le a végleges leírásokra; ahol nincs
   egyedi szöveg, a FALLBACK megy ki. */
const COPY = {
  /* pl.: Slovakia: 'Ide jön Szlovákia rövid bemutatása.', */
};
const COPY_FALLBACK = 'Példaszöveg — ide jön a piac rövid bemutatása: mióta szállítunk oda, '
  + 'milyen termékkörrel és milyen partnerekkel. (A végleges szöveg még nincs megírva.)';

const NAMES = {
  Hungary: 'Magyarország', Slovakia: 'Szlovákia', Austria: 'Ausztria', Romania: 'Románia',
  Croatia: 'Horvátország', Serbia: 'Szerbia', Slovenia: 'Szlovénia', Czechia: 'Csehország',
  Poland: 'Lengyelország', Ukraine: 'Ukrajna', Germany: 'Németország',
  'Bosnia and Herz.': 'Bosznia-Hercegovina', France: 'Franciaország', Belarus: 'Fehéroroszország',
  Lithuania: 'Litvánia', Estonia: 'Észtország', Latvia: 'Lettország', Norway: 'Norvégia',
  Sweden: 'Svédország', Finland: 'Finnország', Luxembourg: 'Luxemburg', Belgium: 'Belgium',
  'North Macedonia': 'Észak-Macedónia', Albania: 'Albánia', Kosovo: 'Koszovó', Spain: 'Spanyolország',
  Denmark: 'Dánia', Ireland: 'Írország', 'United Kingdom': 'Egyesült Királyság', Greece: 'Görögország',
  Italy: 'Olaszország', Switzerland: 'Svájc', Netherlands: 'Hollandia', Bulgaria: 'Bulgária',
  Montenegro: 'Montenegró', Portugal: 'Portugália', Moldova: 'Moldova',
};

async function init() {
  const canvas = document.getElementById('eumapCanvas');
  const stage = document.getElementById('eumapStage');
  const section = document.getElementById('eu-jelenlet');
  const tooltip = document.getElementById('eumapTooltip');
  const message = document.getElementById('eumapMessage');
  const card = document.getElementById('eumapCard');
  const cardTitle = document.getElementById('eumapCardTitle');
  const cardText = document.getElementById('eumapCardText');
  const cardClose = document.getElementById('eumapCardClose');
  const hint = document.getElementById('eumapHint');
  if (!canvas || !stage || !section) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth <= 760;

  const geo = await (await fetch('custom.geo.json')).json();
  /* a címkék rajzolása előtt várjuk meg a betűtípust, különben fallback fonttal
     sülne bele a szöveg a textúrába */
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* nem kritikus */ } }

  /* ---------------- vetítés ---------------- */
  const LAT0 = 50, LON0 = 15;
  const COSLAT = Math.cos(LAT0 * Math.PI / 180);
  const project = (lon, lat) => [
    (lon - LON0) * COSLAT * CFG.projScale,
    (lat - LAT0) * CFG.projScale,
  ];
  const nearEurope = (ring) => {
    let sx = 0, sy = 0;
    for (const [lon, lat] of ring) { sx += lon; sy += lat; }
    const lon = sx / ring.length, lat = sy / ring.length;
    return lon > BBOX.lonMin && lon < BBOX.lonMax && lat > BBOX.latMin && lat < BBOX.latMax;
  };
  /* map-koordináta -> világ (a group -90°-os X forgatása miatt) */
  const toWorld = (mx, my, h = 0) => new THREE.Vector3(mx, h, -my);

  /* ---------------- textúrák (mind canvasból — nincs külső asset) ---------------- */
  function makePaperTexture() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, S, S);

    /* papírrost-szemcse */
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 236 + Math.random() * 19;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);

    /* halvány szintvonalak — "térképlap" érzet, ettől nem üres a felület */
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const cx = Math.random() * S, cy = Math.random() * S;
      const r0 = 12 + Math.random() * 26;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(168,156,128,${0.05 + Math.random() * 0.045})`;
        ctx.ellipse(cx, cy, r0 + k * 13, (r0 + k * 13) * (0.62 + Math.random() * 0.3),
          Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    /* apró spóra-pettyek */
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(150,140,116,${0.05 + Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, Math.random() * 1.5 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.045, 0.045);
    tex.anisotropy = 4;
    return tex;
  }

  function makeBlob(r, g, b, aMax) {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    /* lágy, több lépcsős kifutás — nincs kemény perem */
    grd.addColorStop(0.00, `rgba(${r},${g},${b},${aMax})`);
    grd.addColorStop(0.35, `rgba(${r},${g},${b},${aMax * 0.55})`);
    grd.addColorStop(0.65, `rgba(${r},${g},${b},${aMax * 0.18})`);
    grd.addColorStop(1.00, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  }

  /* ---- zászlók: canvasra rajzolva, nincs külső kép/asset ----
     A címeres zászlók (Szlovákia, Szerbia, Szlovénia) a térkép léptékében
     amúgy is csak sávokként olvashatók, ezért a címer nélküli, egyszerűsített
     sávos változatot rajzoljuk; a jellegzetes elemeket (cseh ék, horvát
     sakktábla, bosnyák háromszög) viszont megrajzoljuk. */
  const FLAGS = {
    Hungary:    (c, w, h) => bands(c, w, h, ['#CE2939', '#FFFFFF', '#477050'], 'h'),
    Slovakia:   (c, w, h) => bands(c, w, h, ['#FFFFFF', '#0B4EA2', '#EE1C25'], 'h'),
    Austria:    (c, w, h) => bands(c, w, h, ['#ED2939', '#FFFFFF', '#ED2939'], 'h'),
    Romania:    (c, w, h) => bands(c, w, h, ['#002B7F', '#FCD116', '#CE1126'], 'v'),
    Serbia:     (c, w, h) => bands(c, w, h, ['#C6363C', '#0C4076', '#FFFFFF'], 'h'),
    Slovenia:   (c, w, h) => bands(c, w, h, ['#FFFFFF', '#005DA4', '#ED1C24'], 'h'),
    Poland:     (c, w, h) => bands(c, w, h, ['#FFFFFF', '#DC143C'], 'h'),
    Ukraine:    (c, w, h) => bands(c, w, h, ['#0057B7', '#FFD700'], 'h'),
    Germany:    (c, w, h) => bands(c, w, h, ['#000000', '#DD0000', '#FFCE00'], 'h'),
    Croatia:    (c, w, h) => {
      bands(c, w, h, ['#FF0000', '#FFFFFF', '#171796'], 'h');
      /* sakktábla-négyzet középen */
      const s = h * 0.30, x0 = w / 2 - s / 2, y0 = h / 2 - s / 2, n = 5, cell = s / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          c.fillStyle = (i + j) % 2 ? '#FFFFFF' : '#FF0000';
          c.fillRect(x0 + i * cell, y0 + j * cell, cell, cell);
        }
      }
    },
    Czechia: (c, w, h) => {
      bands(c, w, h, ['#FFFFFF', '#D7141A'], 'h');
      c.fillStyle = '#11457E';
      c.beginPath();
      c.moveTo(0, 0); c.lineTo(w * 0.5, h / 2); c.lineTo(0, h); c.closePath();
      c.fill();
    },
    'Bosnia and Herz.': (c, w, h) => {
      c.fillStyle = '#002395'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#FECB00';
      c.beginPath();
      c.moveTo(w * 0.28, 0); c.lineTo(w, 0); c.lineTo(w, h); c.closePath();
      c.fill();
      c.fillStyle = '#FFFFFF';
      for (let i = 0; i < 7; i++) {
        star(c, w * 0.22 + i * w * 0.108, h * 0.92 - i * h * 0.145, h * 0.075);
      }
    },
  };

  function bands(ctx, w, h, colors, dir) {
    const n = colors.length;
    colors.forEach((col, i) => {
      ctx.fillStyle = col;
      if (dir === 'h') ctx.fillRect(0, (h / n) * i, w, h / n + 1);
      else ctx.fillRect((w / n) * i, 0, w / n + 1, h);
    });
  }

  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.42 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function makeFlagTexture(name) {
    const w = 180, h = 120;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    (FLAGS[name] || ((c) => { c.fillStyle = '#DDD3BF'; c.fillRect(0, 0, w, h); }))(ctx, w, h);
    /* finom keret, hogy a világos sávok se olvadjanak bele a térképlapba */
    ctx.strokeStyle = 'rgba(60,52,38,0.55)';
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  const paperTex = makePaperTexture();

  /* ---------------- jelenet ---------------- */
  const scene = new THREE.Scene();
  /* nincs köd — a távolabbi részek is élesek és teli színűek maradnak */

  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  scene.add(group);

  function shrinkRing(ring, k) {
    let cx = 0, cy = 0;
    ring.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= ring.length; cy /= ring.length;
    return ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  }

  /* ---------------- 1-2. országlapok + tetőkontúr ---------------- */
  const countryMeshes = [];
  const centroidOf = new Map();
  const outlineVerts = [];
  /* a kontinens külső gyűrűi — ebből rajzoljuk a kontakt-árnyékot */
  const countryShadowRings = [];

  geo.features.forEach((f) => {
    const name = f.properties.name;
    if (EXCLUDE.has(name)) return;
    const g = f.geometry;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      .filter((rings) => nearEurope(rings[0]));
    if (!polys.length) return;

    const isDeliver = DELIVER.has(name);
    const isHungary = name === 'Hungary';
    const depth = isHungary ? CFG.depthHungary : isDeliver ? CFG.depthDeliver : CFG.depth;

    /* az ország befoglaló doboza — ehhez illesztjük rá a zászlót */
    let bxMin = Infinity, bxMax = -Infinity, byMin = Infinity, byMax = -Infinity;

    const shapes = polys.map((rings) => {
      const proj = rings.map((r) => r.map(([lon, lat]) => project(lon, lat)));
      proj[0].forEach(([x, y]) => {
        if (x < bxMin) bxMin = x; if (x > bxMax) bxMax = x;
        if (y < byMin) byMin = y; if (y > byMax) byMax = y;
      });
      const outer = shrinkRing(proj[0], CFG.shrink);
      countryShadowRings.push(outer);
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (let i = 1; i < proj.length; i++) {
        shape.holes.push(new THREE.Path(
          shrinkRing(proj[i], CFG.shrink).map(([x, y]) => new THREE.Vector2(x, y))));
      }
      /* tetőkontúr: a lap pereme, hajszálnyival beljebb és a tető fölött */
      const top = depth + 0.035;
      proj.forEach((r) => {
        const line = shrinkRing(r, CFG.shrink * 0.992);
        for (let i = 0; i < line.length - 1; i++) {
          outlineVerts.push(line[i][0], line[i][1], top, line[i + 1][0], line[i + 1][1], top);
        }
      });
      return shape;
    });

    const geom = new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: true,
      bevelThickness: CFG.bevelThickness,
      bevelSize: CFG.bevelSize,
      bevelSegments: 1,
      curveSegments: 2,
    });
    geom.computeVertexNormals();

    /* A szállítási országok LAPJA maga a zászló: a zászló-textúrát az ország
       befoglaló dobozára illesztjük. Az ExtrudeGeometry a tetőlaphoz a
       vertex x/y-t használja UV-nek, ezért repeat/offset-tel skálázzuk rá.
       A geometria két anyagcsoportot ad: 0 = tető/alj, 1 = oldalfal. */
    let capMat;
    if (isDeliver) {
      const w = Math.max(bxMax - bxMin, 0.001);
      const h = Math.max(byMax - byMin, 0.001);
      const flagTex = makeFlagTexture(name);
      flagTex.wrapS = flagTex.wrapT = THREE.ClampToEdgeWrapping;
      flagTex.repeat.set(1 / w, 1 / h);
      flagTex.offset.set(-bxMin / w, -byMin / h);
      capMat = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,          /* fehér alap, hogy a zászló valódi színe jöjjön */
        map: flagTex,
        bumpMap: paperTex,        /* a papír mikro-domborzata megmarad alatta */
        bumpScale: 0.3,
        roughness: 0.78,
        metalness: 0.02,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      });
    } else {
      capMat = new THREE.MeshStandardMaterial({
        color: CFG.paper,
        map: paperTex,
        bumpMap: paperTex,
        bumpScale: 0.35,
        roughness: 0.88,
        metalness: 0.02,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      });
    }
    const sideMat = new THREE.MeshStandardMaterial({
      color: isDeliver ? CFG.paperSide : CFG.paper,
      map: paperTex,
      roughness: 0.9,
      metalness: 0.02,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, [capMat, sideMat]);
    mesh.userData = {
      name, label: NAMES[name] || name, isDeliver,
      capMat, sideMat,
      baseColor: capMat.color.clone(),
    };
    group.add(mesh);
    countryMeshes.push(mesh);

    const biggest = polys.slice().sort((a, b) => b[0].length - a[0].length)[0][0];
    let sx = 0, sy = 0;
    biggest.forEach(([lon, lat]) => { const [x, y] = project(lon, lat); sx += x; sy += y; });
    centroidOf.set(name, new THREE.Vector2(sx / biggest.length, sy / biggest.length));
  });

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outlineVerts), 3));
  const outlineMat = new THREE.LineBasicMaterial({
    color: CFG.outline, transparent: true, opacity: 0, depthWrite: false,
  });
  group.add(new THREE.LineSegments(outlineGeo, outlineMat));

  /* ---------------- fény ---------------- */
  /* Sötét háttérhez hangolt világítás: erős, meleg kulcsfény felülről-balról
     (ettől lesz "megvilágított makett"), gyenge, hűvös-zöld környezeti fény,
     és egy zöldes peremfény jobbról, ami elválasztja a lapokat a háttértől. */
  scene.add(new THREE.HemisphereLight(0xDDE8DA, 0x0E120F, 0.34));
  const key = new THREE.DirectionalLight(0xFFF3E0, 1.9);
  key.position.set(-24, 42, 26);
  scene.add(key);
  scene.add(key.target);
  const rimLight = new THREE.DirectionalLight(0x8FE3B0, 0.55);
  rimLight.position.set(28, 18, -22);
  scene.add(rimLight);

  const box = new THREE.Box3().setFromObject(group);
  const bsize = box.getSize(new THREE.Vector3());
  /* ---------------- LEBEGŐ TÉRKÉP + KONTAKT-ÁRNYÉK ----------------
     Nincs alátét (asztal/tányér): minden ilyen tárgy elszívta a figyelmet a
     térképről, és kelléknek degradálta azt, ami a főszereplő. A térkép a
     szekció krém hátterén lebeg, egyetlen lágy kontakt-árnyékkal, ami
     fizikai súlyt ad neki. A "prémium tárgy" keretezést az oldal
     tipográfiája adja (lásd .eumap__frame az index.html-ben). */
  const mapSpan = Math.max(bsize.x, bsize.z);
  const cxMap = (box.min.x + box.max.x) / 2;
  const czMap = (box.min.z + box.max.z) / 2;

  /* SÖTÉT háttéren a sötét árnyék nem látszana, ezért a kontinens sziluettje
     alá lágy zöld fény-tócsát teszünk: ez adja a "megvilágított makett"
     hatást, és leülteti a térképet a térben. */
  function makeContactGlowTexture() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const sx = S / (bsize.x * 1.35), sz = S / (bsize.z * 1.35);
    ctx.translate(S / 2, S / 2);
    ctx.scale(sx, sz);
    ctx.translate(-cxMap, -czMap);
    ctx.fillStyle = 'rgba(84,196,128,0.55)';
    ctx.filter = 'blur(16px)';
    countryShadowRings.forEach((ring) => {
      ctx.beginPath();
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, -y) : ctx.moveTo(x, -y)));
      ctx.closePath();
      ctx.fill();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const shadowMat = new THREE.MeshBasicMaterial({
    map: makeContactGlowTexture(),
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(bsize.x * 1.35, bsize.z * 1.35), shadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  /* a fény bal-felülről jön, ezért az árnyék jobbra-lefelé csúszik el */
  contactShadow.position.set(cxMap + mapSpan * 0.012, -0.55, czMap + mapSpan * 0.016);
  scene.add(contactShadow);


  /* Nincs árnyéktérkép: nincs mire vetülnie (nincs alátét), a súlyt a
     rajzolt kontakt-árnyék adja — így egy teljes render-menetet is spórolunk. */

  /* ---------------- 3. szállítási útvonalak Demjénből ---------------- */
  const [dx, dy] = project(DEMJEN[0], DEMJEN[1]);
  const demjen = new THREE.Vector3(dx, CFG.depthHungary + 0.1, -dy);   /* világ-koordináta */

  const ARC_SEG = 46;
  const routeTargets = [...DELIVER].filter((n) => n !== 'Hungary')
    .map((n) => ({ n, c: centroidOf.get(n) })).filter((o) => o.c);

  const rPos = [], rT = [], rOff = [];
  routeTargets.forEach((o, i) => {
    const end = toWorld(o.c.x, o.c.y, CFG.depthDeliver + 0.1);
    const mid = demjen.clone().lerp(end, 0.5);
    mid.y += demjen.distanceTo(end) * 0.34 + 1.6;
    const pts = new THREE.QuadraticBezierCurve3(demjen, mid, end).getPoints(ARC_SEG);
    const off = i / routeTargets.length;
    for (let k = 0; k < ARC_SEG; k++) {
      const a = pts[k], b = pts[k + 1];
      rPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      rT.push(k / ARC_SEG, (k + 1) / ARC_SEG);
      rOff.push(off, off);
    }
  });
  const routeGeo = new THREE.BufferGeometry();
  routeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rPos), 3));
  routeGeo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(rT), 1));
  routeGeo.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(rOff), 1));
  const routeUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: CFG.route },
    uHot: { value: CFG.routeHot },
  };
  const routes = new THREE.LineSegments(routeGeo, new THREE.ShaderMaterial({
    uniforms: routeUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aT, aOff;
      varying float vT, vOff;
      void main(){
        vT = aT; vOff = aOff;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity;
      uniform vec3 uColor, uHot;
      varying float vT, vOff;
      void main(){
        float head = fract(uTime * 0.11 + vOff);
        float d = abs(vT - head); d = min(d, 1.0 - d);
        float pulse = exp(-d * d * 300.0);
        vec3 col = mix(uColor, uHot, pulse);
        gl_FragColor = vec4(col, (0.18 + pulse * 0.72) * uOpacity);
      }`,
  }));
  scene.add(routes);

  /* ---------------- 6. Magyarország-fókusz ---------------- */
  const hu = centroidOf.get('Hungary');
  let logo = null, logoShadow = null;
  if (hu) {
    /* (a korábbi zöld fénygyűrű Magyarország körül eltávolítva) */

    /* lágy, széles, alig látható árnyékfolt (nem kemény korong) */
    logoShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 6.6),
      new THREE.MeshBasicMaterial({
        map: makeBlob(84, 72, 52, 0.30), transparent: true, opacity: 0, depthWrite: false,
      }));
    logoShadow.position.set(hu.x, hu.y - 0.5, CFG.depthHungary + 0.07);
    group.add(logoShadow);

    const logoTex = new THREE.TextureLoader().load('images/assets/logo.webp');
    logoTex.colorSpace = THREE.SRGBColorSpace;
    logo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: logoTex, transparent: true, opacity: 0, depthTest: false,
    }));
    logo.scale.set(7.4, 7.4, 1);
    logo.renderOrder = 20;
    logo.position.copy(toWorld(hu.x, hu.y, CFG.depthHungary + 6.2));
    scene.add(logo);
  }

  /* (A GLB kellékek — gombák és korona — eltávolítva: az asztal maradt,
     de 3D modellek nélkül.) */

  /* ---------------- 7. spórák ---------------- */
  const sporeCount = isMobile ? 90 : 220;
  const sPos = new Float32Array(sporeCount * 3);
  const sBase = new Float32Array(sporeCount * 3);
  const sSeed = new Float32Array(sporeCount);
  for (let i = 0; i < sporeCount; i++) {
    const x = box.min.x + Math.random() * bsize.x;
    const y = 1 + Math.random() * 26;
    const z = box.min.z + Math.random() * bsize.z;
    sBase[i * 3] = x; sBase[i * 3 + 1] = y; sBase[i * 3 + 2] = z;
    sPos[i * 3] = x; sPos[i * 3 + 1] = y; sPos[i * 3 + 2] = z;
    sSeed[i] = Math.random() * Math.PI * 2;
  }
  const sporeGeo = new THREE.BufferGeometry();
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const spores = new THREE.Points(sporeGeo, new THREE.PointsMaterial({
    size: 0.42, map: makeBlob(255, 251, 240, 0.95),
    transparent: true, opacity: 0, depthWrite: false,
  }));
  scene.add(spores);

  /* ---------------- kamera ---------------- */
  const camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.1, 4000);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  /* a keretezésnek már a TÁNYÉR a mérvadó, nem csak a térkép — különben
     a nyitóképen levágnánk a peremét */
  const wideDist = (sphere.radius * 0.98) / Math.tan(THREE.MathUtils.degToRad(CFG.fov) / 2);
  camera.far = wideDist * 8;
  camera.updateProjectionMatrix();

  const central = new THREE.Vector2();
  let cN = 0;
  DELIVER.forEach((n) => { const c = centroidOf.get(n); if (c) { central.add(c); cN++; } });
  if (cN) central.divideScalar(cN);

  function shot(v2, dist, elevation, azimuth, h = 0) {
    const target = toWorld(v2.x, v2.y, h);
    const dir = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation));
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }

  const mapCenter = new THREE.Vector2(sphere.center.x, -sphere.center.z);
  const KEY = [
    /* nyitókép: laposabb szög, hogy az asztal és a rajta lévő gombák
       is látszódjanak, ne csak felülnézetből a térkép */
    shot(mapCenter, wideDist * 1.16, 0.52, 0.16, 0),
    shot(central, wideDist * 0.58, 0.66, 0.12, CFG.depthDeliver),
    /* ez a MAXIMÁLIS közelítés — a screenshotos beállítás; ennél közelebb
       nem megy a scroll, mert onnantól szétesik a kompozíció */
    shot(hu || central, wideDist * 0.44, 0.62, 0.04, CFG.depthHungary),
  ];

  const camPos = new THREE.Vector3().copy(KEY[0].pos);
  const camTarget = new THREE.Vector3().copy(KEY[0].target);
  const smooth = (p) => p * p * (3 - 2 * p);

  function sampleShot(p) {
    const segs = KEY.length - 1;
    const s = Math.min(Math.floor(p * segs), segs - 1);
    const local = smooth(THREE.MathUtils.clamp(p * segs - s, 0, 1));
    camPos.lerpVectors(KEY[s].pos, KEY[s + 1].pos, local);
    camTarget.lerpVectors(KEY[s].target, KEY[s + 1].target, local);
  }

  const aspectPull = () => (camera.aspect < 1 ? 1.45 : camera.aspect < 1.5 ? 1.14 : 1.0);

  function placeCamera(t) {
    const dA = Math.sin(t * 0.13) * 0.035;
    const dY = Math.sin(t * 0.11 + 1.1) * 0.012;
    const dir = camPos.clone().sub(camTarget);
    const len = dir.length() * aspectPull();
    const ang = Math.atan2(dir.x, dir.z) + dA;
    const el = Math.asin(THREE.MathUtils.clamp(dir.y / dir.length(), -1, 1)) + dY;
    camera.position.set(
      camTarget.x + Math.sin(ang) * len * Math.cos(el),
      camTarget.y + Math.sin(el) * len,
      camTarget.z + Math.cos(ang) * len * Math.cos(el));
    camera.lookAt(camTarget);
  }

  /* ---------------- renderer ---------------- */
  /* A vászon TELJES KÉPERNYŐS (100vw x 100vh), ezért itt minden képpont drága.
     Három dolog véd a "szétesik a gép" esettől:

     failIfMajorPerformanceCaveat: ha a böngészőnek nincs igazi GPU-gyorsítása
       és szoftveresen (SwiftShader, CPU) renderelne, inkább HIBÁZZON. Egy
       teljes képernyős 3D jelenet CPU-n megfojtja a gépet — jobb a tartalék
       nézet (lásd eumapFallback), mint egy használhatatlanul akadó oldal.
     powerPreference: kétGPU-s gépen a dedikált kártyát kérjük.
     dpr: 2 helyett 1.5 a felső határ. Retina kijelzőn ez 44%-kal kevesebb
       képpont, a lapos, nagy felületű grafikán viszont alig látszik. */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !isMobile && (window.devicePixelRatio || 1) < 1.5,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.5);
  renderer.setPixelRatio(dpr);

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  function resize() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---------------- hover / kattintás ---------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;

  function pick(cx, cy) {
    const rect = stage.getBoundingClientRect();
    ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(countryMeshes, false)[0];
    return hit ? hit.object : null;
  }

  function highlight(mesh, cx, cy) {
    if (hovered && hovered !== mesh) hovered.userData.capMat.color.copy(hovered.userData.baseColor);
    if (mesh) {
      /* a zászlós lapoknál a fehér alapot világosítjuk (1 fölé), különben
         a fehérre keverés nem látszana */
      const c = mesh.userData.capMat.color;
      if (mesh.userData.isDeliver) c.setRGB(1.22, 1.22, 1.22);
      else c.copy(mesh.userData.baseColor).lerp(new THREE.Color('#FFFFFF'), 0.22);
      if (tooltip) {
        const rect = stage.getBoundingClientRect();
        tooltip.textContent = mesh.userData.label;
        tooltip.style.left = (cx - rect.left) + 'px';
        tooltip.style.top = (cy - rect.top) + 'px';
        tooltip.classList.add('is-on');
      }
      canvas.style.cursor = 'pointer';
    } else {
      if (tooltip) tooltip.classList.remove('is-on');
      canvas.style.cursor = 'default';
    }
    hovered = mesh;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    highlight(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => highlight(null));

  /* ---------------- kattintás: az exportpiac kiemelkedik + adatlap ---------------- */
  let selected = null;

  function deselect() {
    if (!selected) return;
    gsap.to(selected.scale, { z: 1, duration: 0.55, ease: 'power2.inOut', overwrite: true });
    selected = null;
    if (card) card.classList.remove('is-on');
    updateHint();
  }

  function select(mesh) {
    if (!mesh || !mesh.userData.isDeliver) { deselect(); return; }
    if (selected === mesh) { deselect(); return; }
    if (selected) gsap.to(selected.scale, { z: 1, duration: 0.45, ease: 'power2.inOut', overwrite: true });
    selected = mesh;
    /* a kiválasztott ország kiemelkedik a lapból */
    gsap.to(mesh.scale, { z: 2.4, duration: 0.75, ease: 'power3.out', overwrite: true });
    if (card && cardTitle && cardText) {
      cardTitle.textContent = mesh.userData.label;
      cardText.textContent = COPY[mesh.userData.name] || COPY_FALLBACK;
      card.classList.add('is-on');
    }
    updateHint();
  }

  canvas.addEventListener('click', (e) => {
    const mesh = pick(e.clientX, e.clientY);
    highlight(mesh, e.clientX, e.clientY);
    select(mesh);
  });
  if (cardClose) cardClose.addEventListener('click', deselect);

  /* ---------------- belépő ---------------- */
  const reveal = { v: 0 };
  countryMeshes.forEach((m) => {
    m.userData.delay = Math.random() * 0.45;
    m.scale.z = 0.001;
    m.userData.capMat.opacity = 0;
    m.userData.sideMat.opacity = 0;
  });

  const c01 = (x) => THREE.MathUtils.clamp(x, 0, 1);

  function applyReveal() {
    const p = reveal.v;
    countryMeshes.forEach((m) => {
      const e = smooth(c01((p - m.userData.delay) / 0.55));
      m.scale.z = Math.max(0.001, e);
      m.userData.capMat.opacity = e;
      m.userData.sideMat.opacity = e;
    });
    outlineMat.opacity = c01((p - 0.45) / 0.55) * 0.5;
    /* a fény-tócsa a lapokkal együtt erősödik — ettől "leül" a térkép */
    shadowMat.opacity = c01((p - 0.1) / 0.5) * 0.5;
    if (logo) logo.material.opacity = c01((p - 0.6) / 0.4);
    if (logoShadow) logoShadow.material.opacity = c01((p - 0.6) / 0.4) * 0.55;
    spores.material.opacity = c01((p - 0.35) / 0.65) * 0.7;
    routeUniforms.uOpacity.value = c01((p - 0.7) / 0.3);
  }

  const render = () => renderer.render(scene, camera);

  /* a zászlók csak a közelibb beállításoknál úsznak be, hogy a teljes
     Európa-nézet ne legyen zsúfolt */
  /* A kameramozgás a görgetési sáv ELSŐ ~62%-a alatt fut le; a maradék a
     "tartás": a végső beállításban még görgetni kell egy darabot, mielőtt a
     szekció elengedi az oldalt — így nem dob azonnal tovább. */
  const HOLD_AT = 0.62;
  let camP = 0;
  function applyScroll(p) {
    camP = c01(p / HOLD_AT);
    sampleShot(camP);
    /* a márkaüzenet mindjárt az elején, felül látszik, és görgetésre elúszik */
    /* a fejléc a nyitóképnél látszik, és a ráközelítés elején elúszik */
    if (message) message.classList.toggle('is-on', camP < 0.3);
    updateHint();
  }

  /* egyetlen, központi "kattints" felirat — nincs több ország-név a térképen */
  function updateHint() {
    if (!hint) return;
    const open = !!(card && card.classList.contains('is-on'));
    hint.classList.toggle('is-on', camP > 0.22 && !open);
  }

  if (reduce) {
    reveal.v = 1; applyReveal(); applyScroll(0.5);
    placeCamera(0); render();
    return;
  }

  applyScroll(0);
  placeCamera(0);
  applyReveal();
  render();

  const intro = gsap.to(reveal, {
    v: 1, duration: 2.4, ease: 'power2.out', paused: true, onUpdate: applyReveal,
  });

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    /* hosszabb sáv: a mozgás 62%-nál véget ér, a maradék a tartás */
    end: '+=185%',
    pin: true,
    scrub: 1.1,
    onUpdate: (self) => applyScroll(self.progress),
  });

  const clock = new THREE.Clock();
  let raf = null, running = false;

  /* Ha a GPU-folyamat menet közben elszáll, a vászon szemetes/fagyott képet
     mutatna. A preventDefault() nélkül a kontextus nem is állítható helyre.
     Megállítjuk a ciklust és átváltunk a tartalék nézetre.
     (Szándékosan ITT áll, a raf/running deklarációja UTÁN — feljebb, a
     renderer mellett a kezelő TDZ-hibát dobna, ha a kontextus még az init
     lefutása közben veszne el.) */
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    running = false;
    eumapFallback('elveszett a WebGL-kontextus');
  }, false);

  function frame() {
    const t = clock.getElapsedTime();
    placeCamera(t);
    routeUniforms.uTime.value = t;

    const p = sporeGeo.attributes.position;
    for (let i = 0; i < sporeCount; i++) {
      const s = sSeed[i];
      p.setXYZ(i,
        sBase[i * 3] + Math.sin(t * 0.16 + s) * 1.5,
        sBase[i * 3 + 1] + Math.sin(t * 0.11 + s * 1.7) * 0.9,
        sBase[i * 3 + 2] + Math.cos(t * 0.13 + s * 2.1) * 1.5);
    }
    p.needsUpdate = true;

    if (logo && hu) {
      const bob = Math.sin(t * 0.7) * 0.55;
      logo.position.copy(toWorld(hu.x, hu.y, CFG.depthHungary + 6.2 + bob));
      if (logoShadow) {
        const k = 1 - bob * 0.05;
        logoShadow.scale.set(k, k, 1);
        logoShadow.material.opacity = Math.max(0, logoShadow.material.opacity);
      }
    }
    render();
    raf = requestAnimationFrame(frame);
  }

  new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !running) {
        running = true;
        section.classList.add('is-in');
        clock.start();
        intro.play();
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (!e.isIntersecting && running) {
        running = false;
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      }
    });
  }, { threshold: 0.05 }).observe(section);
}

/* ------------------------------------------------------------------
   TARTALÉK MEGJELENÉS, ha a 3D nem indul el.

   Ez NEM elméleti eset: ha a GPU-folyamat összeomlik (túlterhelt integrált
   GPU, driverhiba, vagy egyszerűen sok WebGL-fül), a böngésző utána már NEM
   ad WebGL-kontextust, amíg újra nem indul — a WebGLRenderer konstruktora
   dob egy "Error creating WebGL context" hibát.

   Korábban ilyenkor az init() itt elhalt, és mivel a felirat/hint .is-on
   osztályait is az init() adta hozzá, a látogató egy TELJESEN ÜRES sötét
   dobozt kapott — se térkép, se szöveg. Most legalább a szekció üzenete
   megjelenik, a vászon eltűnik, és a szekció összemegy normál magasságra. */
function eumapFallback(reason) {
  const section = document.getElementById('eu-jelenlet');
  if (!section || section.classList.contains('is-nogl')) return;
  section.classList.add('is-nogl', 'is-in');
  const message = document.getElementById('eumapMessage');
  if (message) message.classList.add('is-on');
  console.warn('[eumap] 3D térkép kikapcsolva, tartalék nézet:', reason);
}

/* Van egyáltalán használható WebGL? Olcsó próba a nehéz init ELŐTT — így
   össze sem építjük a jelenetet, ha úgyis elhasalna. */
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

if (!hasWebGL()) {
  eumapFallback('nincs WebGL-kontextus');
} else {
  init().catch((e) => { eumapFallback(e && e.message ? e.message : e); });
}
