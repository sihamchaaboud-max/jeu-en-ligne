'use strict';

const svg = document.getElementById('connections');
const svgNS = 'http://www.w3.org/2000/svg';
const components = [...document.querySelectorAll('.component')];

const connections = [
  { from: 'ui-auth', to: 'api-auth', type: 'http', curve: 0 },
  { from: 'ui-quiz', to: 'api-quiz', type: 'http', curve: 0 },
  { from: 'ui-ranking', to: 'api-ranking', type: 'http', curve: 0 },
  { from: 'ui-social', to: 'api-social', type: 'http', curve: 0 },
  { from: 'ui-dashboard', to: 'api-players', type: 'http', curve: -8 },
  { from: 'ui-dashboard', to: 'api-ws', type: 'ws', label: 'Top 10 en direct', curve: 12 },

  { from: 'api-auth', to: 'svc-auth', type: 'call', curve: 0 },
  { from: 'api-quiz', to: 'svc-quiz', type: 'call', curve: 0 },
  { from: 'api-players', to: 'svc-player', type: 'call', curve: -12 },
  { from: 'api-ranking', to: 'svc-player', type: 'call', curve: 12 },

  { from: 'api-auth', to: 'db-mongo', type: 'data', curve: -30 },
  { from: 'api-quiz', to: 'db-redis', type: 'data', curve: -16 },
  { from: 'api-quiz', to: 'db-mongo', type: 'data', curve: 18 },
  { from: 'api-players', to: 'db-mongo', type: 'data', curve: -26 },
  { from: 'api-players', to: 'db-redis', type: 'data', curve: 0 },
  { from: 'api-players', to: 'db-neo4j', type: 'data', curve: 26 },
  { from: 'api-ranking', to: 'db-mongo', type: 'data', curve: -16 },
  { from: 'api-ranking', to: 'db-redis', type: 'data', curve: 16 },
  { from: 'api-social', to: 'db-mongo', type: 'data', curve: -22 },
  { from: 'api-social', to: 'db-redis', type: 'data', curve: 0 },
  { from: 'api-social', to: 'db-neo4j', type: 'data', curve: 0 },
  { from: 'api-ws', to: 'db-redis', type: 'data', curve: 25 },

  { from: 'svc-player', to: 'db-mongo', type: 'data', curve: -16 },
  { from: 'svc-player', to: 'db-redis', type: 'data', curve: 0 },
  { from: 'svc-player', to: 'db-neo4j', type: 'data', curve: 16 },
];

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function addMarkers() {
  const defs = svgElement('defs', {});
  [
    ['http', '#80aaff'],
    ['ws', '#f3c779'],
    ['call', '#ba9eff'],
    ['data', '#63d7a2'],
  ].forEach(([name, color]) => {
    const marker = svgElement('marker', {
      id: `arrow-${name}`,
      markerWidth: 7,
      markerHeight: 7,
      refX: 6,
      refY: 3.5,
      orient: 'auto-start-reverse',
      markerUnits: 'strokeWidth',
    });
    marker.appendChild(svgElement('path', { d: 'M 0 0 L 7 3.5 L 0 7 z', fill: color }));
    defs.appendChild(marker);
  });
  svg.appendChild(defs);
}

function edgePoint(center, target, bounds) {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const scale = 1 / Math.max(Math.abs(dx) / (bounds.width / 2), Math.abs(dy) / (bounds.height / 2), 0.001);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function getPath(connection, canvasRect) {
  const from = document.getElementById(connection.from);
  const to = document.getElementById(connection.to);
  const fromRect = from.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();
  const startCenter = {
    x: fromRect.left - canvasRect.left + fromRect.width / 2,
    y: fromRect.top - canvasRect.top + fromRect.height / 2,
  };
  const endCenter = {
    x: toRect.left - canvasRect.left + toRect.width / 2,
    y: toRect.top - canvasRect.top + toRect.height / 2,
  };
  const start = edgePoint(startCenter, endCenter, fromRect);
  const end = edgePoint(endCenter, startCenter, toRect);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = connection.curve || 0;
  const control = {
    x: (start.x + end.x) / 2 - (dy / length) * offset,
    y: (start.y + end.y) / 2 + (dx / length) * offset,
  };
  return {
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    label: control,
  };
}

function drawConnections() {
  const bounds = svg.parentElement.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  svg.replaceChildren();
  addMarkers();

  connections.forEach((connection, index) => {
    const path = getPath(connection, bounds);
    const attributes = {
      d: path.d,
      class: `flow-path flow-${connection.type}`,
      'data-index': index,
      'marker-end': `url(#arrow-${connection.type})`,
    };
    if (connection.type === 'http' || connection.type === 'ws') {
      attributes['marker-start'] = `url(#arrow-${connection.type})`;
    }
    svg.appendChild(svgElement('path', attributes));

    if (connection.label) {
      const label = svgElement('text', {
        x: path.label.x,
        y: path.label.y - 7,
        class: 'flow-label',
        'data-index': index,
      });
      label.textContent = connection.label;
      svg.appendChild(label);
    }
  });
  highlightConnections(null);
}

function highlightConnections(componentId) {
  connections.forEach((connection, index) => {
    const related = componentId && (connection.from === componentId || connection.to === componentId);
    const path = svg.querySelector(`.flow-path[data-index="${index}"]`);
    const label = svg.querySelector(`.flow-label[data-index="${index}"]`);
    path.classList.toggle('is-muted', Boolean(componentId && !related));
    path.classList.toggle('is-related', Boolean(related));
    if (label) label.classList.toggle('is-muted', Boolean(componentId && !related));
  });

  components.forEach((component) => {
    const related = componentId && connections.some((connection) =>
      (connection.from === componentId && connection.to === component.id)
      || (connection.to === componentId && connection.from === component.id)
    );
    component.classList.toggle('is-muted', Boolean(componentId && component.id !== componentId && !related));
    component.classList.toggle('is-related', Boolean(related));
  });
}

components.forEach((component) => {
  component.addEventListener('mouseenter', () => highlightConnections(component.id));
  component.addEventListener('mouseleave', () => highlightConnections(null));
  component.addEventListener('focus', () => highlightConnections(component.id));
  component.addEventListener('blur', () => highlightConnections(null));
});

let redrawFrame = 0;
function scheduleRedraw() {
  cancelAnimationFrame(redrawFrame);
  redrawFrame = requestAnimationFrame(drawConnections);
}

if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(scheduleRedraw);
  observer.observe(svg.parentElement);
  components.forEach((component) => observer.observe(component));
} else {
  window.addEventListener('resize', scheduleRedraw);
}

window.addEventListener('load', scheduleRedraw, { once: true });
scheduleRedraw();
