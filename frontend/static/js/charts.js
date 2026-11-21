/* ═══════════════════════════════════════════════════════════════
   ARENA — Graphiques de progression (Chart.js)
   Dessine la courbe des points par partie dans le tiroir de profil.
   Appelé par app.js (chargerHistorique) via dessinerGraphiqueProfil().
   ═══════════════════════════════════════════════════════════════ */
'use strict';

let _profilChart = null;

function dessinerGraphiqueProfil(historique) {
  const canvas = document.getElementById('profilChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (!historique || historique.length < 2) return;   // pas assez de données

  // historique = plus récent → plus ancien ; on inverse pour la lecture temporelle
  const parties = historique.slice(0, 15).reverse();
  const labels = parties.map((p) =>
    new Date(p.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
  const points = parties.map((p) => p.points);

  const ctx = canvas.getContext('2d');
  if (_profilChart) { _profilChart.destroy(); _profilChart = null; }

  const styles = getComputedStyle(document.documentElement);
  const cOr    = styles.getPropertyValue('--accent').trim() || '#F2B03D';
  const cGrid  = 'rgba(255,255,255,0.055)';
  const cTexte = styles.getPropertyValue('--text-tertiary').trim() || '#8A8880';
  const police = "11px 'JetBrains Mono', monospace";

  // Dégradé d'aire : la courbe devient une nappe de lumière
  const hauteur = canvas.clientHeight || canvas.parentElement?.clientHeight || 180;
  const nappe = ctx.createLinearGradient(0, 0, 0, hauteur);
  nappe.addColorStop(0, 'rgba(242,176,61,0.24)');
  nappe.addColorStop(0.55, 'rgba(242,176,61,0.07)');
  nappe.addColorStop(1, 'rgba(242,176,61,0)');

  _profilChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Points par partie',
        data: points,
        borderColor: cOr,
        backgroundColor: nappe,
        pointBackgroundColor: '#0C0E12',
        pointBorderColor: cOr,
        pointBorderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: cOr,
        pointHoverBorderColor: '#FFE0A3',
        pointHoverBorderWidth: 2,
        borderWidth: 2.2,
        tension: 0.38,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20,22,28,0.96)',
          borderColor: 'rgba(242,176,61,0.28)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          displayColors: false,
          titleFont: { family: 'Inter', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y} pts`,
          },
        },
      },
      scales: {
        x: {
          border: { display: false },
          grid: { color: cGrid, drawTicks: false },
          ticks: { color: cTexte, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, padding: 6 },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: cGrid, drawTicks: false },
          ticks: { color: cTexte, font: { size: 10 }, maxTicksLimit: 5, padding: 8 },
        },
      },
    },
  });
}
