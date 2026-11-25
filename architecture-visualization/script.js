/**
 * script.js - Arena Architecture Visualization
 */
const State = {
  currentView: 'global',
  selectedNode: null,
  selectedEntity: null,
};

function qs(sel, ctx) { return (ctx||document).querySelector(sel); }
function qsa(sel, ctx) { return [...(ctx||document).querySelectorAll(sel)]; }
function el(tag, cls) { const e = document.createElement(tag); if(cls) e.className=cls; return e; }
function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));
  return e;
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- NAVIGATION ----
function showView(viewId) {
  State.currentView = viewId;
  qsa('.view, .db-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(viewId === 'global' ? 'view-global' : 'view-'+viewId);
  if (target) target.classList.add('active');
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  if (viewId !== 'global') renderDbView(viewId);
  else renderGlobalArch();
}

// ---- GLOBAL VIEW ----
function renderGlobalArch() {
  renderProjectHero();
  renderDbCards();
  renderArchDiagram();
  renderDataFlows();
  renderTechGrid();
}

function renderProjectHero() {
  const container = qs('#project-hero');
  if (!container) return;
  const p = ARCHITECTURE.project;
  container.innerHTML = '<div class="project-hero-inner"><div class="project-name">'+p.name+'</div><div class="project-desc">'+p.description+'</div><div class="project-badges" id="tech-badges"></div></div>';
  const badgesEl = qs('#tech-badges');
  const catCls = {backend:'badge-backend',database:'badge-database',realtime:'badge-realtime',auth:'badge-auth',infra:'badge-infra',frontend:'badge-frontend'};
  p.technologies.forEach(t => {
    const b = el('span','badge '+(catCls[t.category]||''));
    b.innerHTML = t.icon+' '+t.name;
    badgesEl.appendChild(b);
  });
}

function renderDbCards() {
  const container = qs('#db-cards');
  if (!container) return;
  container.innerHTML = '';
  const dbs = [
    {key:'mongodb',cls:'mongo',label:'MongoDB',icon:'🍃',role:'Profils joueurs, inventaires et historique des parties. Stocke les données persistantes structurées.',owner:'Siham — app/services/mongo_service.py'},
    {key:'redis',cls:'redis',label:'Redis',icon:'🔴',role:'Scores en temps réel, classement mondial (Sorted Set), sessions de quiz avec TTL, Pub/Sub WebSocket.',owner:'Oussama — app/services/redis_service.py'},
    {key:'neo4j',cls:'neo4j',label:'Neo4j',icon:'🕸️',role:"Réseau social des joueurs, amis d'amis, demandes d'ami avec statut, traversal graphe.",owner:'Salma — app/services/neo4j_service.py'}
  ];
  dbs.forEach((db,i) => {
    const card = el('div','db-card '+db.cls);
    card.style.animationDelay = (i*80)+'ms';
    card.innerHTML = '<div class="db-card-icon">'+db.icon+'</div><div class="db-card-name '+db.cls+'">'+db.label+'</div><div class="db-card-role">'+db.role+'</div><div class="db-card-owner">'+db.owner+'</div><div class="db-card-cta">Explorer le schéma <span>→</span></div>';
    card.addEventListener('click', () => showView(db.key));
    container.appendChild(card);
  });
}

// =====================================================================
// PARTIE 2 — à ajouter APRÈS renderDbCards()
// =====================================================================
const COL = { frontend:'#a78bfa', backend:'#38bdf8', service:'#fb923c', mongodb:'#00ED64', redis:'#FF4438', neo4j:'#018BFF' };
const NODE_ICON = { frontend:'🖥️', backend:'⚡', service:'⚙️', mongodb:'🍃', redis:'🔴', neo4j:'🕸️' };
let archRefs = null;
const dbRefs = {};

function toast(msg) {
  const c = qs('#toast-container'); if (!c) return;
  const t = el('div', 'toast'); t.textContent = msg; c.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function sec(title, body) { return '<div><div class="detail-section-title">' + title + '</div>' + body + '</div>'; }
function toolBtn(label, title, fn) {
  const b = el('button', 'tool-btn'); b.textContent = label; b.title = title; b.addEventListener('click', fn); return b;
}

// ---- ZOOM / PAN (partagé par tous les diagrammes) ----
function enablePanZoom(svg, vp) {
  const s = { k: 1, x: 0, y: 0 }; let last = null, moved = 0;
  const apply = () => vp.setAttribute('transform', 'translate(' + s.x + ' ' + s.y + ') scale(' + s.k + ')');
  const pt = (cx, cy) => { const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (p, f) => { const k = Math.min(3, Math.max(0.4, s.k * f)), r = k / s.k; s.x = p.x - (p.x - s.x) * r; s.y = p.y - (p.y - s.y) * r; s.k = k; apply(); };
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(pt(e.clientX, e.clientY), e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  svg.addEventListener('mousedown', e => { last = { x: e.clientX, y: e.clientY }; moved = 0; svg.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', e => {
    if (!last || !svg.isConnected) return;
    const m = svg.getScreenCTM(); if (!m) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy);
    s.x += dx / m.a; s.y += dy / m.d; last = { x: e.clientX, y: e.clientY }; apply();
  });
  window.addEventListener('mouseup', () => { last = null; svg.style.cursor = 'grab'; });
  const center = () => { const vb = svg.viewBox.baseVal; return { x: vb.width / 2, y: vb.height / 2 }; };
  return {
    zoomIn: () => zoomAt(center(), 1.25), zoomOut: () => zoomAt(center(), 0.8),
    reset: () => { s.k = 1; s.x = 0; s.y = 0; apply(); },
    dragged: () => moved > 5
  };
}

// ---- VUE GLOBALE : DIAGRAMME ----
function renderArchDiagram() {
  const host = qs('#arch-canvas'); if (!host) return;
  host.innerHTML = ''; archRefs = { nodes: {}, conns: [] };
  const A = ARCHITECTURE, W = 180, H = 64, byId = Object.fromEntries(A.components.map(c => [c.id, c]));
  const bend = { 'api>redis': 240 };
  const svg = svgEl('svg', { viewBox: '0 0 800 670' }); svg.style.cursor = 'grab';
  const defs = svgEl('defs');
  defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8b9ab8"/></marker>';
  svg.appendChild(defs);
  const vp = svgEl('g'); svg.appendChild(vp);
  const edge = (c, t) => { const dx = t.x - c.x, dy = t.y - c.y; const k = 1 / Math.max(Math.abs(dx) / (W / 2) || 1e-4, Math.abs(dy) / (H / 2) || 1e-4); return { x: c.x + dx * k, y: c.y + dy * k }; };

  A.connections.forEach(cn => {
    const a = byId[cn.from], b = byId[cn.to]; if (!a || !b) return;
    const off = bend[cn.from + '>' + cn.to] || 0;
    const cp = { x: (a.x + b.x) / 2 + off, y: (a.y + b.y) / 2 };
    const p0 = edge(a, off ? cp : b), p1 = edge(b, off ? cp : a);
    const path = svgEl('path', { d: 'M' + p0.x + ' ' + p0.y + ' Q' + cp.x + ' ' + cp.y + ' ' + p1.x + ' ' + p1.y, class: 'arch-connection', stroke: '#8b9ab8', 'marker-end': 'url(#arr)' });
    if (cn.bidirectional) path.setAttribute('marker-start', 'url(#arr)');
    const lx = .25 * p0.x + .5 * cp.x + .25 * p1.x, ly = .25 * p0.y + .5 * cp.y + .25 * p1.y;
    const label = svgEl('text', { x: lx, y: ly - 4, 'text-anchor': 'middle', class: 'conn-label' }); label.textContent = cn.label;
    vp.appendChild(path); vp.appendChild(label);
    archRefs.conns.push({ from: cn.from, to: cn.to, path, label, text: cn.label });
  });

  A.components.forEach(c => {
    const col = COL[c.type] || '#fff';
    const g = svgEl('g', { class: 'svg-box', transform: 'translate(' + (c.x - W / 2) + ' ' + (c.y - H / 2) + ')' });
    g.appendChild(svgEl('rect', { class: 'box-bg', width: W, height: H, rx: 12, fill: col, 'fill-opacity': .1, stroke: col, 'stroke-width': 1.5 }));
    const t1 = svgEl('text', { x: W / 2, y: 28, 'text-anchor': 'middle', fill: col, 'font-size': 14, 'font-weight': 700 }); t1.textContent = (NODE_ICON[c.type] || '') + ' ' + c.label;
    const t2 = svgEl('text', { x: W / 2, y: 47, 'text-anchor': 'middle', fill: '#8b9ab8', 'font-size': 9.5 }); t2.textContent = c.sublabel;
    g.appendChild(t1); g.appendChild(t2);
    g.addEventListener('click', () => { if (!pz.dragged()) selectNode(c.id); });
    if (c.dbId) g.addEventListener('dblclick', () => showView(c.dbId));
    vp.appendChild(g); archRefs.nodes[c.id] = g;
  });
  host.appendChild(svg);
  const pz = enablePanZoom(svg, vp); archRefs.pz = pz;
  svg.addEventListener('click', e => { if (e.target === svg && !pz.dragged()) clearNode(); });
  const bind = (id, fn) => { const b = qs(id); if (b) b.onclick = fn; };
  bind('#arch-zoom-in', pz.zoomIn); bind('#arch-zoom-out', pz.zoomOut);
  bind('#arch-reset', () => { pz.reset(); clearNode(); });
}

function clearNode() {
  State.selectedNode = null; if (!archRefs) return;
  Object.values(archRefs.nodes).forEach(g => { g.style.opacity = 1; g.firstChild.setAttribute('stroke-width', 1.5); });
  archRefs.conns.forEach(c => { c.path.classList.remove('conn-highlighted'); c.path.style.cssText = ''; c.label.style.opacity = 1; });
  const p = qs('#info-panel'); if (p) p.classList.remove('visible');
}

function selectNode(id) {
  if (!archRefs || !archRefs.nodes[id]) return;
  State.selectedNode = id;
  Object.entries(archRefs.nodes).forEach(([k, g]) => {
    const rel = k === id || archRefs.conns.some(c => (c.from === id && c.to === k) || (c.to === id && c.from === k));
    g.style.opacity = rel ? 1 : .3; g.firstChild.setAttribute('stroke-width', k === id ? 3.5 : 1.5);
  });
  archRefs.conns.forEach(c => {
    const on = c.from === id || c.to === id;
    c.path.classList.toggle('conn-highlighted', on);
    c.path.style.opacity = on ? 1 : .1; c.path.style.strokeDasharray = on ? '6 4' : '';
    c.path.style.animation = on ? 'flow-dash 1s linear infinite' : ''; c.label.style.opacity = on ? 1 : .15;
  });
  const c = ARCHITECTURE.components.find(x => x.id === id), p = qs('#info-panel'); if (!c || !p) return;
  const names = Object.fromEntries(ARCHITECTURE.components.map(x => [x.id, x.label]));
  const conns = archRefs.conns.filter(x => x.from === id || x.to === id)
    .map(x => '<div class="info-panel-detail-item">' + escapeHtml(names[x.from]) + ' → ' + escapeHtml(names[x.to]) + ' · ' + escapeHtml(x.text) + '</div>').join('');
  p.innerHTML = '<button class="info-panel-close" id="info-close">✕</button>'
    + '<div class="info-panel-title" style="color:' + COL[c.type] + '">' + (NODE_ICON[c.type] || '') + ' ' + escapeHtml(c.label) + '</div>'
    + '<div class="detail-type">' + escapeHtml(c.sublabel) + '</div>'
    + '<div class="info-panel-desc">' + escapeHtml(c.description) + '</div>'
    + (c.details ? '<div class="detail-section-title">Détails</div><div class="info-panel-details">' + c.details.map(d => '<div class="info-panel-detail-item">' + escapeHtml(d) + '</div>').join('') + '</div>' : '')
    + '<div class="detail-section-title">Connexions</div><div class="info-panel-details">' + conns + '</div>'
    + (c.dbId ? '<button class="open-db-btn" id="open-db">Ouvrir le schéma →</button>' : '');
  p.classList.add('visible');
  qs('#info-close').onclick = clearNode;
  const ob = qs('#open-db'); if (ob) ob.onclick = () => showView(c.dbId);
}

// ---- FLUX DE DONNÉES & TECHNOLOGIES ----
function renderDataFlows() {
  const host = qs('#data-flows'); if (!host) return; host.innerHTML = '';
  ARCHITECTURE.dataFlows.forEach((f, i) => {
    const card = el('div', 'flow-card'); card.id = 'flow-' + f.id; card.style.animationDelay = (i * 80) + 'ms';
    card.innerHTML = '<div class="flow-name">' + escapeHtml(f.name) + '</div><div class="flow-endpoint">' + escapeHtml(f.endpoint) + '</div><div class="flow-steps">'
      + f.steps.map(s => '<div class="flow-step"><span class="flow-step-icon">' + s.icon + '</span>'
        + (s.db !== 'none' ? '<span class="flow-step-db ' + s.db + '">' + s.db + '</span>' : '')
        + '<span>' + escapeHtml(s.action) + '</span></div>').join('') + '</div>';
    host.appendChild(card);
  });
}
function renderTechGrid() {
  const host = qs('#tech-grid'); if (!host) return; host.innerHTML = '';
  ARCHITECTURE.project.technologies.forEach((t, i) => {
    const c = el('div', 'tech-chip'); c.style.animationDelay = (i * 40) + 'ms'; c.textContent = t.icon + ' ' + t.name; host.appendChild(c);
  });
}

// ---- VUES BASES DE DONNÉES ----
function dbEntities(key) {
  const d = ARCHITECTURE.databases[key];
  if (key === 'mongodb') return d.collections.map(c => ({ ...c, group: 'Collections', type: 'Collection', fields: c.fields, ops: c.operations }));
  if (key === 'redis') return d.structures.map(s => ({ ...s, group: 'Structures', ops: s.operations }));
  return [
    ...d.nodes.map(n => ({ ...n, group: 'Nœuds', type: 'Node ' + n.label, fields: n.properties, ops: n.operations })),
    ...d.relationships.map(r => ({ ...r, group: 'Relations', type: 'Relationship ' + r.pattern, fields: r.properties, ops: r.operations }))
  ];
}
const LAYOUT = {
  mongodb: { vb: [900, 400], w: 330, pos: { col_joueurs: [30, 30], col_historique: [540, 30] },
    links: [{ a: ['col_historique', 'joueur_id'], b: ['col_joueurs', '_id'], label: 'joueur_id → _id (réf.)' }] },
  redis: { vb: [900, 330], w: 240, pos: { redis_quiz_session: [10, 30], redis_sorted_set: [330, 30], redis_pubsub: [650, 30] },
    links: [{ a: ['redis_quiz_session'], b: ['redis_sorted_set'], label: 'ZINCRBY' }, { a: ['redis_sorted_set'], b: ['redis_pubsub'], label: "PUBLISH 'maj'", dash: true }] },
  neo4j: { vb: [900, 330], w: 290, pos: { node_joueur: [60, 140], rel_ami_de: [530, 140] },
    links: [{ a: ['node_joueur'], b: ['rel_ami_de'], label: 'propriétés', dash: true }] }
};

function drawCard(parent, e, x, y, w, col) {
  const hdr = 46, rowH = 22, fields = e.fields || [], h = hdr + fields.length * rowH + 10;
  const g = svgEl('g', { class: 'svg-box', transform: 'translate(' + x + ' ' + y + ')' }), rows = {};
  g.appendChild(svgEl('rect', { class: 'box-bg', width: w, height: h, rx: 12, fill: col, 'fill-opacity': .07, stroke: col, 'stroke-width': 1.5 }));
  const t = (txt, attrs) => { const n = svgEl('text', attrs); n.textContent = txt; g.appendChild(n); return n; };
  t(e.icon + ' ' + e.name, { x: 12, y: 20, fill: col, 'font-size': 13, 'font-weight': 700 });
  t(e.type, { x: 12, y: 36, fill: '#8b9ab8', 'font-size': 9.5, 'font-family': 'monospace' });
  g.appendChild(svgEl('line', { x1: 0, x2: w, y1: hdr, y2: hdr, stroke: col, 'stroke-opacity': .25 }));
  fields.forEach((f, i) => {
    const ry = hdr + i * rowH + 15; rows[f.name] = y + hdr + i * rowH + rowH / 2;
    t(f.name, { x: 12, y: ry, fill: '#f0f4ff', 'font-size': 11, 'font-family': 'monospace' });
    t((f.pk ? 'PK ' : f.fk ? 'FK ' : '') + f.type, { x: w - 12, y: ry, 'text-anchor': 'end', fill: f.pk ? '#fb923c' : f.fk ? '#60a5fa' : '#8b9ab8', 'font-size': 9.5, 'font-family': 'monospace' });
  });
  parent.appendChild(g);
  return { g, x, y, w, h, rows };
}

function renderDbView(key) {
  const host = document.getElementById('view-' + key), d = ARCHITECTURE.databases[key]; if (!host || !d) return;
  const ents = dbEntities(key), col = COL[key], lay = LAYOUT[key];
  const port = d.port ? 'port ' + d.port : 'http ' + d.ports.http + ' · bolt ' + d.ports.bolt;
  const chips = ['v' + d.version, port, d.containerName, d.module, 'Resp. : ' + d.responsible];
  const groups = [...new Set(ents.map(e => e.group))];
  host.innerHTML = '<aside class="db-sidebar"><div class="db-sidebar-header"><button class="db-back-btn" id="back-' + key + '">← Vue globale</button>'
    + '<div class="db-sidebar-name" style="color:' + col + '">' + d.icon + ' ' + d.name + '</div><div class="db-sidebar-tagline">' + escapeHtml(d.tagline) + '</div>'
    + '<div class="db-sidebar-tagline">' + escapeHtml(d.description) + '</div><div class="db-meta-row">' + chips.map(c => '<span class="db-meta-chip">' + escapeHtml(c) + '</span>').join('') + '</div></div>'
    + '<div class="db-sidebar-nav">' + groups.map(gr => '<div class="nav-section"><div class="nav-section-label">' + gr + '</div>'
      + ents.filter(e => e.group === gr).map(e => '<button class="entity-btn" data-ent="' + e.id + '"><span class="entity-btn-icon">' + e.icon + '</span><span><div class="entity-btn-name">' + escapeHtml(e.name) + '</div><div class="entity-btn-type">' + escapeHtml(e.type) + '</div></span></button>').join('') + '</div>').join('') + '</div></aside>'
    + '<div class="db-main"><div class="db-diagram-area"><div class="db-diagram-bg"></div><div class="db-diagram-canvas" id="canvas-' + key + '"></div>'
    + '<div class="db-diagram-tools" id="tools-' + key + '"></div><div class="diagram-hint"><span class="hint-item">🖱️ Glisser = déplacer</span><span class="hint-item">⚲ Molette = zoom</span><span class="hint-item">Clic = détails</span></div></div>'
    + '<aside class="detail-panel" id="detail-' + key + '"><div class="detail-panel-empty"><div class="detail-panel-empty-icon">' + d.icon + '</div><div class="detail-panel-empty-text">Sélectionne un élément du diagramme pour voir ses détails.</div></div></aside></div>';

  const svg = svgEl('svg', { viewBox: '0 0 ' + lay.vb[0] + ' ' + lay.vb[1] }); svg.style.cursor = 'grab';
  const defs = svgEl('defs');
  defs.innerHTML = '<marker id="arr-' + key + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' + col + '"/></marker>';
  svg.appendChild(defs);
  const vp = svgEl('g'); svg.appendChild(vp);
  const linkG = svgEl('g'); vp.appendChild(linkG);
  const refs = dbRefs[key] = { boxes: {}, links: [], ents, key };

  ents.forEach(e => {
    const p = lay.pos[e.id]; if (!p) return;
    const c = drawCard(vp, e, p[0], p[1], lay.w, col); refs.boxes[e.id] = c;
    c.g.addEventListener('click', () => { if (!pz.dragged()) selectEntity(key, e.id); });
  });
  lay.links.forEach(l => {
    const A = refs.boxes[l.a[0]], B = refs.boxes[l.b[0]]; if (!A || !B) return;
    const left = A.x < B.x, x1 = left ? A.x + A.w : A.x, x2 = left ? B.x : B.x + B.w;
    const y1 = l.a[1] && A.rows[l.a[1]] ? A.rows[l.a[1]] : A.y + 60, y2 = l.b[1] && B.rows[l.b[1]] ? B.rows[l.b[1]] : B.y + 60, mx = (x1 + x2) / 2;
    const path = svgEl('path', { d: 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2, class: 'arch-connection', stroke: col, 'marker-end': 'url(#arr-' + key + ')' });
    if (l.dash) path.setAttribute('stroke-dasharray', '5 4');
    const t = svgEl('text', { x: mx, y: Math.min(y1, y2) - 8, 'text-anchor': 'middle', class: 'conn-label' }); t.textContent = l.label;
    linkG.appendChild(path); linkG.appendChild(t); refs.links.push({ a: l.a[0], b: l.b[0], path, t });
  });
  if (key === 'neo4j') { // boucle (:Joueur)-[:AMI_DE]->(:Joueur)
    const J = refs.boxes.node_joueur;
    if (J) {
      const lp = svgEl('path', { d: 'M' + (J.x + 60) + ' ' + J.y + ' C' + (J.x + 20) + ' ' + (J.y - 90) + ' ' + (J.x + 240) + ' ' + (J.y - 90) + ' ' + (J.x + 200) + ' ' + J.y, class: 'arch-connection svg-box', stroke: col, 'stroke-width': 2.5, 'marker-end': 'url(#arr-' + key + ')' });
      const lt = svgEl('text', { x: J.x + 130, y: J.y - 62, 'text-anchor': 'middle', fill: col, 'font-size': 12, 'font-weight': 700 }); lt.textContent = ':AMI_DE';
      lp.style.cursor = 'pointer'; lp.addEventListener('click', () => selectEntity(key, 'rel_ami_de'));
      vp.appendChild(lp); vp.appendChild(lt); refs.links.push({ a: 'node_joueur', b: 'rel_ami_de', path: lp, t: lt });
    }
  }
  qs('#canvas-' + key).appendChild(svg);
  const pz = enablePanZoom(svg, vp), tools = qs('#tools-' + key);
  tools.append(toolBtn('+', 'Zoom +', pz.zoomIn), toolBtn('−', 'Zoom −', pz.zoomOut), toolBtn('⟲', 'Réinitialiser', () => { pz.reset(); selectEntity(key, null); }));
  svg.addEventListener('click', e => { if (e.target === svg && !pz.dragged()) selectEntity(key, null); });
  qs('#back-' + key).onclick = () => showView('global');
  qsa('.entity-btn', host).forEach(b => b.addEventListener('click', () => selectEntity(key, b.dataset.ent)));
}

function selectEntity(key, id) {
  const r = dbRefs[key]; if (!r) return;
  State.selectedEntity = id;
  const rel = id ? new Set([id, ...r.links.filter(l => l.a === id || l.b === id).flatMap(l => [l.a, l.b])]) : null;
  Object.entries(r.boxes).forEach(([k, b]) => { b.g.style.opacity = !rel || rel.has(k) ? 1 : .3; b.g.firstChild.setAttribute('stroke-width', k === id ? 3.5 : 1.5); });
  r.links.forEach(l => {
    const on = !!id && (l.a === id || l.b === id);
    l.path.classList.toggle('conn-highlighted', on); l.path.style.opacity = !id ? '' : on ? 1 : .1;
    l.path.style.animation = on ? 'flow-dash 1s linear infinite' : ''; if (on) l.path.style.strokeDasharray = '6 4'; else l.path.style.strokeDasharray = '';
  });
  qsa('.entity-btn', document.getElementById('view-' + key)).forEach(b => b.classList.toggle('active', b.dataset.ent === id));
  const panel = qs('#detail-' + key), e = r.ents.find(x => x.id === id); if (!panel) return;
  if (!e) { panel.innerHTML = '<div class="detail-panel-empty"><div class="detail-panel-empty-icon">' + ARCHITECTURE.databases[key].icon + '</div><div class="detail-panel-empty-text">Sélectionne un élément du diagramme pour voir ses détails.</div></div>'; return; }
  panel.innerHTML = detailHtml(key, e);
}

function detailHtml(key, e) {
  const d = ARCHITECTURE.databases[key], esc = escapeHtml;
  let h = '<div class="detail-panel-content"><div class="detail-header"><div class="detail-icon">' + e.icon + '</div><div><div class="detail-name" style="color:' + COL[key] + '">' + esc(e.name) + '</div><span class="detail-type">' + esc(e.type) + '</span></div></div>'
    + '<div class="detail-desc">' + esc(e.description) + '</div>' + (e.role ? '<div class="detail-role">' + esc(e.role) + '</div>' : '');
  if (e.key) h += sec('Clé Redis', '<div class="op-item">' + esc(e.key) + '</div>');
  if (e.constraint) h += sec('Contrainte', '<div class="constraint-block">' + esc(e.constraint) + '</div>');
  if (e.indexes) h += sec('Index', '<div class="ops-list">' + e.indexes.map(i => '<div class="op-item">' + esc(i) + '</div>').join('') + '</div>');
  if (e.fields && e.fields.length) h += sec('Champs / propriétés', '<div class="fields-table">' + e.fields.map(f => '<div class="field-row"><div><div class="field-name">' + esc(f.name) + '</div><div class="field-badges">'
    + (f.pk ? '<span class="field-badge pk">PK</span>' : '') + (f.fk ? '<span class="field-badge fk">FK → ' + esc(f.fk) + '</span>' : '') + '</div></div><div class="field-type">' + esc(f.type) + '</div><div class="field-desc">' + esc(f.description) + '</div></div>').join('') + '</div>');
  if (e.statuses) h += sec('Statuts', '<div class="status-list">' + e.statuses.map(s => '<div class="status-item ' + (s.value === 'acceptee' ? 'status-accepted' : 'status-pending') + '"><div class="status-value">' + esc(s.value) + '</div><div class="status-desc">' + esc(s.description) + '</div></div>').join('') + '</div>');
  if (e.aggregation) h += sec('Aggregation pipeline', '<div class="detail-desc">' + esc(e.aggregation.description) + '</div><div class="agg-steps">' + e.aggregation.steps.map(s => '<div class="agg-step">' + esc(s) + '</div>').join('') + '</div>');
  if (e.ops) h += sec('Opérations', '<div class="ops-list">' + e.ops.map(o => '<div class="op-item">' + esc(o) + '</div>').join('') + '</div>');
  if (e.characteristics) h += sec('Caractéristiques', '<div class="char-list">' + e.characteristics.map(c => '<div class="char-item">' + esc(c) + '</div>').join('') + '</div>');
  if (e.id === 'rel_ami_de' && d.cypher_examples) h += sec('Requêtes Cypher', d.cypher_examples.map(c => '<div class="cypher-block"><div class="cypher-name">' + esc(c.name) + '</div><div class="cypher-desc">' + esc(c.description) + '</div><div class="cypher-code">' + esc(c.query) + '</div></div>').join(''));
  return h + '</div>';
}

// ---- RECHERCHE ----
function buildSearchIndex() {
  const A = ARCHITECTURE, idx = [];
  A.components.forEach(c => idx.push({ icon: NODE_ICON[c.type], name: c.label, sub: 'Composant · ' + c.sublabel, desc: c.description, go: () => { showView('global'); selectNode(c.id); } }));
  Object.keys(A.databases).forEach(k => dbEntities(k).forEach(e => {
    idx.push({ icon: e.icon, name: e.name, sub: A.databases[k].name + ' · ' + e.type, desc: e.description, go: () => { showView(k); selectEntity(k, e.id); } });
    (e.fields || []).forEach(f => idx.push({ icon: '▫️', name: e.name + '.' + f.name, sub: A.databases[k].name + ' · champ · ' + f.type, desc: f.description, go: () => { showView(k); selectEntity(k, e.id); } }));
  }));
  A.dataFlows.forEach(f => idx.push({ icon: '🔀', name: f.name, sub: 'Flux · ' + f.endpoint, desc: f.steps.map(s => s.action).join(' → '), go: () => { showView('global'); const c = document.getElementById('flow-' + f.id); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }));
  return idx;
}
function initSearch() {
  const ov = qs('#search-overlay'), inp = qs('#search-input'), res = qs('#search-results'), trig = qs('#search-trigger');
  if (!ov || !inp || !res) return;
  let idx = null;
  const close = () => { ov.classList.remove('visible'); inp.value = ''; };
  const open = () => { if (!idx) idx = buildSearchIndex(); ov.classList.add('visible'); inp.focus(); render(''); };
  const render = q => {
    q = q.trim().toLowerCase();
    const hits = (q ? idx.filter(i => (i.name + ' ' + i.sub + ' ' + i.desc).toLowerCase().includes(q)) : idx.filter(i => !i.name.includes('.'))).slice(0, 12);
    res.innerHTML = hits.length ? '' : '<div class="search-empty">Aucun résultat</div>';
    hits.forEach(h => {
      const it = el('div', 'search-result-item');
      it.innerHTML = '<span class="search-result-icon">' + h.icon + '</span><div><div class="search-result-name">' + escapeHtml(h.name) + '</div><div class="search-result-db">' + escapeHtml(h.sub) + '</div><div class="search-result-desc">' + escapeHtml(h.desc.slice(0, 110)) + '…</div></div>';
      it.addEventListener('click', () => { close(); h.go(); }); res.appendChild(it);
    });
    res.firstChild && res.firstChild.classList && res.firstChild.classList.add('active');
  };
  inp.addEventListener('input', () => render(inp.value));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = res.querySelector('.search-result-item'); if (f) f.click(); } });
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  if (trig) { trig.addEventListener('focus', () => { trig.blur(); open(); }); trig.addEventListener('click', open); }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    else if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); open(); }
    else if (e.key === 'Escape') { if (ov.classList.contains('visible')) close(); else if (State.currentView === 'global') clearNode(); else selectEntity(State.currentView, null); }
  });
}

// ---- INITIALISATION ----
document.addEventListener('DOMContentLoaded', () => {
  qsa('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  initSearch();
  showView('global');
});